/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * ComiCine visitor and Ray tracking with minimal fields.
 *
 * Privacy rules:
 * - visitors_v2 and ray_log_v2 do not store full IPs, user agents, or queries.
 * - Hash IPs to the first 16 HMAC characters with the separate
 *   OBSERVABILITY_HMAC_KEY.
 * - visitor_rollups also stores an **encrypted** IP (VISITOR_IP_KEY; see
 *   _lib/visitor-ip.ts). Decrypt one row only when an admin selects it; never
 *   return this value from list endpoints.
 * - Tracking failures go to the console only; they do not block requests or
 *   recursively write error events.
 */

import { execute, executeBatch } from "./d1";
import type { Env } from "./env";
import { ipHash } from "./logging";
import { encryptVisitorIp } from "./visitor-ip";
import { GATE_TRUST } from "../_data/gateTrust";
import { isDeclaredCrawler } from "./bots";
import { IMAGES_HOSTNAME, REDIRECT_HOSTNAME } from "./config";
import { clientCountryForLogs, clientIpForLogs, requestUrl } from "./routing";

let trackingSchemaReady = false;
/** Time of the last table-creation attempt, in milliseconds; see ensureTrackingSchema and tasks/22 W9-19. */
let trackingSchemaAttemptAt = 0;
const SCHEMA_RETRY_COOLDOWN_MS = 60_000;

