-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- 012: Add the missing probes.label_key column.
--
-- This column had previously been added manually to production without a repository migration.
-- A fresh database created from ops/migrations/ would make the status page fail with
-- `no such column: p.label_key`. Production already has the column, so this migration affects
-- only new databases (see .d1-migrations/applied for migration records).

ALTER TABLE probes ADD COLUMN label_key TEXT;
