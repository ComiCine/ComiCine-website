/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { D1Database } from "./d1";

export interface Env {
// Gate (phase 1)
  TURNSTILE_SITEKEY: string;
  TURNSTILE_SECRET: string;
  GATE_HMAC_KEY: string;
// Observability: IP hashing key separate from GATE_HMAC_KEY; log an empty
// string if missing instead of reusing another key.
  OBSERVABILITY_HMAC_KEY?: string;
// Login (Cloudflare Access is the only identity source; tasks/17 §11.10)
/** Zero Trust team domain, such as https://limooo.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN?: string;
/** Comma-separated AUD list; matches receive the admin role. */
  ACCESS_ADMIN_AUDS?: string;
/** Comma-separated AUD list; matches receive the viewer role unless admin takes precedence. */
  ACCESS_VIEWER_AUDS?: string;
  SESSION_HMAC_KEY?: string;
// Local development only: set to "1" to allow localhost or 127.0.0.1 CSRF
// Origins. Disabled by default in production; set only in local .dev.vars,
// never as a Pages Secret.
  ALLOW_LOCAL_ORIGINS?: string;
// Encrypt visitor-row IPs with a dedicated Fernet key for visitor_rollups.ip_enc.
  VISITOR_IP_KEY?: string;
// Encrypt Apple Account passwords with a Fernet key shared with the Flask deployment.
  APPLE_ACCOUNT_ENCRYPTION_KEY?: string;
// D1 (phase 3: visitor statistics, blocklist, and Apple Account)
  DB?: D1Database;
// Pages static-assets binding; middleware selects prerendered pages by language.
  ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}
