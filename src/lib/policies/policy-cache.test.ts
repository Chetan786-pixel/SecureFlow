import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRedisGet = vi.hoisted(() => vi.fn());
const mockRedisSet = vi.hoisted(() => vi.fn());
const mockRedisDel = vi.hoisted(() => vi.fn());
const mockRedisIncr = vi.hoisted(() => vi.fn());
const mockRedisExpire = vi.hoisted(() => vi.fn());
const mockRedisEval = vi.hoisted(() => vi.fn());

vi.mock("@/lib/redis", () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
    incr: mockRedisIncr,
    expire: mockRedisExpire,
    eval: mockRedisEval,
  },
}));

const mockFindManyTemplates = vi.hoisted(() => vi.fn());
const mockFindManyToggles = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  default: {
    policyTemplate: { findMany: mockFindManyTemplates },
    userPolicyToggle: { findMany: mockFindManyToggles },
  },
}));

import {
  getActivePoliciesForUser,
  fetchPoliciesFromDb,
  invalidatePolicyCache,
  policyCacheKey,
  policyVersionKey,
  POLICY_CACHE_TTL_SECONDS,
  POLICY_VERSION_TTL_SECONDS,
} from "./policy-cache";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    id: "tpl-1",
    name: "Block Secrets",
    description: "...",
    severity: "CRITICAL",
    action: "DENY",
    rules: {},
    isDefault: true,
  },
  {
    id: "tpl-2",
    name: "SQL Injection",
    description: "...",
    severity: "HIGH",
    action: "REVIEW REQUIRED",
    rules: {},
    isDefault: false,
  },
];

const TOGGLES_ENABLE_BOTH = [
  { policyTemplateId: "tpl-1", isActive: true },
  { policyTemplateId: "tpl-2", isActive: true },
];

const CACHED_POLICIES = JSON.stringify([{ id: "tpl-1", name: "Block Secrets", isActive: true }]);

