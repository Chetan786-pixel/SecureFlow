import { beforeEach, describe, expect, it, vi } from "vitest";

const { findManyMock, countMock, scanJobFindFirstMock, findingFindFirstMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  scanJobFindFirstMock: vi.fn(),
  findingFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    armorIQEnforcementLog: {
      findMany: findManyMock,
      count: countMock,
    },
    scanJob: {
      findFirst: scanJobFindFirstMock,
    },
    finding: {
      findFirst: findingFindFirstMock,
    },
  },
}));

import { fetchArmorIQAuditTraces, verifyArmorIQAuditResourceOwnership } from "./audit-integration";

describe("ArmorIQ audit tenancy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    scanJobFindFirstMock.mockResolvedValue({ id: "job-1" });
    findingFindFirstMock.mockResolvedValue({ id: "finding-1" });
  });

  it("scopes trace reads through both owning relations", async () => {
    await fetchArmorIQAuditTraces({
      userId: "user-1",
      scanJobId: "job-1",
      decision: "BLOCK",
    });

    const query = findManyMock.mock.calls[0][0];
    expect(query.where).toMatchObject({
      scanJobId: "job-1",
      decision: "BLOCK",
      OR: [
        { scanJob: { is: { repository: { is: { userId: "user-1" } } } } },
        {
          finding: {
            is: {
              scanResult: {
                is: {
                  pullRequest: { is: { repository: { is: { userId: "user-1" } } } },
                },
              },
            },
          },
        },
      ],
    });
    expect(countMock).toHaveBeenCalledWith({ where: query.where });
  });

  it("does not accept a scan job owned by another user", async () => {
    scanJobFindFirstMock.mockResolvedValueOnce(null);

    await expect(
      verifyArmorIQAuditResourceOwnership({ userId: "user-1", scanJobId: "job-2" }),
    ).resolves.toBe(false);

    expect(scanJobFindFirstMock).toHaveBeenCalledWith({
      where: { id: "job-2", repository: { is: { userId: "user-1" } } },
      select: { id: true },
    });
  });

  it("does not accept a finding owned by another user", async () => {
    findingFindFirstMock.mockResolvedValueOnce(null);

    await expect(
      verifyArmorIQAuditResourceOwnership({ userId: "user-1", findingId: "finding-2" }),
    ).resolves.toBe(false);

    expect(findingFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "finding-2",
        scanResult: {
          is: {
            pullRequest: { is: { repository: { is: { userId: "user-1" } } } },
          },
        },
      },
      select: { id: true },
    });
  });

  it("requires every supplied resource to belong to the user", async () => {
    scanJobFindFirstMock.mockResolvedValueOnce({ id: "job-1" });
    findingFindFirstMock.mockResolvedValueOnce({ id: "finding-1" });

    await expect(
      verifyArmorIQAuditResourceOwnership({
        userId: "user-1",
        scanJobId: "job-1",
        findingId: "finding-1",
      }),
    ).resolves.toBe(true);

    findingFindFirstMock.mockResolvedValueOnce(null);
    await expect(
      verifyArmorIQAuditResourceOwnership({
        userId: "user-1",
        scanJobId: "job-1",
        findingId: "finding-2",
      }),
    ).resolves.toBe(false);
  });

  it("allows an unlinked record without a database lookup", async () => {
    await expect(verifyArmorIQAuditResourceOwnership({ userId: "user-1" })).resolves.toBe(true);

    expect(scanJobFindFirstMock).not.toHaveBeenCalled();
    expect(findingFindFirstMock).not.toHaveBeenCalled();
  });
});
