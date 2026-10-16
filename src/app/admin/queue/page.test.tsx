/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import QueueMonitorPage, { dynamic } from "./page";
import * as queueActions from "@/lib/actions/queue";

vi.mock("@/lib/actions/queue", () => ({
  getQueueMetrics: vi.fn(),
  getDLQJobs: vi.fn(),
}));

vi.mock("@/components/admin/JobExplorer", () => ({
  default: () => <div data-testid="job-explorer">JobExplorer Mock</div>,
}));

vi.mock("@/components/admin/DLQTable", () => ({
  default: ({ initialJobs }: { initialJobs: any[] }) => (
    <div data-testid="dlq-table">
      <span data-testid="dlq-count">Total DLQ: {initialJobs.length}</span>
      <ul>
        {initialJobs.map((job) => (
          <li key={job.id} data-testid="dlq-item">
            {job.name}
          </li>
        ))}
      </ul>
    </div>
  ),
}));

describe("QueueMonitorPage Component (#1351)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports dynamic configuration as force-dynamic", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("fetches metrics and DLQ jobs and renders 5 queue metric cards", async () => {
    vi.mocked(queueActions.getQueueMetrics).mockResolvedValue({
      waiting: 12,
      active: 4,
      completed: 1845,
      failed: 3,
      delayed: 7,
    } as any);

    vi.mocked(queueActions.getDLQJobs).mockResolvedValue([
      { id: "job-1", name: "scan-repo-1" },
      { id: "job-2", name: "dispatch-webhook" },
      { id: "job-3", name: "generate-sbom" },
    ] as any);

    const pageElement = await QueueMonitorPage();
    render(pageElement);

    expect(queueActions.getQueueMetrics).toHaveBeenCalledTimes(1);
    expect(queueActions.getDLQJobs).toHaveBeenCalledTimes(1);

    // Header
    expect(screen.getByRole("heading", { name: "Queue Monitor" })).toBeInTheDocument();
    expect(
      screen.getByText(/Real-time observability of the BullMQ async processing pipelines/i),
    ).toBeInTheDocument();

    // 5 metric cards
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("1845")).toBeInTheDocument();

    expect(screen.getByText("Failed (DLQ)")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    expect(screen.getByText("Delayed")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();

    // Health & Operations
    expect(screen.getByText("Queue Health and Operations")).toBeInTheDocument();
    expect(screen.getByText("Active (3 retries)")).toBeInTheDocument();
    expect(screen.getByText("10,000 entries max")).toBeInTheDocument();
    expect(screen.getByText("Operational")).toBeInTheDocument();

    // Child components
    expect(screen.getByRole("heading", { name: "Pipeline Jobs" })).toBeInTheDocument();
    expect(screen.getByTestId("job-explorer")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Dead-Letter Queue (DLQ)" })).toBeInTheDocument();
    expect(screen.getByTestId("dlq-table")).toBeInTheDocument();
    expect(screen.getByTestId("dlq-count").textContent).toBe("Total DLQ: 3");
    expect(screen.getAllByTestId("dlq-item")).toHaveLength(3);
  });

  it("handles empty DLQ and all zero metrics cleanly", async () => {
    vi.mocked(queueActions.getQueueMetrics).mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    } as any);

    vi.mocked(queueActions.getDLQJobs).mockResolvedValue([]);

    const pageElement = await QueueMonitorPage();
    render(pageElement);

    const zeros = screen.getAllByText("0");
    expect(zeros).toHaveLength(5); // exactly 5 queue cards with 0

    expect(screen.getByTestId("dlq-count").textContent).toBe("Total DLQ: 0");
    expect(screen.queryByTestId("dlq-item")).toBeNull();
  });

  it("renders metric cards in responsive 5-column container", async () => {
    vi.mocked(queueActions.getQueueMetrics).mockResolvedValue({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 4,
      delayed: 5,
    } as any);
    vi.mocked(queueActions.getDLQJobs).mockResolvedValue([]);

    const pageElement = await QueueMonitorPage();
    const { container } = render(pageElement);

    const grid = container.querySelector(".grid");
    expect(grid).toBeInTheDocument();
    expect(grid).toHaveClass("gap-6", "sm:grid-cols-2", "lg:grid-cols-5");
  });
});
