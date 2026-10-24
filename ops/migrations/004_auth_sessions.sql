-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.md.

-- Limooo Pages OIDC session revocation table (docs/09).
-- A parallel agent already used the 004_* migration prefix; this file follows the established
-- naming convention so it can be picked up by migrate_d1.sh.
-- Apply with: wrangler d1 execute limooo --file=./migrations/004_auth_sessions.sql
-- If this table is missing, requireAuth must return 503 rather than trusting a signed cookie alone.

CREATE TABLE IF NOT EXISTS auth_sessions (
    sid         TEXT PRIMARY KEY,
    sub         TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
    auth_at     INTEGER NOT NULL,
    exp         INTEGER NOT NULL,
    revoked_at  INTEGER DEFAULT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_sub_exp ON auth_sessions (sub, exp);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions (revoked_at);
