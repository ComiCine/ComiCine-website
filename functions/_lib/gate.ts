/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Human-verification gate: cookie validation and issuance, Turnstile verification, gate-page rendering, and config endpoints. */

import { queryAll } from "./d1";
import { contains, networkAddress, normalizeIp } from "./cidr";
import { logEvent } from "./logging";
import type { RequestContext } from "./routing";
import {
  clientCountryForLogs,
  clientIpForLogs,
  detectLang,
  escapeHtml,
  isGateTrustedIp,
  isPublicHost,
  preserveSetCookie,
  requestUrl,
  safeNextPath,
  sanitizeHost,
  templateText,
  withLangCookie,
} from "./routing";
import { isTrustedCrawler } from "./tracking";
import { declaredCrawlerToken } from "./bots";
import {
  BASE_URL,
  GATE_COOKIE,
  GATE_TTL_SECONDS,
  ROOT_DOMAIN,
  rootDomainForHost,
} from "./config";
import { GATE_I18N } from "../_data/runtime";
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 3000;

/** Write gate event logs asynchronously without delaying the verification response. */
function deferLog(context: RequestContext, promise: Promise<unknown>): void {
  if (typeof context.waitUntil === "function") {
    context.waitUntil(promise);
  } else {
    void promise;
  }
}


/**
 * Cookie format: `<issued-at>.<expires-at>.<HMAC-SHA256 hex signature>`.
 *
 * Sign the complete `issued.expires` payload so the cookie cannot be altered
 * or extended using a signature from an older cookie.
 *
 * Previously, only the expiry was signed, so every request could issue a new
 * cookie with a full TTL. Visitors whose request interval exceeded the TTL
 * repeatedly returned to the gate. The issued-at time is now signed too, and
 * renewal is explicit and bounded: renew only after
 * `GATE_RENEW_AFTER_SECONDS` (three quarters of the TTL). A one-hour session
 * is therefore a stable guarantee rather than a sliding window.
 */
export const GATE_RENEW_AFTER_SECONDS = Math.floor(GATE_TTL_SECONDS * 0.75);

/**
 * Maximum number of same-name `__gate` cookies to validate per request.
 *
 * A normal visitor has at most two (the earlier host-only cookie and the
 * current domain cookie), so eight leaves ample room. The limit prevents an
 * attacker from controlling the number of WebCrypto operations per request
 * with an oversized Cookie header.
 * （tasks/22 W9-10）。
 */
export const MAX_GATE_COOKIE_VALUES = 8;

/** Validation failure categories for diagnostic logs only; do not expose them to visitors. */
export type GateCookieReason =
  | "ok"
  | "absent"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "future_issued";

export interface GateCookieState {
  valid: boolean;
/** Whether the request contains at least one __gate cookie. */
  present: boolean;
/** Whether less than one quarter of the TTL remains and the response should renew the cookie. */
  shouldRenew: boolean;
  reason: GateCookieReason;
}

/**
 * Get all values for cookies with the same name.
 *
 * Browsers allow same-name cookies in **different scopes** (host-only,
 * Domain=, or different Path values) and send them all in one Cookie header.
 * Checking only the first may select an older value and cause a visitor who
 * just passed verification to be blocked on the next request. Validate each
 * value.
 */
export function allCookieValues(name: string, header: string | null): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out.push(decodeURIComponent(raw));
    } catch {
      out.push(raw);
    }
  }
  return out;
}

