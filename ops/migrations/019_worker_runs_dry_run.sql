-- 019: worker_runs.dry_run distinguishes a simulated run from a real push.
--
-- Migration 018 did not include this column, so `GET /?dry-run=1` recorded a row with
-- outcome='ok' added=0 removed=0, indistinguishable from a completed real sync. This table exists
-- to answer whether a sync actually ran, so an audit log cannot contain two semantically
-- different events that look identical. Add a column to distinguish them.
--
-- Semantics:
--   dry_run = 1  calculated differences only; sent no write requests to Cloudflare
--   dry_run = 0  real sync (used by both cron and GET /)
--
-- Existing rows written between migrations 018 and 019 default to 0 because they came from real
-- syncs or archives.
--
-- Use the same error handling as migrations 014 and 016: SQLite ADD COLUMN only appends, and if
-- the column already exists, migrate_d1.sh treats `duplicate column name` as "already applied",
-- records 19001, and continues the migration chain.

ALTER TABLE worker_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;
