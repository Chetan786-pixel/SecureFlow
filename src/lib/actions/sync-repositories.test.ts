import { describe, it, expect, vi, beforeEach } from "vitest";
import { triggerRepositorySync } from "./sync-repositories";
import * as authModule from "@/auth";
import * as syncEngine from "@/lib/github/sync-user-repos";
import { captureGitHubAccessToken } from "@/lib/github/oauth-token-capture";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("triggerRepositorySync Server Action (#634)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error if unauthenticated", async () => {
    vi.mocked(authModule.auth).mockResolvedValue(null);

    const result = await triggerRepositorySync();
    expect(result.synced).toBe(0);
    expect(result.hasInstallation).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });

  it("executes repository sync when user is authenticated", async () => {
    // As NextAuth does: the session callback sees the GitHub token, the
    // session it returns does not carry it.
    vi.mocked(authModule.auth).mockImplementation((async () => {
      captureGitHubAccessToken("gho_token_abc");
      return { user: { id: "user-456", githubLogin: "dev_heist" } };
    }) as any);

    vi.spyOn(syncEngine, "syncUserRepositories").mockResolvedValue({
      synced: 3,
      hasInstallation: true,
      installationId: 778899,
    });

    const result = await triggerRepositorySync();

    expect(result.synced).toBe(3);
    expect(result.hasInstallation).toBe(true);
    expect(syncEngine.syncUserRepositories).toHaveBeenCalledWith(
      "user-456",
      "dev_heist",
      "gho_token_abc",
    );
  });
});
