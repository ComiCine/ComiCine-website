/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * The monitoring layer for `worker_runs` (migration 018).
 *
 * Migration 018 made two cron Workers record each run, but **nothing read that table**:
 * failures were stored without notifying anyone (`ops/check_blocklist_sync.py` is a manual
 * entry point with no automated callers). This file adds a reader: the status-worker daily
 * job (cron `47 3 * * *`, after archive `0 0 * * *` and sync `30 3 * * *`) reads the latest run
 * for each job and reports problems through the existing alert channel.
 *
 * Cost limits (see the D1 read budget in AGENTS.md):
 *   - Runs **once per day**, only in the `47 3 * * *` branch, never in the per-minute probe cron.
 *   - Each job uses one index seek and reads one row; this is not a range scan, `COUNT(*)`, or
 *     `IN (SELECT MAX(id) ... GROUP BY job)`.
 *
 *     Why not the latter, the most obvious way to get the latest row per job: production
 *     `EXPLAIN QUERY PLAN` showed a **SCAN** of `idx_worker_runs_job_started`; it read 10 rows
 *     when the table had only 6. The count grows with the table and violates the budget of a
 *     handful of rows per day. The current query read 2 rows for two jobs and scales with the
 *     number of jobs, independent of table size:
 *         SEARCH worker_runs USING INDEX idx_worker_runs_job_started (job=?)
 *
 *   - Sort only by `started_at DESC`, without `id DESC`. The index is `(job, started_at DESC)`;
 *     adding `id` prevents SQLite from satisfying ORDER BY from the index and makes it scan and
 *     sort every row for that job. Production measurements for the same job: `started_at DESC`
 *     read 1 row, adding `, id DESC` read 3 (the job had 3 rows), and `ORDER BY id DESC` read 7.
 *     See `lastRun` in `ops/sync-worker/src/runlog.ts`, which reads one row but sorts by both
 *     `started_at DESC` and `id DESC`.
 *
 * Fail open on every error: if the table is missing (migration not applied) or a read fails,
 * **log only and do not alert**. Never throw to the caller; the daily job still needs to run D1
 * retention cleanup.
 */

/**
 * Watched cron job names, matching the JOB constants that write to `worker_runs`:
 *   - `blocklist_sync`        ops/sync-worker/src/index.ts        (cron 30 3 * * *)
 *   - `d1_archive`            ops/d1-archive/src/index.ts        (cron 0 0 * * *)
 *   - `config_backup`         ops/d1-archive/src/config-backup.ts (same d1-archive cron)
 *   - `blocklist_sync_check`  manual records from `ops/check_blocklist_sync.py --record`; it is
 *     **intentionally excluded** because a manual check not being run is not a failure.
 *
 * This is a constant rather than `SELECT DISTINCT job`, which scans the whole index and reads
 * every row; this query reads one row per job. The tradeoff is that **every new job must be
 * added here**. Otherwise its failures remain unwatched, defeating the purpose of this file.
 */
export const WATCHED_JOBS = ["blocklist_sync", "d1_archive", "config_backup"] as const;

/**
 * Time in seconds after which a `running` job is considered stale.
 *
 * `started_at` is written on INSERT, so an active job remains `running`. Without a threshold,
 * a check that overlaps normal execution would alert incorrectly. Both cron jobs take seconds
 * in production (about 1 second for sync and tens of seconds for archive); two hours is far
 * longer than any normal run and catches only a genuinely stuck or terminated process.
 */
export const STALE_RUNNING_S = 2 * 3600;

/** Normal outcomes that do not require an alert. */
const HEALTHY_OUTCOMES = new Set(["ok", "skipped"]);

/** Maximum error summary length; alerts include only the summary, while the full value stays in the table. */
export const ERROR_SUMMARY_CHARS = 200;

export interface LatestRun {
  job: string;
  outcome: string;
  started_at: number;
  error: string | null;
}

