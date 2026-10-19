/**
 * Hand the signed-in user's GitHub OAuth token to server code without putting
 * it in the session.
 *
 * Everything the session callback returns is public. `/api/auth/session`
 * serves it to the browser and the root layout embeds it in the page for
 * `SessionProvider`, so a token in the session is a token any script on the
 * page, browser extension or cached response can read. The token has to stay
 * in the encrypted JWT, but a few server paths (repository sync) still need it.
 *
 * The session callback calls {@link captureGitHubAccessToken} on every run.
 * Outside {@link withGitHubAccessTokenCapture} that is a no-op, which is the
 * case for every HTTP request to `/api/auth/session`. Inside it, the token
 * goes into a store scoped to that one async call. It reads the token the jwt
 * callback has just refreshed, so the server never refreshes a second time.
 *
 * The store lives in its own module, separate from `@/auth` and from the
 * accessor in `./user-access-token`, so that neither of those has to import the
 * other.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface CaptureSlot {
  accessToken: string | null;
}

const slots = new AsyncLocalStorage<CaptureSlot>();

/**
 * Record the provider access token for the caller that asked for it.
 *
 * Does nothing unless the current call is running inside
 * {@link withGitHubAccessTokenCapture}.
 */
export function captureGitHubAccessToken(accessToken: unknown): void {
  const slot = slots.getStore();
  if (!slot) return;
  slot.accessToken = typeof accessToken === "string" && accessToken.length > 0 ? accessToken : null;
}

/**
 * Run `fn` (an `auth()` call) and return its result together with the access
 * token its session callback saw, or `null` if the callback did not run or the
 * session has no token.
 */
export async function withGitHubAccessTokenCapture<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; accessToken: string | null }> {
  const slot: CaptureSlot = { accessToken: null };
  const result = await slots.run(slot, fn);
  return { result, accessToken: slot.accessToken };
}
