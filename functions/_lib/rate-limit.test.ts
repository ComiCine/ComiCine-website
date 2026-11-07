/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Tests for the authentication rate limiter.
 *
 * The counter is mocked through the injectable store so these cases do not
 * depend on the Cache API being present in the Node test environment. The
 * window is driven through `options.now` so no timers are needed.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  RATE_LIMIT_POLICIES,
  cacheRateLimitStore,
  checkRateLimit,
  memoryRateLimitStore,
  rateLimitPolicyFor,
  rateLimitResponse,
  resetRateLimitMemory,
  type RateLimitStore,
} from "./rate-limit";

const LOGIN = RATE_LIMIT_POLICIES["/login"];
const LOGOUT = RATE_LIMIT_POLICIES["/logout"];
const START = Date.UTC(2026, 10, 7, 12, 0, 0);
const ONE_MINUTE = 60_000;

function fakeCache() {
  const entries = new Map<string, string>();
  const keys: string[] = [];
  const cache = {
    match: async (request: RequestInfo) => {
      const key = typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
      const body = entries.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    put: async (request: RequestInfo, response: Response) => {
      const key = typeof request === "string"
        ? request
        : request instanceof URL
          ? request.href
          : request.url;
      keys.push(key);
      entries.set(key, await response.text());
    },
  };
  return { cache, entries, keys };
}

beforeEach(() => {
  resetRateLimitMemory();
});

describe("rate limit policies", () => {
  it("covers only the exact authentication entry points", () => {
    expect(rateLimitPolicyFor("/login")).toBe(LOGIN);
    expect(rateLimitPolicyFor("/logout")).toBe(LOGOUT);
    expect(rateLimitPolicyFor("/login/")).toBe(LOGIN);
    expect(rateLimitPolicyFor("/logout/")).toBe(LOGOUT);
  });

  it("never throttles the Access login callbacks or lookalike paths", () => {
    for (const path of [
      "/login/entra",
      "/login/callback",
      "/identity/callback",
      "/api/identity/exchange",
      "/login-as-admin",
      "/logout-anywhere",
      "/login/anything",
    ]) {
      expect(rateLimitPolicyFor(path), path).toBeNull();
    }
  });

  it("uses the documented thresholds", () => {
    expect(LOGIN.limit).toBe(10);
    expect(LOGIN.windowSeconds).toBe(60);
    expect(LOGOUT.limit).toBe(20);
    expect(LOGOUT.windowSeconds).toBe(60);
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit and rejects the next request", async () => {
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      const decision = await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
      expect(decision.limited, `attempt ${attempt}`).toBe(false);
      expect(decision.remaining).toBe(LOGIN.limit - attempt);
    }

    const limited = await checkRateLimit(LOGIN, "203.0.113.7", { now: START + 1_000 });
    expect(limited.limited).toBe(true);
    expect(limited.remaining).toBe(0);
    expect(limited.retryAfterSeconds).toBe(59);
  });

  it("uses a separate, higher bucket for /logout", async () => {
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
    }
    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START })).limited).toBe(true);

    const logout = await checkRateLimit(LOGOUT, "203.0.113.7", { now: START });
    expect(logout.limited).toBe(false);
    expect(logout.remaining).toBe(LOGOUT.limit - 1);
  });

  it("isolates different source addresses", async () => {
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
    }
    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START })).limited).toBe(true);
    expect((await checkRateLimit(LOGIN, "198.51.100.8", { now: START })).limited).toBe(false);
  });

  it("starts a fresh count in the next fixed window", async () => {
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
    }
    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START + ONE_MINUTE - 1 })).limited)
      .toBe(true);

    const next = await checkRateLimit(LOGIN, "203.0.113.7", { now: START + ONE_MINUTE });
    expect(next.limited).toBe(false);
    expect(next.remaining).toBe(LOGIN.limit - 1);
  });

  it("reports the seconds left in the current window", async () => {
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
    }
    const decision = await checkRateLimit(LOGIN, "203.0.113.7", { now: START + 30_000 });
    expect(decision.retryAfterSeconds).toBe(30);
    expect(decision.resetAt).toBe(Math.floor((START + ONE_MINUTE) / 1000));
  });

  it("fails open when the counter store cannot be read", async () => {
    const broken: RateLimitStore = {
      read: async () => {
        throw new Error("cache read failed");
      },
      write: async () => {
        throw new Error("cache write failed");
      },
    };
    await expect(checkRateLimit(LOGIN, "203.0.113.7", { now: START, store: broken }))
      .resolves.toMatchObject({ limited: false });
  });

  it("fails open when the counter cannot be written", async () => {
    const readOnly: RateLimitStore = {
      read: async () => null,
      write: async () => {
        throw new Error("cache write failed");
      },
    };
    for (let attempt = 0; attempt < LOGIN.limit + 5; attempt++) {
      const decision = await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store: readOnly });
      expect(decision.limited).toBe(false);
    }
  });

  it("shares one counter through the cache store", async () => {
    const { cache } = fakeCache();
    const store = cacheRateLimitStore(cache);
    for (let attempt = 1; attempt <= LOGIN.limit; attempt++) {
      expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store })).limited)
        .toBe(false);
    }
    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store })).limited).toBe(true);
  });

  it("ignores a stale cache entry from another window", async () => {
    const { cache, entries } = fakeCache();
    const store = cacheRateLimitStore(cache);
    await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store });
    for (const key of [...entries.keys()]) {
      expect(key).toContain("/__rate_limit/login/");
      entries.set(key, JSON.stringify({ window: 1, count: 999 }));
    }

    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store })).limited).toBe(false);
  });

  it("never puts the raw source address into a cache key", async () => {
    const { cache, keys } = fakeCache();
    await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store: cacheRateLimitStore(cache) });
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("203.0.113.7");
    expect(keys[0]).toMatch(/\/__rate_limit\/login\/\d+\/[0-9a-f]{32}$/);
  });

  it("keeps the memory fallback bounded and independent of the cache", async () => {
    await checkRateLimit(LOGIN, "203.0.113.7", { now: START, store: memoryRateLimitStore });
    await checkRateLimit(LOGIN, "203.0.113.7", { now: START });
    // Both calls count: the default store is the memory store when the Cache API is absent.
    expect((await checkRateLimit(LOGIN, "203.0.113.7", { now: START })).remaining)
      .toBe(LOGIN.limit - 3);
  });
});

