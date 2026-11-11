/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * ComiCine Pages middleware orchestration.
 *
 * This file coordinates requests and controls when tracking runs. Routing,
 * gate, redirect, blocklist, rate-limit, and sampling logic live in
 * _lib/routing.ts, _lib/gate.ts, _lib/redirect.ts, _lib/tracking.ts,
 * _lib/rate-limit.ts, and _lib/sampling.ts. Public-file serving and branded
 * 404/401 responses live in _lib/not-found.ts, host and path aliases in
 * _lib/aliases.ts, and page cache policy plus shared response headers and gate
 * cookie renewal in _lib/page-cache.ts.
 */

import { logEvent } from "./_lib/logging";
import { shouldLogDiagnostic } from "./_lib/sampling";
import { configErrorResponse, runtimeConfigError } from "./_lib/session";
import {
  clientIpForLogs,
  defer,
  detectLang,
  isGateTrustedIp,
  isApiPath,
  isExemptPath,
  isPublicAssetPath,
  PUBLIC_FILES_PREFIX,
  pageAsset,
  requestUrl,
  withLangCookie,
  type RequestContext,
} from "./_lib/routing";
import {
  APPLE_ACCOUNT_HOSTNAME,
  BASE_URL,
  GATE_HOSTNAME,
  IDENTITY_HOSTS,
  ROOT_DOMAINS,
  ROOT_DOMAIN,
  WWW_HOSTNAME,
} from "./_lib/config";
import {
  handleGateConfig,
  handleGateDiag,
  handleGateEntry,
  handleLegacyGateRedirect,
  handleVerify,
  isBlocked,
  renderGatePage,
  resolveGateTrust,
} from "./_lib/gate";
import { isRedirectHost, renderRedirectPage } from "./_lib/redirect";
import {
  checkRateLimit,
  rateLimitPolicyFor,
  rateLimitResponse,
} from "./_lib/rate-limit";
import {
  isTrustedCrawler,
  recordRay,
  recordVisit,
  shouldTrackRay,
  shouldTrackVisit,
} from "./_lib/tracking";
import {
  IDENTITY_ALLOWED_PATHS,
  IMAGE_ASSET_LANDING_PATHS,
  isImageAssetHost,
  resolveFeishuPathAlias,
  resolveLegacyHtmlAlias,
} from "./_lib/aliases";
import {
  servePublicFile,
  withNotFoundStatus,
  brandedNotFoundResponse,
  adminAuthRedirect,
} from "./_lib/not-found";
import { cachedPageAsset, renewGateCookie, withSecurityHeaders } from "./_lib/page-cache";

type PagesFunction = (context: RequestContext) => Promise<Response>;

// Existing tests import pageCacheKey and withSecurityHeaders from this module; keep the re-exports.
export { pageCacheKey, withSecurityHeaders } from "./_lib/page-cache";

