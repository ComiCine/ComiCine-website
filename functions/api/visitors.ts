/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * GET /api/visitors
 *
 * Requires an admin session and reads aggregate data from D1. To protect privacy, this endpoint
 * returns only ip_hash, not full IP addresses. Use the single-record endpoint
 * `GET /api/visitors/<ip_hash>/ip` to view a visitor's real IP; it decrypts only after the row is clicked.
 * The frontend filters statuses locally, so the main frontend calls this endpoint without a status parameter.
 * `?status=<3-digit number>` remains available for deep links and external callers.
 *
 * Window: statistics cover the 30 complete UTC days stored in `visitors_daily` (permanent daily
 * aggregate) plus the current, still incomplete UTC day appended from `visitor_rollups`. Because the
 * daily table is keyed by whole UTC days, the statistics window starts at the UTC midnight 30 days ago,
 * which can reach up to 24 hours further back than the rolling `now - 30 days` cutoff that the marker
 * query keeps; the comment on `statsSql` records that boundary rule.
 *
 * The legacy `visitors_v2` detail table has received no writes since hourly rollups landed and
 * retention prunes it after 30 days. `visitors_include_legacy` (config contract, default true) keeps it
 * in the current-day tail and in the marker query; turning it off removes one scan per cache miss and
 * changes nothing else once the table is empty.
 */

import { CONTRACT } from "../_lib/config";
import { queryAll } from "../_lib/d1";
import { requireAdminSession } from "../_lib/session";
import type { Env } from "../_lib/env";

const DAY_SECONDS = 24 * 60 * 60;
const VISITOR_WINDOW_DAYS = 30;
const VISITOR_WINDOW_SECONDS = VISITOR_WINDOW_DAYS * DAY_SECONDS;
const MAX_VISITOR_MARKERS = 500;

/**
 * Cache query results for slightly longer than the frontend's 600-second poll interval.
 *
 * A 300-second TTL expired before every scheduled poll, so each poll re-ran both 30-day aggregate
 * queries; the cache only absorbed bursts. With 660 seconds, polls at 10 and 20 minutes hit the
 * entry written at the previous miss, halving the scan rate while never serving data older than
 * two poll intervals. A historical query read about 131,000 rows while the legacy detail table was
 * populated; at that cost, uncached polls would exceed the 5-million-row Free-plan limit. Retention
 * and hourly rollups reduce the current scan, but check `rows_read_24h` before changing the window
 * or refresh interval.
 */
const VISITOR_CACHE_CONTROL = "public, max-age=660";
const VISITOR_RESPONSE_CACHE_CONTROL = "private, no-store";
const VISITOR_CACHE_SECONDS = 660;

/**
 * Version marker in both cache keys.
 *
 * The previous version cached the whole response under one key that included `status`, so every
 * status deep link re-ran the status-independent statistics. Statistics and markers are now cached as
 * independent parts under `__stats` and `__markers`; the version marker keeps the old whole-response
 * entries from ever being read with the new part format.
 */
const VISITOR_CACHE_VERSION = `${VISITOR_CACHE_SECONDS}v2`;
const VISITOR_PART_TAG_HEADER = "x-comicine-part-tag";
const VISITOR_PART_TAG_LENGTH = 32;
/** Hex characters of the composed response ETag. */
const VISITOR_ETAG_HEX_LENGTH = 32;

type VisitorCacheLike = {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
};

interface StatsRow {
  ips: number;
  requests: number;
  countries: number;
  status_series: string | null;
}

interface MarkerRow {
  ip_hash: string;
  country: string;
  status: number;
  n: number;
/** Integer returned by D1; visitors_v2.ts and visitor_rollups.last_ts are INTEGER columns. */
  last_ts: number;
}

interface MarkerAccumulator {
  country: string;
  count: number;
/** Unix seconds for the most recent visit; convert to an ISO timestamp with Z before returning it to the frontend. */
  last_time: number;
  statuses: Record<string, number>;
}

/** Statistics half of the response, cached independently of the status filter. */
interface StatsPayload {
  stats: { total_ips: number; total_requests: number; countries: number };
  status_counts: Record<string, number>;
}

/** Marker half of the response, cached per status filter. */
interface MarkersPayload {
  markers: VisitorMarker[];
}

