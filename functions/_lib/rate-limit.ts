/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Per-source request throttling for the authentication entry points `/login` and `/logout`.
 *
 * Both paths are exempt from the D1 blocklist (`routing.ts` isExemptPath) so an
 * administrator on a blocked IP can still sign in or out. That exemption makes
 * them the cheapest targets for a flood, and `/logout` can trigger a D1 session
 * revocation write. This limiter is the only throttle in front of them.
 *
 * Counters deliberately never touch D1: a flood of authentication requests must
 * not turn into write amplification. They live in the Cache API (shared inside
 * one colo) with an isolate-memory fallback, and store failures fail **open**:
 * a cache outage must not lock administrators out of signing in.
 *
 * Fixed one-minute windows aligned to the UTC minute are intentional. A fixed
 * window allows at most twice the configured rate across a rolling minute (a
 * burst at the end of one window plus a burst at the start of the next), which
 * is acceptable for an abuse throttle and keeps the implementation small.
 * Counts are approximate by design: isolates may race on read-modify-write.
 */

import { BASE_URL } from "./config";
import { toHex } from "./crypto";

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * The only rate-limited paths, matched exactly after removing trailing slashes.
 *
 * Do not add `/login/entra`, `/login/callback`, `/identity/callback`, or
 * `/api/identity/exchange`: they are Access login callbacks, and throttling them
 * would turn a legitimate sign-in into a 429.
 */
export const RATE_LIMIT_POLICIES: Readonly<Record<string, RateLimitPolicy>> = {
  "/login": { name: "login", limit: 10, windowSeconds: 60 },
  "/logout": { name: "logout", limit: 20, windowSeconds: 60 },
};

/** Resolve the policy for a request path; exact match only. */
export function rateLimitPolicyFor(pathname: string): RateLimitPolicy | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return RATE_LIMIT_POLICIES[normalized] ?? null;
}

/** One fixed-window counter; `window` is the window start in unix seconds. */
export interface RateLimitCounter {
  window: number;
  count: number;
}

/** Minimal counter backend so tests can substitute a fake store. */
export interface RateLimitStore {
  read(key: string): Promise<RateLimitCounter | null>;
  write(key: string, counter: RateLimitCounter, ttlSeconds: number): Promise<void>;
}

export interface RateLimitDecision {
  limited: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the current window ends; 0 when the request is allowed. */
  retryAfterSeconds: number;
  /** Unix seconds when the current window ends. */
  resetAt: number;
}

const MEMORY_COUNTER_LIMIT = 4096;
const memoryCounters = new Map<string, { counter: RateLimitCounter; expiresAt: number }>();

/** In-isolate fallback used when the Cache API is unavailable (local development and tests). */
export const memoryRateLimitStore: RateLimitStore = {
  async read(key) {
    const entry = memoryCounters.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      memoryCounters.delete(key);
      return null;
    }
    return entry.counter;
  },
  async write(key, counter, ttlSeconds) {
    if (memoryCounters.size >= MEMORY_COUNTER_LIMIT) {
      const now = Date.now();
      for (const [entryKey, entry] of memoryCounters) {
        if (entry.expiresAt <= now) memoryCounters.delete(entryKey);
      }
      if (memoryCounters.size >= MEMORY_COUNTER_LIMIT) memoryCounters.clear();
    }
    memoryCounters.set(key, {
      counter,
      expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
    });
  },
};

/** Test hook: forget all in-isolate counters so a suite can restart from zero. */
export function resetRateLimitMemory(): void {
  memoryCounters.clear();
}

interface CacheLike {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
}

/**
 * Cache API store: shared across isolates in the same colo.
 *
 * Cache keys are absolute in-zone URLs containing only the route name, the
 * fixed window, and a truncated SHA-256 of the source IP; the raw IP is never a
 * cache key. The stored payload is a tiny JSON counter and the window start is
 * also stored, so a stale entry can never be mistaken for the current window.
 */
