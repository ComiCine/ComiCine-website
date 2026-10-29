-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- The canonical .com health targets are seeded by 009_probes.sql. Keep this versioned migration
-- as a no-op for clean database replays; the imported probe rows are preserved verbatim.
UPDATE probes
SET target = target
WHERE 0;

UPDATE probes
SET target = target
WHERE 0;
