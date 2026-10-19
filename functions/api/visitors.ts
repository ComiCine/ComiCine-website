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
 * GET /api/visitors
 *
 * Requires an admin session and reads aggregate data from D1. To protect privacy, this endpoint
 * returns only ip_hash, not full IP addresses. Use the single-record endpoint
 * `GET /api/visitors/<ip_hash>/ip` to view a visitor's real IP; it decrypts only after the row is clicked.
 * The frontend filters statuses locally, so the main frontend calls this endpoint without a status parameter.
 * `?status=<3-digit number>` remains available for deep links and external callers.
 *
 * Query range: combine the new visitor_rollups with pre-migration visitors_v2 details to cover the last 30 days.
 * Rollups condense each hour/IP/page/status group into one row while requests remains the exact request count.
 */

import { queryAll } from "../_lib/d1";
import { requireAdminSession } from "../_lib/session";
import type { Env } from "../_lib/env";

const VISITOR_WINDOW_DAYS = 30;
const VISITOR_WINDOW_SECONDS = VISITOR_WINDOW_DAYS * 24 * 60 * 60;
const MAX_VISITOR_MARKERS = 500;

/**
 * Cache query results for 300 seconds, matching the AGENTS.md rule that pages must not poll D1 more often than every five minutes.
 *
 * The frontend polls every 600 seconds, so the 300-second cache mainly absorbs duplicate requests
 * within the same window (multiple tabs, manual refreshes, or external crawlers). The tradeoff is that
 * admins may wait up to five minutes to see new visitors; the user has accepted this to avoid one page
 * consuming the entire daily read quota.
 */
const VISITOR_CACHE_CONTROL = "public, max-age=300";
const VISITOR_RESPONSE_CACHE_CONTROL = "private, no-store";
const VISITOR_CACHE_SECONDS = 300;

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

function buildMarkers(rows: MarkerRow[]): Array<{
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
}> {
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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request, "无权限");
  if (auth instanceof Response) return auth;

  const url = new URL(context.request.url);
  const statusParam = url.searchParams.get("status");
  if (statusParam !== null && !/^\d{3}$/.test(statusParam)) {
    return Response.json(
      { error: "无效的 status 参数，应为三位数字" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const statusNum = statusParam === null ? null : Number(statusParam);

  // In-process cache (300 seconds).
  // One query reads about 131,000 rows in production (see the SQL comment below). The admin page polls
  // every 600 seconds, or about 144 times per day, approaching the Free plan's 5,000,000-row daily limit
  // and repeating the pattern of the 2026-09-17 incident. Results for the same request URL (including
  // status filters) are identical for five minutes, so caching only suppresses duplicate reads.
  //
  // Authentication runs before the cache, whose key does not include identity. This is not an authorization
  // cache: requests that fail the admin check never reach this code and are never cached.
  const cacheKeyUrl = new URL(url.toString());
  cacheKeyUrl.searchParams.set("__cache", String(VISITOR_CACHE_SECONDS));
  const cache = typeof caches !== "undefined"
    ? (caches as unknown as { default?: VisitorCacheLike }).default
    : undefined;
  if (cache) {
    const hit = await cache.match(new Request(cacheKeyUrl));
    if (hit) {
      const headers = new Headers(hit.headers);
      headers.set("Cache-Control", VISITOR_RESPONSE_CACHE_CONTROL);
      return new Response(hit.body, {
        status: hit.status,
        statusText: hit.statusText,
        headers,
      });
    }
  }

  const cutoff = Math.floor(Date.now() / 1000) - VISITOR_WINDOW_SECONDS;

  // Query 1: global statistics and the full status distribution. Use the same 30-day window so the
  // status distribution matches the summary statistics.
  //
  // Performance constraint (D1 Free plan: 5M rows/day): combine four metrics into two scans,
  // one outer aggregate and one status distribution. The previous version used separate subqueries
  // for COUNT(DISTINCT), SUM, and COUNT(DISTINCT), scanning the 30-day window five times. This was
  // the main cause of hitting the daily read limit in 2026-09.
  const statsRows = await queryAll<StatsRow>(
    context.env.DB,
    `WITH scoped AS (
        SELECT ip_hash, country, status, ts, 1 AS requests
        FROM visitors_v2
        WHERE ts >= ?
        UNION ALL
        SELECT ip_hash, country, status, last_ts AS ts, requests
        FROM visitor_rollups
        WHERE last_ts >= ?
     )
     SELECT
       COUNT(DISTINCT ip_hash) AS ips,
       COALESCE(SUM(requests), 0) AS requests,
       COUNT(DISTINCT country) AS countries,
       (SELECT GROUP_CONCAT(status || ':' || n, ',') FROM (
          SELECT status, SUM(requests) AS n FROM scoped GROUP BY status ORDER BY status
       )) AS status_series
     FROM scoped`,
    cutoff,
    cutoff,
  );

  // Query 2: list the 500 most recent IP hashes and each IP's status distribution.
  // Select the top 500 first, then group by ip_hash and status to fetch all rows needed to build markers.
  //
  // The filtered and unfiltered queries differ only by `AND status = ?`, so build one SQL string
  // with interpolation. statusFilter is derived from whether statusNum is empty, not from user input,
  // using the same pattern as `${MAX_VISITOR_MARKERS}` above without adding an injection vector.
  //
  // Use the country from the **most recent** visit. Do not use MAX(country): it sorts alphabetically,
  // not by time, so visitors with both CN and CH would always show CN. One IP appearing in multiple
  // countries is normal because Cloudflare may report different locations for proxy or relay ranges.
  // Implementation notes, measured on production D1:
  //   - top already contains each IP's last_ts; join back to scoped to fetch that row's country (131,000 rows read).
  //   - Do not use a correlated subquery (SELECT s2.country ... ORDER BY ts DESC LIMIT 1; 13.7M rows),
  //     NOT EXISTS (7.53M rows), or ROW_NUMBER() over all partitions (175,000 rows). The Free plan limit is 5M rows/day.
  const statusFilter = statusNum === null ? "" : " AND status = ?";
  const markerSql = `WITH scoped AS (
         SELECT ip_hash, country, status, ts, 1 AS requests
         FROM visitors_v2
         WHERE ts >= ?${statusFilter}
         UNION ALL
         SELECT ip_hash, country, status, last_ts AS ts, requests
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

  const markerParams: unknown[] = statusNum === null
    ? [cutoff, cutoff]
    : [cutoff, statusNum, cutoff, statusNum];
  const markerRows = await queryAll<MarkerRow>(context.env.DB, markerSql, ...markerParams);

  const stats = statsRows[0] ?? { ips: 0, requests: 0, countries: 0, status_series: null };
  const statusCounts = parseStatusSeries(stats.status_series);

  const response = Response.json(
    {
      stats: { total_ips: stats.ips, total_requests: stats.requests, countries: stats.countries },
      status_counts: statusCounts,
      range_days: VISITOR_WINDOW_DAYS,
      max_markers: MAX_VISITOR_MARKERS,
      markers: buildMarkers(markerRows),
    },
    { headers: { "Cache-Control": VISITOR_RESPONSE_CACHE_CONTROL } },
  );
  if (cache) {
      // A failed put must not turn the request into a 500; caching is only an optimization.
    try {
      const cached = response.clone();
      cached.headers.set("Cache-Control", VISITOR_CACHE_CONTROL);
      await cache.put(new Request(cacheKeyUrl), cached);
    } catch {
      // Ignore the failure; the next request will query the source as usual.
    }
  }
  return response;
};
