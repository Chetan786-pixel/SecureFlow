/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLogsPage, { metadata } from "./page";
import * as adminActions from "@/lib/actions/admin";

vi.mock("@/lib/actions/admin", () => ({
  getAuditLogs: vi.fn(),
  getAuditLogMetrics: vi.fn(),
  getAuditLogFilters: vi.fn(),
}));

vi.mock("@/components/admin/LogsTable", () => ({
  default: ({ logs, actions }: { logs: any[]; actions: string[] }) => (
    <div data-testid="logs-table">
      <span data-testid="logs-table-count">{logs.length}</span>
      <span data-testid="logs-table-actions">{actions.join(",")}</span>
    </div>
  ),
}));

describe("AdminLogsPage Component (#1351)", () => {
  const defaultMetrics = {
    total: 350,
    last24h: 42,
    topActions: [{ action: "ADMIN_LOGIN", count: 18 }],
  };

  const defaultFilters = {
    actions: ["ADMIN_LOGIN", "ROLE_UPDATED", "SCAN_TRIGGERED"],
  };

  const defaultResult = {
    logs: [
      { id: "log-1", action: "ADMIN_LOGIN", resource: "auth" },
      { id: "log-2", action: "ROLE_UPDATED", resource: "user:1" },
    ],
    total: 2,
    page: 1,
    pageSize: 200,
    totalPages: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminActions.getAuditLogMetrics).mockResolvedValue(defaultMetrics as any);
    vi.mocked(adminActions.getAuditLogFilters).mockResolvedValue(defaultFilters as any);
    vi.mocked(adminActions.getAuditLogs).mockResolvedValue(defaultResult as any);
  });

  it("exports correct document metadata", () => {
    expect(metadata).toBeDefined();
    expect(metadata.title).toBe("Audit Logs · SecureFlow Admin");
  });

  it("fetches audit logs, metrics and filters using default page 1", async () => {
    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({}),
    });
    render(pageElement);

    expect(adminActions.getAuditLogs).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
    });
    expect(adminActions.getAuditLogMetrics).toHaveBeenCalledTimes(1);
    expect(adminActions.getAuditLogFilters).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("heading", { name: "Audit Logs" })).toBeInTheDocument();
    expect(
      screen.getByText("Comprehensive audit trail of every administrative and system event."),
    ).toBeInTheDocument();

    expect(screen.getByText("Total Logs")).toBeInTheDocument();
    expect(screen.getByText("350")).toBeInTheDocument();

    expect(screen.getByText("Last 24 Hours")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();

    expect(screen.getByText("Top Action")).toBeInTheDocument();
    expect(screen.getByText("ADMIN_LOGIN")).toBeInTheDocument();

    expect(screen.getByTestId("logs-table")).toBeInTheDocument();
    expect(screen.getByTestId("logs-table-count").textContent).toBe("2");
    expect(screen.getByTestId("logs-table-actions").textContent).toBe(
      "ADMIN_LOGIN,ROLE_UPDATED,SCAN_TRIGGERED",
    );
  });

  it("parses explicit searchParams.page properly", async () => {
    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({ page: "4" }),
    });
    render(pageElement);

    expect(adminActions.getAuditLogs).toHaveBeenCalledWith({
      page: 4,
      pageSize: 200,
    });
  });

  it("safely falls back to page 1 on invalid or negative searchParams.page", async () => {
    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({ page: "-5" }),
    });
    render(pageElement);

    expect(adminActions.getAuditLogs).toHaveBeenCalledWith({
      page: 1,
      pageSize: 200,
    });
  });

  it("displays dash fallback when topActions is empty", async () => {
    vi.mocked(adminActions.getAuditLogMetrics).mockResolvedValue({
      total: 0,
      last24h: 0,
      topActions: [],
    } as any);

    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({}),
    });
    render(pageElement);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("displays pagination note when total exceeds INITIAL_PAGE_SIZE (200)", async () => {
    const mockLogs = Array.from({ length: 200 }, (_, i) => ({
      id: `log-${i}`,
      action: "ACTION",
      resource: "res",
    }));

    vi.mocked(adminActions.getAuditLogs).mockResolvedValue({
      logs: mockLogs,
      total: 450,
      page: 1,
      pageSize: 200,
      totalPages: 3,
    } as any);

    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({}),
    });
    render(pageElement);

    expect(
      screen.getByText(/Showing the most recent 200 of 450 log entries\./i),
    ).toBeInTheDocument();
  });

  it("omits pagination note when total does not exceed INITIAL_PAGE_SIZE", async () => {
    vi.mocked(adminActions.getAuditLogs).mockResolvedValue({
      logs: [{ id: "1", action: "A", resource: "R" }],
      total: 1,
      page: 1,
      pageSize: 200,
      totalPages: 1,
    } as any);

    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({}),
    });
    render(pageElement);

    expect(screen.queryByText(/Showing the most recent/i)).toBeNull();
  });

  it("renders metric cards in responsive 3-column container", async () => {
    const pageElement = await AdminLogsPage({
      searchParams: Promise.resolve({}),
    });
    const { container } = render(pageElement);

    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveClass("gap-6", "sm:grid-cols-3");
  });
});
