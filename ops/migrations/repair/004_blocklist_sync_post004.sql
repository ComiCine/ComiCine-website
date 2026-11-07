-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- ComiCine recovery tail for an interrupted 004_blocklist_sync migration.
--
-- Not a versioned migration and not picked up by the normal migration loop: ops/migrate_d1.sh
-- runs it only from --repair, after checking that blocked_ips already has the post-004 schema,
-- blocked_ips_new is absent or empty, and schema_version has no 004_blocklist_sync row (key 4002).
--
-- It reads only post-004 columns, so it is idempotent in that state: every value is copied through
-- unchanged, and a rerun after an interruption repeats the same safe copy/swap. Like the main
-- migration it never drops a table before the copy succeeds, so a replay in the dangerous state
-- (blocked_ips_new exists, blocked_ips missing) stops at the SELECT with the copy intact.
--
-- Apply it only through `bash ops/migrate_d1.sh --repair --remote`. `wrangler d1 execute --file` and
-- continue-on-error clients keep going after a failed SELECT and would then run the DROP.
--
-- If the repair was interrupted after this INSERT but before the DROP, both tables hold the rows.
-- --repair refuses that ambiguous state on purpose; when blocked_ips is the complete post-004 table
-- and blocked_ips_new is only the interrupted copy, DROP TABLE blocked_ips_new and rerun --repair.

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

INSERT OR IGNORE INTO blocked_ips_new
    (cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active)
SELECT
    c.cidr,
    c.network,
    c.prefix,
    COALESCE(c.reason, ''),
    COALESCE(NULLIF(c.source, ''), 'auto_block'),
    COALESCE(NULLIF(c.created_at, ''), datetime('now')),
    COALESCE(NULLIF(c.updated_at, ''), datetime('now')),
    COALESCE(c.updated_by, ''),
    COALESCE(c.active, 1)
FROM blocked_ips c;

DROP TABLE IF EXISTS blocked_ips;
ALTER TABLE blocked_ips_new RENAME TO blocked_ips;

CREATE INDEX IF NOT EXISTS idx_blocked_ips_network_prefix
    ON blocked_ips (network, prefix);
CREATE INDEX IF NOT EXISTS idx_blocked_ips_active
    ON blocked_ips (active, updated_at);

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
