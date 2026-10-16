/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Limooo Pages middleware orchestration.
 *
 * This file coordinates requests, applies shared security headers, and controls
 * when tracking runs. Routing, gate, redirect, and blocklist logic live in
 * _lib/routing.ts, _lib/gate.ts, _lib/redirect.ts, and _lib/tracking.ts.
 */

import { logEvent } from "./_lib/logging";
import { configErrorResponse, requireAuth, runtimeConfigError } from "./_lib/session";
import { SECURITY_HEADERS } from "./_lib/security";
import {
  detectLang,
  getCookie,
  isGateTrustedIp,
  isApiPath,
  isExemptPath,
  isPublicAssetPath,
  PUBLIC_FILES_PREFIX,
  pageAsset,
  preserveSetCookie,
  requestUrl,
  withLangCookie,
  type RequestContext,
} from "./_lib/routing";
import {
  APPLE_ACCOUNT_HOSTNAME,
  BASE_URL,
  GATE_HOSTNAME,
  IMAGES_HOSTNAME,
  LANG_COOKIE,
  REDIRECT_HOSTNAME,
  ROOT_DOMAIN,
  VISITOR_HOSTNAME,
  WWW_HOSTNAME,
} from "./_lib/config";
import {
  handleGateConfig,
  handleGateDiag,
  handleGateEntry,
  handleLegacyGateRedirect,
  gateCookieHeaders,
  handleVerify,
  isBlocked,
  renderGatePage,
  resolveGateTrust,
} from "./_lib/gate";
import { isRedirectHost, renderRedirectPage } from "./_lib/redirect";
import {
  isTrustedCrawler,
  recordRay,
  recordVisit,
  shouldTrackRay,
  shouldTrackVisit,
} from "./_lib/tracking";

type PagesFunction = (context: RequestContext) => Promise<Response>;

/**
 * Map `/files/<name>` to the generated `/static/files/<name>` asset and serve it publicly.
 *
 * Accept only a single-level filename with no dot traversal to prevent reads
 * such as `/files/../secrets`. Do not list directories; return 404 when missing.
 */
async function servePublicFile(
  context: RequestContext,
  pathname: string,
): Promise<Response> {
  const name = pathname.slice(PUBLIC_FILES_PREFIX.length);
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) {
    return new Response("Not Found", { status: 404 });
  }
  if (!context.env.ASSETS) return new Response("Not Found", { status: 404 });

  const asset = await context.env.ASSETS.fetch(
    new URL(`/static/files/${name}`, BASE_URL),
  );
  if (!asset.ok) return new Response("Not Found", { status: 404 });

  return new Response(asset.body, {
    status: 200,
    headers: {
      "Content-Type":
        asset.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      ...(asset.headers.get("ETag") ? { ETag: asset.headers.get("ETag")! } : {}),
    },
  });
}

