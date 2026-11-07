-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- ComiCine docs/10: single source of truth for blocking (D1 -> Cloudflare IP List).
-- Apply with: bash ops/migrate_d1.sh --remote   (do not apply this file on its own)
-- Back up D1 before applying: this migration rebuilds the old blocked_ips table with a new schema.
--
-- Replay-safe order. The original file dropped blocked_ips_new before rebuilding it, so a replay
-- after DROP TABLE blocked_ips but before the rename could delete the only surviving copy. This
-- version creates the new table (never drops it), copies rows first, and only then drops the old
-- table. A replay therefore either completes or stops at the failed SELECT before deleting data; in
-- particular a replay without blocked_ips leaves blocked_ips_new untouched.
--
-- That guarantee depends on an executor that stops at the first failed statement. Never apply this
-- file with `wrangler d1 execute --file` or any continue-on-error client: after a failed SELECT they
-- still execute the DROP and replace the table with the rows copied so far. The only supported path
-- is `bash ops/migrate_d1.sh --remote`.
--
-- The copy reads the legacy note/added_at columns, so this file is the legacy-to-004 path only.
-- A database that already has the post-004 schema but no schema_version row (an interrupted run)
-- has no note/added_at; migrate_d1.sh detects that state and makes it run the idempotent tail in
-- ops/migrations/repair/004_blocklist_sync_post004.sql via --repair.
--
-- A legacy row whose cidr is NULL cannot satisfy network NOT NULL and is skipped by INSERT OR IGNORE.
-- The old migration had the same limitation; check the table before a first-time run if such rows are
-- possible (the admin API never writes one).

CREATE TABLE IF NOT EXISTS blocked_ips_new (
    cidr        TEXT PRIMARY KEY,
    network     TEXT NOT NULL,
    prefix      INTEGER NOT NULL,
    reason      TEXT DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'auto_block',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by  TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1
);

-- Migrate old data: fill the new fields and treat all legacy rows as originating from auto_block.
-- INSERT OR IGNORE keeps a partial copy from an earlier interrupted run and fills the missing rows.
INSERT OR IGNORE INTO blocked_ips_new
    (cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active)
SELECT
    c.cidr,
    CASE WHEN instr(c.cidr, '/') > 0
         THEN substr(c.cidr, 1, instr(c.cidr, '/') - 1)
         ELSE c.cidr
    END,
    CASE WHEN instr(c.cidr, '/') > 0
         THEN CAST(substr(c.cidr, instr(c.cidr, '/') + 1) AS INTEGER)
         WHEN instr(c.cidr, ':') > 0 THEN 128
         ELSE 32
    END,
    COALESCE(c.note, ''),
    'auto_block',
    COALESCE(c.added_at, datetime('now')),
    datetime('now'),
    'migration:004',
    1
FROM blocked_ips c;

-- A retry may find rows copied by an earlier interrupted attempt. Keep the copy, but drop rows
-- whose cidr is no longer in the legacy table so the rebuild is exactly the current blocklist.
-- The count guard is load-bearing: when blocked_ips is an empty stub and blocked_ips_new holds the
-- only copy (an operator-created variant of the dangerous state), NOT IN () would delete every row.
-- NOT EXISTS also keeps a NULL cidr in the legacy table from disabling the cleanup through SQL's
-- three-valued logic. This statement is only reached after the SELECT above succeeded.
DELETE FROM blocked_ips_new
WHERE (SELECT COUNT(*) FROM blocked_ips) > 0
  AND NOT EXISTS (SELECT 1 FROM blocked_ips c WHERE c.cidr = blocked_ips_new.cidr);

DROP TABLE IF EXISTS blocked_ips;
ALTER TABLE blocked_ips_new RENAME TO blocked_ips;

CREATE INDEX IF NOT EXISTS idx_blocked_ips_network_prefix
    ON blocked_ips (network, prefix);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_active
    ON blocked_ips (active, updated_at);

-- Admin API audit table: preserve the actor, time, and before/after values for blocks and unblocks.
CREATE TABLE IF NOT EXISTS blocklist_audit (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    cidr               TEXT NOT NULL,
    network            TEXT NOT NULL,
    prefix             INTEGER NOT NULL,
    action             TEXT NOT NULL,
    actor              TEXT NOT NULL DEFAULT '',
    reason             TEXT DEFAULT '',
    source             TEXT DEFAULT '',
    previous_reason    TEXT DEFAULT '',
    previous_source    TEXT DEFAULT '',
    previous_updated_at TEXT DEFAULT '',
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blocklist_audit_cidr_ts
    ON blocklist_audit (cidr, created_at);
CREATE INDEX IF NOT EXISTS idx_blocklist_audit_action_ts
    ON blocklist_audit (action, created_at);
