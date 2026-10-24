import { describe, it, expect, vi, beforeEach } from "vitest";

const { handlersGet, handlersPost, withRateLimitMock, TIERS_MOCK } = vi.hoisted(() => {
  const handlersPost = vi.fn();
  return {
    handlersGet: vi.fn(),
    handlersPost,
    withRateLimitMock: vi.fn((handler: unknown, options: unknown) => ({
      wrapped: handler,
      options,
    })),
    TIERS_MOCK: { AUTH: { limit: 10, windowSeconds: 60 } },
  };
});

vi.mock("@/auth", () => ({
  handlers: { GET: handlersGet, POST: handlersPost },
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  withRateLimit: withRateLimitMock,
  TIERS: TIERS_MOCK,
}));

import { GET, POST } from "./route";

describe("NextAuth route handlers (#1372)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports the NextAuth GET handler unwrapped so session and callback reads are not throttled", () => {
    expect(GET).toBe(handlersGet);
  });

  it("wraps the NextAuth POST handler with the AUTH rate-limit tier", () => {
    // withRateLimit runs once at import time, before beforeEach clears the mock.
    expect(POST).toEqual({
      wrapped: handlersPost,
      options: { limit: 10, windowSeconds: 60, keyPrefix: "auth:post" },
    });
  });
});
