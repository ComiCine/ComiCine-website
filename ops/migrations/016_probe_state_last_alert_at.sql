-- 016: Add the missing probe_state.last_alert_at column for down-alert cooldowns.
--
-- This column had previously been added manually to production without a repository migration.
-- The probe_state table in 009_probes.sql contains only probe_id / last_status / consecutive_fail /
-- down_since / checked_at, but maybeAlert() in ops/status-worker/src/index.ts reads and writes it.
--   SELECT last_alert_at FROM probe_state WHERE probe_id = ?1
--   UPDATE probe_state SET last_alert_at = ?2 WHERE probe_id = ?1
-- Evidence: the table definition in ops/backups/d1-limooo-20260926-062521.sql ends with
-- `, last_alert_at INTEGER);`, confirming the column was added manually in production.
--
-- Consequence: a new database built from ops/migrations/ lacks this column. The SELECT fails and
-- maybeAlert() silently catches it, disabling alert cooldown and sending repeated mail during probe flaps.
--
-- D1 schema_version determines whether a migration was applied (key = version*1000+sequence;
-- this migration uses 16001). The local .d1-migrations/applied file is only an offline-plan cache
-- and does not determine whether to skip. migrate_d1.sh applies statements individually, skips only
-- a duplicate-column statement, and records the migration after every remaining statement succeeds.

ALTER TABLE probe_state ADD COLUMN last_alert_at INTEGER;
