-- Copyright (C) 2026-Present Limooo Studio
-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Additional terms under Section 7 apply.
-- See ADDITIONAL_TERMS.md.

UPDATE apple_accounts
SET email = replace(email, '@account.limooo.cn', '@apple.account.limooo.cn'),
    updated_at = datetime('now')
WHERE email LIKE '%@account.limooo.cn';
