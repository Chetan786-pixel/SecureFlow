import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- Mocks (hoisted before imports) ----

const {
  mockWebhookEvent,
  mockRepository,
  mockPullRequest,
  mockAccount,
  mockHandlePullRequestSynchronize,
} = vi.hoisted(() => ({
  mockWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
  mockRepository: { findUnique: vi.fn() },
  mockPullRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
  mockAccount: { findFirst: vi.fn() },
  mockHandlePullRequestSynchronize: vi.fn(),
}));

vi.mock("bullmq", () => ({
  // The processor is the second constructor argument; the tests below read it
  // back off the mock so the real worker body runs end to end.
  Worker: vi.fn().mockImplementation(function (this: any) {
    this.on = vi.fn();
  }),
  Queue: vi.fn().mockImplementation(function (this: any) {
    this.add = vi.fn();
  }),
  DelayedError: class DelayedError extends Error {},
}));

vi.mock("./redis", () => ({ redis: {} }));
vi.mock("./lock", () => ({
  acquireLock: vi.fn(async () => "lock-token"),
  releaseLock: vi.fn(async () => {}),
  startLockHeartbeat: vi.fn(() => ({ stop: vi.fn() })),
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    webhookEvent: mockWebhookEvent,
    repository: mockRepository,
    pullRequest: mockPullRequest,
    account: mockAccount,
  },
}));
vi.mock("@/lib/github/app-auth", () => ({
  WebhookConfigurationError: class WebhookConfigurationError extends Error {},
  getGitHubAppCredentials: () => {
    throw new Error("app credentials unavailable");
  },
}));
vi.mock("@/lib/armor/scanner", () => ({ scanner: {}, parseSecureFlowIgnore: vi.fn() }));
vi.mock("@/lib/sbom/pull-request-manifests", () => ({
  handlePullRequestSynchronize: mockHandlePullRequestSynchronize,
}));
vi.mock("@/ai/flows/developer-receives-ai-security-explanations", () => ({
  developerReceivesAISecurityExplanations: vi.fn(),
}));

// ---- Imports (after mocks) ----
import { Worker } from "bullmq";
import "./worker";

type Processor = (job: unknown) => Promise<void>;
const processor = vi.mocked(Worker).mock.calls[0][1] as unknown as Processor;

const DELIVERY_ID = "delivery-885-retry";

const syncPayload = {
  action: "synchronize",
  number: 7,
  pull_request: {
    id: 555,
    number: 7,
    title: "Bump deps",
    state: "open",
    head: { sha: "head-sha-885" },
    user: { login: "dev" },
  },
  repository: { id: 8888, name: "app", full_name: "acme/app", owner: { login: "acme" } },
  installation: { id: 777 },
  sender: { id: 1 },
};

const makeJob = () => ({
  id: `delivery-${DELIVERY_ID}`,
  name: "process-webhook",
  data: { event: "pull_request", deliveryId: DELIVERY_ID, payload: structuredClone(syncPayload) },
  attemptsMade: 0,
  opts: { attempts: 3 },
});

describe("webhook worker: pull_request.synchronize retry (#885)", () => {
  beforeEach(() => {
    mockHandlePullRequestSynchronize.mockReset();
    mockWebhookEvent.findUnique.mockReset().mockResolvedValue(null);
    mockWebhookEvent.create.mockReset().mockResolvedValue({});
    mockRepository.findUnique.mockReset();
    mockPullRequest.findUnique.mockReset().mockResolvedValue(null);
    mockAccount.findFirst.mockReset().mockResolvedValue(null);
  });

  it("re-runs the manifest scan with the same payload and delivery when the job is retried, and never records completion for a failed attempt", async () => {
    // Attempt 1: the manifest scan runs, then the next database call fails.
    mockRepository.findUnique
      .mockResolvedValueOnce(null) // metadata lookup at the top of the job
      .mockRejectedValueOnce(new Error("database unavailable")) // after the manifest scan
      .mockResolvedValue(null); // the retry gets past it

    await expect(processor(makeJob())).rejects.toThrow("database unavailable");

    expect(mockHandlePullRequestSynchronize).toHaveBeenCalledTimes(1);
    expect(mockWebhookEvent.create).not.toHaveBeenCalled();

    // Attempt 2: BullMQ retries the same job. It fails again, later on (the
    // GitHub App credentials are unavailable), which is enough: what matters is
    // what the retry hands to the manifest scan.
    await expect(processor(makeJob())).rejects.toThrow("app credentials unavailable");

    expect(mockHandlePullRequestSynchronize).toHaveBeenCalledTimes(2);
    const [firstPayload, firstDelivery] = mockHandlePullRequestSynchronize.mock.calls[0];
    const [retryPayload, retryDelivery] = mockHandlePullRequestSynchronize.mock.calls[1];

    // Same PR, same head SHA, same delivery: the SBOM job IDs and dedupe keys
    // handlePullRequestSynchronize derives from these are identical, so the
    // retry cannot enqueue a second set of scans or findings.
    expect(retryPayload).toEqual(firstPayload);
    expect(retryPayload.pull_request.head.sha).toBe("head-sha-885");
    expect(firstDelivery).toBe(DELIVERY_ID);
    expect(retryDelivery).toBe(DELIVERY_ID);

    // A delivery is only marked processed once everything succeeded, so a
    // failed attempt can never suppress its own retry.
    expect(mockWebhookEvent.create).not.toHaveBeenCalled();
  });

  it("does not run the manifest scan again for a delivery that already completed", async () => {
    mockRepository.findUnique.mockResolvedValue(null);
    mockWebhookEvent.findUnique.mockResolvedValue({ deliveryId: DELIVERY_ID });

    await processor(makeJob());

    expect(mockWebhookEvent.findUnique).toHaveBeenCalledWith({
      where: { deliveryId: DELIVERY_ID },
    });
    expect(mockHandlePullRequestSynchronize).not.toHaveBeenCalled();
    expect(mockWebhookEvent.create).not.toHaveBeenCalled();
  });
});
