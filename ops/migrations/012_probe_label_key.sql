-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Additional terms under Section 7 apply.
-- See ADDITIONAL_TERMS.md.

-- 012: Add the missing probes.label_key column.
--
-- This column had previously been added manually to production without a repository migration.
-- A fresh database created from ops/migrations/ would make the status page fail with
-- `no such column: p.label_key`. Production already has the column, so this migration affects
-- only new databases (see .d1-migrations/applied for migration records).

ALTER TABLE probes ADD COLUMN label_key TEXT;