/** Validate a __gate cookie; its signature, format, and expiry must all be valid. */
export async function readGateCookie(
  value: string | undefined,
  key: string,
): Promise<GateCookieState> {
  const present = Boolean(value);
  const fail = (reason: GateCookieReason): GateCookieState => ({
    valid: false,
    present,
    shouldRenew: false,
    reason,
  });
  if (!present) return fail("absent");
  if (!key) return fail("malformed");

  const parts = (value as string).split(".");
  if (parts.length !== 3) return fail("malformed");
  const [issuedRaw, expiryRaw, signature] = parts;
  if (!/^\d{10,}$/.test(issuedRaw) || !/^\d{10,}$/.test(expiryRaw)) return fail("malformed");
  if (!/^[0-9a-f]{64}$/.test(signature)) return fail("malformed");

  const expected = await hmacSha256Hex(key, `${issuedRaw}.${expiryRaw}`);
  if (!timingSafeEqual(signature, expected)) return fail("bad_signature");

  const issued = Number(issuedRaw);
  const expiry = Number(expiryRaw);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expiry)) return fail("malformed");
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now) return fail("expired");
// Reject a future issued-at time (clock skew or forgery) to prevent cookies that never renew.
  if (issued > now + 60) return fail("future_issued");

  return {
    valid: true,
    present: true,
    shouldRenew: now - issued >= GATE_RENEW_AFTER_SECONDS,
    reason: "ok",
  };
}

