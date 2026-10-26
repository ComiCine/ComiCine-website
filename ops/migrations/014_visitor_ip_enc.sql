-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- 014: Store a decryptable IP for each visitor row (clicking a row decrypts it and opens ipinfo.io).
--
-- Privacy behavior is unchanged: /api/visitors still returns only ip_hash. Encrypt the full IP
-- with the separate VISITOR_IP_KEY using Fernet; only an admin single-row lookup decrypts it in
-- the Worker. Historical rows from before this migration have no ip_enc and cannot be recovered;
-- the endpoint returns 404 for them.

ALTER TABLE visitor_rollups ADD COLUMN ip_enc TEXT NOT NULL DEFAULT '';

-- Single-row decryption fetches the latest row by ip_hash. visitor_rollups is keyed first by
-- bucket_hour, so querying by ip_hash alone would scan the table. Add an (ip_hash, last_ts) index
-- so each click reads only one row and stays within the D1 free-plan row-read budget.
CREATE INDEX IF NOT EXISTS idx_visitor_rollups_ip_hash
  ON visitor_rollups (ip_hash, last_ts);
