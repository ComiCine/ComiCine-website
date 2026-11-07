/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate HTTP handlers: entry, legacy redirect, config, and diagnostics. */

import { ROOT_DOMAIN } from "../config";
import { GATE_I18N } from "../../_data/runtime";
import { logEvent } from "../logging";
import { shouldLogDiagnostic } from "../sampling";
import {
  clientCountryForLogs,
  clientIpForLogs,
  defer,
  detectLang,
  preserveSetCookie,
  requestUrl,
  safeNextPath,
  sanitizeHost,
  withLangCookie,
  type RequestContext,
} from "../routing";
import { gateCookieHeaders } from "./cookie";
import { renderGatePage } from "./page";
import { resolveGateTrust } from "./trust";

/**
 * GET /gate: the only public gate entry point.
 *
 * Redirect verified visitors (302) to the original host and path; render the
 * gate page in place for others. resolveGateTrust handles both verification
 * and renewal decisions. Renew only after three quarters of the cookie TTL so
 * the one-hour session remains stable instead of sliding on every request.
 */
export async function handleGateEntry(context: RequestContext): Promise<Response> {
  const { request, env } = context;
  const url = requestUrl(request);
  const forceChallenge = url.searchParams.get("challenge") === "1";
  const host = sanitizeHost(url.searchParams.get("host"));
  const next = safeNextPath(url.searchParams.get("next") ?? "/");
  const trust = await resolveGateTrust(context);
  const passed = trust.trusted || trust.declaredCrawler || trust.cookieValid;

  if (passed && !forceChallenge) {
    if (shouldLogDiagnostic("gate_entry", clientIpForLogs(request))) {
      defer(
        context,
        logEvent(env, "gate_entry", request, {
          outcome: "passed",
          status: 302,
          message: trust.trusted
            ? "trusted"
            : trust.declaredCrawler
              ? `declared_crawler:${trust.crawlerToken}`
              : trust.shouldRenew
                ? "renewed"
                : "cookie",
        }),
      );
    }
    let resp = Response.redirect(`https://${host}${next}`, 302);
// Allowlisted IPs and crawlers have no cookie, so issue one; renew existing cookies only near expiry.
    //
// Use `trust.trusted`, not `passed`: crawlers matching the user-agent list do
// **not** receive a cookie. User agents are self-reported, so issuing one would
// turn a claim to be GPTBot into a reusable signed session. Crawlers send the
// user agent with every request and do not need a cookie.
    if (trust.trusted || trust.shouldRenew) {
      const headers = new Headers(resp.headers);
      preserveSetCookie(headers, resp.headers);
      for (const value of await gateCookieHeaders(env.GATE_HMAC_KEY, requestUrl(request).hostname)) {
        headers.append("Set-Cookie", value);
      }
      resp = new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers,
      });
    }
    return withLangCookie(request, resp);
  }

  return renderGatePage(context, { host, next });
}

/**
 * GET /__gate: preserve the legacy endpoint but always return a 308 to /gate.
 *
 * Requests may still be in flight and visitors may have bookmarks to this
 * endpoint. Redirecting instead of duplicating the gate decision keeps /gate
 * as the only address used by the frontend and documentation, preventing
 * inconsistent decisions between two entry points. Preserve query parameters.
 */
export function handleLegacyGateRedirect(context: RequestContext): Response {
  const url = requestUrl(context.request);
  const target = new URL(`https://${url.hostname}/gate`);
  target.search = url.search;
  return new Response(null, {
    status: 308,
    headers: { Location: target.toString(), "Cache-Control": "no-store" },
  });
}

/** GET /gate/config and /__gate/config: return non-sensitive runtime config without embedding the sitekey in HTML. */
export function handleGateConfig(context: RequestContext): Response {
  const { env, request } = context;
  return Response.json(
    {
      sitekey: env.TURNSTILE_SITEKEY ?? "",
      i18n: GATE_I18N,
      lang: detectLang(request),
      root_domain: ROOT_DOMAIN,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** GET /__gate/diag: dynamic diagnostics; the rest of the page may be cached. */
export function handleGateDiag(context: RequestContext): Response {
  const { request } = context;
  return Response.json(
    {
      country: clientCountryForLogs(request) || "—",
      ip: clientIpForLogs(request) || "—",
      ray: request.headers.get("CF-Ray") || "—",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