/** Issue a __gate cookie for the matching current or legacy root domain, with the contract TTL. */
export async function mintGateCookie(key: string, host: string = ROOT_DOMAIN): Promise<string> {
  const ttlSeconds = GATE_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + ttlSeconds;
  const payload = `${now}.${expiry}`;
  const signature = await hmacSha256Hex(key, payload);
  const rootDomain = rootDomainForHost(host);
  const domain = rootDomain ? ` Domain=.${rootDomain};` : "";
  return `${GATE_COOKIE}=${payload}.${signature};${domain} HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

/**
 * Remove an older host-only `__gate` cookie that has no Domain attribute.
 *
 * Same-name host-only and Domain=.comicine.com cookies can **coexist** and are
 * sent together. If an expired old cookie stays first, it can shadow the valid
 * one. Delete the host-only variant when issuing a new cookie to avoid a
 * state where verification succeeds but the visitor remains blocked.
 */
export function purgeLegacyGateCookie(): string {
  return `${GATE_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}

/** Set-Cookie headers for one issuance: clear the host-only cookie, then write the matching root-domain cookie. */
export async function gateCookieHeaders(key: string, host: string = ROOT_DOMAIN): Promise<string[]> {
  return [purgeLegacyGateCookie(), await mintGateCookie(key, host)];
}

export interface GateTrustState {
/** Allowlisted IPs and Cloudflare-verified bots already bypass verification and need no cookie. */
  trusted: boolean;
  /**
    * A crawler or AI user agent matches an explicit User-agent in
    * docs/lists/robots.txt and **bypasses human verification only**.
   *
    * Keep this separate from trusted because user agents are self-reported.
    * They must not bypass blocked_ips or receive a __gate cookie (see the
    * header in _lib/bots.ts).
   */
  declaredCrawler: boolean;
/** Matched lowercase user-agent fragment, or an empty string; used only for logs. */
  crawlerToken: string;
/** Whether the request has a valid __gate cookie. */
  cookieValid: boolean;
/** Whether to renew the cookie because it is valid and three quarters of its TTL has elapsed. */
  shouldRenew: boolean;
/** The request has __gate cookies but none are valid; helps diagnose blocks after verification. */
  cookiePresent: boolean;
/** Validation result category. */
  cookieReason: GateCookieReason;
}

/**
 * The single implementation of the gate decision.
 *
 * Middleware and /gate must both call this function rather than duplicating
 * the allowlist, crawler, and cookie checks. Similar but separate logic
 * previously caused behavior to drift and made repeated challenges difficult
 * to diagnose.
 *
 * Same-name __gate cookies may coexist across scopes; validate each and allow
 * the request if any one is valid.
 */
export async function resolveGateTrust(
  context: RequestContext,
): Promise<GateTrustState> {
  const { request, env } = context;
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const trusted = isGateTrustedIp(ip) || isTrustedCrawler(request);
// Trusted sources do not need another user-agent match; this only saves work.
// Check other sources against the crawler list. A match bypasses verification,
// but not blocking, and does not receive a cookie.
  const crawlerToken = trusted ? "" : declaredCrawlerToken(request);

  const values = allCookieValues(GATE_COOKIE, request.headers.get("Cookie"));
  let best: GateCookieState = {
    valid: false,
    present: values.length > 0,
    shouldRenew: false,
    reason: values.length > 0 ? "malformed" : "absent",
  };
// The number of same-name cookies is unbounded, and each requires a regular
// expression plus WebCrypto importKey and sign operations. A 32 KB Cookie
// header can contain about 400 cookies, letting an attacker control per-request
// CPU cost (tasks/22 W9-10). Validate only the first N. Normal visitors have at
// most two (old host-only and new domain cookies), so existing behavior is unchanged.
  for (const value of values.slice(0, MAX_GATE_COOKIE_VALUES)) {
    const state = await readGateCookie(value, env.GATE_HMAC_KEY);
    if (state.valid) {
      best = state;
      break;
    }
    if (state.present) best = state;
  }

  return {
    trusted,
    declaredCrawler: crawlerToken !== "",
    crawlerToken,
    cookieValid: best.valid,
    shouldRenew: best.shouldRenew,
    cookiePresent: best.present,
    cookieReason: best.reason,
  };
}

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
    deferLog(
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

export interface GateRenderOptions {
  next?: string;
  host?: string;
  errorKey?: string;
  unavailable?: boolean;
/** True when a verified visitor requests this page from the gate host; render in place with status 200. */
  passed?: boolean;
/** Pass the result when the caller already ran detectLang to avoid duplicate work. */
  lang?: string;
}

/** Load the generated <lang>/auth.html gate page and inject only host, next, error, and lang. */
export async function renderGatePage(
  context: RequestContext,
  opts: GateRenderOptions,
): Promise<Response> {
  const { request, env } = context;
  const host = sanitizeHost(opts.host);
  const next = safeNextPath(opts.next ?? "/");
  const lang = opts.lang ?? detectLang(request);
  const status = opts.unavailable ? 503 : opts.passed ? 200 : 403;

// Reuse template text per language in the process (fetch from ASSETS once,
// then read from memory). Injection matches the per-request render path; only
// template loading is skipped.
  const source = await templateText(env, lang, "auth.html");
  if (source === null) return new Response("Gate page unavailable", { status: 503 });
// The build renders the language in <html lang="{{ g.lang }}">. No template or
// artifact contains a `{{lang}}` placeholder, so do not perform a needless replacement.
  const html = source
    .replaceAll("{{host}}", escapeHtml(host))
    .replaceAll("{{next}}", escapeHtml(next))
    .replaceAll("{{error}}", escapeHtml(opts.errorKey ?? ""));

// Never cache the gate page.
  //
// This page replaces the real-content URL in place and returns 403. A previous
// `max-age=300` private browser cache could replay the challenge after
// verification when location.replace returned to the same URL, causing a loop
// and another verify request on every replay. The challenge has no cache value;
// no-store is the correct behavior.
  return withLangCookie(
    request,
    new Response(html, {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Cookie",
      },
    }),
    lang,
  );
}

interface BlockedRow {
  cidr: string;
  network: string;
  prefix: number;
}

/**
 * Record failed gate attempts and block an IP on its third failure within 24 hours.
 *
 * Store only the HMAC of each IP. Write the normalized address to blocked_ips
 * only when blocking it. Delete the counter after a successful write to avoid
 * retaining rows for blocked sources or repeatedly auditing the same block.
 */
/* Automatic gate-failure threshold blocking has been removed. */
async function removedBanAfterGateFailures(
  _env: import("./env").Env,
  _request: Request,
  _ip: string,
): Promise<boolean> {
  return false;
/*
  if (!env.DB || !env.OBSERVABILITY_HMAC_KEY) return false;
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const parsed = parseCidr(normalized);
  if (!parsed) return false;

  const hashedIp = await ipHash(normalized, env);
  if (!hashedIp) return false;

  try {
    const rows = await queryAll<{ failures: number }>(
      env.DB,
      `INSERT INTO gate_failures (ip_hash, failures, window_started_at, last_seen_at)
       VALUES (?, 1, unixepoch(), unixepoch())
       ON CONFLICT(ip_hash) DO UPDATE SET
         failures = CASE
           WHEN gate_failures.last_seen_at < unixepoch() - ? THEN 1
           ELSE gate_failures.failures + 1
         END,
         window_started_at = CASE
           WHEN gate_failures.last_seen_at < unixepoch() - ? THEN unixepoch()
           ELSE gate_failures.window_started_at
         END,
         last_seen_at = unixepoch()
       RETURNING failures`,
      hashedIp,
      GATE_FAILURE_WINDOW_SECONDS,
      GATE_FAILURE_WINDOW_SECONDS,
    );
    if ((rows[0]?.failures ?? 0) < GATE_FAILURE_BAN_THRESHOLD) return false;

    const now = "datetime('now')";
    const reason = `${GATE_FAILURE_BAN_THRESHOLD} unverified gate requests within 24h`;
    const mutationSql =
      `INSERT INTO blocked_ips
         (cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active)
       VALUES (?, ?, ?, ?, 'gate/threshold', ${now}, ${now}, 'gate-threshold', 1)
       ON CONFLICT(cidr) DO UPDATE SET
         network = excluded.network, prefix = excluded.prefix, reason = excluded.reason,
         source = 'gate/threshold', updated_at = excluded.updated_at,
         updated_by = 'gate-threshold', active = 1`;
    const auditSql =
      `INSERT INTO blocklist_audit
         (cidr, network, prefix, action, actor, reason, source, previous_reason,
          previous_source, previous_updated_at, created_at)
       VALUES (?, ?, ?, 'threshold_block', 'gate-threshold', ?, 'gate/threshold',
               '', '', '', ${now})`;
    const clearSql = "DELETE FROM gate_failures WHERE ip_hash = ?";
    const statements = [
      env.DB.prepare(mutationSql).bind(parsed.cidr, parsed.network, parsed.prefix, reason),
      env.DB.prepare(auditSql).bind(parsed.cidr, parsed.network, parsed.prefix, reason),
      env.DB.prepare(clearSql).bind(hashedIp),
    ];
    const batched = await executeBatch(env.DB, statements);
    if (!batched) {
      if (!(await execute(env.DB, mutationSql, parsed.cidr, parsed.network, parsed.prefix, reason))) return false;
      if (!(await execute(env.DB, auditSql, parsed.cidr, parsed.network, parsed.prefix, reason))) return false;
      if (!(await execute(env.DB, clearSql, hashedIp))) return false;
    }
    await logEvent(env, "gate_threshold_block", request, {
      outcome: "blocked",
      status: 403,
      ip: normalized,
      message: `cidr=${parsed.cidr}; failures=${GATE_FAILURE_BAN_THRESHOLD}`,
    });
    return true;
  } catch {
    // Preserve the gate's existing behavior if the failure counter is unavailable; do not block by mistake.
    return false;
  }*/
}

/**
 * Process-local cache duration for the complete blocked_ips list, in milliseconds.
 *
 * Sixty seconds balances a maximum one-minute delay for admin changes against
 * at most one full-table read per isolate per minute. The cache affects reads
 * only; write paths (/api/blocklist and automatic blocking) do not use it.
 */
export const BLOCKED_LIST_TTL_MS = 60_000;

/**
 * Cache by the **env.DB binding object itself** in a WeakMap, not by a closure singleton.
 *
 * One isolate may use different DB bindings in different environments or test
 * stubs. Keying by the binding ensures that environment A's blocklist is never
 * used to classify requests in environment B.
 */
interface BlockedListCacheEntry {
/** Last **successfully** read full list, or `null` if none; a read failure does not clear it. */
  rows: BlockedRow[] | null;
/** Time of the last read attempt; determines when the cooldown ends. */
  at: number;
}

const blockedListCache = new WeakMap<object, BlockedListCacheEntry>();

/** Full-list query; `active = 1` matches the per-prefix filter. */
const BLOCKED_LIST_SQL = "SELECT cidr, network, prefix FROM blocked_ips WHERE active = 1";

/**
 * Reproduce per-prefix query matching in memory.
 *
 * Equivalence relies on `blocked_ips.network` always being a **normalized
 * network address**. The write paths in `_lib/cidr.ts` and `src/cidr.py` mask
 * and normalize before storing. Thus `contains(network, prefix, ip) === true`
 * is equivalent to the SQL predicate `networkAddress(ip, prefix) = network`.
 * Both paths reject prefixes wider than the address. Select the maximum prefix
 * as the query path does, and use the `cidr` primary key to avoid ambiguity.
 */
function matchBlockedRow(
  rows: BlockedRow[],
  normalized: string,
  maxPrefix: number,
): BlockedRow | null {
  let matched: BlockedRow | null = null;
  let matchedPrefix = -1;
  for (const row of rows) {
    const prefix = Number(row.prefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) continue;
    if (typeof row.network !== "string") continue;
    if (!contains(row.network, prefix, normalized)) continue;
    if (prefix > matchedPrefix) {
      matchedPrefix = prefix;
      matched = row;
    }
  }
  return matched;
}

/**
 * Read the full blocklist once and cache **this attempt** (the list on success, null on failure).
 *
 * Cache failures too: during a D1 disruption, do not make every request repeat
 * a full-list read that is certain to fail before falling back. That would
 * double the requests during one outage (the same cooldown principle as
 * `logging.ensureEventSchema`). During cooldown, use the original per-prefix
 * query path with unchanged semantics.
 */
async function readBlockedList(
  db: import("./env").Env["DB"] & object,
  now: number,
): Promise<BlockedRow[] | null> {
  let rows: BlockedRow[] | null = null;
  try {
    const stmt = db.prepare(BLOCKED_LIST_SQL);
    const result = await stmt.all<BlockedRow>();
// If a driver or test stub does not explicitly report success: true, fall back
// to per-prefix queries. An extra query is safer than allowing based on a
// potentially unreliable empty list.
    if (result?.success === true) rows = result.results ?? [];
  } catch {
    rows = null;
  }
// On read failure, **keep the last successful list** instead of replacing it
// with null. Otherwise the cooldown forces per-prefix queries, which could
// also fail and make all application blocking fail open during a D1 outage.
// Using a list read seconds earlier avoids allowing repeat offenders or
// blocking normal visitors. Literal fail-closed behavior would send every
// non-allowlisted visitor to a gate page that also reads D1, turning a brief
// disruption into a site-wide outage.
  const previous = blockedListCache.get(db)?.rows ?? null;
  const serving = rows ?? previous;
  blockedListCache.set(db, { rows: serving, at: now });
// Return the list **actually used for the decision**. If a read failed but an
// older list exists, return it so the caller can keep checking. Return null
// only before any successful read; the caller then falls back to per-prefix queries.
  return serving;
}

/** Original per-prefix query path, used unchanged when the cache is unavailable (one IPv4 or three IPv6 round trips). */
async function queryBlockedRows(
  db: import("./env").Env["DB"],
  normalized: string,
  maxPrefix: number,
): Promise<BlockedRow | null> {
  const candidates: Array<[string, number]> = [];
  for (let prefix = 0; prefix <= maxPrefix; prefix++) {
    const network = networkAddress(normalized, prefix);
    if (network) candidates.push([network, prefix]);
  }
  let matched: BlockedRow | null = null;
// Each network/prefix pair uses two bind parameters. Forty-nine pairs stay
// within D1's 100-parameter statement limit, so IPv4 needs one query and IPv6
// drops from seven to three.
  for (let start = 0; start < candidates.length; start += 49) {
    const chunk = candidates.slice(start, start + 49);
    const conditions = chunk.map(() => "(network = ? AND prefix = ?)").join(" OR ");
    const rows = await queryAll<BlockedRow>(
      db,
      `SELECT cidr, network, prefix
       FROM blocked_ips
       WHERE active = 1 AND (${conditions})
       ORDER BY prefix DESC
       LIMIT 1`,
      ...chunk.flatMap(([network, prefix]) => [network, prefix]),
    );
    for (const row of rows) {
      if (!matched || row.prefix > matched.prefix) matched = row;
    }
  }
  return matched;
}

/**
 * Check a request IP against blocked_ips after normalization (allow on database errors).
 *
 * On a process-cache hit (TTL is BLOCKED_LIST_TTL_MS), match the full list in
 * JavaScript without a database read. When cold or after a failed read, use the
 * original per-prefix query path with unchanged fail-open behavior. A
 * `block_match` event must have the same fields and decision as the query path,
 * including its `cidr` value.
 */
export async function isBlocked(
  env: { DB?: import("./env").Env["DB"] },
  request: Request,
  ip: string,
): Promise<boolean> {
  if (!env.DB || !ip) return false;
  const url = requestUrl(request);
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const maxPrefix = normalized.includes(":") ? 128 : 32;
  try {
    const now = Date.now();
    const cached = blockedListCache.get(env.DB);
    const fresh = cached && now - cached.at < BLOCKED_LIST_TTL_MS ? cached : null;
// Use the cached list during cooldown; otherwise refresh it. On read failure,
// readBlockedList returns null but **preserves the previous successful list**,
// so rows may still contain data read seconds ago.
    const rows = fresh ? fresh.rows : await readBlockedList(env.DB, now);

// Fallback order, from most authoritative:
//   1. Use the in-memory list (newly read or the last successful result); no query.
//   2. If there is no list, use the original per-prefix query, which distinguishes driver errors from misses.
//   3. If that query also fails, the outer catch is the remaining fail-open path.
    //
// Using the retained list in step 1 instead of failing open is the key change.
// Previously, a failed read replaced the cache with `rows: null`, forcing step
// 2; if that failed too, all application-level blocking silently failed open
// during D1 disruptions. A list read seconds earlier blocks repeat offenders
// while still allowing normal visitors. Literal fail-closed behavior would
// send every non-allowlisted visitor to a gate page that also reads D1,
// turning a transient issue into a site-wide outage.
    const matched = rows
      ? matchBlockedRow(rows, normalized, maxPrefix)
      : await queryBlockedRows(env.DB, normalized, maxPrefix);
    if (matched) {
      await logEvent(env as never, "block_match", request, {
        ip: normalized,
        path: url.pathname,
        outcome: "blocked",
        status: 403,
        message: `cidr=${matched.cidr}`,
      });
      return true;
    }
  } catch {
// Fail open: skip application-level blocking when the database is unavailable.
  }
  return false;
}

/**
 * Shared action identifier for the gate widget and siteverify response.
 */
export const GATE_TURNSTILE_ACTION = "gate";

/**
 * Call Turnstile siteverify; derive `remoteip` only from `CF-Connecting-IP`.
 *
 * In addition to `success`, require **hostname** to be one of the site's
 * managed hosts (`isPublicHost`, shared with the redirect allowlist). If the
 * same sitekey is used on another domain, tokens solved there may also pass
 * siteverify. Checking only `success` would let the sitekey configuration
 * define who counts as a visitor (tasks/22 W9-16, defense in depth). Reject a
 * missing hostname.
 *
 * Validate `action` only if the site declares one. The gate widget currently
 * has no action and siteverify returns none. If an action is added later, use
 * a fixed expected value here so tokens from other components cannot be reused.
 *
 * Exported so tests can verify that visitor-supplied forwarding headers never
 * reach remoteip. `handleVerify` is the only production caller.
 */
export async function verifyTurnstile(
  token: string,
  remoteip: string,
  secret: string,
  diagnostics?: { reason?: string },
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  try {
    const resp = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip }).toString(),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`siteverify HTTP ${resp.status}`);
    const data = (await resp.json()) as {
      success?: boolean;
      hostname?: unknown;
      action?: unknown;
      "error-codes"?: unknown;
    };
    if (data.success !== true) {
      const errorCodes = Array.isArray(data["error-codes"])
        ? data["error-codes"].filter(
            (code: unknown): code is string =>
              typeof code === "string" && /^[a-z0-9-]{1,40}$/.test(code),
          ).slice(0, 4)
        : [];
      if (diagnostics) {
        diagnostics.reason = errorCodes.length
          ? `siteverify_${errorCodes.join("_")}`
          : "siteverify_rejected";
      }
      return false;
    }
    const hostname = typeof data.hostname === "string" ? data.hostname : "";
    if (!isPublicHost(hostname)) {
      if (diagnostics) diagnostics.reason = "hostname_rejected";
      return false;
    }
    if (typeof data.action === "string" && data.action !== GATE_TURNSTILE_ACTION) {
      if (diagnostics) diagnostics.reason = "action_rejected";
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

function wantsJson(request: Request): boolean {
  return request.headers.get("Accept")?.includes("application/json") ?? false;
}

function gateTarget(host: string, path: string): string {
  return `https://${host}${path}`;
}

/** POST /__gate/verify: validate Turnstile and issue a cookie on success.
 *
 * The gate page calls this endpoint with fetch. The response sets only a
 * cookie and does not pass through the redirect subdomain. Without JavaScript,
 * the page still returns to the original site as an accessibility fallback.
 */
export async function handleVerify(context: RequestContext): Promise<Response> {
  const { request, env } = context;
  const startedAt = Date.now();
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    deferLog(
      context,
      logEvent(env, "gate_verify", request, {
        outcome: "failed",
        status: 400,
        durationMs: Date.now() - startedAt,
        message: "invalid_form",
      }),
    );
    return renderGatePage(context, { errorKey: "invalid" });
  }

  const token = form.get("cf-turnstile-response")?.toString() ?? "";
  const next = safeNextPath(form.get("next")?.toString() ?? null);
  const host = sanitizeHost(form.get("host")?.toString() ?? null);
// Turnstile compares remoteip with the challenge source. Pass only the
// connection IP identified by Cloudflare; never trust visitor-supplied
// forwarding headers, which would let visitors choose the verification input.
  const remoteip = clientIpForLogs(request);

  let success = false;
  let unavailable = false;
  const verifyDiagnostics: { reason?: string } = { reason: "turnstile_rejected" };
// Both secrets are required: TURNSTILE_SECRET verifies challenges and
// GATE_HMAC_KEY signs cookies. Previously only the first was checked, so an
// empty GATE_HMAC_KEY could reach gateCookieHeaders("") and issue a __gate
// cookie with an **empty key**. Middleware runtimeConfigError currently catches
// this, but this handler is the fallback when middleware routing is missing
// and must enforce the check itself (tasks/22 W9-11).
  if (!env.TURNSTILE_SECRET || !env.GATE_HMAC_KEY) {
    unavailable = true;
  } else {
    try {
      success = token !== "" && (await verifyTurnstile(
        token,
        remoteip,
        env.TURNSTILE_SECRET,
        verifyDiagnostics,
      ));
    } catch {
      unavailable = true;
    }
  }

  if (!success) {
    deferLog(
      context,
      logEvent(env, "gate_verify", request, {
        outcome: unavailable ? "unavailable" : "failed",
        status: unavailable ? 503 : 403,
        durationMs: Date.now() - startedAt,
        message: unavailable
          ? env.GATE_HMAC_KEY
            ? env.TURNSTILE_SECRET
              ? "turnstile_unavailable"
              : "turnstile_secret_missing"
            : "gate_hmac_key_missing"
          : token
            ? verifyDiagnostics.reason ?? "turnstile_rejected"
            : "missing_token",
      }),
    );
    const errorKey = unavailable ? "unavailable" : "failed";
    if (wantsJson(request)) {
      return Response.json(
        { ok: false, error: errorKey },
        { status: unavailable ? 503 : 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    return renderGatePage(context, {
      host,
      next,
      unavailable,
      errorKey,
    });
  }

// Clear the old host-only scope before writing the new domain cookie.
  //
// Deliberately send two Set-Cookie headers: the old same-name host-only cookie
// coexists with the new domain cookie and remains first in the request header.
// Writing only the new cookie would not remove the old one. preserveSetCookie
// prevents the headers from being merged, avoiding Safari's first-header issue.
  const cookies = await gateCookieHeaders(env.GATE_HMAC_KEY, requestUrl(request).hostname);
  deferLog(
    context,
    logEvent(env, "gate_verify", request, {
      outcome: "success",
      status: 204,
      durationMs: Date.now() - startedAt,
      message: "cookie_issued",
    }),
  );

  if (wantsJson(request)) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 204, headers });
  }

  const headers = new Headers({
    Location: gateTarget(host, next),
    "Cache-Control": "no-store",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
