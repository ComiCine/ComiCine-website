/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Shared ComiCine security response headers for Pages Functions.
 *
 * `ops/security-headers.json` is the only source of truth; this file mirrors
 * it for Pages build and runtime. Update the JSON too and run
 * `python3 ops/check_security_headers.py` when changing these headers.
 *
 * CSP rollout: `Content-Security-Policy` enforces, and
 * `Content-Security-Policy-Report-Only` carries the same directive list plus
 * `report-to csp` / `report-uri /api/csp-report`, which `Reporting-Endpoints`
 * binds to the report handler. Start a tightening round by making the
 * Report-Only policy stricter than the enforced one (remove one directive
 * source, or add a directive such as `script-src-attr 'none'`), never looser;
 * `ops/check_security_headers.py` rejects a looser Report-Only policy. After a
 * clean observation window, move the confirmed change into the enforced policy
 * and copy it back into Report-Only, so the two never describe conflicting
 * rules.
 */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy":
    "default-src 'self'; object-src 'none'; base-uri 'self'; script-src 'self' https://challenges.cloudflare.com http://static.cloudflareinsights.com https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://images.comicine.com; font-src 'self' data: https://fonts.comicine.com; connect-src 'self' https://api.frankfurter.dev https://images.comicine.com https://challenges.cloudflare.com http://cloudflareinsights.com https://cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; form-action 'self' https://*.comicine.com",
  "Content-Security-Policy-Report-Only":
    "default-src 'self'; object-src 'none'; base-uri 'self'; script-src 'self' https://challenges.cloudflare.com http://static.cloudflareinsights.com https://static.cloudflareinsights.com; style-src 'self'; img-src 'self' data: https://images.comicine.com; font-src 'self' data: https://fonts.comicine.com; connect-src 'self' https://api.frankfurter.dev https://images.comicine.com https://challenges.cloudflare.com http://cloudflareinsights.com https://cloudflareinsights.com; frame-src 'self' https://challenges.cloudflare.com; frame-ancestors 'self'; form-action 'self' https://*.comicine.com; report-to csp; report-uri /api/csp-report",
  "Reporting-Endpoints": "csp=\"/api/csp-report\"",
};
