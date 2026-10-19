import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest.setup.ts mocks "@/auth" for every suite. These tests run the real
// callbacks in src/auth.ts, so only NextAuth itself is replaced.
vi.unmock("@/auth");

const nextAuth = vi.hoisted(() => ({
  config: null as any,
  /** What the encrypted session cookie decodes to for the current request. */
  cookieToken: null as Record<string, unknown> | null,
}));

/**
 * Stand-in for NextAuth's `auth()`: run the configured session callback on the
 * decoded token and round-trip the result through JSON, as the real one does
 * when it builds the `/api/auth/session` response.
 */
async function resolveSession() {
  const token = nextAuth.cookieToken;
  if (!token) return null;
  // Real `auth()` decrypts the cookie before the callbacks run. Yielding here
  // lets concurrent calls overlap, which the isolation test depends on.
  await new Promise((resolve) => setImmediate(resolve));
  const session = await nextAuth.config.callbacks.session({
    session: {
      user: { name: "Octo Cat", email: "octo@example.test", image: null },
      expires: "2027-01-01T00:00:00.000Z",
    },
    token,
  });
  return JSON.parse(JSON.stringify(session));
}

vi.mock("next-auth", () => ({
  default: vi.fn((config: unknown) => {
    nextAuth.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn(resolveSession) };
  }),
}));
vi.mock("next-auth/providers/github", () => ({ default: vi.fn(() => ({ id: "github" })) }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("@/lib/prisma", () => ({ default: { user: { findUnique: vi.fn() } } }));

import { auth } from "@/auth";
import { getSessionWithGitHubToken } from "./user-access-token";

const ACCESS_TOKEN = "gho_server_side_only_access";
const REFRESH_TOKEN = "ghr_server_side_only_refresh";

function signedInToken(accessToken = ACCESS_TOKEN) {
  return {
    sub: "user-1",
    userId: "user-1",
    codename: "Tokyo",
    roles: ["USER"],
    accessToken,
    refreshToken: REFRESH_TOKEN,
    accessTokenExpires: 0,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MOCK_AUTH", "false");
  vi.stubEnv("ALLOW_MOCK_AUTH", "false");
  nextAuth.cookieToken = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("public session", () => {
  it("contains no GitHub provider token", async () => {
    nextAuth.cookieToken = signedInToken();

    const session = await auth();

    expect(session?.user?.id).toBe("user-1");
    const serialized = JSON.stringify(session);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
  });
});

describe("getSessionWithGitHubToken", () => {
  it("returns the token to server code while the session it returns stays clean", async () => {
    nextAuth.cookieToken = signedInToken();

    const { session, githubAccessToken } = await getSessionWithGitHubToken();

    expect(githubAccessToken).toBe(ACCESS_TOKEN);
    expect(session?.user?.id).toBe("user-1");
    expect(JSON.stringify(session)).not.toContain(ACCESS_TOKEN);
  });

  it("returns no token when nobody is signed in", async () => {
    const { session, githubAccessToken } = await getSessionWithGitHubToken();

    expect(session).toBeNull();
    expect(githubAccessToken).toBeNull();
  });

  it("returns no token when the session has none", async () => {
    nextAuth.cookieToken = { ...signedInToken(), accessToken: undefined };

    const { session, githubAccessToken } = await getSessionWithGitHubToken();

    expect(session?.user?.id).toBe("user-1");
    expect(githubAccessToken).toBeNull();
  });

  it("keeps concurrent requests' tokens apart", async () => {
    const tokens = ["gho_request_a", "gho_request_b", "gho_request_c"];

    // Each call reads the cookie synchronously, then all three are in flight
    // before any session callback runs.
    const pending = tokens.map((token) => {
      nextAuth.cookieToken = signedInToken(token);
      return getSessionWithGitHubToken();
    });
    const results = await Promise.all(pending);

    expect(results.map((r) => r.githubAccessToken)).toEqual(tokens);
  });
});
