-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.md.

-- 011: Reduce daily D1 row reads (fix for hitting the free-plan 5M rows/day limit on 2026-09-17).
--
-- Observed: rows_read_24h = 7,882,267 (limit 5,000,000), while rows_written was 24k and the DB
-- was 19 MB, both well below their limits. Only row reads exceeded the limit. Page polling
-- amplified two full scans by more than 1,000 times:
--   1. The visitor page polled /api/visitors every 60 seconds; the endpoint aggregated a 30-day
--      window in 4-5 full scans.
--   2. The status page reloaded every 60 seconds and counted seven days of heartbeats (~60k rows).
--
-- This migration changes structure only to reduce reads in existing queries; query semantics stay the same.

-- 1) Visitor statistics use a covering index, so timestamp-range scans do not need table lookups
--    for ip_hash/country/status.
CREATE INDEX IF NOT EXISTS idx_visitors_v2_ts_cover
  ON visitors_v2 (ts, ip_hash, country, status);

CREATE INDEX IF NOT EXISTS idx_visitor_rollups_last_ts_cover
  ON visitor_rollups (last_ts, ip_hash, country, status);

-- 2) Aggregate probe uptime by day. The status page reads only this table (up to seven rows per
--    probe) instead of scanning heartbeats. day is a Unix timestamp floored to a multiple of 86400,
--    which makes numeric retention cleanup straightforward.
CREATE TABLE IF NOT EXISTS probe_uptime_daily (
  probe_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  up INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (probe_id, day)
);

-- 3) Include heartbeats in 30-day retention cleanup; a single-column ts index makes DELETE inexpensive.
CREATE INDEX IF NOT EXISTS idx_heartbeats_ts ON heartbeats (ts);
