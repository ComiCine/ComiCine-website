/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Shared Limooo security response headers for Pages Functions.
 *
 * `ops/security-headers.json` is the only source of truth; this file mirrors
 * it for Pages build and runtime. Update the JSON too and run
 * `python3 ops/check_security_headers.py` when changing these headers.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy":
    "default-src 'self'; object-src 'none'; base-uri 'self'; script-src 'self' https://challenges.cloudflare.com http://static.cloudflareinsights.com https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://image.limooo.cn https://images.limooo.cn; font-src 'self' data: https://fonts.limooo.cn; connect-src 'self' https://api.frankfurter.dev https://image.limooo.cn https://images.limooo.cn https://challenges.cloudflare.com http://cloudflareinsights.com https://cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; form-action 'self' https://*.limooo.cn",
};
