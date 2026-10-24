/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Encrypt and decrypt visitor-row IPs with Fernet and the dedicated `VISITOR_IP_KEY`.
 *
 * Hashing is one-way, so `ip_hash` cannot answer operational questions about
 * a visitor. Store an encrypted value instead. List endpoints still return
 * only `ip_hash`; decrypt one row in the Worker at `/api/visitors/<hash>/ip`
 * only when an admin selects it.
 *
 * Do not reuse `OBSERVABILITY_HMAC_KEY` or `APPLE_ACCOUNT_ENCRYPTION_KEY`:
 * the former is for hashing, and the latter protects Apple Account passwords.
 * Keep keys separated by purpose, as with GATE_HMAC_KEY and
 * OBSERVABILITY_HMAC_KEY.
 *
 * Failure behavior: writes fail open (missing keys or encryption errors store
 * an empty string and never block visitor tracking); reads fail closed
 * (return null when plaintext cannot be recovered, so callers return 404/503).
 */

import { fernetDecrypt, fernetEncrypt } from "./fernet";
import type { Env } from "./env";

/** Secret value, or an empty string when unset. */
export function visitorIpKey(env: Env): string {
  return (env.VISITOR_IP_KEY ?? "").trim();
}

/** Encrypt a visitor IP; return an empty string when the key is unset or the IP is empty. */
export async function encryptVisitorIp(ip: string, env: Env): Promise<string> {
  const key = visitorIpKey(env);
  if (!ip || !key) return "";
  try {
    return await fernetEncrypt(ip, key);
  } catch {
// Encryption failure must not break tracking or discard the entire row.
    return "";
  }
}

/** Decrypt a visitor IP; return null if the key is missing, ciphertext is empty, or validation fails. */
export async function decryptVisitorIp(token: string, env: Env): Promise<string | null> {
  const key = visitorIpKey(env);
  if (!token || !key) return null;
  try {
    const ip = await fernetDecrypt(token, key);
    return ip || null;
  } catch {
    return null;
  }
}
