import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prewarm } from "./prewarm";

describe("scripts/prewarm.ts (#1330)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("exits successfully when route responds with 401 (handler compiled, signature checked)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
    });

    const success = await prewarm({
      url: "http://localhost:9002/api/webhooks/github",
      maxRetries: 1,
      initialBackoffMs: 1,
    });

    expect(success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:9002/api/webhooks/github",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-hub-signature-256": "sha256=dummy",
          "x-github-event": "pull_request",
        }),
      }),
    );
  });

  it("exits successfully when route responds with 200 OK", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
    });

    const success = await prewarm({
      url: "http://localhost:9002/api/webhooks/github",
      maxRetries: 1,
      initialBackoffMs: 1,
    });

    expect(success).toBe(true);
  });

  it("retries on connection errors until succeeding", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce({ name: "AbortError", message: "Request timed out" })
      .mockResolvedValueOnce({
        status: 401,
        ok: false,
      });

    global.fetch = fetchMock;

    const success = await prewarm({
      url: "http://localhost:9002/api/webhooks/github",
      maxRetries: 3,
      initialBackoffMs: 1,
    });

    expect(success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns false after exhausting maxRetries on persistent failure", async () => {
    global.fetch = vi.fn().mockRejectedValue({
      code: "ECONNREFUSED",
      message: "connect ECONNREFUSED 127.0.0.1:9002",
    });

    const success = await prewarm({
      url: "http://localhost:9002/api/webhooks/github",
      maxRetries: 2,
      initialBackoffMs: 1,
    });

    expect(success).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
