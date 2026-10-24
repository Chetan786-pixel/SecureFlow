import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authMock, findingFindMany, patchUpsert, patchUpdateMany, generatePatchMock } = vi.hoisted(
  () => ({
    authMock: vi.fn(),
    findingFindMany: vi.fn(),
    patchUpsert: vi.fn(),
    patchUpdateMany: vi.fn(),
    generatePatchMock: vi.fn(),
  }),
);

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/prisma", () => ({
  default: {
    finding: { findMany: findingFindMany },
    remediationPatch: { upsert: patchUpsert, updateMany: patchUpdateMany },
  },
}));

vi.mock("@/ai/flows/generate-remediation-patch", () => ({
  generateRemediationPatchFlow: generatePatchMock,
}));

const mockCheckRateLimitDetailed = vi.hoisted(() =>
  vi.fn(async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: Date.now() + 60_000,
    degraded: false,
  })),
);

vi.mock("@/lib/redis", () => ({
  checkRateLimitDetailed: mockCheckRateLimitDetailed,
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  TIERS: {
    AI_STREAM: { limit: 20, windowSeconds: 60, fallbackStrategy: "fail-closed" },
    AI_STREAM_USER: {
      limit: 10,
      windowSeconds: 60,
      fallbackStrategy: "fail-closed",
      timeoutMs: 1000,
    },
  },
  withRateLimit: <T>(handler: T): T => handler,
  buildRateLimitHeaders: vi.fn(() => ({ "X-RateLimit-Limit": "10" })),
  secondsUntilReset: vi.fn(() => 60),
}));

