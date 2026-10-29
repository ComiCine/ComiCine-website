-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- 015: Normalize a missing health target for probe 2 and fill status-page label keys.
--
-- 009_probes.sql seeds the canonical .com targets for a clean database. This migration also
-- repairs a missing target in databases where the probe row predates that seed. Preserve targets
-- changed manually by operators. Do not probe a Worker's own domain; Cloudflare blocks subrequests
-- from a Worker to its own zone or route.
UPDATE probes
   SET target = 'https://images.comicine.com/_health',
       name   = 'Edge Assets'
 WHERE id = 2 AND target IS NULL;

UPDATE probes SET label_key = 'card_website' WHERE id = 1 AND label_key IS NULL;
-- `card_admin` was removed from the status-worker copy because the management endpoint disappeared
-- with the VPS. Its old label would fall back to the English name, so update it to card_status.
UPDATE probes SET label_key = 'card_status'  WHERE id = 2 AND (label_key IS NULL OR label_key = 'card_admin');
UPDATE probes SET label_key = 'card_d1'      WHERE id = 3 AND label_key IS NULL;
