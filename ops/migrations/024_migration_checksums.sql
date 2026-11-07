-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- ComiCine D1 migration checksums (task 15).
--
-- ops/migrate_d1.sh records the SHA-256 of every migration file here after the file's version is
-- written to schema_version. Later runs compare applied files against these rows and stop before
-- executing any migration SQL when an applied file changed. version is the same key used by
-- schema_version (version * 1000 + sequence), so the three legacy 004 files stay distinguishable.
-- The script also creates this table defensively before recording; both definitions must match.

CREATE TABLE IF NOT EXISTS migration_checksums (
    version     INTEGER PRIMARY KEY,
    filename    TEXT NOT NULL,
    sha256      TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
