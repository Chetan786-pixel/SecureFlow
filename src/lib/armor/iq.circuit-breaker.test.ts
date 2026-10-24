import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sdk } = vi.hoisted(() => {
  process.env.ARMORIQ_API_KEY = "test-armoriq-key";
  return {
    sdk: {
      ensureIapPublicKey: vi.fn(),
      verifyToken: vi.fn(),
      getIntentToken: vi.fn(),
    },
  };
});

vi.mock("@armoriq/sdk", () => ({
  ArmorIQClient: class {
    ensureIapPublicKey = sdk.ensureIapPublicKey;
    verifyToken = sdk.verifyToken;
    getIntentToken = sdk.getIntentToken;
    forUser = vi.fn();
  },
}));

vi.mock("@/lib/prisma", () => ({ default: {} }));

import { resetModelCircuitBreakers } from "@/ai/resilience";
import { ArmorIQService } from "./iq";
import { ArmorIQUnavailableError } from "./armoriq-breaker";

const { publicKey } = generateKeyPairSync("ed25519");
const publicKeyHex = publicKey
  .export({ format: "der", type: "spki" })
  .subarray(-32)
  .toString("hex");

const token = { rawToken: { token: { public_key: publicKeyHex } } } as never;

const timeout = () =>
  Object.assign(new Error("ArmorIQ policy verification timed out after 15000ms"), {
    name: "ArmorIQTimeoutError",
    status: 504,
  });

describe("ArmorIQService circuit breaker (#1376)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetModelCircuitBreakers();
    sdk.ensureIapPublicKey.mockResolvedValue(publicKey);
    sdk.verifyToken.mockResolvedValue(true);
    sdk.getIntentToken.mockResolvedValue({ tokenId: "intent-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetModelCircuitBreakers();
  });

  describe("verifyIntentToken", () => {
    it("validates a token when ArmorIQ is healthy", async () => {
      await expect(ArmorIQService.verifyIntentToken(token)).resolves.toEqual({ valid: true });
    });

    it("fails closed on a timeout without crashing the caller", async () => {
      sdk.ensureIapPublicKey.mockRejectedValue(timeout());

      const result = await ArmorIQService.verifyIntentToken(token);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/timed out/);
      expect(result.unavailable).toBeUndefined();
    });

    it("skips ArmorIQ and blocks once the circuit is open", async () => {
      sdk.ensureIapPublicKey.mockRejectedValue(timeout());
      for (let i = 0; i < 3; i++) {
        await ArmorIQService.verifyIntentToken(token);
      }
      expect(sdk.ensureIapPublicKey).toHaveBeenCalledTimes(3);

      const result = await ArmorIQService.verifyIntentToken(token);

      expect(result).toMatchObject({ valid: false, unavailable: true });
      expect(result.reason).toMatch(/circuit open/);
      expect(sdk.ensureIapPublicKey).toHaveBeenCalledTimes(3);
      expect(sdk.verifyToken).not.toHaveBeenCalled();
    });

    it("trips on proof verification outages too", async () => {
      sdk.verifyToken.mockRejectedValue(Object.assign(new Error("bad gateway"), { status: 502 }));
      for (let i = 0; i < 3; i++) {
        await ArmorIQService.verifyIntentToken(token);
      }

      const result = await ArmorIQService.verifyIntentToken(token);

      expect(result).toMatchObject({ valid: false, unavailable: true });
      expect(sdk.verifyToken).toHaveBeenCalledTimes(3);
    });

    it("recovers once ArmorIQ answers the probe after the cool-down", async () => {
      vi.useFakeTimers();
      sdk.ensureIapPublicKey.mockRejectedValue(timeout());
      for (let i = 0; i < 3; i++) {
        await ArmorIQService.verifyIntentToken(token);
      }
      expect(await ArmorIQService.verifyIntentToken(token)).toMatchObject({ unavailable: true });

      sdk.ensureIapPublicKey.mockResolvedValue(publicKey);
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(ArmorIQService.verifyIntentToken(token)).resolves.toEqual({ valid: true });
      await expect(ArmorIQService.verifyIntentToken(token)).resolves.toEqual({ valid: true });
    });

    it("does not open the circuit for tokens ArmorIQ rejects", async () => {
      sdk.verifyToken.mockResolvedValue(false);

      for (let i = 0; i < 6; i++) {
        await expect(ArmorIQService.verifyIntentToken(token)).resolves.toEqual({
          valid: false,
          reason: "Cryptographic proof validation failed",
        });
      }

      expect(sdk.verifyToken).toHaveBeenCalledTimes(6);
    });
  });

  describe("getProtectedToken", () => {
    const mint = () => ArmorIQService.getProtectedToken("dev@example.com", { goal: "scan" }, []);

    it("mints a token when ArmorIQ is healthy", async () => {
      await expect(mint()).resolves.toEqual({ tokenId: "intent-1" });
    });

    it("rejects with ArmorIQUnavailableError once the circuit is open and stops calling ArmorIQ", async () => {
      sdk.getIntentToken.mockRejectedValue(timeout());
      for (let i = 0; i < 3; i++) {
        await expect(mint()).rejects.toMatchObject({ name: "ArmorIQTimeoutError" });
      }

      await expect(mint()).rejects.toBeInstanceOf(ArmorIQUnavailableError);

      expect(sdk.getIntentToken).toHaveBeenCalledTimes(3);
    });

    it("shares one circuit with token verification", async () => {
      sdk.getIntentToken.mockRejectedValue(timeout());
      for (let i = 0; i < 3; i++) {
        await expect(mint()).rejects.toBeDefined();
      }

      const result = await ArmorIQService.verifyIntentToken(token);

      expect(result).toMatchObject({ valid: false, unavailable: true });
      expect(sdk.ensureIapPublicKey).not.toHaveBeenCalled();
    });
  });
});
