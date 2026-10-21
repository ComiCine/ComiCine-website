UPDATE apple_accounts
SET email = replace(email, '@account.limooo.cn', '@apple.account.limooo.cn'),
    updated_at = datetime('now')
WHERE email LIKE '%@account.limooo.cn';