function redirectMissingDocument(request: Request, response: Response): Response {
  if (response.status !== 404 || !isHtmlNavigation(request)) return response;
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${BASE_URL}/404`,
      "Cache-Control": "no-store",
    },
  });
}

function isHtmlNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    request.headers.get("Sec-Fetch-Dest") === "document" ||
    request.headers.get("Sec-Fetch-Mode") === "navigate"
  ) {
    return true;
  }
  return (request.headers.get("Accept") ?? "")
    .split(",")
    .some((value) => {
      const [mediaType = ""] = value.trim().split(";", 1);
      return mediaType.toLowerCase() === "text/html";
    });
}

/** Non-business logs must be written after the response so they do not block pages or redirects. */
function defer(context: RequestContext, promise: Promise<unknown>): void {
  if (typeof context.waitUntil === "function") {
    context.waitUntil(promise);
  } else {
    void promise;
  }
}

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
const PAGE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const PAGE_CACHE_VARY = "Accept-Language";
const PRIVATE_PAGE_HOSTS = new Set([VISITOR_HOSTNAME, APPLE_ACCOUNT_HOSTNAME]);
const PRIVATE_PAGE_CACHE_CONTROL = "private, no-store";
const IMAGE_ASSET_LANDING_PATHS = new Set([
  "/",
  "/index.html",
  "/portfolio",
  "/qr-codes",
  "/icons",
]);
const LEGACY_HTML_HOST_ROOTS = new Map<string, string>([
  [ROOT_DOMAIN, `${BASE_URL}/`],
  [WWW_HOSTNAME, `${BASE_URL}/`],
  [IMAGES_HOSTNAME, `${BASE_URL}/`],
  [`services.${ROOT_DOMAIN}`, `https://services.${ROOT_DOMAIN}/`],
  [`contact.${ROOT_DOMAIN}`, `https://contact.${ROOT_DOMAIN}/`],
  [VISITOR_HOSTNAME, `https://${VISITOR_HOSTNAME}/`],
  [APPLE_ACCOUNT_HOSTNAME, `https://${APPLE_ACCOUNT_HOSTNAME}/`],
]);
const LEGACY_HTML_PATH_TARGETS = new Map<string, string>([
  ["www", `${BASE_URL}/`],
  ["images", `${BASE_URL}/`],
  ["portfolio", `${BASE_URL}/portfolio`],
  ["services", `https://services.${ROOT_DOMAIN}/`],
  ["contact", `https://contact.${ROOT_DOMAIN}/`],
  ["visitor", `https://${VISITOR_HOSTNAME}/`],
  ["apple-account", `https://${APPLE_ACCOUNT_HOSTNAME}/`],
  ["redirect", `https://${REDIRECT_HOSTNAME}/`],
  // docs.limooo.cn/ currently redirects to the main site via its own _redirects file.
  ["docs", `${BASE_URL}/`],
  ["status", `https://status.${ROOT_DOMAIN}/`],
]);

type LegacyHtmlResolution =
  | { kind: "redirect"; target: string }
  | { kind: "not_found" };

function resolveLegacyHtmlAlias(
  hostname: string,
  pathname: string,
): LegacyHtmlResolution | null {
  const hostRoot = LEGACY_HTML_HOST_ROOTS.get(hostname);
  if (!hostRoot) return null;
  const match = pathname.match(/^\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.html$/i);
  if (!match) return null;

  const subdomain = match[1].toLowerCase();
  if (subdomain === "index") return { kind: "redirect", target: hostRoot };
  const target = LEGACY_HTML_PATH_TARGETS.get(subdomain);
  return target ? { kind: "redirect", target } : { kind: "not_found" };
}

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
async function cachedPageAsset(
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
    const hit = await cache.match(new Request(cacheUrl));
    if (hit) return applyBrowserPageCachePolicy(hit, pageHost);
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
    const put = cache.put(new Request(cacheUrl), response.clone());
    context.waitUntil?.(put);
    if (!context.waitUntil) void put;
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
    headers.set(name, value);
  }
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

/**
 * Send unauthenticated users on protected subdomains to the local /login to establish a session (tasks/17 §11.10).
 *
 * Access has already authenticated the user before this subdomain and added
 * `Cf-Access-Jwt-Assertion`. This step converts that identity into our signed
 * session cookie. Return to `/login` on the **same host** rather than sending
 * the user to a separate identity host: the session cookie is scoped to
 * `.limooo.cn`, so a same-host round trip saves a hop and avoids Safari cookie issues.
 */
