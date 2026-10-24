-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Additional terms under Section 7 apply.
-- See ADDITIONAL_TERMS.md.

-- Limooo D1 data retention and privacy (docs/11).
--
-- Create v2 tables that do not store full IPs, user agents, or query strings. Keep the old
-- visitors and ray_log tables as read-only history; ops/prune_d1.py applies their retention later.

CREATE TABLE IF NOT EXISTS visitors_v2 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash     TEXT    NOT NULL DEFAULT '',
    country     TEXT    NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 0,
    ts          INTEGER NOT NULL DEFAULT (unixepoch()),
    page_slug   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_visitors_v2_ts ON visitors_v2 (ts);
CREATE INDEX IF NOT EXISTS idx_visitors_v2_ip_hash_ts ON visitors_v2 (ip_hash, ts);
CREATE INDEX IF NOT EXISTS idx_visitors_v2_page_slug_ts ON visitors_v2 (page_slug, ts);

CREATE TABLE IF NOT EXISTS ray_log_v2 (
    ray             TEXT    PRIMARY KEY,
    ts              INTEGER NOT NULL DEFAULT (unixepoch()),
    host            TEXT    NOT NULL DEFAULT '',
    normalized_path TEXT    NOT NULL DEFAULT '',
    method          TEXT    NOT NULL DEFAULT '',
    status          INTEGER NOT NULL DEFAULT 0,
    duration_ms     INTEGER NOT NULL DEFAULT 0,
    ip_hash         TEXT    NOT NULL DEFAULT '',
    country         TEXT    NOT NULL DEFAULT '',
    ua_family       TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ray_log_v2_ts ON ray_log_v2 (ts);
CREATE INDEX IF NOT EXISTS idx_ray_log_v2_host_ts ON ray_log_v2 (host, ts);

-- Long-term aggregate table: permanent retention; unique key is UTC day plus dimensions.
CREATE TABLE IF NOT EXISTS visitors_daily (
    day         TEXT NOT NULL,
    country     TEXT NOT NULL DEFAULT '',
    page_slug   TEXT NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 0,
    unique_ips  INTEGER NOT NULL DEFAULT 0,
    requests    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, country, page_slug, status)
);

CREATE INDEX IF NOT EXISTS idx_visitors_daily_day ON visitors_daily (day);

-- Prune/aggregation job state for alerts and failure tracking; stores no sensitive values.
CREATE TABLE IF NOT EXISTS retention_state (
    name             TEXT PRIMARY KEY,
    last_run_at      INTEGER NOT NULL DEFAULT 0,
    last_success_at  INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT NOT NULL DEFAULT ''
);

-- Add an events aggregation index on ip_hash + ts (same fields as 003; the schema contract is unchanged).
CREATE INDEX IF NOT EXISTS idx_events_ip_hash_ts ON events (ip_hash, ts);