export interface RunIssue {
  job: string;
  outcome: string;
  started_at: number;
  /** One-line alert detail: outcome, time, and error summary. */
  detail: string;
}

export interface LatestRunsResult {
  rows: LatestRun[];
  /** Read failure reason (missing table or network error). **An error value is not the same as no failed runs.** */
  error?: string;
}

/**
 * SQL for the latest row per job: one indexed `WHERE job = ?` + `LIMIT 1` seek for each job,
 * combined with `UNION ALL` into **one** statement (one prepare and one round trip; tests can
 * assert with a spy that the table is read only once).
 */
export function latestRunsSql(jobs: readonly string[] = WATCHED_JOBS): string {
  return jobs
    .map(
      (_job, i) =>
        "SELECT job, outcome, started_at, error FROM (" +
        "SELECT job, outcome, started_at, error FROM worker_runs " +
        `WHERE job = ?${i + 1} ORDER BY started_at DESC LIMIT 1)`,
    )
    .join(" UNION ALL ");
}

/**
 * Read the latest run for each job. Any failure, including a missing table, is returned in
 * `error`; never throw, so the caller can log it.
 */
export async function readLatestRuns(
  db: D1Database,
  jobs: readonly string[] = WATCHED_JOBS,
): Promise<LatestRunsResult> {
  try {
    const stmt = db.prepare(latestRunsSql(jobs));
    const res = await (jobs.length ? stmt.bind(...jobs) : stmt).all<LatestRun>();
    return { rows: res.results ?? [] };
  } catch (err) {
    return { rows: [], error: String(err).slice(0, 140) };
  }
}

/**
 * Format a timestamp as `2026-10-12 03:30` (UTC; requested on 2026-10-11).
 *
 * This is the **only timestamp format used in alerts**. `index.ts` `renderAlert` shares this
 * implementation; previously, formatting was duplicated and could drift. Keep leading zeroes
 * so lexicographic order matches chronological order and log or chat messages sort correctly.
 * Seconds are omitted because alerts and `ALERT_COOLDOWN_S` have minute-level precision. The
 * `UTC` suffix is also omitted because the site owner is the only reader and UTC is understood.
 */
export function formatUtc(epochSeconds: number): string {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) return "-";
  // `toISOString()` returns `2023-11-14T22:13:20.000Z`; take the first 16 characters and
  // replace `T` with a space to get `2023-11-14 22:13`. **Replace only `T`**; the previous
  // format also changed `:` to `-`.
  return new Date(epochSeconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** Flatten newlines and truncate the error summary so a full stack trace does not fill the alert. */
export function errorSummary(error: unknown): string {
  const flat = String(error ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "-";
  return flat.length > ERROR_SUMMARY_CHARS ? `${flat.slice(0, ERROR_SUMMARY_CHARS)}…` : flat;
}

/**
 * Decide whether the latest run should alert (pure function):
 *   - `ok` / `skipped`        → healthy (`skipped` due to missing sync credentials is expected)
 *   - `running` past threshold → issue (stuck or terminated; `finished_at` will never be set)
 *   - `running` within threshold → healthy (the job is still running)
 *   - Other values (`failed` or unknown) → issue; an unfamiliar outcome should alert rather
 *     than silently become unwatched.
 */
export function runIssues(
  rows: readonly LatestRun[],
  now: number,
  staleRunningS: number = STALE_RUNNING_S,
): RunIssue[] {
  const issues: RunIssue[] = [];
  for (const row of rows) {
    const outcome = String(row.outcome ?? "").trim().toLowerCase();
    if (HEALTHY_OUTCOMES.has(outcome)) continue;
    const startedAt = Number(row.started_at);
    if (outcome === "running" && now - startedAt < staleRunningS) continue;
    issues.push({
      job: row.job,
      outcome,
      started_at: startedAt,
      detail:
        `outcome=${outcome} · started ${formatUtc(startedAt)} · ` +
        `error: ${errorSummary(row.error)}`,
    });
  }
  return issues;
}
