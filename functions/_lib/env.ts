/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import type { D1Database } from "./d1";

export interface Env {
// Gate (phase 1)
  TURNSTILE_SITEKEY: string;
  TURNSTILE_SECRET: string;
  GATE_HMAC_KEY: string;
// Accepted for validation only during rotation; never used to sign.
  GATE_HMAC_KEY_PREVIOUS?: string;
// Observability: IP hashing key separate from GATE_HMAC_KEY; log an empty
// string if missing instead of reusing another key.
  OBSERVABILITY_HMAC_KEY?: string;
// Login (Cloudflare Access identity broker)
/** Zero Trust team domain, such as https://comicine.cloudflareaccess.com. */
  ACCESS_TEAM_DOMAIN?: string;
/** AUD of the single Access application protecting identity.comicine.com/login. */
  ACCESS_IDENTITY_AUD?: string;
  SESSION_HMAC_KEY?: string;
// Local development only: set to "1" to allow localhost or 127.0.0.1 CSRF
// Origins. Disabled by default in production; set only in local .dev.vars,
// never as a Pages Secret.
  ALLOW_LOCAL_ORIGINS?: string;
// Encrypt visitor-row IPs with a dedicated Fernet key for visitor_rollups.ip_enc.
  VISITOR_IP_KEY?: string;
// Encrypt Apple Account credentials stored in D1 with a dedicated Fernet key.
  APPLE_ACCOUNT_ENCRYPTION_KEY?: string;
// D1 (phase 3: visitor statistics, blocklist, and Apple Account)
  DB?: D1Database;
// Pages static-assets binding; middleware selects prerendered pages by language.
  ASSETS?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export const GATE_HMAC_KEY_MIN_LENGTH = 32;

const GATE_HMAC_KEY_PATTERN = new RegExp(`^\\S{${GATE_HMAC_KEY_MIN_LENGTH},}$`);

/**
 * Reject a malformed previous gate key at runtime-config validation time.
 *
 * The previous key is only a rotation fallback: accepting a key that can never
 * have signed a cookie would silently leave no fallback while rotation looks
 * configured. The key value itself must never appear in logs or responses.
 */
export function gatePreviousKeyConfigError(env: Env): string | null {
  const raw = env.GATE_HMAC_KEY_PREVIOUS;
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return GATE_HMAC_KEY_PATTERN.test(trimmed) ? null : "invalid_GATE_HMAC_KEY_PREVIOUS";
}