interface VisitorMarker {
  ip: null;
  ip_hash: string;
  country: string;
  city: string;
  latitude: null;
  longitude: null;
  hosts: unknown[];
  count: number;
/** UTC ISO 8601 (`2026-01-02T00:00:00Z`); the frontend converts it to the visitor's browser time zone for display. */
  last_time: string;
  statuses: Record<string, number>;
}

/** A cached part plus the tag that lets the response ETag be composed without rehashing the body. */
interface CachedPart<T> {
  value: T;
  tag: string;
}

/**
 * Bounds of the statistics window.
 *
 * The marker query keeps the original rolling `now - 30 days` cutoff, so its result set is unchanged.
 * The statistics come from whole UTC days and start at the midnight of the day that cutoff falls in,
 * which may include up to 24 hours of that oldest day; the current day is appended from the tail.
 */
export interface VisitorWindow {
/** Inclusive Unix-second lower bound for the marker query. */
  cutoff: number;
/** UTC midnight of the current day; `visitors_daily` never contains this incomplete day. */
  todayStart: number;
/** First UTC day read from `visitors_daily`, inclusive, formatted `YYYY-MM-DD`. */
  dayStart: string;
/** Current UTC day, exclusive, formatted `YYYY-MM-DD`; the current day comes from the tail query instead. */
  dayEnd: string;
}

export function visitorWindow(nowMs: number): VisitorWindow {
  const now = Math.floor(nowMs / 1000);
  const todayStart = now - (now % DAY_SECONDS);
  return {
    cutoff: now - VISITOR_WINDOW_SECONDS,
    todayStart,
    dayStart: utcDay(todayStart - VISITOR_WINDOW_SECONDS),
    dayEnd: utcDay(todayStart),
  };
}

