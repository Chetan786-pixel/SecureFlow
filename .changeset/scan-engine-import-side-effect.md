---
"secureflow": patch
---

Importing the scan engine (`src/lib/scanner/scanEngine.ts`) no longer starts the `github-webhooks` BullMQ consumer. The engine took `getGitHubAppCredentials` from `@/lib/queue/worker`, which constructs that Worker at module scope, so any process that loaded the engine — including one meant to run only the scan pool — also consumed webhook jobs. It now imports the helper from `@/lib/github/app-auth`, and a test fails if anything other than `scripts/start-worker.ts` imports a module that starts a consumer.
