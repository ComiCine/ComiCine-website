-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- Self-managed password login credentials (docs/17, phase 1, alternative A).
-- This table coexists with the auth_sessions revocation table from docs/09 and only identifies
-- where an identity comes from; session revocation and requireAuth fail-closed behavior are unchanged.

CREATE TABLE IF NOT EXISTS auth_credentials (
    email          TEXT PRIMARY KEY,
    sub            TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'admin',   -- admin | viewer
    password_hash  TEXT NOT NULL,                   -- pbkdf2$iters$salt$hash
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until   INTEGER,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
