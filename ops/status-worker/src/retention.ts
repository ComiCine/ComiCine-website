/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * D1 retention job, migrated from the VPS `ops/prune_d1.py` (tasks/17, stage 6).
 *
 * The VPS cron no longer exists after retirement. Without this migration, D1 would grow
 * indefinitely until it reached the per-database limit.
 *
 * **This file owns the retention policy** (tasks/22 W7-8) and is the version scheduled by cron.
 * `ops/readme_facts.py` and `ops/prune_d1.py` both read their windows from here; at import,
 * `prune_d1.py` compares each value with this file and fails on any mismatch, preventing drift.
 *
 * Note: `prune_d1.py` also aggregates visitor details into `visitors_daily` as a manual task.
 * This file handles **daily pruning** only, the critical path for preventing unbounded growth.
 */

export const DAY_SECONDS = 86_400;

/** Table to retention window in seconds; this is the source used by `ops/prune_d1.py` too. */
export const BUCKETS: Record<string, number> = {
  ray_log_v2: 7 * DAY_SECONDS,
  visitors_v2: 30 * DAY_SECONDS,
  visitor_rollups: 30 * DAY_SECONDS,
  events: 90 * DAY_SECONDS,
  // Three heartbeats per minute would grow without bound and slow status and troubleshooting queries.
  heartbeats: 30 * DAY_SECONDS,
  // Keep daily uptime summaries for 90 days; the status page shows at most 7 days.
  probe_uptime_daily: 90 * DAY_SECONDS,
  // Each login creates one row (`createAuthSession` in `functions/identity/callback.ts`), and there was no
  // cleanup path. Keep rows for 60 days, **longer than** `session_ttl_seconds` (30 days in
  // `config-contract.json`), or a still-valid signed session could be deleted and logged out.
  auth_sessions: 60 * DAY_SECONDS,
  // Identity codes are valid for two minutes; keep only a day of unconsumed handoffs.
  identity_handoffs: 1 * DAY_SECONDS,
};

/** Timestamp columns that differ from the default. */
export const TIMESTAMP_COLUMNS: Record<string, string> = {
  visitor_rollups: "last_ts",
  probe_uptime_daily: "day",
  auth_sessions: "exp",
  identity_handoffs: "expires_at",
};

export interface PruneResult {
  table: string;
  deleted: number;
  cutoff: number;
  error?: string;
}

/** Prune expired rows table by table; a failure in one table does not affect the others. */
export async function runRetention(
  env: { DB: D1Database },
  now = Math.floor(Date.now() / 1000),
): Promise<PruneResult[]> {
  const results: PruneResult[] = [];
  for (const [table, windowSeconds] of Object.entries(BUCKETS)) {
    const column = TIMESTAMP_COLUMNS[table] ?? "ts";
    const cutoff = now - windowSeconds;
    try {
      const res = await env.DB.prepare(
        `DELETE FROM ${table} WHERE ${column} < ?1`,
      )
        .bind(cutoff)
        .run();
      results.push({ table, deleted: res.meta?.changes ?? 0, cutoff });
    } catch (err) {
      results.push({ table, deleted: 0, cutoff, error: String(err).slice(0, 140) });
    }
  }
  console.log(JSON.stringify({ event: "d1_retention", results }));
  return results;
}
