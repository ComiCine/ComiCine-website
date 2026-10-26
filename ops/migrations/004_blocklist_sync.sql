-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- ComiCine docs/10: single source of truth for blocking (D1 -> Cloudflare IP List).
-- Apply with: wrangler d1 execute limooo --file=./migrations/004_blocklist_sync.sql
-- Back up D1 before applying: this migration rebuilds the old blocked_ips table with a new schema.

DROP TABLE IF EXISTS blocked_ips_new;

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
