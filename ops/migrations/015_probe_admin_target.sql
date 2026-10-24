-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- 015: Fix the stale target for probe 2, left behind after the VPS retirement.
--
-- Background: probe id=2 targeted `https://admin.limooo.cn/_health`, an operations endpoint from
-- the authentik + Uptime Kuma era. The domain has no DNS record since the VPS was retired, so it
-- failed to resolve / returned http_530. The probe kept running every minute and the status page
-- showed a service down indefinitely; this was stale configuration, not a real failure.
--
-- 009_probes.sql uses INSERT OR IGNORE, so changing its seed data would not affect existing
-- databases. Add a separate idempotent migration and fill in all three label_key values so the
-- status-page card names follow the selected interface language.
--
-- Update only rows that still have the old value, preserving targets changed manually by operators.

-- Note: Do not probe `status.limooo.cn/_health` or a Worker's `*.workers.dev` domain. Cloudflare
-- blocks subrequests from a Worker to its own zone or route (observed http_522 / http_404 while an
-- external curl to the same URL returned 200). Probe a static-asset host in the same region to
-- test a genuinely reachable edge asset instead.
UPDATE probes
   SET target = 'https://images.limooo.cn/_health',
       name   = 'Edge Assets'
 WHERE id = 2
   AND (target = 'https://admin.limooo.cn/_health' OR target IS NULL);

UPDATE probes SET label_key = 'card_website' WHERE id = 1 AND label_key IS NULL;
-- `card_admin` was removed from the status-worker copy because the management endpoint disappeared
-- with the VPS. Its old label would fall back to the English name, so update it to card_status.
UPDATE probes SET label_key = 'card_status'  WHERE id = 2 AND (label_key IS NULL OR label_key = 'card_admin');
UPDATE probes SET label_key = 'card_d1'      WHERE id = 3 AND label_key IS NULL;