beforeEach(() => {
  vi.clearAllMocks();
  mockFindManyTemplates.mockResolvedValue(TEMPLATES);
  mockFindManyToggles.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// policyCacheKey
// ---------------------------------------------------------------------------

describe("policyCacheKey", () => {
  it("returns a namespaced key for the userId", () => {
    expect(policyCacheKey("user-1")).toBe("policy:active:user-1");
  });

  it("returns a separate namespaced version key for the userId", () => {
    expect(policyVersionKey("user-1")).toBe("policy:ver:user-1");
  });
});

// ---------------------------------------------------------------------------
// getActivePoliciesForUser — cache hit
// ---------------------------------------------------------------------------

describe("getActivePoliciesForUser — cache hit", () => {
  it("returns cached data without hitting Prisma", async () => {
    mockRedisGet.mockResolvedValue(CACHED_POLICIES);

    const result = await getActivePoliciesForUser("user-1");

    expect(result).toEqual(JSON.parse(CACHED_POLICIES));
    expect(mockFindManyTemplates).not.toHaveBeenCalled();
    expect(mockFindManyToggles).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getActivePoliciesForUser — cache miss
// ---------------------------------------------------------------------------

describe("getActivePoliciesForUser — cache miss", () => {
  it("fetches from Prisma and writes to Redis on a miss", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFindManyToggles.mockResolvedValue(TOGGLES_ENABLE_BOTH);

    await getActivePoliciesForUser("user-1");

    expect(mockFindManyTemplates).toHaveBeenCalledOnce();
    expect(mockFindManyToggles).toHaveBeenCalledWith({ where: { userId: "user-1" } });
    // The write goes through a version-guarded script (#1222), not a bare SET.
    expect(mockRedisEval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      policyVersionKey("user-1"),
      policyCacheKey("user-1"),
      "0",
      expect.any(String),
      String(POLICY_CACHE_TTL_SECONDS),
    );
  });

  it("returns only policies the user has enabled", async () => {
    mockRedisGet.mockResolvedValue(null);
    // Only tpl-2 toggled on; tpl-1 is isDefault:true so it's on by default
    mockFindManyToggles.mockResolvedValue([
      { policyTemplateId: "tpl-2", isActive: true },
      { policyTemplateId: "tpl-1", isActive: false },
    ]);

    const result = await getActivePoliciesForUser("user-1");

    // tpl-1 explicitly disabled, tpl-2 explicitly enabled
    expect(result.map((p) => p.id)).toEqual(["tpl-2"]);
  });

  it("includes isDefault:true policies when user has no toggle for them", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockFindManyToggles.mockResolvedValue([]); // no toggles at all

    const result = await getActivePoliciesForUser("user-1");

    // tpl-1 isDefault:true → included; tpl-2 isDefault:false → excluded
    expect(result.map((p) => p.id)).toEqual(["tpl-1"]);
  });
});

// ---------------------------------------------------------------------------
// getActivePoliciesForUser — Redis fallback
// ---------------------------------------------------------------------------

describe("getActivePoliciesForUser — Redis error fallback", () => {
  it("falls back to Prisma when Redis.get throws", async () => {
    mockRedisGet.mockRejectedValue(new Error("ECONNRESET"));
    mockFindManyToggles.mockResolvedValue([]);

    const result = await getActivePoliciesForUser("user-1");

    expect(result).toHaveLength(1); // tpl-1 isDefault
    expect(mockFindManyTemplates).toHaveBeenCalledOnce();
  });

  it("does not throw when the cache write fails after a miss", async () => {
    mockRedisGet.mockResolvedValue(null);
    mockRedisEval.mockRejectedValue(new Error("Redis write failed"));

    await expect(getActivePoliciesForUser("user-1")).resolves.toBeDefined();
  });

  it("skips the cache write when the version cannot be read", async () => {
    mockRedisGet.mockImplementation(async (key: string) => {
      if (key === policyVersionKey("user-1")) throw new Error("Redis down");
      return null;
    });

    const result = await getActivePoliciesForUser("user-1");

    expect(result).toHaveLength(1);
    expect(mockRedisEval).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// invalidatePolicyCache
// ---------------------------------------------------------------------------

describe("invalidatePolicyCache", () => {
  it("deletes the correct Redis key", async () => {
    await invalidatePolicyCache("user-1");

    expect(mockRedisDel).toHaveBeenCalledWith(policyCacheKey("user-1"));
  });

  it("bumps the version counter before deleting the cached value", async () => {
    const order: string[] = [];
    mockRedisIncr.mockImplementation(async () => void order.push("incr"));
    mockRedisDel.mockImplementation(async () => void order.push("del"));

    await invalidatePolicyCache("user-1");

    expect(mockRedisIncr).toHaveBeenCalledWith(policyVersionKey("user-1"));
    expect(mockRedisExpire).toHaveBeenCalledWith(
      policyVersionKey("user-1"),
      POLICY_VERSION_TTL_SECONDS,
    );
    expect(order).toEqual(["incr", "del"]);
  });

  it("still deletes the cached value when the version bump fails", async () => {
    mockRedisIncr.mockRejectedValue(new Error("Redis down"));

    await invalidatePolicyCache("user-1");

    expect(mockRedisDel).toHaveBeenCalledWith(policyCacheKey("user-1"));
  });

  it("does not throw when Redis.del fails", async () => {
    mockRedisDel.mockRejectedValue(new Error("Redis down"));

    await expect(invalidatePolicyCache("user-1")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Race: a slow read must not repopulate the cache after an invalidation (#1222)
// ---------------------------------------------------------------------------

describe("stale cache write race (#1222)", () => {
  /** Minimal in-memory stand-in for the Redis commands the module uses. */
  function installFakeRedis() {
    const store = new Map<string, string>();
    mockRedisGet.mockImplementation(async (k: string) => store.get(k) ?? null);
    mockRedisSet.mockImplementation(async (k: string, v: string) => void store.set(k, v));
    mockRedisIncr.mockImplementation(async (k: string) => {
      const next = Number(store.get(k) ?? "0") + 1;
      store.set(k, String(next));
      return next;
    });
    mockRedisExpire.mockResolvedValue(1);
    mockRedisDel.mockImplementation(async (k: string) => void store.delete(k));
    // Mirrors the Lua script: store only if the version is still the expected one.
    mockRedisEval.mockImplementation(
      async (
        _s: string,
        _n: number,
        verKey: string,
        key: string,
        expected: string,
        value: string,
      ) => {
        if ((store.get(verKey) ?? "0") !== expected) return 0;
        store.set(key, value);
        return 1;
      },
    );
    return store;
  }

  it("does not cache a policy that was read before an update and written after it", async () => {
    const store = installFakeRedis();

    // First scan reads the OLD policy from Postgres, then stalls before it can cache it.
    let releaseSlowRead!: () => void;
    const slowRead = new Promise<void>((resolve) => (releaseSlowRead = resolve));
    mockFindManyTemplates.mockImplementationOnce(async () => {
      const oldRows = [TEMPLATES[0]];
      await slowRead;
      return oldRows;
    });

    const staleScan = getActivePoliciesForUser("user-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The user updates their policy: DB now returns the NEW rows, cache is invalidated.
    mockFindManyTemplates.mockResolvedValue([TEMPLATES[1]]);
    mockFindManyToggles.mockResolvedValue([{ policyTemplateId: "tpl-2", isActive: true }]);
    await invalidatePolicyCache("user-1");

    releaseSlowRead();
    await staleScan;

    // The stale result must not have been stored...
    expect(store.has(policyCacheKey("user-1"))).toBe(false);

    // ...so the next scan reads the latest policy from Postgres.
    const nextScan = await getActivePoliciesForUser("user-1");
    expect(nextScan.map((p) => p.id)).toEqual(["tpl-2"]);
  });

  it("still caches normally when no invalidation happens during the read", async () => {
    const store = installFakeRedis();

    await getActivePoliciesForUser("user-1");

    expect(store.has(policyCacheKey("user-1"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchPoliciesFromDb
// ---------------------------------------------------------------------------

describe("fetchPoliciesFromDb", () => {
  it("runs both Prisma queries in parallel", async () => {
    mockFindManyToggles.mockResolvedValue([]);

    await fetchPoliciesFromDb("user-1");

    expect(mockFindManyTemplates).toHaveBeenCalledOnce();
    expect(mockFindManyToggles).toHaveBeenCalledOnce();
  });

  it("sets isActive:true on every returned policy", async () => {
    mockFindManyToggles.mockResolvedValue(TOGGLES_ENABLE_BOTH);

    const result = await fetchPoliciesFromDb("user-1");

    expect(result.every((p) => p.isActive === true)).toBe(true);
  });
});
