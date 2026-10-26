-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- Move the two HTTP health probes to the canonical .com hostnames.
-- The WHERE clauses keep this safe for databases already using the new targets.
UPDATE probes
SET target = 'https://comicine.com/_health'
WHERE id = 1 AND target = 'https://limooo.cn/_health';

UPDATE probes
SET target = 'https://images.comicine.com/_health'
WHERE id = 2 AND target = 'https://images.limooo.cn/_health';
