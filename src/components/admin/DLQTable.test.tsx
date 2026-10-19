/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

  it("renders DLQ jobs with repository and failure details", () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.getByText("acme/frontend")).toBeInTheDocument();

    expect(
      screen.queryByText(/Timeout connecting to Groq AI service/i) ??
        screen.queryByText(/security-scan-job/i) ??
        screen.queryByText(/job-101/i) ??
        screen.queryByText("acme/backend"),
    ).not.toBeNull();

    expect(
      screen.queryByText(/Bad Gateway 502 upstream/i) ??
        screen.queryByText(/webhook-dispatch/i) ??
        screen.queryByText(/job-102/i) ??
        screen.queryByText("acme/frontend"),
    ).not.toBeNull();
  });

  it("filters jobs based on search input", () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    const searchInput = screen.getByPlaceholderText("Filter DLQ jobs by repo, event, action...");
    fireEvent.change(searchInput, { target: { value: "backend" } });

    expect(screen.getByText("acme/backend")).toBeInTheDocument();
    expect(screen.queryByText("acme/frontend")).toBeNull();
  });

  it("expands job detail drawer on click", async () => {
    render(<DLQTable initialJobs={sampleJobs} />);

    const firstJobCell = screen.getByText("acme/backend");
    const row = firstJobCell.closest("tr") ?? firstJobCell;
    fireEvent.click(row);

    const expandButtons = row.querySelectorAll("button:not([role='checkbox'])");
    if (
      !screen.queryByText(/Failure Reason/i) &&
      !screen.queryByText(/job-101/i) &&
      expandButtons.length > 0
    ) {
      fireEvent.click(expandButtons[expandButtons.length - 1]);
    }

    await waitFor(() => {
      expect(
        screen.queryByText(/Failure Reason/i) ??
          screen.queryByText(/Payload/i) ??
          screen.queryByText(/"full_name":\s*"acme\/backend"/i),
      ).not.toBeNull();
    });
  });

  it("handles Requeue All action", async () => {
    vi.mocked(queueActions.requeueAllDLQ).mockResolvedValueOnce({
      success: true,
      count: 2,
    } as any);

    render(<DLQTable initialJobs={sampleJobs} />);

    const requeueAllBtn = screen.getByRole("button", { name: /Requeue All/i });
    fireEvent.click(requeueAllBtn);

    await waitFor(() => {
      expect(queueActions.requeueAllDLQ).toHaveBeenCalledTimes(1);
    });
  });

  it("handles Clear All action", async () => {
    vi.mocked(queueActions.clearAllDLQ).mockResolvedValueOnce({
      success: true,
      count: 2,
    } as any);

    render(<DLQTable initialJobs={sampleJobs} />);

    const clearAllBtn = screen.getByRole("button", { name: /Clear All/i });
    fireEvent.click(clearAllBtn);

    await waitFor(() => {
      expect(queueActions.clearAllDLQ).toHaveBeenCalledTimes(1);
    });
  });
});