import { POST, MAX_BULK_REQUEST_BYTES } from "./route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/findings/bulk-remediate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/findings/bulk-remediate (#814)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "user-123" } });
  });

  it("returns 401 if user is unauthenticated", async () => {
    authMock.mockResolvedValue(null);
    const req = makeRequest({ findingIds: ["f-1"] });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid or empty findingIds array", async () => {
    const resEmpty = await POST(makeRequest({ findingIds: [] }));
    expect(resEmpty.status).toBe(400);

    const resMissing = await POST(makeRequest({}));
    expect(resMissing.status).toBe(400);

    const resNonString = await POST(makeRequest({ findingIds: [123] }));
    expect(resNonString.status).toBe(400);
  });

  it("returns 404 when no findings match the IDs or user", async () => {
    findingFindMany.mockResolvedValue([]);
    const res = await POST(makeRequest({ findingIds: ["f-1"] }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when some findings are not found or not owned by user", async () => {
    findingFindMany.mockResolvedValue([{ id: "f-1", type: "VULNERABILITY" }]);
    const res = await POST(makeRequest({ findingIds: ["f-1", "f-2"] }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/access is denied/i);
  });

  it("treats a repeated id as one finding instead of denying access", async () => {
    findingFindMany.mockResolvedValue([
      { id: "f-1", type: "SECRET", fileLocation: "src/keys.ts", codeSnippet: "k" },
    ]);
    generatePatchMock.mockResolvedValue({ patchDiff: "--- a/src/keys.ts", explanation: "e" });
    patchUpsert.mockResolvedValue({ findingId: "f-1", patchDiff: "--- a/src/keys.ts" });

    const res = await POST(makeRequest({ findingIds: ["f-1", "f-1"] }));

    expect(res.status).toBe(200);
    expect(findingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["f-1"] } }),
      }),
    );
    expect(generatePatchMock).toHaveBeenCalledTimes(1);
    expect((await res.json()).count).toBe(1);
  });

  it("rejects a streamed body over the cap before reading it all", async () => {
    const oversized = new Uint8Array(MAX_BULK_REQUEST_BYTES + 1).fill(0x20);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const req = new NextRequest("http://localhost:3000/api/findings/bulk-remediate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1]);

    expect(req.headers.get("content-length")).toBeNull();

    const res = await POST(req);

    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/maximum allowed size/i);
    expect(findingFindMany).not.toHaveBeenCalled();
  });

  it("rejects more findings than one page of the dashboard can select, before any lookup", async () => {
    const findingIds = Array.from({ length: 101 }, (_, i) => `f-${i}`);

    const res = await POST(makeRequest({ findingIds }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at most 100/);
    expect(findingFindMany).not.toHaveBeenCalled();
    expect(generatePatchMock).not.toHaveBeenCalled();
  });

  it("accepts a full page of findings", async () => {
    const findingIds = Array.from({ length: 100 }, (_, i) => `f-${i}`);
    findingFindMany.mockResolvedValue([]);

    const res = await POST(makeRequest({ findingIds }));

    expect(res.status).toBe(404);
    expect(findingFindMany).toHaveBeenCalled();
  });

  it("returns 400 and rejects mixed vulnerability types", async () => {
    findingFindMany.mockResolvedValue([
      { id: "f-1", type: "SECRET", fileLocation: "src/keys.ts" },
      { id: "f-2", type: "VULNERABILITY", fileLocation: "src/auth.ts" },
    ]);
    const res = await POST(makeRequest({ findingIds: ["f-1", "f-2"] }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/same vulnerability type/i);
    expect(generatePatchMock).not.toHaveBeenCalled();
  });

  it("generates bulk remediation patches and returns combined diff for homogeneous types", async () => {
    findingFindMany.mockResolvedValue([
      {
        id: "f-1",
        type: "VULNERABILITY",
        fileLocation: "src/auth/token.ts",
        codeSnippet: "jwt.decode(token)",
        explanation: "Unverified token payload",
        remediation: "Verify signature",
      },
      {
        id: "f-2",
        type: "VULNERABILITY",
        fileLocation: "src/auth/session.ts",
        codeSnippet: "session.id = req.id",
        explanation: "Session fixation",
        remediation: "Regenerate session",
      },
    ]);

    generatePatchMock
      .mockResolvedValueOnce({
        patchDiff:
          "--- a/src/auth/token.ts\n+++ b/src/auth/token.ts\n@@ -1 +1 @@\n-jwt.decode\n+jwt.verify",
        explanation: "Verify token signature",
      })
      .mockResolvedValueOnce({
        patchDiff:
          "--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1 +1 @@\n-session.id = req.id\n+session.regenerate()",
        explanation: "Regenerate session id",
      });

    patchUpsert.mockImplementation(async ({ where, create, update }) => ({
      ...create,
      ...update,
      id: `patch-${where.findingId}`,
    }));

    const res = await POST(makeRequest({ findingIds: ["f-1", "f-2"] }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(data.type).toBe("VULNERABILITY");
    expect(data.patch.status).toBe("GENERATED");
    expect(data.patch.patchDiff).toContain("--- a/src/auth/token.ts");
    expect(data.patch.patchDiff).toContain("--- a/src/auth/session.ts");
    expect(data.explanation).toContain("Bulk remediation patch for 2 VULNERABILITY findings");

    expect(generatePatchMock).toHaveBeenCalledTimes(2);
    expect(patchUpsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    { label: "a misspelled action", action: "aply" },
    { label: "a non-string action", action: 123 },
    { label: "an array action", action: ["apply"] },
  ])("rejects $label before any lookup or AI call", async ({ action }) => {
    const res = await POST(makeRequest({ action, findingIds: ["f-1"] }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/action must be one of/i);
    expect(findingFindMany).not.toHaveBeenCalled();
    expect(generatePatchMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit generate action", async () => {
    findingFindMany.mockResolvedValue([]);

    const res = await POST(makeRequest({ action: "generate", findingIds: ["f-1"] }));

    expect(res.status).toBe(404);
    expect(findingFindMany).toHaveBeenCalled();
  });

  it("reports the number of patch rows the database actually updated", async () => {
    findingFindMany.mockResolvedValue([
      { id: "f-1", type: "SECRET" },
      { id: "f-2", type: "SECRET" },
    ]);
    patchUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await POST(makeRequest({ action: "apply", findingIds: ["f-1", "f-2"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, updatedCount: 1, status: "APPLIED" });
    expect(patchUpdateMany).toHaveBeenCalledWith({
      where: { findingId: { in: ["f-1", "f-2"] } },
      data: { status: "APPLIED" },
    });
    expect(generatePatchMock).not.toHaveBeenCalled();
  });

  it("does not claim a rollback succeeded when no patch rows matched", async () => {
    findingFindMany.mockResolvedValue([{ id: "f-1", type: "SECRET" }]);
    patchUpdateMany.mockResolvedValueOnce({ count: 0 });

    const res = await POST(makeRequest({ action: "rollback", findingIds: ["f-1"] }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, updatedCount: 0, status: "PENDING" });
    expect(patchUpdateMany).toHaveBeenCalledWith({
      where: { findingId: { in: ["f-1"] } },
      data: { status: "PENDING" },
    });
  });

  it("returns 429 when user rate limit is exceeded", async () => {
    mockCheckRateLimitDetailed.mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetAt: Date.now() + 60_000,
      degraded: false,
    });

    const res = await POST(makeRequest({ findingIds: ["f-1"] }));
    expect(res.status).toBe(429);
    expect(findingFindMany).not.toHaveBeenCalled();
    expect(generatePatchMock).not.toHaveBeenCalled();
  });
});
