-- Limooo D1 visitor status filter indexes (docs/15).
--
-- Keep the ?status=<3-digit number> compatibility parameter for /api/visitors. Add composite
-- indexes on (status, ts) and (status, ip_hash, ts) to visitors_v2 to avoid full scans when filtering.
-- Add indexes only; do not remove existing ones. Repeated application is idempotent.

CREATE INDEX IF NOT EXISTS idx_visitors_v2_status_ts
    ON visitors_v2 (status, ts);

CREATE INDEX IF NOT EXISTS idx_visitors_v2_status_ip_hash_ts
    ON visitors_v2 (status, ip_hash, ts);
