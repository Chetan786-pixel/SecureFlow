/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DLQTable from "./DLQTable";
import * as queueActions from "@/lib/actions/queue";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

vi.mock("@/lib/actions/queue", () => ({
  requeueDLQJob: vi.fn(),
  deleteDLQJob: vi.fn(),
  clearAllDLQ: vi.fn(),
  requeueAllDLQ: vi.fn(),
  requeueBulkDLQJobs: vi.fn(),
  deleteBulkDLQJobs: vi.fn(),
}));

describe("DLQTable Component (#1332)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleJobs = [
    {
      id: "job-101",
      name: "security-scan-job",
      timestamp: 1700000000000,
      data: {
        data: {
          event: "pull_request",
          payload: {
            action: "opened",
            repository: { full_name: "acme/backend" },
          },
        },
        failedReason: "Timeout connecting to Groq AI service",
      },
    },
    {
      id: "job-102",
      name: "webhook-dispatch",
      timestamp: 1700000060000,
      data: {
        data: {
          event: "push",
          payload: {
            action: "synchronize",
            repository: { full_name: "acme/frontend" },
          },
        },
        failedReason: "Bad Gateway 502 upstream",
      },
    },
  ];

  it("renders empty state correctly when there are no DLQ jobs", () => {
    render(<DLQTable initialJobs={[]} />);

    expect(screen.getByText("No failed jobs in the DLQ.")).toBeInTheDocument();
    expect(screen.getByText("The Resistance is operating smoothly.")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Filter DLQ jobs by repo, event, action..."),
    ).toBeInTheDocument();
  });

  it("renders DLQ jobs with repository, event, action, and failure reasons", () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.getByText("acme/frontend")).toBeInTheDocument();
    expect(screen.getByText("pull_request")).toBeInTheDocument();
    expect(screen.getByText("push")).toBeInTheDocument();
    expect(screen.getByText("Timeout connecting to Groq AI service")).toBeInTheDocument();
    expect(screen.getByText("Bad Gateway 502 upstream")).toBeInTheDocument();
  });

  it("filters jobs based on search input", () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    const searchInput = screen.getByPlaceholderText("Filter DLQ jobs by repo, event, action...");
    fireEvent.change(searchInput, { target: { value: "backend" } });

    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.queryByText("acme/frontend")).toBeNull();
  });

  it("expands job detail drawer on click", () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    const firstJobRow = screen.getByText("acme/backend");
    fireEvent.click(firstJobRow);

    expect(screen.getByText("Failure Reason:")).toBeInTheDocument();
    expect(screen.getByText("Payload / Data:")).toBeInTheDocument();
  });

  it("handles Requeue All action", async () => {
    vi.mocked(queueActions.requeueAllDLQ).mockResolvedValueOnce({
      success: true,
      count: 2,
    } as any);

    render(<DLQTable initialJobs={sampleJobs} />);

    const requeueAllBtn = screen.getByRole("button", { name: /Requeue All/i });
    fireEvent.click(requeueAllBtn);

    expect(queueActions.requeueAllDLQ).toHaveBeenCalled();
  });

  it("handles Clear All action", async () => {
    vi.mocked(queueActions.clearAllDLQ).mockResolvedValueOnce({
      success: true,
      count: 2,
    } as any);

    render(<DLQTable initialJobs={sampleJobs} />);

    const clearAllBtn = screen.getByRole("button", { name: /Clear All/i });
    fireEvent.click(clearAllBtn);

    expect(queueActions.clearAllDLQ).toHaveBeenCalled();
  });
});