export function cacheRateLimitStore(cache: CacheLike): RateLimitStore {
  return {
    async read(key) {
      const hit = await cache.match(new Request(key));
      if (!hit) return null;
      const value = (await hit.json()) as Partial<RateLimitCounter>;
      if (
        typeof value.window !== "number" ||
        !Number.isFinite(value.window) ||
        typeof value.count !== "number" ||
        !Number.isFinite(value.count) ||
        value.count < 0
      ) {
        return null;
      }
      return { window: value.window, count: Math.floor(value.count) };
    },
    async write(key, counter, ttlSeconds) {
      await cache.put(
        new Request(key),
        new Response(JSON.stringify(counter), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${Math.max(1, ttlSeconds)}`,
          },
        }),
      );
    },
  };
}

/** Use the Cache API when the runtime exposes it, otherwise keep counters in this isolate. */
function sharedRateLimitStore(): RateLimitStore {
  const cache = typeof caches !== "undefined"
    ? (caches as unknown as { default?: CacheLike }).default
    : undefined;
  return cache ? cacheRateLimitStore(cache) : memoryRateLimitStore;
}

async function hashedSource(clientIp: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(clientIp || "anonymous"),
  );
  return toHex(new Uint8Array(digest)).slice(0, 32);
}

/**
 * Count one request against the policy and decide whether it may proceed.
 *
 * `options.now` and `options.store` exist so tests can use a fixed clock and a
 * fake counter. Production callers pass only the policy and the source IP.
 */
export async function checkRateLimit(
  policy: RateLimitPolicy,
  clientIp: string,
  options: { now?: number; store?: RateLimitStore } = {},
): Promise<RateLimitDecision> {
  const now = options.now ?? Date.now();
  const windowMs = policy.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const window = Math.floor(windowStart / 1000);
  const resetAt = Math.floor((windowStart + windowMs) / 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
  const identity = await hashedSource(clientIp);
  const key = `${BASE_URL}/__rate_limit/${policy.name}/${window}/${identity}`;

  let store = options.store ?? sharedRateLimitStore();
  let current: RateLimitCounter | null = null;
  try {
    current = await store.read(key);
  } catch {
    // A broken cache must not fail closed on an authentication endpoint.
    store = memoryRateLimitStore;
    current = null;
  }

  const count = current && current.window === window ? current.count : 0;
  if (count >= policy.limit) {
    return { limited: true, limit: policy.limit, remaining: 0, retryAfterSeconds, resetAt };
  }

  const nextCount = count + 1;
  try {
    await store.write(
      key,
      { window, count: nextCount },
      policy.windowSeconds + 1,
    );
  } catch {
    // Fail open: the request proceeds even if the counter cannot be stored.
  }
  return {
    limited: false,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - nextCount),
    retryAfterSeconds: 0,
    resetAt,
  };
}

/**
 * JSON only when the client asks for JSON and not for HTML.
 *
 * Browsers send `text/html` (with wildcards) for navigations, so an HTML 429
 * page stays the default; API clients that send only `application/json` get a
 * machine-readable body. A header that lists both keeps HTML, matching the
 * visual entry point these two paths are.
 */
function wantsJson(request: Request): boolean {
  const mediaTypes = (request.headers.get("Accept") ?? "")
    .split(",")
    .map((value) => value.trim().split(";", 1)[0].toLowerCase());
  const asksJson = mediaTypes.includes("application/json") || mediaTypes.includes("application/*");
  const asksHtml = mediaTypes.includes("text/html");
  return asksJson && !asksHtml;
}

/**
 * 429 response: JSON when the client asks for `application/json`, otherwise a
 * minimal HTML document. Keep the page free of inline style and script so the
 * shared CSP applies unchanged.
 */
export function rateLimitResponse(request: Request, decision: RateLimitDecision): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Retry-After": String(decision.retryAfterSeconds),
    "Vary": "Accept",
    "X-Robots-Tag": "noindex, nofollow",
  });

  if (wantsJson(request)) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(
      JSON.stringify({ error: "rate_limited", retry_after: decision.retryAfterSeconds }),
      { status: 429, headers },
    );
  }

  headers.set("Content-Type", "text/html; charset=utf-8");
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Too Many Requests</title></head><body><h1>Too Many Requests</h1><p>Too many requests. Try again in ${decision.retryAfterSeconds} seconds.</p><p><a href="/">Continue to ComiCine</a></p></body></html>`;
  return new Response(request.method === "HEAD" ? null : body, { status: 429, headers });
}
