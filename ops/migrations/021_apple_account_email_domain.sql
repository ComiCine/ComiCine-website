-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

-- Apple Account email addresses are user data, not infrastructure identifiers. The identifier
-- migration imports their existing values verbatim and deliberately does not rewrite them.
UPDATE apple_accounts SET email = email WHERE 0;
