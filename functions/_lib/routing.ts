/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Request routing, language, and internal redirect helpers with no browser DOM dependency; safe to import in vitest. */

import type { Env } from "./env";
import { contains, normalizeIp } from "./cidr";
import { GATE_TRUST_IPS, GATE_TRUST_NETWORKS } from "../_data/gateTrust";
import {
  BASE_URL,
  DEFAULT_LANG,
  LANG_COOKIE,
  LANG_COOKIE_MAX_AGE,
  PAGE_ROUTES,
  PUBLIC_HOSTS,
  rootDomainForHost,
  ROOT_DOMAIN,
  SUPPORTED_LANGS,
} from "./config";

export interface RequestContext {
  request: Request;
  env: Env;
  next(): Promise<Response>;
  waitUntil?(promise: Promise<unknown>): void;
}

/**
 * Parse the URL once per request.
 *
 * `new URL(request.url)` was called more than seven times along one request
 * path by middleware, gate and redirect pages, tracking, and logging. Each call
 * reparsed the URL and allocated an object. Memoize by Request in a WeakMap so
 * the full path parses once without retaining a strong reference. Keying by
 * Request rather than URL text also isolates hosts and environments.
 *
 * Callers must treat the URL as **read-only**. URL is mutable and
 * `url.searchParams` is a live reference; clone it before rewriting, as in
 * `_middleware.ts` pageCacheKey.
 */
const requestUrlCache = new WeakMap<Request, URL>();

export function requestUrl(request: Request): URL {
  let url = requestUrlCache.get(request);
  if (!url) {
    url = new URL(request.url);
    requestUrlCache.set(request, url);
  }
  return url;
}

/**
 * Cache **gate and redirect template text**, not the final HTML.
 *
 * `renderGatePage` and `renderRedirectPage` fetch the full
 * `/<lang>/auth.html` or `/<lang>/redirect.html` on every render, although the
 * template is constant during an isolate's lifetime. Pages deployments are
 * immutable and a new build gets new isolates, matching the assumption in
 * `_middleware.cachedPageAsset`; reuse only within a process, not across
 * versions. Cache template text only and inject placeholders per request.
 *
 * The outer key is the **ASSETS binding object itself** in a WeakMap, keeping
 * isolates and per-test stubs separate. The inner key is the asset path,
 * including the language segment (`/<lang>/<file>`), so same-name templates
 * in different languages cannot collide. The request host is not part of the
 * key because fetch uses an absolute path from BASE_URL.
 *
 * On fetch failure (missing binding or non-2xx), return null and **do not cache** so the next request retries.
 */
const templateTextCache = new WeakMap<object, Map<string, string>>();

export async function templateText(
  env: Env,
  lang: string,
  file: string,
): Promise<string | null> {
  const assets = env.ASSETS;
  if (!assets) return null;
  const path = `/${lang}/${file}`;
  let perAssets = templateTextCache.get(assets);
  const hit = perAssets?.get(path);
  if (hit !== undefined) return hit;
  const asset = await assets.fetch(new URL(path, BASE_URL));
  if (!asset.ok) return null;
  const text = await asset.text();
  if (!perAssets) {
    perAssets = new Map<string, string>();
    templateTextCache.set(assets, perAssets);
  }
  perAssets.set(path, text);
  return text;
}

/** Paths that must bypass the gate to avoid redirect loops. */
export const SKIP_PATHS = new Set<string>([
  "/__gate/verify",
  "/__gate/diag",
  "/__gate/config",
  "/comicine.svg",
  "/comicine-xtext.svg",
  "/comicine-favicon.svg",
  "/ComiCine-xtext.svg",
  "/favicon.svg",
// Crawler and AI entry files (2026-10-12) are generated at the output root and
// listed in _routes.json excludes, so normally they never reach Functions.
// Keep this second check as defense in depth: if the exclude list is wrong,
// unverified crawlers must not receive a 403 challenge page as /robots.txt.
  "/robots.txt",
  "/llms.txt",
// Login flow: the Entra callback is a top-level redirect from
// login.microsoftonline.com. Do not send it to the gate because a __gate
// cookie expired, or login will fail.
  "/login/entra",
  "/login/callback",
  "/identity/callback",
]);

/** Gate and blocklist allowlist; use only trust settings generated from docs/lists/whitelist.txt. */
export function isGateTrustedIp(ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (GATE_TRUST_IPS.has(normalized)) return true;
  return GATE_TRUST_NETWORKS.some(([network, prefix]) =>
    contains(network, Number(prefix), normalized),
  );
}