function utcDay(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Whether the legacy `visitors_v2` detail table still participates in queries.
 *
 * Read from the contract per request rather than frozen at import so a test can exercise both states
 * and so a deployment can flip the flag without touching code. Defaults to true when the key is absent
 * (older generated config).
 */
export function visitorsIncludeLegacy(): boolean {
  // build.py emits CONTRACT `as const`, so the generated property type is the literal currently in
  // config-contract.json. Read it through a widened view: flipping the contract to false must not
  // require a code change, and tests need to exercise both states.
  const configured = (CONTRACT as { visitors_include_legacy?: boolean }).visitors_include_legacy;
  return configured !== false;
}

/**
 * Aggregated statistics for the whole window in one D1 round trip.
 *
 * Complete days come from `visitors_daily` (one permanent row per UTC day and dimension) and the
 * current day is appended from `visitor_rollups`, grouped per (country, status) so the current day's
 * distinct IPs are not multiplied by page slug. Request totals and the status distribution stay
 * exact; `countries` stays an exact `COUNT(DISTINCT country)`.
 *
 * Metric caveat: `total_ips` used to be `COUNT(DISTINCT ip_hash)` over the detail rows. The daily table
 * stores no ip_hash, so it becomes `SUM(unique_ips)`, an "IP-days" upper bound that grows with the
 * window length because the same IP is counted once per day, country, page, and status. The field name
 * is unchanged so the frontend contract is untouched, but the number is not an exact distinct-IP count
 * and must not be presented as one without a decision to change the label.
 *
 * Boundary rule: `visitors_daily` holds whole UTC days only, so the window starts at the midnight of
 * the day 30 days ago and can include up to 24 hours of that day; the marker query keeps the rolling
 * 30x24h cutoff. The current day is never in `visitors_daily` (the aggregation only writes complete
 * days), so the tail supplies it and no request is counted twice.
 *
 * Parameter order: the current-day tail bound(s) first, then the `visitors_daily` window bounds.
 */
export function statsSql(includeLegacy: boolean): string {
  const legacyTail = includeLegacy
    ? `SELECT ip_hash, country, status, 1 AS requests
         FROM visitors_v2
         WHERE ts >= ?
         UNION ALL
         `
    : "";
  return `WITH tail AS (
       ${legacyTail}SELECT ip_hash, country, status, requests
       FROM visitor_rollups
       WHERE last_ts >= ?
     ),
     tail_groups AS (
       SELECT country, status, COUNT(DISTINCT ip_hash) AS unique_ips, SUM(requests) AS requests
       FROM tail
       GROUP BY country, status
     ),
     scoped AS (
       SELECT country, status, unique_ips, requests
       FROM visitors_daily
       WHERE day >= ? AND day < ?
       UNION ALL
       SELECT country, status, unique_ips, requests
       FROM tail_groups
     )
     SELECT
       COUNT(DISTINCT country) AS countries,
       COALESCE(SUM(unique_ips), 0) AS ips,
       COALESCE(SUM(requests), 0) AS requests,
       (SELECT GROUP_CONCAT(status || ':' || n, ',') FROM (
          SELECT status, SUM(requests) AS n FROM scoped GROUP BY status ORDER BY status
       )) AS status_series
     FROM scoped`;
}

/** Bind values for `statsSql`, in statement order. */
export function statsParams(window: VisitorWindow, includeLegacy: boolean): unknown[] {
  const params: unknown[] = [];
  if (includeLegacy) params.push(window.todayStart);
  params.push(window.todayStart, window.dayStart, window.dayEnd);
  return params;
}

/**
 * SQL listing the 500 most recent IP hashes and each IP's status distribution.
 *
 * Select the top 500 first, then group by ip_hash and status to fetch all rows needed to build markers.
 *
 * The filtered and unfiltered queries differ only by `AND status = ?`, so build one SQL string with
 * interpolation. statusFilter is derived from whether statusNum is empty, not from user input, using
 * the same pattern as `${MAX_VISITOR_MARKERS}` below without adding an injection vector.
 *
 * Use the country from the **most recent** visit. Do not use MAX(country): it sorts alphabetically,
 * not by time, so visitors with both CN and CH would always show CN. One IP appearing in multiple
 * countries is normal because Cloudflare may report different locations for proxy or relay ranges.
 * Implementation notes, measured on production D1:
 *   - top already contains each IP's last_ts; join back to scoped to fetch that row's country (131,000 rows read).
 *   - Do not use a correlated subquery (SELECT s2.country ... ORDER BY ts DESC LIMIT 1; 13.7M rows),
 *     NOT EXISTS (7.53M rows), or ROW_NUMBER() over all partitions (175,000 rows). The Free plan limit is 5M rows/day.
 */
export function markerSql(includeLegacy: boolean, statusFilter: string): string {
  const legacyScope = includeLegacy
    ? `SELECT ip_hash, country, status, ts, 1 AS requests
         FROM visitors_v2
         WHERE ts >= ?${statusFilter}
         UNION ALL
         `
    : "";
  return `WITH scoped AS (
         ${legacyScope}SELECT ip_hash, country, status, last_ts AS ts, requests
         FROM visitor_rollups
         WHERE last_ts >= ?${statusFilter}
       ),
       top AS (
         SELECT ip_hash, MAX(ts) AS last_ts
         FROM scoped
         GROUP BY ip_hash
         ORDER BY last_ts DESC
         LIMIT ${MAX_VISITOR_MARKERS}
       ),
       latest AS (
         SELECT t.ip_hash, MAX(s.country) AS country
         FROM top t
         JOIN scoped s ON s.ip_hash = t.ip_hash AND s.ts = t.last_ts
         GROUP BY t.ip_hash
       )
       SELECT v.ip_hash, l.country, v.status,
              SUM(v.requests) AS n,
              MAX(v.ts) AS last_ts
       FROM scoped v
       JOIN top t ON t.ip_hash = v.ip_hash
       JOIN latest l ON l.ip_hash = v.ip_hash
       GROUP BY v.ip_hash, v.status
       ORDER BY MAX(v.ts) DESC, v.status`;
}

/** Bind values for `markerSql`, in statement order; the status value follows each window bound. */
export function markerParams(
  window: VisitorWindow,
  statusNum: number | null,
  includeLegacy: boolean,
): unknown[] {
  const params: unknown[] = [];
  if (includeLegacy) {
    params.push(window.cutoff);
    if (statusNum !== null) params.push(statusNum);
  }
  params.push(window.cutoff);
  if (statusNum !== null) params.push(statusNum);
  return params;
}

function parseStatusSeries(value: string | null): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!value) return counts;
  for (const part of value.split(",")) {
    const sep = part.lastIndexOf(":");
    if (sep <= 0) continue;
    const code = part.slice(0, sep).trim();
    const n = Number(part.slice(sep + 1));
    if (code && Number.isFinite(n)) {
      counts[code] = (counts[code] ?? 0) + n;
    }
  }
  return counts;
}

