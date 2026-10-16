-- Limooo D1 audit fields (docs/08).
-- Add reveal-audit fields to existing events tables. New installations create these fields through
-- CREATE TABLE IF NOT EXISTS in functions/_lib/logging.ts; this migration upgrades existing tables only.

ALTER TABLE events ADD COLUMN account_id TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN actor_sub TEXT DEFAULT '';