export function getCookie(name: string, header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
// Cookies are client-supplied; malformed percent-encoding must not turn the whole request into a 500.
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Characters forbidden in a request-controlled redirect value.
 *
 * If C0 control characters (including CR/LF) or DEL reach `Location`, workerd
 * throws `TypeError` while constructing the response header, producing an
 * uncaught 500 after gate verification. CR/LF are also standard response
 * header-injection payloads, so reject them at the shared validation point.
 */
const UNSAFE_NEXT_CHARS = /[\u0000-\u001f\u007f]/;

/** Allow only internal relative paths beginning with /; reject //, backslashes, and protocol prefixes. */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  if (raw.includes("\\")) return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return "/";
  if (UNSAFE_NEXT_CHARS.test(raw)) return "/";
  return raw.slice(0, 2048);
}

/** Login/logout redirect targets: internal relative paths or HTTPS URLs on allowlisted hosts. */
export function safeNextUrl(raw: string | null): string {
  const fallback = `${BASE_URL}/`;
  if (!raw || raw.length > 2048) return fallback;
  if (UNSAFE_NEXT_CHARS.test(raw)) return fallback;
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) return raw;
  try {
    const value = new URL(raw);
    if (value.protocol === "https:" && isPublicHost(value.hostname)) return raw;
  } catch {
// Fall back to the main site for non-URL values.
  }
  return fallback;
}

/** Gate and login redirect allowlist: exact hostnames or configured domain subdomains. */
export function isPublicHost(host: string): boolean {
  if (!host) return false;
  if (PUBLIC_HOSTS.has(host)) return true;
  for (const entry of PUBLIC_HOSTS) {
    if (entry.startsWith("*.") && host.endsWith(entry.slice(1))) return true;
  }
  return false;
}

/** Gate redirect targets may use only public allowlisted hosts; all others go to the main site. */
export function sanitizeHost(raw: string | null | undefined): string {
  return raw && isPublicHost(raw) ? raw : ROOT_DOMAIN;
}

/**
 * Escape values injected into generated HTML: host/next on the gate page and to on the redirect page.
 *
 * gate.ts and redirect.ts previously had identical copies. Both inject
 * **request-controlled** values, so a missed escape could cause XSS; keep one
 * shared implementation.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * Client IP for display and logs: trust only Cloudflare's `CF-Connecting-IP`.
 *
 * This previously preferred the `X-ComiCine-Client-IP` and
 * `X-ComiCine-Client-Country` headers added by the nginx proxy. That VPS was
 * decommissioned on 2026-09-17, so those headers no longer have a trusted
 * source. Accepting visitor-supplied values would poison visitor_rollups IP
 * hashes, country, and `ip_enc` (the admin's "view visitor IP" endpoint would
 * reveal the address supplied by an attacker), structured logs, and Turnstile
 * siteverify's `remoteip`. Those headers have been removed.
 *
 * These helpers are only for display, tracking, and Turnstile `remoteip`.
 * Never use them for trust decisions such as `isGateTrustedIp` or `isBlocked`;
 * caller-supplied headers with these names are ignored.
 */
export function clientIpForLogs(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "";
}

/** Client country for display and logs: use only Cloudflare's `request.cf.country`. */
export function clientCountryForLogs(request: Request): string {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  return cf?.country ?? "";
}

type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** Primary language subtag: the first segment of a language tag (for example, `zh`). */
function primarySubtag(lang: string): string {
  return lang.split("-")[0];
}

/** Uppercase region subtag (for example, `CN`), or an empty string when absent. */
function regionSubtag(lang: string): string {
  const parts = lang.split("-");
  return parts.length > 1 ? parts[1].toUpperCase() : "";
}

function acceptedLanguageTags(header: string): string[] {
  const accepted: { tag: string; quality: number; order: number }[] = [];
  for (const [order, part] of header.split(",").entries()) {
    const [rawTag, ...parameters] = part.trim().split(";");
    const tag = rawTag?.trim().toLowerCase();
    if (!tag || tag === "*") continue;

    const qualityParameter = parameters.find((parameter) => /^q\s*=/i.test(parameter));
    let quality = 1;
    if (qualityParameter) {
      const rawQuality = qualityParameter.slice(qualityParameter.indexOf("=") + 1).trim();
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(rawQuality)) continue;
      quality = Number(rawQuality);
    }
    if (quality > 0) accepted.push({ tag, quality, order });
  }

  return accepted
    .sort((left, right) => right.quality - left.quality || left.order - right.order)
    .map(({ tag }) => tag);
}

/**
 * Language selection: cookie > Accept-Language (matched against contract supported_langs) > CF region > contract default.
 *
 * Keep language tags out of this module: the contract is the source of truth.
 * Adding a language requires only updating `supported_langs` in
 * `config-contract.json`. Accept-Language prefix matching (the primary
 * subtag) and country matching (the region subtag) are derived from each tag.
 * The fallback also comes from the contract's `DEFAULT_LANG`; a hard-coded
 * value here would make contract changes ineffective at runtime.
 */
