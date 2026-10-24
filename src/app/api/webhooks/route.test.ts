import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";

// ---- Mocks ----

vi.mock("@/lib/middleware/error-handler", () => {
  const AppError = class AppError extends Error {
    statusCode: number;
    constructor(msg: string, code = 400) {
      super(msg);
      this.statusCode = code;
    }
  };
  return {
    withErrorHandler:
      (fn: (...args: unknown[]) => unknown) =>
      async (...args: unknown[]) => {
        try {
          return await fn(...args);
        } catch (err: unknown) {
          const e = err as { statusCode?: number; message?: string };
          return {
            status: e.statusCode || 500,
            json: async () => ({ error: e.message }),
          };
        }
      },
    AppError,
  };
});

vi.mock("@/lib/middleware/rate-limit", () => ({
  withRateLimit: <T extends (...args: unknown[]) => unknown>(handler: T): T => handler,
}));

// ---- Imports (after mocks) ----

import { POST } from "@/app/api/webhooks/route";

const WEBHOOK_SECRET = "test-secret-key-12345";

/** A legacy signature, bound to `timestamp` when one is given and over the bare body otherwise. */
function makeSignature(payload: string, secret: string, timestamp?: string): string {
  const material = timestamp === undefined ? payload : `${timestamp}.${payload}`;
  return `sha256=${createHmac("sha256", secret).update(material).digest("hex")}`;
}

function makeRequest(body: string, extraHeaders: Record<string, string> = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = makeSignature(body, WEBHOOK_SECRET, timestamp);

  return new Request("http://localhost:3000/api/webhooks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SecureFlow-Signature": signature,
      "X-SecureFlow-Timestamp": timestamp,
      ...extraHeaders,
    },
    body,
  });
}

describe("/api/webhooks (generic webhook route)", () => {
  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it("accepts a valid signed webhook with ping event", async () => {
    const payload = JSON.stringify({ event: "ping" });
    const req = makeRequest(payload);

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("pong");
    expect(data.message).toBe("Webhook verified");
  });

  it("accepts a valid signed webhook with alert event", async () => {
    const payload = JSON.stringify({ event: "alert", severity: "high" });
    const req = makeRequest(payload);

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("received");
    expect(data.message).toBe("Alert processed");
  });

  it("accepts a valid signed webhook with unknown event", async () => {
    const payload = JSON.stringify({ data: "some payload" });
    const req = makeRequest(payload);

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("received");
  });

  it("extracts event from x-webhook-event header", async () => {
    const payload = JSON.stringify({ data: "test" });
    const req = makeRequest(payload, { "x-webhook-event": "notification" });

    const res = await POST(req as any);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.message).toBe("Notification processed");
  });

  it("rejects request with invalid signature", async () => {
    const payload = JSON.stringify({ event: "ping" });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const req = new Request("http://localhost:3000/api/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SecureFlow-Signature": "sha256=" + "0".repeat(64),
        "X-SecureFlow-Timestamp": timestamp,
      },
      body: payload,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("rejects request with expired timestamp", async () => {
    const payload = JSON.stringify({ event: "ping" });
    const oldTimestamp = Math.floor(Date.now() / 1000 - 600).toString(); // 10 minutes ago
    const signature = makeSignature(payload, WEBHOOK_SECRET, oldTimestamp);

    const req = new Request("http://localhost:3000/api/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SecureFlow-Signature": signature,
        "X-SecureFlow-Timestamp": oldTimestamp,
      },
      body: payload,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("rejects request with missing signature header", async () => {
    const payload = JSON.stringify({ event: "ping" });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const req = new Request("http://localhost:3000/api/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SecureFlow-Timestamp": timestamp,
      },
      body: payload,
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
  });

  it("rejects malformed JSON payload", async () => {
    const payload = "not valid json {{{";
    const req = makeRequest(payload);

    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  describe("unbound legacy signatures (WEBHOOK_ALLOW_UNBOUND_LEGACY_SIGNATURES)", () => {
    afterEach(() => {
      delete process.env.WEBHOOK_ALLOW_UNBOUND_LEGACY_SIGNATURES;
    });

    const bareSigned = (payload: string) =>
      makeRequest(payload, { "X-SecureFlow-Signature": makeSignature(payload, WEBHOOK_SECRET) });

    it("rejects a bare-body signature by default", async () => {
      const res = await POST(bareSigned(JSON.stringify({ event: "ping" })) as any);

      expect(res.status).toBe(401);
    });

    it("accepts a bare-body signature when the switch is on", async () => {
      process.env.WEBHOOK_ALLOW_UNBOUND_LEGACY_SIGNATURES = "true";

      const res = await POST(bareSigned(JSON.stringify({ event: "ping" })) as any);

      expect(res.status).toBe(200);
    });

    it.each(["1", "yes", "TRUE ", "false"])("treats %j as off", async (value) => {
      process.env.WEBHOOK_ALLOW_UNBOUND_LEGACY_SIGNATURES = value;

      const res = await POST(bareSigned(JSON.stringify({ event: "ping" })) as any);

      expect(res.status).toBe(401);
    });
  });

  describe("body size cap (WEBHOOK_MAX_BYTES)", () => {
    afterEach(() => {
      delete process.env.WEBHOOK_MAX_BYTES;
    });

    it("refuses a correctly signed body over the configured cap with 413", async () => {
      process.env.WEBHOOK_MAX_BYTES = "256";
      const payload = JSON.stringify({ event: "alert", padding: "x".repeat(512) });

      const res = await POST(makeRequest(payload) as any);

      expect(res.status).toBe(413);
    });

    it("refuses a body whose Content-Length is over the cap before reading it", async () => {
      process.env.WEBHOOK_MAX_BYTES = "256";
      const payload = JSON.stringify({ event: "ping" });

      const res = await POST(makeRequest(payload, { "content-length": "100000" }) as any);

      expect(res.status).toBe(413);
    });

    it("still accepts a signed body under the cap", async () => {
      process.env.WEBHOOK_MAX_BYTES = "256";

      const res = await POST(makeRequest(JSON.stringify({ event: "ping" })) as any);

      expect(res.status).toBe(200);
    });
  });
});
