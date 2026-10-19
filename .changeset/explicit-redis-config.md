---
"secureflow": patch
---

The job-queue Redis client no longer falls back to `redis://localhost:6379` in production. With `REDIS_URL` unset it now throws a clear configuration error at startup instead of hanging every enqueue; development, tests and `next build` keep the local default. `REDIS_URL` must be a `redis://` or `rediss://` URL. The Upstash rate limiter now requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` together, and the URL must be https. docker-compose now runs a Redis service and sets `REDIS_URL` unless `.env` provides one. Error messages name variables, never values.
