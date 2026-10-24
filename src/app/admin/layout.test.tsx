/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "./layout";
import * as authModule from "@/auth";
import * as navigationModule from "next/navigation";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT: ${url}`);
  }),
}));

vi.mock("@/components/admin/AdminNav", () => ({
  AdminSidebarNav: () => <nav data-testid="admin-sidebar-nav">AdminSidebarNav</nav>,
  AdminMobileNav: () => <nav data-testid="admin-mobile-nav">AdminMobileNav</nav>,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button data-testid="theme-toggle">ThemeToggle</button>,
}));

describe("AdminLayout Component (#1351)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Role-based access gating", () => {
    it("redirects unauthenticated users (session is null) to '/'", async () => {
      vi.mocked(authModule.auth).mockResolvedValue(null);

      await expect(
        AdminLayout({ children: <div data-testid="admin-child">Protected Content</div> }),
      ).rejects.toThrow("NEXT_REDIRECT: /");

      expect(navigationModule.redirect).toHaveBeenCalledWith("/");
      expect(screen.queryByTestId("admin-child")).toBeNull();
    });

    it("redirects when session has no user object", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({} as any);

      await expect(
        AdminLayout({ children: <div data-testid="admin-child">Protected Content</div> }),
      ).rejects.toThrow("NEXT_REDIRECT: /");

      expect(navigationModule.redirect).toHaveBeenCalledWith("/");
    });

    it("redirects when user has no roles defined", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({
        user: { id: "user-1", name: "Guest User" },
      } as any);

      await expect(
        AdminLayout({ children: <div data-testid="admin-child">Protected Content</div> }),
      ).rejects.toThrow("NEXT_REDIRECT: /");

      expect(navigationModule.redirect).toHaveBeenCalledWith("/");
    });

    it("redirects non-admin authenticated users (e.g. role USER only) to '/'", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({
        user: { id: "user-2", name: "Regular User", roles: ["USER"] },
      } as any);

      await expect(
        AdminLayout({ children: <div data-testid="admin-child">Protected Content</div> }),
      ).rejects.toThrow("NEXT_REDIRECT: /");

      expect(navigationModule.redirect).toHaveBeenCalledWith("/");
      expect(screen.queryByTestId("admin-child")).toBeNull();
    });
  });

  describe("Authorized Admin access", () => {
    it("renders layout shell and children when user has ADMIN role", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({
        user: { id: "admin-1", name: "Admin User", roles: ["ADMIN"] },
      } as any);

      const layoutElement = await AdminLayout({
        children: <div data-testid="admin-child">Admin Secure Section</div>,
      });

      render(layoutElement);

      expect(navigationModule.redirect).not.toHaveBeenCalled();
      expect(screen.getByTestId("admin-child")).toBeInTheDocument();
      expect(screen.getByText("Admin Secure Section")).toBeInTheDocument();
    });

    it("renders layout shell when user possesses multiple roles including ADMIN", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({
        user: { id: "admin-2", name: "Multi Role", roles: ["USER", "ANALYST", "ADMIN"] },
      } as any);

      const layoutElement = await AdminLayout({
        children: <span data-testid="child-multi">Child Content</span>,
      });

      render(layoutElement);

      expect(screen.getByTestId("child-multi")).toBeInTheDocument();
      expect(navigationModule.redirect).not.toHaveBeenCalled();
    });

    it("renders desktop sidebar, mobile navigation, system control branding, and theme toggles", async () => {
      vi.mocked(authModule.auth).mockResolvedValue({
        user: { id: "admin-1", roles: ["ADMIN"] },
      } as any);

      const layoutElement = await AdminLayout({
        children: <p>Dashboard View</p>,
      });

      const { container } = render(layoutElement);

      expect(screen.getByTestId("admin-sidebar-nav")).toBeInTheDocument();
      expect(screen.getByTestId("admin-mobile-nav")).toBeInTheDocument();
      expect(screen.getAllByTestId("theme-toggle")).toHaveLength(2);
      expect(screen.getByText("SecureFlow System Control")).toBeInTheDocument();

      // Check aside container and main content container
      const aside = container.querySelector("aside");
      expect(aside).toBeInTheDocument();
      expect(aside).toHaveClass("hidden", "lg:flex");

      const main = container.querySelector("main");
      expect(main).toBeInTheDocument();
      expect(main?.textContent).toContain("Dashboard View");
    });
  });
});