async function adminAuthRedirect(
  env: RequestContext["env"],
  request: Request,
  hostname: string,
  url?: URL,
): Promise<Response | null> {
  if (hostname !== VISITOR_HOSTNAME && hostname !== APPLE_ACCOUNT_HOSTNAME) return null;
  try {
    if (await requireAuth(env, request)) return null;
    const current = url ?? requestUrl(request);
    const next = `${current.pathname}${current.search}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?next=${encodeURIComponent(next)}`,
      },
    });
  } catch {
    return Response.json(
      { error: "auth_sessions_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

/** Get the original path to show after verification and remove the parameter used only to force a challenge. */
function gateNextPath(pathname: string, search: string): string {
  const nextUrl = new URL(pathname + search, BASE_URL);
  nextUrl.searchParams.delete("challenge");
  return nextUrl.pathname + nextUrl.search;
}

/**
 * Renew the __gate cookie on a normal page response when the session is near expiry.
 *
 * resolveGateTrust.shouldRenew controls renewal and waits until three quarters
 * of the TTL has elapsed, so this does not create an unbounded sliding window.
 * When renewal is unnecessary, return the response unchanged without extra allocations.
 */
async function renewGateCookie(
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

/** Core middleware orchestration, exported so local tests can mock dependencies. */
export async function handleOnRequest(context: RequestContext): Promise<Response> {
  const { request, env, next } = context;
// Parse once and reuse through the request path: requestUrl is memoized and lang/host/url are passed explicitly below.
  const url = requestUrl(request);
  const configError = runtimeConfigError(env);
  if (configError) return configErrorResponse(configError);
  const { hostname, pathname } = url;
  const forceChallenge = url.searchParams.get("challenge") === "1";

// Operations health endpoint: no visitor tracking or human-verification gate; Uptime Kuma calls it with a probe UA.
  if (pathname === "/_health") {
    return new Response("ok\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  // images.limooo.cn is a static asset host, never an API origin.
  if (hostname === IMAGES_HOSTNAME && isApiPath(pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

// Application-level blocklist exemptions. These paths must remain reachable
// from blocked IPs so administrators can still sign in or out instead of
// waiting for the next Cloudflare IP List sync. Match exact paths or their
// subpaths with routing.ts isExemptPath; a broad prefix such as
// `startsWith("/account")` would also exempt future `/account-anything` paths.
  const exempt = isExemptPath(pathname);
  const whitelisted = isGateTrustedIp(request.headers.get("CF-Connecting-IP") ?? "");
// Cheap first stage of trust evaluation: allowlisted IP or Cloudflare
// verifiedBot. Compute it once so blocklist checks can skip trusted sources;
// both checks are pure or read request headers and do not query a database.
  //
// Deliberately do not include the crawler UA list (docs/lists/robots.txt)
// here: user agents are self-reported, and skipping blocked_ips would let a
// blocked crawler evade blocking by changing its UA. The list applies only to
// the gate decision below via resolveGateTrust.declaredCrawler.
  const sourceTrusted = whitelisted || isTrustedCrawler(request);

// Route public static assets and APIs first. The redirect subdomain shares
// /static assets; do not render redirect.limooo.cn/static/css/... as a redirect
// page. Do this before blocklist checks because static assets and /files/ do
// not require a database lookup.
  if (isPublicAssetPath(pathname) || isApiPath(pathname)) {
// Clean file URL `/files/<name>` maps to `/static/files/<name>` in the build
// output. It is public and bypasses the gate, including on images.limooo.cn.
    if (pathname.startsWith(PUBLIC_FILES_PREFIX)) {
      const response = await servePublicFile(context, pathname);
      return redirectMissingDocument(request, response);
    }
// `/api/*` must still pass the blocklist check (W9-1). Only static assets,
// /files/, and APIs from exempt paths or trusted sources return directly.
// Exempt paths skip the database lookup because it cannot change the result.
    if (!isApiPath(pathname)) return next();
  }

  /**
   * Application-level blocklist check; exempt paths and trusted sources pass.
   *
   * Placement is critical; preserve all three rules:
   * 1. Run **before** `next()` for `/api/*`. Previously, the `isApiPath`
   *    early return came first, letting every API except static assets bypass
   *    blocking. This also made the exempt API paths unreachable, leaving
   *    blocked IPs to wait for the daily 03:30 D1-to-Cloudflare IP List sync.
   * 2. Skip database reads for trusted sources (allowlisted IPs and
   *    verifiedBot). A check can require 33 IPv4 prefix probes or 129 for
   *    IPv6; doing that for every normal visitor was the largest fixed read
   *    cost in this audit (tasks/22 W2-2).
   * 3. Use `sourceTrusted`, not cookieValid; ordinary visitors with __gate
   *    cookies remain subject to blocking.
   *
   * Keep the exempt list so blocked IPs can still reach /login and /gate
   * instead of waiting for the next Cloudflare IP List sync.
   */
  const bannedIp = request.headers.get("CF-Connecting-IP") ?? "";
  if (
    !exempt &&
    !sourceTrusted &&
    bannedIp &&
    (await isBlocked(env, request, bannedIp))
  ) {
    return renderGatePage(context, {
      host: hostname,
      next: pathname + url.search,
      errorKey: "blocked",
    });
  }

// After blocklist checks, pass `/api/*` to its route as before. Exempt and
// trusted sources skip the check above; other sources arrive here only if not
// blocked. Without this return, exempt APIs such as /api/auth,
// /api/apple-account, and /api/ray would be caught by the gate below, keeping
// administrators on blocked IPs from signing in.
  if (isApiPath(pathname)) return next();

// Redirect subdomain: forwarding only; bypass human verification.
  if (isRedirectHost(hostname)) return renderRedirectPage(context);

// Gate endpoints and public static/API paths must bypass the gate.
  if (pathname === "/__gate/verify" || pathname === "/gate/verify") return handleVerify(context);
  if (pathname === "/__gate/config" || pathname === "/gate/config") return handleGateConfig(context);
  if (pathname === "/__gate/diag" || pathname === "/gate/diag") return handleGateDiag(context);

// Gate page: /gate is the only public endpoint; redirect legacy /__gate paths to it with 308.
// Render and return on any corresponding host so the challenge completes on the same domain.
  if (pathname === "/__gate") return handleLegacyGateRedirect(context);
  if (pathname === "/gate") return handleGateEntry(context);

// On the image subdomain, render a forced challenge at the current URL; do not change the address to /__gate.
  if (forceChallenge && hostname === IMAGES_HOSTNAME) {
    return renderGatePage(context, { host: hostname, next: gateNextPath(pathname, url.search) });
  }

  // Preserve www's existing challenge redirect to the canonical host before handling aliases.
  if (forceChallenge && hostname === WWW_HOSTNAME) {
    return withLangCookie(request, new Response(null, {
      status: 301,
      headers: {
        Location: `${BASE_URL}${pathname}${url.search}`,
        "Cache-Control": "no-store",
      },
    }));
  }

  // Keep forced challenges ahead of legacy redirects, then resolve known aliases before
  // the images-only and www catch-all branches below.
  if (forceChallenge) {
    defer(
      context,
      logEvent(env, "gate_redirect", request, {
        outcome: "forced",
        status: 403,
        path: pathname,
        message: "force_theme_challenge",
      }),
    );
    return renderGatePage(context, { host: hostname, next: gateNextPath(pathname, url.search) });
  }

  // Preserve permanent redirects for the image host's retired landing paths.
  const normalizedImagePath = pathname.replace(/\/+$/, "") || "/";
  if (hostname === IMAGES_HOSTNAME && IMAGE_ASSET_LANDING_PATHS.has(normalizedImagePath)) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${BASE_URL}/`,
        "Cache-Control": "no-store",
      },
    });
  }

  const legacyHtmlAlias = resolveLegacyHtmlAlias(hostname, pathname);
  if (legacyHtmlAlias?.kind === "not_found") {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  if (legacyHtmlAlias?.kind === "redirect") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${legacyHtmlAlias.target}${url.search}`,
        "Cache-Control": "no-store",
      },
    });
  }

// images.<root_domain> serves public static assets only; map /icons and /portfolio/thumbs to /static.
  if (hostname === IMAGES_HOSTNAME) {
    if (env.ASSETS) {
      const staticPath = pathname === "/static" || pathname.startsWith("/static/")
        ? pathname
        : `/static${pathname}`;
      const staticAsset = await env.ASSETS.fetch(new URL(`${staticPath}${url.search}`, BASE_URL));
      if (staticAsset.ok) {
        return new Response(staticAsset.body, {
          headers: {
            "Content-Type": staticAsset.headers.get("Content-Type") ?? "",
            "Cache-Control": "public, max-age=2592000",
            "ETag": staticAsset.headers.get("ETag") ?? "",
          },
        });
      }
    }
    return redirectMissingDocument(request, new Response("Not Found", { status: 404 }));
  }

// Preserve the former nginx behavior for www: redirect to the root domain with 301 and keep the path.
  if (hostname === WWW_HOSTNAME) {
    return withLangCookie(request, new Response(null, {
      status: 301,
      headers: {
        Location: `${BASE_URL}${pathname}${url.search}`,
        "Cache-Control": "no-store",
      },
    }));
  }

  const trust = await resolveGateTrust(context);
// Three sources can pass the gate: allowlisted IP or verifiedBot (trusted), a
// crawler user agent (declaredCrawler; bypasses verification only, see
// _lib/bots.ts), and a valid __gate cookie.
  const gated = !(trust.trusted || trust.declaredCrawler || trust.cookieValid);

  if (!gated) {
    if (trust.trusted) {
      defer(
        context,
        logEvent(env, "gate_bypass", request, {
          outcome: "trusted",
          status: 200,
          path: pathname,
          message: whitelisted ? "gate_whitelist" : "cf_verified_bot",
        }),
      );
    } else if (trust.declaredCrawler) {
// **Log crawler allowlist matches**: user agents are self-reported, so this is
// the only record of which agents use the list. Their volume is tens to
// hundreds per day and does not materially affect D1 writes.
      defer(
        context,
        logEvent(env, "gate_bypass", request, {
          outcome: "crawler",
          status: 200,
          path: pathname,
          message: `declared_crawler:${trust.crawlerToken}`,
        }),
      );
    }

    const lang = detectLang(request);
    const asset = pageAsset(hostname, pathname, lang);
    if (asset) {
      const authRedirect = await adminAuthRedirect(env, request, hostname, url);
      if (authRedirect) return withLangCookie(request, authRedirect, lang);
      const resp = await cachedPageAsset(context, asset, lang, hostname);
      if (resp?.ok) {
// Renew the session on the response near expiry so visitors are not sent back to the gate mid-session.
        return withLangCookie(
          request,
          await renewGateCookie(context, resp, trust.shouldRenew),
          lang,
        );
      }
    }
// The gate host has no other content pages. Render the gate page in place with
// status 200 even for verified visitors; do not return 404 or send them to the main site.
    if (hostname === GATE_HOSTNAME) {
      return renderGatePage(context, {
        host: hostname,
        next: pathname + url.search,
        passed: true,
        lang,
      });
    }
    const nextResponse = redirectMissingDocument(request, await next());
    return withLangCookie(
      request,
      await renewGateCookie(context, nextResponse, trust.shouldRenew),
      lang,
    );
  }

// If a request has __gate but still fails, write the validation result to
// events to diagnose blocks after verification. Log only this unusual state;
// do not write for normal first visits without a cookie.
  if (trust.cookiePresent) {
    defer(
      context,
      logEvent(env, "gate_stale_cookie", request, {
        outcome: "gated",
        status: 403,
        path: pathname,
        message: trust.cookieReason,
      }),
    );
  }

// For unverified requests, render the gate page at the requested URL and keep the address bar unchanged.
  return renderGatePage(context, { host: hostname, next: pathname + url.search });
}

export const onRequest: PagesFunction = async (context) => {
  const { request, env } = context;
// Reuse the URL object parsed inside handleOnRequest; requestUrl memoizes by
// Request. Pass it to security headers and tracking so the request is parsed once.
  const url = requestUrl(request);
  const startedAt = Date.now();
  const resp = withSecurityHeaders(request, await handleOnRequest(context), url);

// Do not track gate rejections or blocked sources; scanning traffic must not consume the D1 quota.
  const trackResponse = resp.status !== 403;
  if (trackResponse && shouldTrackVisit(request, url)) {
    if (typeof context.waitUntil === "function") {
      context.waitUntil(recordVisit(env, request, resp.status));
    } else {
      void recordVisit(env, request, resp.status);
    }
  }
  if (trackResponse && shouldTrackRay(request, url)) {
    const durationMs = Date.now() - startedAt;
    if (typeof context.waitUntil === "function") {
      context.waitUntil(recordRay(env, request, resp.status, durationMs));
    } else {
      void recordRay(env, request, resp.status, durationMs);
    }
  }
  return resp;
};
