/**
 * @vitest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import AdminError from "./error";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** A thrown error as the boundary actually receives it in production. */
function boundaryError(digest?: string): Error & { digest?: string } {
  const error = new Error(
    "Can't reach database server at postgresql://neondb_owner:hunter2@ep-x.neon.tech/neondb",
  ) as Error & { digest?: string };
  if (digest) error.digest = digest;
  return error;
}

describe("app/admin/error.tsx - segment boundary (#1444)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders an alert with a retry button wired to reset()", () => {
    const reset = vi.fn();
    render(<AdminError error={boundaryError("a1")} reset={reset} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest but never the underlying message", () => {
    // A Prisma failure's message carries the connection string, password
    // included. The digest is the only detail safe to put on screen.
    render(<AdminError error={boundaryError("a1")} reset={vi.fn()} />);

    expect(screen.getByTestId("error-digest")).toHaveTextContent("a1");
    expect(document.body.textContent).not.toContain("postgresql://");
    expect(document.body.textContent).not.toContain("hunter2");
  });

  it("logs only the digest, so the console is not a second leak", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AdminError error={boundaryError("a1")} reset={vi.fn()} />);

    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toContain("a1");
    expect(logged).not.toContain("hunter2");
  });

  it("does not offer a dashboard link, since it renders inside the admin layout", () => {
    render(<AdminError error={boundaryError("a1")} reset={vi.fn()} />);

    expect(screen.queryByRole("link", { name: /back to dashboard/i })).not.toBeInTheDocument();
  });

  it("copes with an error that has no digest", () => {
    render(<AdminError error={boundaryError()} reset={vi.fn()} />);

    expect(screen.queryByTestId("error-digest")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("admin loading skeletons (#1444)", () => {
  it.each([
    ["overview", () => import("./loading")],
    ["logs", () => import("./logs/loading")],
    ["queue", () => import("./queue/loading")],
    ["users", () => import("./users/loading")],
  ])("%s announces a busy region while the queries resolve", async (_name, load) => {
    const { default: Loading } = await load();
    const { container } = render(<Loading />);

    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy).toHaveAttribute("aria-label");
    // A skeleton with no placeholders is just an empty page.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("gives the queue skeleton the same five stat tiles as the page", async () => {
    const { default: Loading } = await import("./queue/loading");
    const { container } = render(<Loading />);

    const grid = container.querySelector(".lg\\:grid-cols-5");
    expect(grid).not.toBeNull();
    expect(grid?.children).toHaveLength(5);
  });
});
