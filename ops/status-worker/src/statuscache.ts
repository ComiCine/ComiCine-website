/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Explicit Cache API layer for the server-rendered status page (suggestion 23).
 *
 * A Worker-generated response is **not** cached just because it carries
 * `Cache-Control: public, s-maxage=60`. Without an explicit `caches.default.put`, every page
 * view (a refresh, an external monitor, a crawler) ran `renderStatusPage()` and read D1
 * (probes, probe_state, latest heartbeat, probe_uptime_daily). That is the hottest public page
 * and a meaningful part of the daily D1 read budget.
 *
 * Design:
 *   - One key per language, so the four variants can never leak into each other. The key is a
 *     synthetic same-origin URL that does not collide with any real route.
 *   - The TTL comes from the stored response's own `Cache-Control` (`s-maxage=60`), keeping the
 *     page aligned with the one-minute probe cron. At most one render and D1 read per language
 *     per minute; the data can be at most about one minute stale.
 *   - The caller decides what is cacheable: this module refuses anything that is not a 200 or
 *     that says `no-store`, so the 404 page and the 503 render-failure page can never enter the
 *     cache. POST requests never reach the cache key path in `index.ts`.
 *   - Every function degrades silently when the Cache API is unavailable (local tests, an
 *     unusual runtime): the page renders directly instead of failing.
 *   - Writes never reject the caller, and errors are logged once per failure, not per request.
 */

/** Synthetic origin for cache keys; the status page is always served from this host in production. */
export const STATUS_CACHE_ORIGIN = "https://status.comicine.com";

/** Path prefix for cache keys; must not collide with any real route of the Worker. */
export const STATUS_CACHE_KEY_PREFIX = "/__status-page/";

/** Resolve `caches.default` defensively: Node tests have no global `caches`, and access can throw. */
function defaultCache(): Cache | null {
  try {
    // The DOM `CacheStorage` type has no `default`; the Workers runtime adds it.
    const storage = (globalThis as { caches?: { default?: Cache } }).caches;
    return storage?.default ?? null;
  } catch {
    return null;
  }
}

/** Cache key request for one language; one key per language so variants never collide. */
export function statusPageCacheKey(lang: string): Request {
  return new Request(`${STATUS_CACHE_ORIGIN}${STATUS_CACHE_KEY_PREFIX}${String(lang)}`);
}

/** Whether the runtime exposes a Cache API. The caller uses this to label the response `bypass`. */
export function statusCacheAvailable(): boolean {
  return defaultCache() !== null;
}

/**
 * Read a previously cached status page. Returns null when the Cache API is unavailable, the
 * entry is missing/expired, or the read throws. Never throws.
 */
export async function readStatusPageCache(key: Request): Promise<Response | null> {
  const cache = defaultCache();
  if (!cache) return null;
  try {
    return (await cache.match(key)) ?? null;
  } catch (err) {
    console.warn(
      JSON.stringify({ event: "status_cache_read_failed", message: String(err).slice(0, 140) }),
    );
    return null;
  }
}

/**
 * Store a rendered status page for the TTL carried by its response headers.
 *
 * Skips: no Cache API, non-200 responses, responses with `Cache-Control: no-store`. Uses
 * `waitUntil` when provided so the caller can return the response immediately; otherwise the
 * put runs in the background. Never throws and never rejects the caller.
 */
export function writeStatusPageCache(
  key: Request,
  response: Response,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  const cache = defaultCache();
  if (!cache) return;
  if (response.status !== 200) return;
  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (/no-store/i.test(cacheControl)) return;

  const put = cache.put(key, response.clone()).catch((err: unknown) => {
    console.warn(
      JSON.stringify({ event: "status_cache_write_failed", message: String(err).slice(0, 140) }),
    );
    return undefined;
  });

  try {
    if (waitUntil) waitUntil(put);
    else void put;
  } catch (err) {
    // A context whose waitUntil is already sealed must not break the page response.
    console.warn(
      JSON.stringify({ event: "status_cache_write_failed", message: String(err).slice(0, 140) }),
    );
  }
}
