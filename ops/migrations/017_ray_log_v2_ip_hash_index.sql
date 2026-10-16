-- 017: Add an (ip_hash, ts) index to ray_log_v2 (implementation of docs/22 W7-9).
--
-- Background: ray_log_v2 is a seven-day detail table that previously had only
-- idx_ray_log_v2_ts. Queries filtered by ip_hash had to scan the entire index. The affected
-- callers are diagnostic scripts and endpoints:
--
--   ops/check_ip_rays.py:168      ... FROM ray_log_v2 WHERE ip_hash IN (...) ORDER BY ts DESC LIMIT n
--   ops/check_visitor_id.py:212   ... FROM ray_log_v2 WHERE ip_hash = '...' ORDER BY ts DESC LIMIT n
--   functions/api/ray/[id].ts:48  ... FROM ray_log_v2 WHERE ray LIKE '...' ORDER BY ts DESC LIMIT 100
--   ops/check_ray_id.py:121       ... FROM ray_log_v2 WHERE ray LIKE '...' ORDER BY ts DESC LIMIT 100
--
-- Production measurements from 2026-10-11 (wrangler d1 execute limooo --remote):
--   ray_log_v2   = 2,337 rows; visitor_rollups = 7,270 rows
--   EXPLAIN QUERY PLAN before this change:
--     SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts          ← ip_hash = / IN (...)
--     SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts          ← ray LIKE '...'
--
-- This index changes the first query to SEARCH ... USING INDEX idx_ray_log_v2_ip_hash_ts (ip_hash=?).
-- Specify DESC to match both queries' ORDER BY ts DESC, allowing SQLite to read directly from the
-- index without building a temporary B-tree for sorting.
--
-- Retention-friendly: prune_d1.py and status-worker delete ray_log_v2 rows by ts, so the index
-- shrinks with the table instead of growing indefinitely.

CREATE INDEX IF NOT EXISTS idx_ray_log_v2_ip_hash_ts
  ON ray_log_v2 (ip_hash, ts DESC);

-- This migration does not restore idx_ray_log_v2_host_ts (host, ts). It was added in
-- 005_retention.sql:33 and intentionally removed in 008_gate_failures.sql:23-25 because no
-- production query used it and it increased the cost of every write; primary-key/time indexes
-- were kept. This remains true: every ray_log_v2 query in functions/ and ops/ filters by ts,
-- ip_hash, or ray. host appears only in selected columns (d1-archive snapshots, check_* rendering,
-- and api/ray responses); no query filters by host. Do not restore an index that adds write cost
-- without helping a query.
--
-- Note on why this cannot be added by editing migration 005: production schema_version records
-- 005 as the legacy plain version 5, predating the version*1000+sequence key format. migrate_d1.sh
-- skips all of 005 with `skip (recorded legacy version 5)`, so even CREATE INDEX IF NOT EXISTS in
-- 005 would never run. Add the index through a new numbered migration, as done here.