const TRACKING_DDL = [
  `CREATE TABLE IF NOT EXISTS visitor_rollups (
    bucket_hour INTEGER NOT NULL,
    ip_hash     TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 0,
    page_slug   TEXT NOT NULL DEFAULT '',
    requests    INTEGER NOT NULL DEFAULT 1,
    last_ts     INTEGER NOT NULL DEFAULT (unixepoch()),
    ip_enc      TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (bucket_hour, ip_hash, country, status, page_slug)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_visitor_rollups_ip_hash ON visitor_rollups (ip_hash, last_ts)",
  `CREATE TABLE IF NOT EXISTS visitors_v2 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash     TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 0,
    ts          INTEGER NOT NULL DEFAULT (unixepoch()),
    page_slug   TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_visitors_v2_ts ON visitors_v2 (ts)",
  "CREATE INDEX IF NOT EXISTS idx_visitors_v2_ip_hash_ts ON visitors_v2 (ip_hash, ts)",
  "CREATE INDEX IF NOT EXISTS idx_visitors_v2_page_slug_ts ON visitors_v2 (page_slug, ts)",
  `CREATE TABLE IF NOT EXISTS ray_log_v2 (
    ray             TEXT PRIMARY KEY,
    ts              INTEGER NOT NULL DEFAULT (unixepoch()),
    host            TEXT NOT NULL DEFAULT '',
    normalized_path TEXT NOT NULL DEFAULT '',
    method          TEXT NOT NULL DEFAULT '',
    status          INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    ip_hash         TEXT NOT NULL DEFAULT '',
    country         TEXT NOT NULL DEFAULT '',
    ua_family       TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ray_log_v2_ts ON ray_log_v2 (ts)",
];

export function isTrustedCrawler(request: Request): boolean {
  const cf = (request as Request & { cf?: { botManagement?: { verifiedBot?: boolean } } }).cf;
  if (GATE_TRUST.verified_bot !== true) return false;
  return cf?.botManagement?.verifiedBot === true;
}

/** Normalize a path without its query and limit its length to protect D1 from oversized or malicious paths. */
export function normalizePath(pathname: string): string {
  return pathname.split("?")[0].slice(0, 2048);
}

/** Map a request path to a page slug for aggregation. */
export function pageSlug(pathname: string): string {
  const p = normalizePath(pathname).replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/index.html") return "home";
  if (p.startsWith("/services")) return "services";
  if (p.startsWith("/contact")) return "contact";
  if (p.startsWith("/visitor")) return "visitor";
  if (p.startsWith("/account")) return "apple-account";
  if (p.startsWith("/login")) return "login";
  if (p.startsWith("/logout")) return "logout";
  const first = p.split("/").filter(Boolean)[0];
  return first || "root";
}

/** Allowlisted user-agent categories; store only a limited classification, never the original UA. */
export function uaFamily(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (!ua) return "";
  const bots: Array<[RegExp, string]> = [
    [/googlebot/, "googlebot"],
    [/bingbot/, "bingbot"],
    [/baiduspider/, "baiduspider"],
    [/yandex/, "yandexbot"],
    [/applebot/, "applebot"],
    [/gptbot|chatgpt-|oai-searchbot/, "ai-bot"],
    [/claudebot|anthropic-ai|claude-web/, "ai-bot"],
    [/perplexitybot|amazonbot|ccbot|diffbot/, "ai-bot"],
    [/uptimerobot|pingdom|gtmetrix|statuscake|datadog|zabbix/, "monitor"],
  ];
  for (const [re, name] of bots) if (re.test(ua)) return name;
  if (ua.includes("edg/")) return "edge";
  if (ua.includes("chrome")) return "chrome";
  if (ua.includes("firefox")) return "firefox";
  if (ua.includes("safari")) return "safari";
  if (ua.includes("mobile")) return "mobile";
  return "other";
}

/**
 * Count only real-user page GETs. Exclude crawlers, static assets, APIs, gate
 * pages, images, and redirects.
 *
 * Exclude both Cloudflare-verified bots and crawlers that self-report through
 * the UA list (`isDeclaredCrawler`). They receive the real site with status
 * 200, so counting them would pollute visitor data; a visitor means a real user.
 */
export function shouldTrackVisit(request: Request, url: URL): boolean {
  if (request.method !== "GET") return false;
  if (isTrustedCrawler(request) || isDeclaredCrawler(request)) return false;
  if (url.hostname === IMAGES_HOSTNAME || url.hostname === REDIRECT_HOSTNAME) return false;
  const p = url.pathname;
  if (
    p.startsWith("/api/") ||
    p === "/_health" ||
    p.startsWith("/static/") ||
    p.startsWith("/__gate") ||
    p.startsWith("/favicon") ||
    p === "/comicine.svg" ||
    p === "/comicine-xtext.svg" ||
    p === "/comicine-favicon.svg" ||
    p === "/Limooo-xtext.svg" ||
    p === "/ComiCine-xtext.svg"
  ) {
    return false;
  }
  if (isGateEndpointPath(p)) return false;
  return !/\.(png|webp|jpg|jpeg|gif|ico|svg|css|js|json|webmanifest|txt|xml)$/i.test(p);
}

/** Normalize legacy `/__gate/...` paths (308 redirect) and canonical `/gate/...` paths to the same form. */
function normalizeGatePath(pathname: string): string {
  return pathname.startsWith("/__gate")
    ? `/gate${pathname.slice("/__gate".length)}`
    : pathname;
}

/**
 * **API paths used by the gate page itself**: the frontend calls `/gate/config`
 * for the sitekey, copy, and root domain; `/gate/diag` for a searchable Ray ID;
 * and POST `/gate/verify` for challenge verification.
 *
 * These requests belong to the gate page and are not visitor page views; **never count them**.
 *
 * The exclusion list previously covered only `/__gate`, while the frontend
 * calls `/gate/config` and `/gate/diag`; `/__gate` is only a 308 redirect.
 * Each unverified page view therefore caused one or two D1 writes, allowing
 * anonymous write amplification by anyone, including scanners. This matched
 * the failure pattern from 2026-09-17.
 */
function isGateEndpointPath(pathname: string): boolean {
  const p = normalizeGatePath(pathname);
  return p === "/gate/config" || p === "/gate/verify" || p === "/gate/diag";
}

/**
 * The **only path allowed to record a Ray ID** on the gate page.
 *
 * Use an explicit allowlist rather than a list of exclusions. If a new
 * `/gate/*` endpoint is added without registration, it will be omitted from
 * logs (acceptable) rather than silently writing one row per request. Keep
 * this endpoint because the gate page displays a Ray ID that must be searchable.
 */
function isTraceableGatePath(pathname: string): boolean {
  const p = normalizeGatePath(pathname);
  return p === "/gate/diag";
}

/** Record Ray data only for pages and a small set of entry points; exclude
 * static assets, APIs, gate endpoints, images, and redirect subdomains.
 * Exception: `/gate/diag`, whose Ray ID is displayed on the auth page. */
export function shouldTrackRay(request: Request, url: URL): boolean {
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PUT" && request.method !== "DELETE") return false;
  if (url.hostname === IMAGES_HOSTNAME || url.hostname === REDIRECT_HOSTNAME) return false;
  const p = url.pathname;
  if (isTraceableGatePath(p)) return true;
  if (
    p.startsWith("/api/") ||
    p === "/_health" ||
    p.startsWith("/static/")
  ) {
    return false;
  }
  if (isGateEndpointPath(p)) return false;
  if (
    p.startsWith("/favicon") ||
    p === "/comicine.svg" ||
    p === "/comicine-xtext.svg" ||
    p === "/comicine-favicon.svg" ||
    p === "/Limooo-xtext.svg" ||
    p === "/ComiCine-xtext.svg"
  ) return false;
  if (/\.(png|webp|jpg|jpeg|gif|ico|svg|css|js|json|webmanifest|txt|xml)$/i.test(p)) return false;
  return true;
}

/**
 * Create tables idempotently before the first write in each isolate (tasks/22 W9-19).
 *
 * Use the same strategy as `ensureEventSchema` in logging.ts: remember each
 * attempt and retry at most once per minute so every request does not send a
 * batch of failing DDL during a D1 outage. Combine statements in one
 * `db.batch` round trip; fall back to individual statements only when batch is
 * unavailable.
 */
async function ensureTrackingSchema(env: Env): Promise<void> {
  if (trackingSchemaReady || !env.DB) return;
  const now = Date.now();
  if (now - trackingSchemaAttemptAt < SCHEMA_RETRY_COOLDOWN_MS) return;
  trackingSchemaAttemptAt = now;
  try {
    const db = env.DB;
    if (db.batch) {
      if (await executeBatch(db, TRACKING_DDL.map((sql) => db.prepare(sql)))) {
        trackingSchemaReady = true;
      }
      return;
    }
    for (const sql of TRACKING_DDL) {
      if (!(await execute(env.DB, sql))) return;
    }
    trackingSchemaReady = true;
  } catch {
// Retry after the cooldown; tracking failures do not affect the request.
  }
}

/** Record a visitor after the response; aggregate by hour, IP, page, and status while keeping exact counts. */
export async function recordVisit(env: Env, request: Request, status: number): Promise<void> {
  if (!env.DB) return;
  const url = requestUrl(request);
  const ip = clientIpForLogs(request);
  try {
    await ensureTrackingSchema(env);
    await execute(
      env.DB,
      `INSERT INTO visitor_rollups
         (bucket_hour, ip_hash, country, status, page_slug, requests, last_ts, ip_enc)
       VALUES ((unixepoch() / 3600) * 3600, ?, ?, ?, ?, 1, unixepoch(), ?)
       ON CONFLICT(bucket_hour, ip_hash, country, status, page_slug) DO UPDATE SET
         requests = visitor_rollups.requests + 1,
         last_ts = excluded.last_ts,
         -- 同 IP 每次加密的 IV 不同，只在原本为空（当时还没配密钥）时补写。
         ip_enc = CASE
           WHEN visitor_rollups.ip_enc = '' THEN excluded.ip_enc
           ELSE visitor_rollups.ip_enc
         END`,
      await ipHash(ip, env),
      clientCountryForLogs(request),
      status,
      pageSlug(url.pathname),
      await encryptVisitorIp(ip, env),
    );
  } catch (error) {
// Do not recursively write error events; keep the error in the Pages console only.
    console.error(JSON.stringify({ event: "visit_record_error", message: String(error) }));
  }
}

/** Record a Ray request after the response with only ray, time, host, normalized path, method, status, duration, ip_hash, country, and ua_family. */
export async function recordRay(
  env: Env,
  request: Request,
  status: number,
  durationMs: number,
): Promise<void> {
  if (!env.DB) return;
  const url = requestUrl(request);
  const ray = request.headers.get("CF-Ray") ?? "";
  if (!ray) return;
  try {
    await ensureTrackingSchema(env);
    await execute(
      env.DB,
      `INSERT OR IGNORE INTO ray_log_v2
        (ray, ts, host, normalized_path, method, status, duration_ms, ip_hash, country, ua_family)
       VALUES (?, unixepoch(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      ray,
      url.hostname,
      normalizePath(url.pathname),
      request.method,
      status,
      Math.max(0, Math.round(durationMs)),
      await ipHash(clientIpForLogs(request), env),
      clientCountryForLogs(request),
      uaFamily(request.headers.get("User-Agent") ?? ""),
    );
  } catch (error) {
// Fail open and do not recursively write error events.
    console.error(JSON.stringify({ event: "ray_record_error", message: String(error) }));
  }
}