export function detectLang(request: Request): SupportedLang {
  const host = (request.headers.get("Host") ?? requestUrl(request).hostname).split(":")[0];
  // Language cookies are shared within the matching current or legacy domain:
  // main site and its subdomains (including
  // visitor, account, status, images, and other subdomains share the same
  // preference so a language change stays consistent across subdomains.
  if (rootDomainForHost(host)) {
    const cookie = getCookie(LANG_COOKIE, request.headers.get("Cookie"));
    if (cookie && SUPPORTED_LANGS.includes(cookie.toLowerCase() as SupportedLang)) {
      return cookie.toLowerCase() as SupportedLang;
    }
  }

  const accept = request.headers.get("Accept-Language") ?? "";
  for (const tag of acceptedLanguageTags(accept)) {
    const exact = SUPPORTED_LANGS.find((lang) => lang === tag);
    if (exact) return exact as SupportedLang;
    const primary = primarySubtag(tag);
    const byPrefix = SUPPORTED_LANGS.find((lang) => primarySubtag(lang) === primary);
    if (byPrefix) return byPrefix as SupportedLang;
  }

  const country = clientCountryForLogs(request).toUpperCase();
  if (country) {
    const byCountry = SUPPORTED_LANGS.find((lang) => regionSubtag(lang) === country);
    if (byCountry) return byCountry as SupportedLang;
  }
  return DEFAULT_LANG as SupportedLang;
}

/** Share language preference across subdomains of the request's current domain. */
export function langCookieHeader(host: string, lang: string): string {
  const bareHost = host.split(":")[0] ?? "";
  const cookieDomain = rootDomainForHost(bareHost);
  const domain = cookieDomain ? `Domain=.${cookieDomain}; ` : "";
  return `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax; Secure; ${domain}`;
}

/** Preserve multiple Set-Cookie headers when copying response headers; Safari may otherwise keep only the first. */
export function preserveSetCookie(headers: Headers, source: Headers): void {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(source) : [];
  if (!cookies.length) return;
  headers.delete("Set-Cookie");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
}

/**
 * Write the detected language on the first visit; response headers may be immutable.
 *
 * `lang` is optional. Callers that already detected the language (for example,
 * middleware selecting a page asset) can pass it to avoid running detectLang
 * twice for the same request. When omitted, this function detects it as before.
 */
export function withLangCookie(request: Request, resp: Response, lang?: string): Response {
  if (getCookie(LANG_COOKIE, request.headers.get("Cookie"))) return resp;
  const headers = new Headers(resp.headers);
  preserveSetCookie(headers, resp.headers);
  headers.append(
    "Set-Cookie",
    langCookieHeader(request.headers.get("Host") ?? "", lang ?? detectLang(request)),
  );
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

function normalizedPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** Map a host and path to a localized page asset; return null for static assets and other paths handled by next(). */
export function pageAsset(host: string, pathname: string, lang: string): string | null {
  const file = PAGE_ROUTES[host]?.[normalizedPath(pathname)];
  return file ? `/${lang}/${file}` : null;
}

/**
 * Public files that bypass human verification: the build copies
 * `src/static/files/` to `public/files/`, and this exposes them at the
 * clean URL `/files/<path>` on both comicine.com and images.comicine.com
 * for external references.
 */
export const PUBLIC_FILES_PREFIX = "/files/";

/** Check whether a path is a public asset or internal route to avoid gate loops and duplicate tracking. */
export function isPublicAssetPath(pathname: string): boolean {
  return (
    SKIP_PATHS.has(pathname) ||
    pathname.startsWith("/static/") ||
    pathname.startsWith(PUBLIC_FILES_PREFIX) ||
    pathname === "/favicon.svg" ||
    pathname === "/comicine.svg" ||
    pathname === "/comicine-xtext.svg" ||
    pathname === "/comicine-favicon.svg" ||
    pathname === "/ComiCine-xtext.svg"
  );
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Application blocklist exemptions for login, logout, and admin pages, so
 * administrators can still sign in from a blocked IP.
 *
 * Match only an exact path or its descendants (such as `/account` and
 * `/account/apple`). Do not use `startsWith("/account")`, which would also
 * exempt a future `/account-anything` route. Middleware is the sole caller.
 */
export const EXEMPT_PATH_PREFIXES = [
  "/login",
  "/logout",
  "/account",
  "/visitor",
  "/api/apple-account",
  "/api/auth",
  "/api/ray",
  // Public reference rates use edge caching to avoid a D1 blocklist read on every request.
  "/api/currency-rates",
] as const;

const EXEMPT_EXACT_PATHS = new Set([
  "/identity/callback",
  "/api/identity/exchange",
]);

export function isExemptPath(pathname: string): boolean {
  return EXEMPT_EXACT_PATHS.has(pathname) || EXEMPT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
