-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Additional terms under Section 7 apply.
-- See ADDITIONAL_TERMS.md.

-- 020: single-use codes carry a verified Access identity and source host to a registered site.
-- Codes are stored as SHA-256 hashes and expire within two minutes. Successful exchanges delete the row.

CREATE TABLE IF NOT EXISTS identity_handoffs (
    code_hash   TEXT PRIMARY KEY NOT NULL CHECK (length(code_hash) = 64),
    state_hash  TEXT NOT NULL CHECK (length(state_hash) = 64),
    source_host TEXT NOT NULL,
    target_path TEXT NOT NULL CHECK (length(target_path) <= 2048),
    sub         TEXT NOT NULL,
    email       TEXT NOT NULL,
    auth_at     INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identity_handoffs_expires
    ON identity_handoffs (expires_at);
