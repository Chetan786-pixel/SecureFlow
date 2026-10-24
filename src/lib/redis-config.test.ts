import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_REDIS_URL,
  RedisConfigurationError,
  resolveQueueRedisUrl,
  resolveUpstashRestConfig,
} from "./redis-config";

const SECRET_URL = "rediss://default:p4ssw0rd-secret@cache.example.test:6379";

describe("resolveQueueRedisUrl", () => {
  it("uses REDIS_URL when set", () => {
    expect(resolveQueueRedisUrl({ NODE_ENV: "production", REDIS_URL: ` ${SECRET_URL} ` })).toBe(
      SECRET_URL,
    );
  });

  it("refuses to fall back to localhost in production", () => {
    expect(() => resolveQueueRedisUrl({ NODE_ENV: "production" })).toThrow(RedisConfigurationError);
    expect(() => resolveQueueRedisUrl({ NODE_ENV: "production", REDIS_URL: "  " })).toThrow(
      /REDIS_URL is not set/,
    );
  });

  it.each([
    { NODE_ENV: "development" },
    { NODE_ENV: "test" },
    { NODE_ENV: "production", NEXT_PHASE: "phase-production-build" },
  ])("keeps the local default for %o", (env) => {
    expect(resolveQueueRedisUrl(env)).toBe(DEFAULT_DEV_REDIS_URL);
  });

  it("rejects a non-Redis URL without echoing it", () => {
    const raw = "https://default:p4ssw0rd-secret@cache.example.test";
    let message = "";
    try {
      resolveQueueRedisUrl({ NODE_ENV: "development", REDIS_URL: raw });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/redis:\/\/ or rediss:\/\//);
    expect(message).not.toContain("p4ssw0rd-secret");
  });
});

describe("resolveUpstashRestConfig", () => {
  const url = "https://example.upstash.io";
  const token = "upstash-token-secret";

  it("is not configured when neither value is set", () => {
    expect(resolveUpstashRestConfig({})).toBeNull();
    expect(resolveUpstashRestConfig({ UPSTASH_REDIS_REST_URL: " " })).toBeNull();
  });

  it("returns both values when both are set", () => {
    expect(
      resolveUpstashRestConfig({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token }),
    ).toEqual({ url, token });
  });

  it("names the missing variable when only the URL is set", () => {
    expect(() => resolveUpstashRestConfig({ UPSTASH_REDIS_REST_URL: url })).toThrow(
      /UPSTASH_REDIS_REST_TOKEN is not/,
    );
  });

  it("names the missing variable without leaking the token when only the token is set", () => {
    let message = "";
    try {
      resolveUpstashRestConfig({ UPSTASH_REDIS_REST_TOKEN: token });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/UPSTASH_REDIS_REST_URL is not/);
    expect(message).not.toContain(token);
  });

  it("requires an https URL", () => {
    expect(() =>
      resolveUpstashRestConfig({
        UPSTASH_REDIS_REST_URL: "http://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: token,
      }),
    ).toThrow(/https:\/\//);
  });
});
