/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, act } from "@testing-library/react";

vi.mock("@/components/cyber-text-reveal", () => ({
  CyberTextReveal: ({ realName }: { realName?: string | null }) => <span>{realName}</span>,
}));

import LeaderboardClient, { type ContributorRow } from "./leaderboard-client";

const NO_FINDINGS = { critical: 0, high: 0, medium: 0, low: 0 };

function row(overrides: Partial<ContributorRow> & { id: string; rank: number }): ContributorRow {
  const login = overrides.login ?? `user${overrides.id}`;
  return {
    login,
    codename: `Codename ${overrides.id}`,
    htmlUrl: `https://github.com/${login}`,
    avatarUrl: `https://avatars.example/${login}.png`,
    score: 50,
    prCount: 4,
    mergedCount: 3,
    passedCount: 2,
    findings: NO_FINDINGS,
    badges: [],
    form: [],
    ...overrides,
  };
}

const contributors: ContributorRow[] = [
  row({
    id: "a",
    rank: 1,
    login: "alice",
    score: 90,
    findings: NO_FINDINGS,
    form: ["W", "W", "D"],
  }),
  row({
    id: "b",
    rank: 2,
    login: "bob",
    score: 60,
    findings: { critical: 1, high: 2, medium: 0, low: 1 },
    badges: [{ emoji: "🛡️", label: "Clean Sweep" }],
  }),
  row({ id: "c", rank: 3, login: "carol", score: 40 }),
  row({ id: "d", rank: 4, login: "dave", score: 20 }),
];

/** Rows of the "The Crew" table, header row excluded. */
function crewRows() {
  const table = screen.getByRole("table");
  return within(table).getAllByRole("row").slice(1);
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
}

