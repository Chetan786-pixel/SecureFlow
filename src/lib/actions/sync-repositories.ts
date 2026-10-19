"use server";

import { getSessionWithGitHubToken } from "@/lib/github/user-access-token";
import { syncUserRepositories, SyncUserReposResult } from "@/lib/github/sync-user-repos";
import { revalidatePath } from "next/cache";

export async function triggerRepositorySync(): Promise<SyncUserReposResult> {
  const { session, githubAccessToken } = await getSessionWithGitHubToken();

  if (!session?.user?.id) {
    return {
      synced: 0,
      hasInstallation: false,
      error: "Unauthorized: Please sign in to sync repositories",
    };
  }

  const result = await syncUserRepositories(
    session.user.id,
    (session.user as any).githubLogin,
    githubAccessToken,
  );

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/findings");
  revalidatePath("/dashboard/policies");

  return result;
}
