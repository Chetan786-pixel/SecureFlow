import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  fetchTracesMock,
  recordAuditLogMock,
  buildReportMock,
} = vi.hoisted(() => ({
  authMock: vi.fn(),
  fetchTracesMock: vi.fn(),
  recordAuditLogMock: vi.fn(),
  buildReportMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/armor/audit-integration", () => ({
  fetchArmorIQAuditTraces: fetchTracesMock,
  recordArmorIQAuditLog: recordAuditLogMock,
  buildComplianceReport: buildReportMock,
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  TIERS: {
    STANDARD: { limit: 120, windowSeconds: 60, fallbackStrategy: "fail-closed" },
  },
  withRateLimit: <T>(handler: T): T => handler,
}));

import { GET, POST } from "./route";

describe("GET /api/audit/armoriq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized when session is missing", async () => {
    authMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq");
    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(fetchTracesMock).not.toHaveBeenCalled();
  });

  it("retrieves ArmorIQ audit traces with default parameters", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-123" } });
    const mockTraces = [
      {
        id: "trace-1",
        scanJobId: "job-1",
        decision: "ALLOW",
        toolName: "ast-scanner",
        timestamp: new Date().toISOString(),
      },
    ];
    fetchTracesMock.mockResolvedValueOnce({ traces: mockTraces, total: 1 });

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq?scanJobId=job-1&decision=ALLOW");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ traces: mockTraces, total: 1 });
    expect(fetchTracesMock).toHaveBeenCalledWith({
      scanJobId: "job-1",
      findingId: undefined,
      decision: "ALLOW",
      limit: 100,
    });
  });

  it("generates a compliance report when format=compliance is requested", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-123" } });
    const mockTraces = [{ id: "trace-1", decision: "ALLOW" }];
    const mockEvidence = [{ control: "CC6.1", status: "PASS" }];

    fetchTracesMock.mockResolvedValueOnce({ traces: mockTraces, total: 1 });
    buildReportMock.mockReturnValueOnce(mockEvidence);

    const req = new NextRequest(
      "http://localhost:3000/api/audit/armoriq?format=compliance&framework=SOC2",
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.framework).toBe("SOC2");
    expect(body.totalRecords).toBe(1);
    expect(body.evidence).toEqual(mockEvidence);
    expect(buildReportMock).toHaveBeenCalledWith(mockTraces, "SOC2");
  });
});

describe("POST /api/audit/armoriq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 Unauthorized when session is missing", async () => {
    authMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq", {
      method: "POST",
      body: JSON.stringify({ agentId: "agent-1", toolName: "bash", decision: "ALLOW" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(recordAuditLogMock).not.toHaveBeenCalled();
  });

  it("returns 400 Bad Request when required audit fields are missing", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-123" } });

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq", {
      method: "POST",
      body: JSON.stringify({ agentId: "agent-1" }), // missing toolName and decision
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("agentId, toolName, and decision");
    expect(recordAuditLogMock).not.toHaveBeenCalled();
  });

  it("records an ArmorIQ audit log entry successfully", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-123" } });
    const mockLog = { id: "log-1", agentId: "agent-1", decision: "BLOCK" };
    recordAuditLogMock.mockResolvedValueOnce(mockLog);

    const payload = {
      scanJobId: "job-100",
      findingId: "finding-200",
      agentId: "agent-1",
      toolName: "remediation-runner",
      decision: "BLOCK",
      ruleMatched: "DENY_ARBITRARY_EXEC",
      justification: "Command touches restricted path",
      proofHash: "abc123hash",
      signature: "sig456",
      intentId: "intent-789",
      frameworks: ["SOC2"],
    };

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, log: mockLog });
    expect(recordAuditLogMock).toHaveBeenCalledWith({
      ...payload,
      userId: "user-123",
    });
  });

  it("returns 500 when recordArmorIQAuditLog throws an error", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-123" } });
    recordAuditLogMock.mockRejectedValueOnce(new Error("Database connection failed"));

    const req = new NextRequest("http://localhost:3000/api/audit/armoriq", {
      method: "POST",
      body: JSON.stringify({
        agentId: "agent-1",
        toolName: "bash",
        decision: "ALLOW",
      }),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to record ArmorIQ enforcement audit log" });
  });
});