function buildMarkers(rows: MarkerRow[]): VisitorMarker[] {
  const byHash = new Map<string, MarkerAccumulator>();
  for (const row of rows) {
    let acc = byHash.get(row.ip_hash);
    if (!acc) {
      acc = {
        country: row.country,
        count: 0,
        last_time: row.last_ts,
        statuses: {},
      };
      byHash.set(row.ip_hash, acc);
    }
    acc.count += row.n;
  // The country must follow the **most recent visit**. Updating only last_time would make the displayed
  // country depend on D1 row order, especially when one ip_hash has multiple statuses with different last_ts values.
    if (row.last_ts > acc.last_time) {
      acc.last_time = row.last_ts;
      acc.country = row.country;
    }
    const key = String(row.status);
    acc.statuses[key] = (acc.statuses[key] ?? 0) + row.n;
  }

  return Array.from(byHash.entries(), ([ip_hash, acc]) => ({
    ip: null,
    ip_hash,
    country: acc.country,
    city: "",
    latitude: null,
    longitude: null,
    hosts: [],
    count: acc.count,
    last_time: new Date(acc.last_time * 1000).toISOString(),
    statuses: acc.statuses,
  }));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function partTag(value: unknown): Promise<string> {
  return (await sha256Hex(JSON.stringify(value))).slice(0, VISITOR_PART_TAG_LENGTH);
}

/**
 * Weak ETag composed from the two part tags and the payload constants.
 *
 * Weak because Cloudflare may serve the same JSON gzip-encoded or identity-encoded, so a strong
 * validator cannot hold across representations. Composing the stored part tags (instead of rehashing
 * the body) keeps a cache hit cheap, and folding `range_days`/`max_markers` in means a constant change
 * cannot reuse a tag whose body used the old value. An identical tag means an identical body: the
 * payload key order is fixed below.
 */
async function composeETag(statsTag: string, markersTag: string): Promise<string> {
  const digest = await sha256Hex(
    `${VISITOR_WINDOW_DAYS}|${MAX_VISITOR_MARKERS}|${statsTag}|${markersTag}`,
  );
  return `W/"${digest.slice(0, VISITOR_ETAG_HEX_LENGTH)}"`;
}

function ifNoneMatchMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  const normalize = (value: string) => value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const target = normalize(etag);
  return header.split(",").some((part) => {
    const candidate = part.trim();
    if (candidate === "*") return true;
    return normalize(candidate) === target;
  });
}

function isStatsPayload(value: unknown): value is StatsPayload {
  const stats = (value as StatsPayload | null)?.stats;
  return !!stats && typeof stats === "object" && typeof stats.total_requests === "number";
}

function isMarkersPayload(value: unknown): value is MarkersPayload {
  return Array.isArray((value as MarkersPayload | null)?.markers);
}

/**
 * Read one cached part. Any failure (missing entry, corrupt JSON, unexpected shape, Cache API error)
 * is treated as a miss so the request falls back to D1 instead of failing.
 */
async function readPart<T>(
  cache: VisitorCacheLike,
  url: URL,
  isValid: (value: unknown) => value is T,
): Promise<CachedPart<T> | null> {
  try {
    const hit = await cache.match(new Request(url));
    if (!hit) return null;
    const text = await hit.text();
    const value: unknown = JSON.parse(text);
    if (!isValid(value)) return null;
    const storedTag = hit.headers.get(VISITOR_PART_TAG_HEADER);
    return { value, tag: storedTag || (await partTag(value)) };
  } catch {
    return null;
  }
}

