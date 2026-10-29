-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- Probes and heartbeats: replace Uptime Kuma (docs/17, phase 2).
--
-- The data model corresponds to Kuma's monitor / heartbeat tables, reduced to the minimum set:
--   probes         probe definitions (replaces Kuma's monitor table)
--   heartbeats     individual probe results (replaces Kuma's heartbeat table)
--   probe_state    current status and consecutive failure count (used for 10-second retries and alerts)
--
-- Retention: prune_d1 aggregates or deletes heartbeats as needed (see ops/prune_d1.py).

CREATE TABLE IF NOT EXISTS probes (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    type         TEXT    NOT NULL DEFAULT 'http',   -- http | d1
    target       TEXT,                              -- target URL for an HTTP probe
    group_key    TEXT    NOT NULL DEFAULT 'internal', -- public | internal
    interval_s   INTEGER NOT NULL DEFAULT 60,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS heartbeats (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    probe_id   INTEGER NOT NULL,
    ts         INTEGER NOT NULL,
    status     INTEGER NOT NULL,          -- 1 up / 0 down / 2 pending
    latency_ms INTEGER,
    msg        TEXT
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_probe_ts
    ON heartbeats (probe_id, ts DESC);

CREATE TABLE IF NOT EXISTS probe_state (
    probe_id         INTEGER PRIMARY KEY,
    last_status      INTEGER,
    consecutive_fail INTEGER NOT NULL DEFAULT 0,
    down_since       INTEGER,
    checked_at       INTEGER
);

-- Seed data based on the Kuma monitors observed in docs/17 §1.3, with duplicates removed.
-- Probe 2 checks a static-asset host in the same region. Do not probe the Worker's own domain;
-- Cloudflare blocks subrequests to the same zone. Migration 015 fills a missing probe target on
-- databases where this seed row already existed because INSERT OR IGNORE does not update rows.
INSERT OR IGNORE INTO probes (id, name, type, target, group_key, interval_s) VALUES
    (1, 'Website',      'http', 'https://comicine.com/_health',         'public',   60),
    (2, 'Edge Assets',  'http', 'https://images.comicine.com/_health',  'internal', 60),
    (3, 'D1 Health',    'd1',   NULL,                                'internal', 900);
