-- Copyright (C) 2026-Present ComiCine
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Section 7 additional terms apply when the work is used under GNU AGPL v3.
-- See ADDITIONAL_TERMS.txt.

UPDATE apple_accounts
SET email = replace(email, '@account.limooo.cn', '@apple.account.limooo.cn'),
    updated_at = datetime('now')
WHERE email LIKE '%@account.limooo.cn';
