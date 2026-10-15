import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { authMock, loadScanJobOwnershipMock, scanJobVisibilityMock, getScanJobStatusMock } =
  vi.hoisted(() => ({
    authMock: vi.fn(),
    loadScanJobOwnershipMock: vi.fn(),
    scanJobVisibilityMock: vi.fn(),
    getScanJobStatusMock: vi.fn(),
  }));

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/prisma", () => ({
  default: {
    scanJob: {},
  },
}));

vi.mock("@/lib/findings/scan-authorization", () => ({
  loadScanJobOwnership: loadScanJobOwnershipMock,
  scanJobVisibility: scanJobVisibilityMock,
}));

vi.mock("@/lib/queue/scanQueue", () => ({
  getScanJobStatus: getScanJobStatusMock,
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  TIERS: {
    STANDARD: { limit: 120, windowSeconds: 60, fallbackStrategy: "fail-closed" },
  },
  withRateLimit: <T>(handler: T): T => handler,
}));

import { GET } from "./route";

describe("GET /api/findings/status/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the session is missing or unauthenticated", async () => {
    authMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/findings/status/job-123");
    const params = Promise.resolve({ jobId: "job-123" });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("AppError");
    expect(body.message).toBe("Unauthorized");
    expect(loadScanJobOwnershipMock).not.toHaveBeenCalled();
  });

  it("returns 400 when jobId parameter is empty", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });

    const req = new NextRequest("http://localhost:3000/api/findings/status/");
    const params = Promise.resolve({ jobId: "" });
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("AppError");
    expect(body.message).toBe("Invalid job ID");
  });

  it("returns 404 when scan job is not owned by the caller (ownership visibility fails)", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    loadScanJobOwnershipMock.mockResolvedValueOnce({ repositoryOwnerId: "user-other" });
    scanJobVisibilityMock.mockReturnValueOnce("absent");

    const req = new NextRequest("http://localhost:3000/api/findings/status/job-other");
    const params = Promise.resolve({ jobId: "job-other" });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("AppError");
    expect(body.message).toBe("Scan job not found");
    expect(getScanJobStatusMock).not.toHaveBeenCalled();
  });

  it("returns 404 when scan job status cannot be found in queue/store", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    loadScanJobOwnershipMock.mockResolvedValueOnce({ repositoryOwnerId: "user-1" });
    scanJobVisibilityMock.mockReturnValueOnce("visible");
    getScanJobStatusMock.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/findings/status/job-missing");
    const params = Promise.resolve({ jobId: "job-missing" });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("AppError");
    expect(body.message).toBe("Scan job not found");
  });

  it("returns 200 with job status payload and polling cache headers when found", async () => {
    authMock.mockResolvedValueOnce({ user: { id: "user-1" } });
    loadScanJobOwnershipMock.mockResolvedValueOnce({ repositoryOwnerId: "user-1" });
    scanJobVisibilityMock.mockReturnValueOnce("visible");

    const mockStatus = {
      status: "PROCESSING",
      progress: 45,
      scannedFiles: 9,
      totalFiles: 20,
      vulnerabilitiesFound: 2,
    };
    getScanJobStatusMock.mockResolvedValueOnce(mockStatus);

    const req = new NextRequest("http://localhost:3000/api/findings/status/job-valid");
    const params = Promise.resolve({ jobId: "job-valid" });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockStatus);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(res.headers.get("Pragma")).toBe("no-cache");
  });
});
