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
  "/Limooo-xtext.svg",
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
 * 展示/日志用的访客 IP：只信 Cloudflare 写入的 `CF-Connecting-IP`。
 *
 * 历史上这里优先读 nginx 反代带上的 `X-ComiCine-Client-IP` /
 * `X-ComiCine-Client-Country`，但那套 VPS 已于 2026-09-17 退租，这两个头
 * **不再有可信来源**——任何访客自带即被采信，会污染 `visitor_rollups` 的
 * IP 哈希 / 国家 / `ip_enc`（后台"查看访客 IP"解出的就是攻击者自报的地址）、
 * 结构化日志，以及 Turnstile siteverify 的 `remoteip`。现已删除。
 *
 * 这两个函数只用于「展示、埋点、Turnstile remoteip」，**绝不能**喂给
 * isGateTrustedIp / isBlocked 之类的信任判定；调用方自带同名头一律无效。
 */
export function clientIpForLogs(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "";
}

/** 展示/日志用的访客国家码：只取 Cloudflare 判定的 `request.cf.country`。 */
export function clientCountryForLogs(request: Request): string {
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  return cf?.country ?? "";
}

type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** 语言码的主语言子标签：语言码的第一段（如 zh 部分）。 */
function primarySubtag(lang: string): string {
  return lang.split("-")[0];
}

/** 语言码的地区子标签大写形式（如 CN）；没有地区段时返回空串。 */
function regionSubtag(lang: string): string {
  const parts = lang.split("-");
  return parts.length > 1 ? parts[1].toUpperCase() : "";
}

/**
 * 语言检测：cookie > Accept-Language（按契约 supported_langs 匹配）> CF 地区 > 契约默认语言。
 *
 * 这里**不写任何语言码字面量**：契约是唯一事实源，加一门语言只需改
 * `config-contract.json` 的 `supported_langs`——Accept-Language 前缀匹配
 * （Accept-Language 的首段命中 supported_langs 的首段）与国家码匹配（地区段相同）
 * 都从语言码自身的子标签推出来。
 * 兜底值同样取契约的 DEFAULT_LANG：历史实现把它写死成一个语言码字面量，
 * 于是改契约对边缘行为零影响。
 */
export function detectLang(request: Request): SupportedLang {
  const host = (request.headers.get("Host") ?? requestUrl(request).hostname).split(":")[0];
  // Language cookies are shared within the matching current or legacy domain:
  // main site and its subdomains (including
  // visitor / account / status / images 等）都读同一份，切语言后跨子域一致。
  if (rootDomainForHost(host)) {
    const cookie = getCookie(LANG_COOKIE, request.headers.get("Cookie"));
    if (cookie && SUPPORTED_LANGS.includes(cookie.toLowerCase() as SupportedLang)) {
      return cookie.toLowerCase() as SupportedLang;
    }
  }

  const accept = request.headers.get("Accept-Language") ?? "";
  for (const part of accept.split(",")) {
    const tag = part.trim().split(";")[0].toLowerCase();
    if (!tag) continue;
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

/** 复制响应头时保留多条 Set-Cookie，避免 Safari 只认第一条。 */
export function preserveSetCookie(headers: Headers, source: Headers): void {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(source) : [];
  if (!cookies.length) return;
  headers.delete("Set-Cookie");
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
}

/**
 * 首次访问时把检测出的语言写回；不能原地修改不可变响应头。
 *
 * `lang` 可选：调用方**已经算过**语言（例如中间件为了取页面资产先算了一次）时
 * 直接传进来，避免对同一个请求把 detectLang 跑两遍；不传则保持旧行为自行检测。
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

/** 主机+路径 → 应吐出的语言页面资产；静态资源等返回 null，交回 next()。 */
export function pageAsset(host: string, pathname: string, lang: string): string | null {
  const file = PAGE_ROUTES[host]?.[normalizedPath(pathname)];
  return file ? `/${lang}/${file}` : null;
}

/**
 * 免人机验证的公开文件目录：`src/static/files/` 随构建镜像到
 * `public/static/files/`，这里额外暴露成干净 URL `/files/<文件名>`
 * （comicine.com 与 images.comicine.com 都可用），供站外直接引用，不进门禁。
 */
export const PUBLIC_FILES_PREFIX = "/files/";

/** 是否属于公开静态资源/内部路径，避免门禁死循环和重复埋点。 */
export function isPublicAssetPath(pathname: string): boolean {
  return (
    SKIP_PATHS.has(pathname) ||
    pathname.startsWith("/static/") ||
    pathname.startsWith(PUBLIC_FILES_PREFIX) ||
    pathname === "/favicon.svg" ||
    pathname === "/comicine.svg" ||
    pathname === "/comicine-xtext.svg" ||
    pathname === "/comicine-favicon.svg" ||
    pathname === "/Limooo-xtext.svg" ||
    pathname === "/ComiCine-xtext.svg"
  );
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * 应用层封禁的豁免前缀：登录/登出/管理页，避免管理员从被封 IP 无法登录。
 *
 * 匹配必须是**精确路径或它的子路径**（`/account`、`/account/apple`），
 * 不能用 `startsWith("/account")`——那会把未来的 `/account-anything`
 * 一起放行，等于给攻击者一个免封禁前缀。调用方（中间件）只做这一处判定。
 */
export const EXEMPT_PATH_PREFIXES = [
  "/login",
  "/logout",
  "/account",
  "/visitor",
  "/api/apple-account",
  "/api/auth",
  "/api/ray",
  // 公共参考汇率走边缘缓存，避免每次访问都增加一次 D1 封禁名单读取。
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
