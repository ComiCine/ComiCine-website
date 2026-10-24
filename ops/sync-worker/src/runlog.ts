/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Shared library for `worker_runs` records (schema in ops/migrations/018_worker_runs.sql).
 *
 * This module exists because limooo-blocklist-sync and limooo-d1-archive both use
 * `ctx.waitUntil(asyncWork(env))`, which silently swallows promise rejections and leaves no trace
 * on failure. Both Workers must write the same record shape, or operations scripts would need two
 * parsers. Keep the implementation here once and let d1-archive import it directly; Wrangler
 * bundles imported modules. Sharing across directories is preferable to maintaining a duplicate
 * that would inevitably drift.
 *
 * D1 read-budget rules (see AGENTS.md):
 *   - Writes: one INSERT + one UPDATE per job run, or one row per day at cron frequency.
 *   - Reads: only the Worker's `?health=1` endpoint and ops/check_blocklist_sync.py read this table;
 *     job hot paths (sync and archive) never do.
 *   - The (job, started_at DESC) index matches the health query's `WHERE job = ? ORDER BY
 *     started_at DESC LIMIT 1`, so it reads one row.
 *
 * Failure semantics: no function in this file throws, except lastRun, whose errors are handled by
 * the caller. Write failures only use console.error; a record-keeping failure must not become a
 * sync/archive failure.
 */

/** Matches the columns in ops/migrations/018_worker_runs.sql one for one. */
export interface RunRow {
  id: number;
  job: string;
  started_at: number;
  finished_at: number | null;
  outcome: string;
  added: number | null;
  removed: number | null;
  error: string | null;
  /** 1 = differences were calculated without sending Cloudflare write requests (`?dry-run=1`). */
  dry_run: number;
}

export interface RunUpdate {
  finishedAt: number;
  outcome: string;
  added?: number;
  removed?: number;
  error?: string | null;
  dryRun?: boolean;
}

/**
 * Declare only the D1 shape used by the Worker, to simplify test stubs.
 *
 * It must remain structurally compatible with D1PreparedStatement in ops/workers.d.ts, or
 * D1Database cannot be assigned to RunDatabase (tsc reports an incompatible prepare() return).
 * Mark results/success optional on all() so the type accepts both real D1Result<T> values and
 * test stubs with only some fields. run() returns Promise<unknown> rather than Promise<D1Result>
 * because callers do not inspect its result.
 */
interface RunStatement {
  bind(...values: unknown[]): RunStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success?: boolean }>;
  run(): Promise<unknown>;
}

/** Declare only the D1 shape the Worker uses, to simplify test stubs. */
export interface RunDatabase {
  prepare(sql: string): RunStatement;
}

/** Run-record timestamps use UTC epoch seconds, matching the other D1 tables. */
export function runStartedAt(now = Date.now()): number {
  return Math.floor(now / 1000);
}

/** Structured log for write failures, including job and stage for searching Workers Logs. */
function logRunStoreError(job: string, stage: string, error: unknown): void {
  console.error(
    JSON.stringify({
      event: "worker_run_store_error",
      job,
      stage,
      outcome: "failed",
      error: String(error),
    }),
  );
}

/**
 * Record the start of a run: outcome='running', finished_at=NULL.
 *
 * Return the row ID for the final update; return null on write failure so the caller can continue syncing.
 */
export async function insertRun(
  db: RunDatabase,
  job: string,
  startedAt = runStartedAt(),
): Promise<number | null> {
  try {
    const result = await db
      .prepare(
        `INSERT INTO worker_runs (job, started_at, outcome)
         VALUES (?, ?, 'running')
         RETURNING id`,
      )
      .bind(job, startedAt)
      .all<{ id: number }>();
    const id = result?.results?.[0]?.id;
    return typeof id === "number" ? id : null;
  } catch (error) {
    logRunStoreError(job, "insert", error);
    return null;
  }
}

/** Update the final status; skip if runId is null because the insert failed. */
export async function updateRun(
  db: RunDatabase,
  runId: number | null,
  update: RunUpdate,
): Promise<boolean> {
  if (runId === null || runId === undefined) return false;
  try {
    await db
      .prepare(
        `UPDATE worker_runs
            SET finished_at = ?, outcome = ?, added = ?, removed = ?, error = ?, dry_run = ?
          WHERE id = ?`,
      )
      .bind(
        update.finishedAt,
        update.outcome,
        update.added ?? null,
        update.removed ?? null,
        update.error === undefined ? null : update.error,
        update.dryRun ? 1 : 0,
        runId,
      )
      .run();
    return true;
  } catch (error) {
    logRunStoreError(String(update.outcome), "update", error);
    return false;
  }
}

/**
 * Read the latest run record (one row per job).
 *
 * Unlike the other functions, this one throws errors. In a health response, lastRun=null can mean
 * either that the table is missing (migration 018 was not applied) or that the query failed. The
 * caller needs the exception to report these accurately instead of treating both as "no record".
 * The query uses idx_worker_runs_job_started and reads one row.
 */
export async function lastRun(db: RunDatabase, job: string): Promise<RunRow | null> {
  const result = await db
    .prepare(
      `SELECT id, job, started_at, finished_at, outcome, added, removed, error, dry_run
         FROM worker_runs
        WHERE job = ?
        ORDER BY started_at DESC, id DESC
        LIMIT 1`,
    )
    .bind(job)
    .all<RunRow>();
  return result?.results?.[0] ?? null;
}
