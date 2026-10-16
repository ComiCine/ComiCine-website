-- Limooo D1 schema version table.
-- ops/migrate_d1.sh upserts the version after each migration for pre-deploy validation.

CREATE TABLE IF NOT EXISTS schema_version (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