/** Get the original path to show after verification and remove the parameter used only to force a challenge. */
function gateNextPath(pathname: string, search: string): string {
  const nextUrl = new URL(pathname + search, BASE_URL);
  nextUrl.searchParams.delete("challenge");
  return nextUrl.pathname + nextUrl.search;
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

  if (hostname === GATE_HOSTNAME && pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${BASE_URL}/?challenge=1`,
        "Cache-Control": "no-store",
      },
    });
  }

  // The identity host serves only the login flow. Keep the gate endpoints reachable there too:
  // /login renders the gate page for an unverified visitor, and without /gate/config and
  // /gate/verify that page could never initialize Turnstile or complete verification.
  if (IDENTITY_HOSTS.has(hostname) && !IDENTITY_ALLOWED_PATHS.has(pathname)) {
    return brandedNotFoundResponse(context, new Response("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    }));
  }

  // The images host is static-only and never an API origin.
  if (isImageAssetHost(hostname) && isApiPath(pathname)) {
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
  const sourceIp = request.headers.get("CF-Connecting-IP") ?? "";
  const whitelisted = isGateTrustedIp(sourceIp);
// Cheap first stage of trust evaluation: allowlisted IP or Cloudflare
// verifiedBot. Compute it once so blocklist checks can skip trusted sources;
// both checks are pure or read request headers and do not query a database.
  //
// Deliberately do not include the crawler UA list (docs/lists/robots.txt)
// here: user agents are self-reported, and skipping blocked_ips would let a
// blocked crawler evade blocking by changing its UA. The list applies only to
// the gate decision below via resolveGateTrust.declaredCrawler.
  const sourceTrusted = whitelisted || isTrustedCrawler(request);

// Throttle the blocklist-exempt authentication entry points. This runs before the
// gate and before any database work: /login and /logout are the only paths a
// blocked source can reach, and /logout can write a D1 session revocation.
// Counters live in the Cache API or isolate memory, never in D1, and allowlisted
// sources (the administrator's own addresses) are exempt. Declared crawler user
// agents are deliberately not exempt: the header is self-reported.
  const rateLimitPolicy = rateLimitPolicyFor(pathname);
  if (rateLimitPolicy && !whitelisted && sourceIp) {
    const decision = await checkRateLimit(rateLimitPolicy, sourceIp);
    if (decision.limited) {
      if (shouldLogDiagnostic("rate_limit", sourceIp)) {
        defer(
          context,
          logEvent(env, "rate_limit", request, {
            outcome: "limited",
            status: 429,
            path: pathname,
            message: rateLimitPolicy.name,
          }),
        );
      }
      return rateLimitResponse(request, decision);
    }
  }

// Route public static assets and APIs first. The redirect subdomain shares
// /static assets; do not render redirect.<root-domain>/static/css/... as a redirect
// page. Do this before blocklist checks because static assets and /files/ do
// not require a database lookup.
  if (isPublicAssetPath(pathname) || isApiPath(pathname)) {
// Clean file URL `/files/<path>` maps to `/public/files/<path>` in the build
// output. It is public and bypasses the gate, including on the images host.
    if (pathname.startsWith(PUBLIC_FILES_PREFIX)) {
      const response = await servePublicFile(context, pathname);
      return brandedNotFoundResponse(context, response);
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
  if (
    !exempt &&
    !sourceTrusted &&
    sourceIp &&
    (await isBlocked(env, request, sourceIp))
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
  if (forceChallenge && isImageAssetHost(hostname)) {
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
    if (shouldLogDiagnostic("gate_redirect", clientIpForLogs(request))) {
      defer(
        context,
        logEvent(env, "gate_redirect", request, {
          outcome: "forced",
          status: 403,
          path: pathname,
          message: "force_theme_challenge",
        }),
      );
    }
    return renderGatePage(context, { host: hostname, next: gateNextPath(pathname, url.search) });
  }

  // Preserve permanent redirects for the image host's retired landing paths.
  const normalizedImagePath = pathname.replace(/\/+$/, "") || "/";
  if (isImageAssetHost(hostname) && IMAGE_ASSET_LANDING_PATHS.has(normalizedImagePath)) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: `${BASE_URL}/`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (ROOT_DOMAINS.includes(hostname)) {
    const feishuTarget = resolveFeishuPathAlias(pathname);
    if (feishuTarget) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${feishuTarget}${url.search}`,
          "Cache-Control": "no-store",
        },
      });
    }
  }

  if (hostname !== ROOT_DOMAIN && hostname.endsWith(`.${ROOT_DOMAIN}`) && pathname === "/index.html") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/${url.search}`,
        "Cache-Control": "no-store",
      },
    });
  }

  const legacyHtmlAlias = resolveLegacyHtmlAlias(hostname, pathname);
  if (legacyHtmlAlias?.kind === "not_found") {
    return brandedNotFoundResponse(context, new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    }));
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
  if (isImageAssetHost(hostname)) {
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
    return brandedNotFoundResponse(context, new Response("Not Found", { status: 404 }));
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
      if (shouldLogDiagnostic("gate_bypass", clientIpForLogs(request))) {
        defer(
          context,
          logEvent(env, "gate_bypass", request, {
            outcome: "trusted",
            status: 200,
            path: pathname,
            message: whitelisted ? "gate_whitelist" : "cf_verified_bot",
          }),
        );
      }
    } else if (trust.declaredCrawler) {
      // **Log crawler allowlist matches**: user agents are self-reported, so this is
      // the only record of which agents use the list. Their volume is tens to
      // hundreds per day and does not materially affect D1 writes.
      if (shouldLogDiagnostic("gate_bypass_crawler", `${clientIpForLogs(request)}:${trust.crawlerToken}`)) {
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
    }

    const lang = detectLang(request);
    if (
      hostname === APPLE_ACCOUNT_HOSTNAME &&
      (pathname === "/" || pathname === "/index.html")
    ) {
      return brandedNotFoundResponse(
        context,
        new Response("Not Found", {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    }

    const asset = pageAsset(hostname, pathname, lang);
    if (asset) {
      const authRedirect = await adminAuthRedirect(env, request, hostname, url);
      if (authRedirect) return withLangCookie(request, authRedirect, lang);
      const resp = await cachedPageAsset(context, asset, lang, hostname);
      if (resp?.ok) {
// Renew the session on the response near expiry so visitors are not sent back to the gate mid-session.
        const pageResponse = pathname.replace(/\/+$/, "") === "/404"
          ? withNotFoundStatus(resp, request)
          : resp;
        return withLangCookie(
          request,
          await renewGateCookie(context, pageResponse, trust.shouldRenew),
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
    const nextResponse = await brandedNotFoundResponse(context, await next());
    return withLangCookie(
      request,
      await renewGateCookie(context, nextResponse, trust.shouldRenew),
      lang,
    );
  }

// If a request has __gate but still fails, write the validation result to
// events to diagnose blocks after verification. Log only this unusual state;
// do not write for normal first visits without a cookie.
  if (trust.cookiePresent && shouldLogDiagnostic("gate_stale_cookie", clientIpForLogs(request))) {
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

// Do not track gate rejections, blocked sources, or rate-limited authentication
// requests; a flood must not consume the D1 write quota through tracking either.
  const trackResponse = resp.status !== 403 && resp.status !== 429;
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
