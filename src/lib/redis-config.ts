/**
 * Which Redis the application talks to, decided in one place.
 *
 * Two problems lived in the separate modules that build the clients:
 *
 *  - The queue client in `src/lib/queue/redis.ts` used
 *    `REDIS_URL || "redis://localhost:6379"` in every environment. A
 *    production deployment that forgot `REDIS_URL` did not fail: it connected
 *    to a localhost where nothing listens, and because BullMQ requires
 *    `maxRetriesPerRequest: null`, every enqueue waited forever. The GitHub
 *    webhook route hung instead of erroring, and the worker sat idle.
 *  - The rate limiter switched to Upstash when `UPSTASH_REDIS_REST_URL` was set
 *    and never checked the token. `Redis.fromEnv()` only warns about a missing
 *    token, so the limiter failed on every request at runtime.
 *
 * Nothing here imports a Redis client or opens a connection, so the env
 * validator and the tests can call it freely. Error messages name variables
 * and never include values: both settings carry credentials.
 */

/** Raised for Redis settings the application cannot run with. */
export class RedisConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisConfigurationError";
    Object.setPrototypeOf(this, RedisConfigurationError.prototype);
  }
}

/** Where the queues connect when `REDIS_URL` is unset outside production. */
export const DEFAULT_DEV_REDIS_URL = "redis://localhost:6379";

type EnvSource = Record<string, string | undefined>;

/** A value that is set and not blank, trimmed; otherwise undefined. */
function setting(env: EnvSource, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * True for a running production server or worker, false during `next build`.
 *
 * `next build` runs with `NODE_ENV=production` and imports route modules to
 * collect page data, but it never processes a job. It sets `NEXT_PHASE` before
 * doing so, and requiring a live Redis there would make every build need
 * production secrets.
 */
export function isProductionRuntime(env: EnvSource = process.env): boolean {
  return env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build";
}

function hasProtocol(raw: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/**
 * The URL the BullMQ queues and workers connect to.
 *
 * - `REDIS_URL` set: used as given, if it is a `redis://` or `rediss://` URL.
 * - Unset in production: throws. A queue that cannot reach Redis should fail
 *   where someone will see it, not hang.
 * - Unset anywhere else (development, tests, `next build`): the local default.
 */
export function resolveQueueRedisUrl(env: EnvSource = process.env): string {
  const url = setting(env, "REDIS_URL");

  if (url) {
    if (!hasProtocol(url, ["redis:", "rediss:"])) {
      throw new RedisConfigurationError("REDIS_URL must be a redis:// or rediss:// URL.");
    }
    return url;
  }

  if (isProductionRuntime(env)) {
    throw new RedisConfigurationError(
      "REDIS_URL is not set. The job queues need it in production; refusing to fall back to " +
        `${DEFAULT_DEV_REDIS_URL}.`,
    );
  }

  return DEFAULT_DEV_REDIS_URL;
}

/** Upstash REST credentials for the rate limiter. */
export interface UpstashRestConfig {
  url: string;
  token: string;
}

/**
 * The Upstash REST settings, or `null` when Upstash is not configured.
 *
 * The URL and token are only meaningful together. Either one alone is a
 * configuration mistake and throws, rather than leaving the rate limiter to
 * fail one request at a time.
 */
export function resolveUpstashRestConfig(env: EnvSource = process.env): UpstashRestConfig | null {
  const url = setting(env, "UPSTASH_REDIS_REST_URL");
  const token = setting(env, "UPSTASH_REDIS_REST_TOKEN");

  if (!url && !token) return null;

  if (!url || !token) {
    const [present, missing] = url
      ? ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
      : ["UPSTASH_REDIS_REST_TOKEN", "UPSTASH_REDIS_REST_URL"];
    throw new RedisConfigurationError(
      `${present} is set but ${missing} is not. Set both to use Upstash, or neither.`,
    );
  }

  if (!hasProtocol(url, ["https:"])) {
    throw new RedisConfigurationError("UPSTASH_REDIS_REST_URL must be an https:// URL.");
  }

  return { url, token };
}
