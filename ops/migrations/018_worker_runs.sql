-- 018: worker_runs records each Cron Worker run so failures are visible.
--
-- Background (observed 2026-10-11): the scheduled() handlers for limooo-blocklist-sync and
-- limooo-d1-archive both called `ctx.waitUntil(asyncWork(env))`. waitUntil silently swallowed
-- promise rejections, while Cloudflare's cron panel still reported "ran/succeeded". No one could
-- detect a real sync failure without manually inspecting Workers logs or R2.
--
-- This table provides the missing record: one row per job run, for both successes and failures;
-- failures include error text. Reads occur only in the operations script
-- (ops/check_blocklist_sync.py) and the Worker's health endpoint. The Worker's hot paths (sync and
-- archive) never query it, preserving the D1 read budget (see the D1 read budget in AGENTS.md).
--
-- Write volume: one row/day for blocklist_sync (cron 30 3 * * *) and one row/day for d1_archive
-- (cron 0 0 * * *), plus manual runs from operations scripts. Each run performs one INSERT + one UPDATE.
--
-- The job column lets both Workers share one table instead of duplicating schemas. One query can
-- group by job and show the latest result for each task.
--
-- Write contract (shared by both Workers; see ops/sync-worker/src/runlog.ts):
--   started_at     written at INSERT time (outcome='running', finished_at is NULL)
--   outcome        updated to ok or failed; early returns for missing credentials use skipped
--   added/removed  incremental item counts for this run, or NULL when not applicable
-- Write failures are always fail-open: log with console.error and do not affect the sync/archive run.
--
-- Idempotent: every statement uses CREATE ... IF NOT EXISTS and can be rerun.

CREATE TABLE IF NOT EXISTS worker_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job         TEXT    NOT NULL DEFAULT 'blocklist_sync',
    started_at  INTEGER NOT NULL,
    finished_at INTEGER,
    outcome     TEXT    NOT NULL DEFAULT 'running',
    added       INTEGER,
    removed     INTEGER,
    error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_runs_job_started
    ON worker_runs (job, started_at DESC);
