import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetModelCircuitBreakers } from "@/ai/resilience";
import {
  ArmorIQUnavailableError,
  isArmorIQUpstreamFailure,
  withArmorIQBreaker,
} from "./armoriq-breaker";

const timeout = () =>
  Object.assign(new Error("ArmorIQ policy verification timed out"), {
    name: "ArmorIQTimeoutError",
    status: 504,
  });

describe("isArmorIQUpstreamFailure (#1376)", () => {
  it.each([
    ["ArmorIQ timeout error", timeout()],
    [
      "unreachable gateway by name",
      Object.assign(new Error("down"), { name: "ArmorIQUnreachableError" }),
    ],
    ["DNS failure code", Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" })],
    ["connection refused code", Object.assign(new Error("refused"), { code: "ECONNREFUSED" })],
    ["HTTP 500", { status: 500 }],
    ["HTTP 502 via statusCode", { statusCode: 502 }],
    ["rate limit", { status: 429 }],
    ["generic timeout message", new Error("request timed out")],
  ])("treats %s as an upstream failure", (_label, error) => {
    expect(isArmorIQUpstreamFailure(error)).toBe(true);
  });

  it.each([
    ["a rejected token", new Error("Invalid intent token")],
    ["HTTP 400", { status: 400 }],
    ["HTTP 403", { status: 403 }],
    ["null", null],
    ["a string", "boom"],
  ])("does not treat %s as an upstream failure", (_label, error) => {
    expect(isArmorIQUpstreamFailure(error)).toBe(false);
  });
});

describe("withArmorIQBreaker (#1376)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetModelCircuitBreakers();
    delete process.env.ARMORIQ_CIRCUIT_FAILURE_THRESHOLD;
    delete process.env.ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    resetModelCircuitBreakers();
  });

  it("returns the result of a healthy call", async () => {
    await expect(withArmorIQBreaker(async () => "ok")).resolves.toBe("ok");
  });

  it("passes the original error through while the circuit is still closed", async () => {
    const error = timeout();

    await expect(withArmorIQBreaker(() => Promise.reject(error))).rejects.toBe(error);
  });

  it("opens after three consecutive upstream failures and then skips the call entirely", async () => {
    const operation = vi.fn().mockRejectedValue(timeout());

    for (let i = 0; i < 3; i++) {
      await expect(withArmorIQBreaker(operation)).rejects.toMatchObject({
        name: "ArmorIQTimeoutError",
      });
    }
    expect(operation).toHaveBeenCalledTimes(3);

    const blocked = withArmorIQBreaker(operation);
    await expect(blocked).rejects.toBeInstanceOf(ArmorIQUnavailableError);
    await expect(blocked).rejects.toMatchObject({ status: 503 });
    await expect(blocked).rejects.toThrow(/not authorized/);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not count answers from ArmorIQ that are not outages", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Invalid intent token"));

    for (let i = 0; i < 6; i++) {
      await expect(withArmorIQBreaker(operation)).rejects.toThrow("Invalid intent token");
    }

    expect(operation).toHaveBeenCalledTimes(6);
  });

  it("resets the failure count after a success", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce("recovered")
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce("still closed");

    await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    await expect(withArmorIQBreaker(operation)).resolves.toBe("recovered");
    await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    await expect(withArmorIQBreaker(operation)).resolves.toBe("still closed");
  });

  it("lets one probe through after the cool-down and closes on success", async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue("back");
    for (let i = 0; i < 3; i++) {
      await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    }
    await expect(withArmorIQBreaker(operation)).rejects.toBeInstanceOf(ArmorIQUnavailableError);

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(withArmorIQBreaker(operation)).resolves.toBe("back");
    await expect(withArmorIQBreaker(operation)).resolves.toBe("back");
  });

  it("reopens when the probe fails", async () => {
    vi.useFakeTimers();
    const operation = vi.fn().mockRejectedValue(timeout());
    for (let i = 0; i < 3; i++) {
      await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();
    }
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(withArmorIQBreaker(operation)).rejects.toMatchObject({
      name: "ArmorIQTimeoutError",
    });
    expect(operation).toHaveBeenCalledTimes(4);

    await expect(withArmorIQBreaker(operation)).rejects.toBeInstanceOf(ArmorIQUnavailableError);
    expect(operation).toHaveBeenCalledTimes(4);
  });

  it("honours ARMORIQ_CIRCUIT_FAILURE_THRESHOLD", async () => {
    process.env.ARMORIQ_CIRCUIT_FAILURE_THRESHOLD = "1";
    const operation = vi.fn().mockRejectedValue(timeout());

    await expect(withArmorIQBreaker(operation)).rejects.toMatchObject({
      name: "ArmorIQTimeoutError",
    });
    await expect(withArmorIQBreaker(operation)).rejects.toBeInstanceOf(ArmorIQUnavailableError);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("honours ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    process.env.ARMORIQ_CIRCUIT_FAILURE_THRESHOLD = "1";
    process.env.ARMORIQ_CIRCUIT_RESET_TIMEOUT_MS = "5000";
    const operation = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValue("ok");
    await expect(withArmorIQBreaker(operation)).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(4_999);
    await expect(withArmorIQBreaker(operation)).rejects.toBeInstanceOf(ArmorIQUnavailableError);

    await vi.advanceTimersByTimeAsync(1);
    await expect(withArmorIQBreaker(operation)).resolves.toBe("ok");
  });

  it.each(["0", "-2", "abc", ""])("falls back to the default threshold for %j", async (raw) => {
    process.env.ARMORIQ_CIRCUIT_FAILURE_THRESHOLD = raw;
    const operation = vi.fn().mockRejectedValue(timeout());

    for (let i = 0; i < 3; i++) {
      await expect(withArmorIQBreaker(operation)).rejects.toMatchObject({
        name: "ArmorIQTimeoutError",
      });
    }
    await expect(withArmorIQBreaker(operation)).rejects.toBeInstanceOf(ArmorIQUnavailableError);

    expect(operation).toHaveBeenCalledTimes(3);
  });
});
