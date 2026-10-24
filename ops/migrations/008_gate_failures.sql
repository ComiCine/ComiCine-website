-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.md.

-- Gate failure counts: on the third failed verification from one source within 24 hours, a Pages
-- Function blocks the source. Store only the HMAC of the IP; delete the row after a successful block.

CREATE TABLE IF NOT EXISTS gate_failures (
    ip_hash           TEXT PRIMARY KEY,
    failures          INTEGER NOT NULL DEFAULT 1,
    window_started_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Compact visitor statistics: keep one row and exact counts per hour, IP, page, and status.
CREATE TABLE IF NOT EXISTS visitor_rollups (
    bucket_hour INTEGER NOT NULL,
    ip_hash     TEXT NOT NULL DEFAULT '',
    country     TEXT NOT NULL DEFAULT '',
    status      INTEGER NOT NULL DEFAULT 0,
    page_slug   TEXT NOT NULL DEFAULT '',
    requests    INTEGER NOT NULL DEFAULT 1,
    last_ts     INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (bucket_hour, ip_hash, country, status, page_slug)
);

-- The following indexes are unused by production queries and increase write cost; keep primary-key and time indexes.
DROP INDEX IF EXISTS idx_ray_log_v2_host_ts;
DROP INDEX IF EXISTS idx_events_ip_hash_ts;