describe("rateLimitResponse", () => {
  const decision = {
    limited: true,
    limit: 10,
    remaining: 0,
    retryAfterSeconds: 42,
    resetAt: Math.floor((START + ONE_MINUTE) / 1000),
  };

  it("returns HTML with Retry-After and no Location by default", async () => {
    const response = rateLimitResponse(new Request("https://comicine.com/login"), decision);
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Location")).toBeNull();
    expect(body).toContain("Too Many Requests");
    expect(body).toContain("/");
  });

  it("returns JSON when the client asks for it", async () => {
    const response = rateLimitResponse(
      new Request("https://comicine.com/login", { headers: { Accept: "application/json" } }),
      decision,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toEqual({ error: "rate_limited", retry_after: 42 });
  });

  it("keeps HTML when the client also asks for it", async () => {
    const html = rateLimitResponse(
      new Request("https://comicine.com/login", { headers: { Accept: "text/html,application/json;q=0.9" } }),
      decision,
    );
    expect(html.headers.get("Content-Type")).toContain("text/html");

    const json = rateLimitResponse(
      new Request("https://comicine.com/login", { headers: { Accept: "application/json; charset=utf-8" } }),
      decision,
    );
    expect(json.headers.get("Content-Type")).toContain("application/json");
  });

  it("keeps the body empty for HEAD", async () => {
    const response = rateLimitResponse(
      new Request("https://comicine.com/login", { method: "HEAD" }),
      decision,
    );
    await expect(response.text()).resolves.toBe("");
  });
});
