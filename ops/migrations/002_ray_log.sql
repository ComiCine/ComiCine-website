-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- Ray ID request log for Limooo Cloudflare Pages.
-- Apply with: wrangler d1 execute limooo --file=./migrations/002_ray_log.sql
-- The middleware writes each request's CF-Ray and request details here for lookup by check-ray-id.

CREATE TABLE IF NOT EXISTS ray_log (
    ray     TEXT PRIMARY KEY,
    ts      INTEGER DEFAULT (unixepoch()),
    host    TEXT NOT NULL,
    path    TEXT NOT NULL,
    method  TEXT NOT NULL,
    status  INTEGER DEFAULT 0,
    ip      TEXT DEFAULT '',
    country TEXT DEFAULT '',
    ua      TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_ray_log_ts ON ray_log (ts);
