// Server-side only. `@/auth` (Prisma) and `node:async_hooks` already keep this
// module out of any client bundle.
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { withGitHubAccessTokenCapture } from "./oauth-token-capture";

export interface SessionWithGitHubToken {
  session: Session | null;
  /**
   * The signed-in user's GitHub OAuth access token. Server-side only: never
   * return it from a route, pass it to a client component or log it.
   */
  githubAccessToken: string | null;
}

/**
 * Resolve the session and the user's GitHub OAuth token in one `auth()` call.
 *
 * Use this in place of `auth()` wherever a server path needs to call GitHub
 * as the user. The token is no longer on the session object because that
 * object is served to the browser (see `./oauth-token-capture`).
 *
 * It is one call rather than `auth()` followed by a token lookup because the
 * jwt callback may refresh an expired GitHub token. A second `auth()` would
 * refresh it again with a refresh token GitHub has already rotated.
 */
export async function getSessionWithGitHubToken(): Promise<SessionWithGitHubToken> {
  const { result, accessToken } = await withGitHubAccessTokenCapture(
    () => auth() as Promise<Session | null>,
  );

  return { session: result, githubAccessToken: result ? accessToken : null };
}
