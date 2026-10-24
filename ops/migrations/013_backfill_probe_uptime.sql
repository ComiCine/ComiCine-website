-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- 013: Backfill probe_uptime_daily from historical heartbeats.
--
-- The daily aggregate table created by 011 is empty by default. Without this backfill, uptime on
-- the status page would show "—" for the next seven days, looking like data loss. MAX() makes this
-- migration safe to rerun: days whose live totals already exceed the backfill are not reduced.

INSERT INTO probe_uptime_daily (probe_id, day, total, up)
SELECT probe_id,
       ts - (ts % 86400) AS day,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS up
  FROM heartbeats
 GROUP BY probe_id, ts - (ts % 86400)
ON CONFLICT (probe_id, day) DO UPDATE SET
  total = MAX(probe_uptime_daily.total, excluded.total),
  up    = MAX(probe_uptime_daily.up, excluded.up);
