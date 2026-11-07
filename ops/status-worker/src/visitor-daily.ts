/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Daily aggregation of visitor details into `visitors_daily`.
 *
 * `/api/visitors` reads its 30-day statistics from `visitors_daily` instead of scanning
 * `visitors_v2` + `visitor_rollups`, so the aggregate table has to keep moving forward on its own.
 * Before this module, `visitors_daily` was written only by the **manual**
 * `ops/prune_d1.py --mode aggregate --apply`; without a daily job the statistics would freeze as
 * soon as nobody ran that command. The status Worker now runs this aggregation from the same
 * `47 3 * * *` cron as retention.
 *
 * Why the same SQL exists twice: `ops/prune_d1.py` remains the manual/backfill entry point (an
 * operator can run it from any machine, against any account), while this module is what the cron
 * actually executes inside the Worker. TypeScript cannot import Python, so the two copies are kept
 * in lockstep by hand: the window definition, the deduplication key, and the monotonic upsert must
 * stay semantically identical to `_aggregate_sql` in `ops/prune_d1.py`. Change both together.
 *
 * `VISITOR_DAILY_AGGREGATE_DAYS` mirrors `AGGREGATE_COMPLETE_DAYS` in `ops/prune_d1.py`: seven
 * complete UTC days give the cron room to repair after a short downtime without rereading more
 * rows than the D1 read budget allows (see AGENTS.md).
 */

import { DAY_SECONDS } from "./retention";

/** Complete UTC days to aggregate per run; mirrors AGGREGATE_COMPLETE_DAYS in ops/prune_d1.py. */
export const VISITOR_DAILY_AGGREGATE_DAYS = 7;

/** Current UTC midnight: floor the unix timestamp to a multiple of one day. */
function dayStartExpr(): string {
  return `(unixepoch() / ${DAY_SECONDS}) * ${DAY_SECONDS}`;
}

/**
 * Build the `visitors_daily` upsert covering only **complete** UTC days, never today.
 *
 * `ops/prune_d1.py::_aggregate_sql` builds the same statement; keep the two in lockstep. A rolling
 * 24-hour window would recompute yesterday from a partial day, which is why the window is
 * `[UTC midnight - days * 86400, UTC midnight)`. The upsert uses `MAX(...)` rather than
 * `INSERT OR REPLACE`, so a rerun can never lower a count that is already recorded.
 */
export function visitorDailyAggregateSql(days = VISITOR_DAILY_AGGREGATE_DAYS): string {
  const start = `${dayStartExpr()} - ${days * DAY_SECONDS}`;
  const end = dayStartExpr();
  return (
    "INSERT INTO visitors_daily " +
    "(day, country, page_slug, status, unique_ips, requests) " +
    "WITH combined AS (" +
    "SELECT ts, ip_hash, country, page_slug, status, 1 AS requests, " +
    "'v:' || id AS fallback_id FROM visitors_v2 " +
    `WHERE ts >= ${start} AND ts < ${end} UNION ALL ` +
    "SELECT last_ts AS ts, ip_hash, country, page_slug, status, requests, " +
    "'r:' || bucket_hour || ':' || country || ':' || status || ':' || page_slug AS fallback_id " +
    "FROM visitor_rollups " +
    `WHERE last_ts >= ${start} AND last_ts < ${end}) ` +
    "SELECT strftime('%Y-%m-%d', ts, 'unixepoch'), country, page_slug, status, " +
    "COUNT(DISTINCT CASE WHEN ip_hash <> '' THEN ip_hash ELSE fallback_id END), SUM(requests) " +
    "FROM combined " +
    "GROUP BY strftime('%Y-%m-%d', ts, 'unixepoch'), country, page_slug, status " +
    "ON CONFLICT (day, country, page_slug, status) DO UPDATE SET " +
    "unique_ips = MAX(unique_ips, excluded.unique_ips), " +
    "requests = MAX(requests, excluded.requests)"
  );
}

/**
 * Run the aggregation as exactly one statement. Never throws: a failed aggregate must not abort
 * retention or the daily checks that follow it in the same cron branch. Returns whether it ran.
 */
export async function runVisitorDailyAggregate(
  env: { DB: D1Database },
  days = VISITOR_DAILY_AGGREGATE_DAYS,
): Promise<boolean> {
  try {
    await env.DB.prepare(visitorDailyAggregateSql(days)).run();
    console.log(JSON.stringify({ event: "visitor_daily_aggregate", days, ok: true }));
    return true;
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "visitor_daily_aggregate",
        days,
        ok: false,
        error: String(err).slice(0, 140),
      }),
    );
    return false;
  }
}
