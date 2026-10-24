-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.md.

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
-- If the column already exists but schema_version lacks this migration, migrate_d1.sh skips that
-- duplicate-column statement and records the migration only after the remaining statements succeed.

ALTER TABLE worker_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;
