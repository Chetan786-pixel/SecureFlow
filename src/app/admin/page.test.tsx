/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminDashboard from "./page";
import * as adminActions from "@/lib/actions/admin";

vi.mock("@/lib/actions/admin", () => ({
  getAdminMetrics: vi.fn(),
  getRecentAuditLogs: vi.fn(),
}));

vi.mock("@/components/admin/AuditLogTable", () => ({
  default: ({ logs }: { logs?: any[] }) => (
    <div data-testid="audit-log-table">
      <div data-testid="logs-count">Logs: {logs?.length ?? 0}</div>
      <ul>
        {(logs || []).map((log) => (
          <li key={log.id} data-testid="audit-log-row">
            {log.action} - {log.resource}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

describe("AdminDashboard Page (#1351)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches admin metrics and recent audit logs on render", async () => {
    vi.mocked(adminActions.getAdminMetrics).mockResolvedValue({
      totalUsers: 1420,
      totalPrs: 830,
      totalAudits: 5210,
    } as any);

    vi.mocked(adminActions.getRecentAuditLogs).mockResolvedValue([
      { id: "log-1", action: "USER_ROLE_UPDATED", resource: "user:123", createdAt: new Date() },
      { id: "log-2", action: "SETTINGS_CHANGED", resource: "auth:policy", createdAt: new Date() },
    ] as any);

    const pageElement = await AdminDashboard();
    render(pageElement);

    expect(adminActions.getAdminMetrics).toHaveBeenCalledTimes(1);
    expect(adminActions.getRecentAuditLogs).toHaveBeenCalledTimes(1);

    // Verify page header
    expect(screen.getByText("Admin Panel")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Overview")).toBeInTheDocument();
    expect(
      screen.getByText("System-wide metrics and administrative analytics."),
    ).toBeInTheDocument();

    // Verify 3 metrics cards
    expect(screen.getByText("Total Users")).toBeInTheDocument();
    expect(screen.getByText("1420")).toBeInTheDocument();

    expect(screen.getByText("Pull Requests Scanned")).toBeInTheDocument();
    expect(screen.getByText("830")).toBeInTheDocument();

    expect(screen.getByText("Audit Logs")).toBeInTheDocument();
    expect(screen.getByText("5210")).toBeInTheDocument();

    // Verify recent audit activity section
    expect(screen.getByText("Recent Audit Activity")).toBeInTheDocument();
    expect(screen.getByTestId("audit-log-table")).toBeInTheDocument();
    expect(screen.getByTestId("logs-count").textContent).toBe("Logs: 2");
    expect(screen.getAllByTestId("audit-log-row")).toHaveLength(2);
  });

  it("renders zero values cleanly when metrics are empty", async () => {
    vi.mocked(adminActions.getAdminMetrics).mockResolvedValue({
      totalUsers: 0,
      totalPrs: 0,
      totalAudits: 0,
    } as any);

    vi.mocked(adminActions.getRecentAuditLogs).mockResolvedValue([]);

    const pageElement = await AdminDashboard();
    render(pageElement);

    expect(screen.getByText("Dashboard Overview")).toBeInTheDocument();
    const zeros = screen.getAllByText("0");
    expect(zeros).toHaveLength(3); // 3 metric cards display 0

    expect(screen.getByTestId("logs-count").textContent).toBe("Logs: 0");
  });

  it("handles undefined logs array without throwing errors", async () => {
    vi.mocked(adminActions.getAdminMetrics).mockResolvedValue({
      totalUsers: 10,
      totalPrs: 5,
      totalAudits: 2,
    } as any);

    vi.mocked(adminActions.getRecentAuditLogs).mockResolvedValue(undefined as any);

    const pageElement = await AdminDashboard();
    render(pageElement);

    expect(screen.getByTestId("audit-log-table")).toBeInTheDocument();
    expect(screen.getByTestId("logs-count").textContent).toBe("Logs: 0");
  });

  it("renders metric cards in a responsive grid container", async () => {
    vi.mocked(adminActions.getAdminMetrics).mockResolvedValue({
      totalUsers: 100,
      totalPrs: 50,
      totalAudits: 200,
    } as any);
    vi.mocked(adminActions.getRecentAuditLogs).mockResolvedValue([]);

    const pageElement = await AdminDashboard();
    const { container } = render(pageElement);

    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveClass("gap-6", "md:grid-cols-3");
  });
});
