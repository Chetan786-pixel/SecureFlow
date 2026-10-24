---
"secureflow": patch
---

The session returned by `/api/auth/session` and embedded in pages for `SessionProvider` no longer carries the user's GitHub OAuth access token. Server code that needs the token (repository sync on the dashboard, the sync server action and `POST /api/repositories/sync`) now reads it with `getSessionWithGitHubToken()` from `@/lib/github/user-access-token`, which takes it from the session callback within the same `auth()` call. The refresh token was never in the session and remains only in the encrypted JWT.