/** Write one cached part. Caching is only an optimization, so a failed put never fails the request. */
async function putPart<T>(
  cache: VisitorCacheLike,
  url: URL,
  value: T,
  tag: string,
): Promise<void> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": VISITOR_CACHE_CONTROL,
  });
  headers.set(VISITOR_PART_TAG_HEADER, tag);
  await cache.put(new Request(url), new Response(JSON.stringify(value), { headers }));
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request, "Forbidden");
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam !== null && !/^\d{3}$/.test(statusParam)) {
    return Response.json(
      { error: "Invalid status parameter: expected a three-digit status code" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const statusNum = statusParam === null ? null : Number(statusParam);
  const statusFilter = statusNum === null ? "" : " AND status = ?";
  const includeLegacy = visitorsIncludeLegacy();
  const window = visitorWindow(Date.now());

  // The admin page polls every 600 seconds, about 144 times per day, and one miss otherwise runs both
  // 30-day queries. Authentication runs before the cache, whose keys do not include identity: this is
  // not an authorization cache, because requests that fail the admin check never reach this code.
  //
  // Key on the path plus the validated status filter only. Using the raw URL let any extra query
  // parameter (`?x=1`, `?x=2`, ...) create a new entry and trigger another pair of full-window scans.
  //
  // Statistics do not depend on `status`, so they get their own key; the markers key keeps the status
  // filter. A deep link to a new status therefore costs one marker query, not a statistics rescan.
  const statsKeyUrl = new URL(url.pathname, url.origin);
  statsKeyUrl.searchParams.set("__stats", VISITOR_CACHE_VERSION);
  const markersKeyUrl = new URL(url.pathname, url.origin);
  if (statusNum !== null) markersKeyUrl.searchParams.set("status", String(statusNum));
  markersKeyUrl.searchParams.set("__markers", VISITOR_CACHE_VERSION);

  const cache = typeof caches !== "undefined"
    ? (caches as unknown as { default?: VisitorCacheLike }).default
    : undefined;

  const [cachedStats, cachedMarkers] = cache
    ? await Promise.all([
      readPart(cache, statsKeyUrl, isStatsPayload),
      readPart(cache, markersKeyUrl, isMarkersPayload),
    ])
    : [null, null];

  const cacheWrites: Promise<void>[] = [];

  let stats = cachedStats?.value;
  let statsTag = cachedStats?.tag ?? "";
  if (!stats) {
    const statsRows = await queryAll<StatsRow>(
      context.env.DB,
      statsSql(includeLegacy),
      ...statsParams(window, includeLegacy),
    );
    const row = statsRows[0] ?? { ips: 0, requests: 0, countries: 0, status_series: null };
    stats = {
      stats: {
        total_ips: row.ips,
        total_requests: row.requests,
        countries: row.countries,
      },
      status_counts: parseStatusSeries(row.status_series),
    };
    statsTag = await partTag(stats);
    if (cache) {
      const part = stats;
      const tag = statsTag;
      // Swallow failures per part: a cache write is an optimization, and an unhandled rejection would
      // surface as a test-run error or an unhandled promise in the Workers runtime.
      cacheWrites.push(putPart(cache, statsKeyUrl, part, tag).catch(() => undefined));
    }
  }

  let markers = cachedMarkers?.value;
  let markersTag = cachedMarkers?.tag ?? "";
  if (!markers) {
    const markerRows = await queryAll<MarkerRow>(
      context.env.DB,
      markerSql(includeLegacy, statusFilter),
      ...markerParams(window, statusNum, includeLegacy),
    );
    markers = { markers: buildMarkers(markerRows) };
    markersTag = await partTag(markers);
    if (cache) {
      const part = markers;
      const tag = markersTag;
      cacheWrites.push(putPart(cache, markersKeyUrl, part, tag).catch(() => undefined));
    }
  }

  const etag = await composeETag(statsTag, markersTag);

  // Schedule cache writes before any early return so the parts just read from D1 are stored even when
  // the response itself is a 304. The 304 response is never put into the cache, only the parts are.
  if (cacheWrites.length > 0) {
    const cacheWrite = Promise.all(cacheWrites).then(() => undefined);
    if (typeof context.waitUntil === "function") {
      context.waitUntil(cacheWrite);
    } else {
      await cacheWrite;
    }
  }

  if (ifNoneMatchMatches(context.request.headers.get("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        "Cache-Control": VISITOR_RESPONSE_CACHE_CONTROL,
        "ETag": etag,
      },
    });
  }

  return Response.json(
    {
      stats: stats.stats,
      status_counts: stats.status_counts,
      range_days: VISITOR_WINDOW_DAYS,
      max_markers: MAX_VISITOR_MARKERS,
      markers: markers.markers,
    },
    {
      headers: {
        "Cache-Control": VISITOR_RESPONSE_CACHE_CONTROL,
        "ETag": etag,
      },
    },
  );
};
