/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminUsersPage, { metadata } from "./page";
import * as authModule from "@/auth";
import * as adminActions from "@/lib/actions/admin";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/actions/admin", () => ({
  getAllUsers: vi.fn(),
  getUserManagementMetrics: vi.fn(),
}));

vi.mock("@/components/admin/UsersTable", () => ({
  default: ({
    users,
    currentUserId,
    totalUsers,
  }: {
    users: any[];
    currentUserId?: string;
    totalUsers?: number;
  }) => (
    <div data-testid="users-table">
      <span data-testid="current-user-id">{currentUserId ?? "none"}</span>
      <span data-testid="users-count">Count: {users.length}</span>
      <span data-testid="total-users">Total: {totalUsers ?? 0}</span>
      <ul>
        {users.map((u) => (
          <li key={u.id} data-testid="user-row">
            {u.name} - {u.email}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

describe("AdminUsersPage Component (#1351)", () => {
  const defaultMetrics = {
    total: 156,
    admins: 4,
    last24h: 12,
  };

  const defaultUsers = [
    { id: "user-1", name: "Alice Admin", email: "alice@example.com", roles: ["ADMIN"] },
    { id: "user-2", name: "Bob Dev", email: "bob@example.com", roles: ["USER"] },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authModule.auth).mockResolvedValue({
      user: { id: "user-1", name: "Alice Admin", roles: ["ADMIN"] },
    } as any);
    vi.mocked(adminActions.getAllUsers).mockResolvedValue({
      users: defaultUsers,
      total: 156,
    } as any);
    vi.mocked(adminActions.getUserManagementMetrics).mockResolvedValue(defaultMetrics as any);
  });

  it("exports correct document metadata", () => {
    expect(metadata).toBeDefined();
    expect(metadata.title).toBe("User Management · SecureFlow Admin");
  });

  it("fetches session and data in parallel and passes current user id to UsersTable", async () => {
    const pageElement = await AdminUsersPage();
    render(pageElement);

    expect(authModule.auth).toHaveBeenCalledTimes(1);
    expect(adminActions.getAllUsers).toHaveBeenCalledTimes(1);
    expect(adminActions.getUserManagementMetrics).toHaveBeenCalledTimes(1);

    // Header
    expect(screen.getByRole("heading", { name: "User Management" })).toBeInTheDocument();
    expect(
      screen.getByText("Manage user roles, access levels, and account status across SecureFlow."),
    ).toBeInTheDocument();

    // 3 Metric Cards
    expect(screen.getByText("Total Users")).toBeInTheDocument();
    expect(screen.getByText("156")).toBeInTheDocument();

    expect(screen.getByText("Administrators")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();

    expect(screen.getByText("New (24h)")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    // UsersTable props verification
    expect(screen.getByTestId("users-table")).toBeInTheDocument();
    expect(screen.getByTestId("current-user-id").textContent).toBe("user-1");
    expect(screen.getByTestId("users-count").textContent).toBe("Count: 2");
    expect(screen.getByTestId("total-users").textContent).toBe("Total: 156");
    expect(screen.getAllByTestId("user-row")).toHaveLength(2);
  });

  it("handles missing session/user safely passing currentUserId as undefined", async () => {
    vi.mocked(authModule.auth).mockResolvedValue(null);

    const pageElement = await AdminUsersPage();
    render(pageElement);

    expect(screen.getByTestId("users-table")).toBeInTheDocument();
    expect(screen.getByTestId("current-user-id").textContent).toBe("none");
  });

  it("renders with empty user list cleanly", async () => {
    vi.mocked(adminActions.getAllUsers).mockResolvedValue({
      users: [],
      total: 0,
    } as any);
    vi.mocked(adminActions.getUserManagementMetrics).mockResolvedValue({
      total: 0,
      admins: 0,
      last24h: 0,
    } as any);

    const pageElement = await AdminUsersPage();
    render(pageElement);

    expect(screen.getByTestId("users-count").textContent).toBe("Count: 0");
    expect(screen.getByTestId("total-users").textContent).toBe("Total: 0");
  });

  it("renders metric cards in responsive container with correct classes", async () => {
    const pageElement = await AdminUsersPage();
    const { container } = render(pageElement);

    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveClass("gap-6", "sm:grid-cols-2", "lg:grid-cols-3");
  });
});
