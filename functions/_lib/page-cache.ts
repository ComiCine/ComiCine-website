/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Browser and process-local page cache policy plus the shared response envelope helpers. */

import { BASE_URL, IDENTITY_SITE_ROLES, LANG_COOKIE } from "./config";
import { gateCookieHeaders } from "./gate";
import { getCookie, preserveSetCookie, requestUrl, type RequestContext } from "./routing";
import { SECURITY_HEADERS } from "./security";

/**
 * Cache headers for public prerendered pages; **follow measured behavior, not expectations**.
 *
 * Live checks on 2026-10-11 sent three requests to the same URL; `cf-cache-status`
 * stayed `DYNAMIC` and `age` stayed 0. Pages Functions responses **are not
 * cached at the Cloudflare edge**, regardless of `s-maxage` or `Vary`. Do not
 * set `s-maxage` or vary on `Cookie`; that would create per-visitor cache keys
 * without any edge benefit.
 *
 * Keep `max-age=300` because **private browser caches** use it. HTML depends on
 * `Accept-Language`, so retain `Vary: Accept-Language` to separate browser
 * entries by language. Request-level reuse comes from the process-local Cache
 * API below, keyed by host, language, and asset path.
 */
// `private` matches the intent above: only the visitor's own browser may cache the page.
// A `public` header would let a shared cache store gate-protected HTML, and the variant
// depends on the language cookie that `Vary: Accept-Language` does not cover.
const PAGE_CACHE_CONTROL = "private, max-age=300, stale-while-revalidate=3600";
const PAGE_CACHE_VARY = "Accept-Language";
const PRIVATE_PAGE_HOSTS = new Set(Object.keys(IDENTITY_SITE_ROLES));
const PRIVATE_PAGE_CACHE_CONTROL = "private, no-store";

type CacheLike = {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
};

/**
 * Process-local Cache API key: **host + language + asset path**.
 *
 * Include the host in the key: `www.<root_domain>` currently shares each route
 * with the root domain (see contract page_routes). If pageAsset is later used
 * for www or two hosts map to the same asset, omitting host could serve one
 * host's page on the other. www currently redirects before the cache; this
 * preventive rule is locked down by tests.
 */
export function pageCacheKey(host: string, assetPath: string, lang: string): URL {
  const url = new URL(assetPath, BASE_URL);
  url.searchParams.set("__cache", "1");
  url.searchParams.set("lang", lang);
  if (host) url.hostname = host;
  return url;
}

/**
 * Do not put Access-protected admin pages in the browser cache. After an
 * Access session expires or the user signs out, Safari could display old HTML
 * whose API fetches are redirected to cloudflareaccess.com, leaving the page
 * with only a load failure instead of a login form. The internal Cache API may
 * still reuse static HTML.
 */
function applyBrowserPageCachePolicy(response: Response, hostname: string): Response {
  if (!PRIVATE_PAGE_HOSTS.has(hostname)) return response;
  const headers = new Headers(response.headers);
  preserveSetCookie(headers, response.headers);
  headers.set("Cache-Control", PRIVATE_PAGE_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Cache prerendered pages by host and language to avoid reading ASSETS on every request.
 *
 * `host` is optional. Callers that already know the request host can pass it
 * in to avoid parsing the URL again for the cache key; otherwise use
 * requestUrl(context.request).
 */
export async function cachedPageAsset(
  context: RequestContext,
  assetPath: string,
  lang: string,
  host?: string,
): Promise<Response | null> {
  const { env, request } = context;
  if (!env.ASSETS) return null;

  const pageHost = host ?? requestUrl(request).hostname;
  const cacheUrl = pageCacheKey(pageHost, assetPath, lang);
  const cache = typeof caches !== "undefined"
    ? (caches as unknown as { default?: CacheLike }).default
    : undefined;

  if (cache) {
    try {
      const hit = await cache.match(new Request(cacheUrl));
      if (hit) return applyBrowserPageCachePolicy(hit, pageHost);
    } catch {
      // Cache failures must not prevent serving the page asset.
    }
  }

  const asset = await env.ASSETS.fetch(new URL(assetPath, BASE_URL));
  if (!asset.ok) return asset;

  const headers = new Headers(asset.headers);
  headers.set("Cache-Control", PAGE_CACHE_CONTROL);
  headers.set("Vary", PAGE_CACHE_VARY);
  // Pass through the ASSETS body stream instead of awaiting asset.arrayBuffer()
  // and buffering the entire response. `cache.put(response.clone())` already
  // tees the stream; pre-buffering would duplicate materialization and delay the
  // response until the stream ends. Copy the status, statusText, and all headers
  // (including Content-Type, ETag, and Content-Length) unchanged. The final
  // withSecurityHeaders() also constructs a Response from the body stream, and
  // Content-Length continues to come from the asset. asset.body is null only for
  // bodyless statuses such as 204/205, which are not real assets; the old code
  // threw TypeError for 204, while this implementation does not.
  const response = new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });

  // The first visit sets a language cookie, so cache only subsequent requests.
  if (cache && getCookie(LANG_COOKIE, request.headers.get("Cookie"))) {
    try {
      const put = cache.put(new Request(cacheUrl), response.clone()).catch(() => undefined);
      if (context.waitUntil) context.waitUntil(put);
      else void put;
    } catch {
      // Cache failures must not prevent serving the page asset.
    }
  }
  return applyBrowserPageCachePolicy(response, pageHost);
}

/**
 * Apply shared security headers; add only nosniff to API responses to avoid breaking JSON endpoints.
 *
 * `url` is optional. Pass it when onRequest has already parsed the URL to
 * avoid duplicate work. Existing callers that pass only the first two
 * arguments continue to work with the same behavior as `new URL(request.url)`.
 */
export function withSecurityHeaders(request: Request, resp: Response, url?: URL): Response {
  const headers = new Headers(resp.headers);
  preserveSetCookie(headers, resp.headers);
  const isApi = (url ?? requestUrl(request)).pathname.startsWith("/api/");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (isApi && name !== "X-Content-Type-Options") continue;
    if (name === "Referrer-Policy" && headers.get(name) === "no-referrer") continue;
    headers.set(name, value);
  }
  return new Response(request.method === "HEAD" ? null : resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

/**
 * Renew the __gate cookie on a normal page response when the session is near expiry.
 *
 * resolveGateTrust.shouldRenew controls renewal and waits until three quarters
 * of the TTL has elapsed, so this does not create an unbounded sliding window.
 * When renewal is unnecessary, return the response unchanged without extra allocations.
 */
export async function renewGateCookie(
  context: RequestContext,
  resp: Response,
  shouldRenew: boolean,
): Promise<Response> {
  if (!shouldRenew) return resp;
  const headers = new Headers(resp.headers);
  preserveSetCookie(headers, resp.headers);
  for (const value of await gateCookieHeaders(context.env.GATE_HMAC_KEY)) {
    headers.append("Set-Cookie", value);
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}