describe("LeaderboardClient component (#1372)", () => {
  const originalEventSource = (globalThis as { EventSource?: unknown }).EventSource;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
    global.fetch = originalFetch;
  });

  describe("ranking table", () => {
    it("lists every contributor in the supplied rank order with zero-padded ranks", () => {
      render(<LeaderboardClient contributors={contributors} />);

      const rows = crewRows();
      expect(rows).toHaveLength(4);
      const ranks = rows.map((r) => within(r).getAllByRole("cell")[0].textContent);
      expect(ranks).toEqual(["01", "02", "03", "04"]);
      expect(within(rows[0]).getByText("Codename a")).toBeInTheDocument();
      expect(within(rows[3]).getByText("Codename d")).toBeInTheDocument();
    });

    it("shows each operative's bounty derived from the security score", () => {
      render(<LeaderboardClient contributors={contributors} />);

      const rows = crewRows();
      expect(within(rows[0]).getByText("€900K")).toBeInTheDocument();
      expect(within(rows[1]).getByText("€600K")).toBeInTheDocument();
      expect(within(rows[3]).getByText("€200K")).toBeInTheDocument();
    });

    it("totals breaches across severities and links each operative to their profile", () => {
      render(<LeaderboardClient contributors={contributors} />);

      const rows = crewRows();
      // alice has no findings; bob has 1 + 2 + 0 + 1 = 4.
      expect(within(rows[0]).getAllByRole("cell")[3]).toHaveTextContent("0");
      expect(within(rows[1]).getAllByRole("cell")[3]).toHaveTextContent("4");
      expect(within(rows[1]).getByRole("link")).toHaveAttribute("href", "https://github.com/bob");
      expect(within(rows[1]).getByText("@bob")).toBeInTheDocument();
    });

    it("renders recent-form pips only for contributors that have form", () => {
      render(<LeaderboardClient contributors={contributors} />);

      const rows = crewRows();
      const pips = within(rows[0]).getByLabelText("Recent pull request outcomes");
      expect(pips.textContent).toBe("WWD");
      expect(
        within(rows[2]).queryByLabelText("Recent pull request outcomes"),
      ).not.toBeInTheDocument();
    });

    it("reports the operative count in the header and footer", () => {
      render(<LeaderboardClient contributors={contributors} />);

      expect(screen.getByText("4 operatives")).toBeInTheDocument();
      expect(screen.getByText(/4 operatives ranked/)).toBeInTheDocument();
    });
  });

  describe("podium", () => {
    it("highlights the top-ranked contributor as the most wanted hero card", () => {
      render(<LeaderboardClient contributors={contributors} />);

      expect(screen.getAllByText(/#1 Most Wanted/)).toHaveLength(1);
      const hero = screen.getByText(/#1 Most Wanted/).closest("a");
      expect(hero).toHaveAttribute("href", "https://github.com/alice");
      expect(hero).toHaveTextContent("Codename a");
      expect(hero).toHaveTextContent("Security score 90/100");
    });

    it("shows the second and third place cards with their badges", () => {
      render(<LeaderboardClient contributors={contributors} />);

      const second = screen.getByText("Security score 60/100").closest("a");
      expect(second).toHaveTextContent("Codename b");
      expect(second).toHaveTextContent("Clean Sweep");
      const third = screen.getByText("Security score 40/100").closest("a");
      expect(third).toHaveTextContent("Codename c");
      // The fourth contributor never gets a podium card.
      expect(screen.queryByText("Security score 20/100")).not.toBeInTheDocument();
    });

    it("renders a single hero card when only one contributor exists", () => {
      render(<LeaderboardClient contributors={[contributors[0]]} />);

      expect(screen.getAllByText(/#1 Most Wanted/)).toHaveLength(1);
      expect(crewRows()).toHaveLength(1);
      expect(screen.getByText("1 operatives")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows the call to action instead of a table when there are no contributors", () => {
      render(<LeaderboardClient contributors={[]} />);

      expect(
        screen.getByText(
          "No operatives yet. Merge a clean pull request to claim your first bounty.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(screen.queryByText(/#1 Most Wanted/)).not.toBeInTheDocument();
    });
  });

  describe("live updates", () => {
    it("opens a server-sent events stream and flips the indicator to live on open", () => {
      render(<LeaderboardClient contributors={contributors} />);

      expect(FakeEventSource.instances).toHaveLength(1);
      expect(FakeEventSource.instances[0].url).toBe("/api/leaderboard?stream=true");
      expect(screen.getByText("Polling")).toBeInTheDocument();

      act(() => FakeEventSource.instances[0].onopen?.());

      expect(screen.getByText("Live Updates")).toBeInTheDocument();
    });

    it("replaces the table with contributors pushed over the stream and shows the update time", () => {
      render(<LeaderboardClient contributors={contributors} />);
      expect(screen.queryByText("Last Updated:")).not.toBeInTheDocument();

      act(() =>
        FakeEventSource.instances[0].onmessage?.({
          data: JSON.stringify({
            contributors: [row({ id: "z", rank: 1, login: "zed", score: 99 })],
            timestamp: Date.UTC(2026, 9, 22, 12, 0, 0),
          }),
        }),
      );

      const rows = crewRows();
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("Codename z")).toBeInTheDocument();
      expect(screen.getByText("Last Updated:")).toBeInTheDocument();
    });

    it("ignores malformed stream frames and keeps the current table", () => {
      render(<LeaderboardClient contributors={contributors} />);

      act(() => FakeEventSource.instances[0].onmessage?.({ data: "{not json" }));

      expect(crewRows()).toHaveLength(4);
    });

    it("closes the stream on unmount", () => {
      const { unmount } = render(<LeaderboardClient contributors={contributors} />);
      const source = FakeEventSource.instances[0];

      unmount();

      expect(source.close).toHaveBeenCalled();
    });

    it("falls back to polling the JSON endpoint when the stream errors", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          contributors: [row({ id: "p", rank: 1, login: "polly", score: 70 })],
        }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      render(<LeaderboardClient contributors={contributors} />);

      act(() => FakeEventSource.instances[0].onerror?.());
      expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
      expect(screen.getByText("Polling")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(fetchMock).toHaveBeenCalledWith("/api/leaderboard", { cache: "no-store" });
      expect(within(crewRows()[0]).getByText("Codename p")).toBeInTheDocument();
    });

    it("polls directly when EventSource is unavailable and keeps stale data if a poll fails", async () => {
      vi.useFakeTimers();
      delete (globalThis as { EventSource?: unknown }).EventSource;
      const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
      global.fetch = fetchMock as unknown as typeof fetch;
      render(<LeaderboardClient contributors={contributors} />);

      expect(FakeEventSource.instances).toHaveLength(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(crewRows()).toHaveLength(4);
    });
  });
});
