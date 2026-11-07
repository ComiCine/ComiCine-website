/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate cookie: validation, issuance, renewal, and legacy-scope cleanup. */

import { GATE_COOKIE, GATE_TTL_SECONDS, ROOT_DOMAIN, rootDomainForHost } from "../config";
import { hmacSha256Hex, timingSafeEqual } from "../crypto";

export { allCookieValues } from "../cookies";

/**
 * Cookie format: `<issued-at>.<expires-at>.<HMAC-SHA256 hex signature>`.
 *
 * Sign the complete `issued.expires` payload so the cookie cannot be altered
 * or extended using a signature from an older cookie.
 *
 * Previously, only the expiry was signed, so every request could issue a new
 * cookie with a full TTL. Visitors whose request interval exceeded the TTL
 * repeatedly returned to the gate. The issued-at time is now signed too, and
 * renewal is explicit and bounded: renew only after
 * `GATE_RENEW_AFTER_SECONDS` (three quarters of the TTL). A one-hour session
 * is therefore a stable guarantee rather than a sliding window.
 */
export const GATE_RENEW_AFTER_SECONDS = Math.floor(GATE_TTL_SECONDS * 0.75);

/**
 * Maximum number of same-name `__gate` cookies to validate per request.
 *
 * A normal visitor has at most two (the earlier host-only cookie and the
 * current domain cookie), so eight leaves ample room. The limit prevents an
 * attacker from controlling the number of WebCrypto operations per request
 * with an oversized Cookie header.
 * (tasks/22 W9-10).
 */
export const MAX_GATE_COOKIE_VALUES = 8;

/** Validation failure categories for diagnostic logs only; do not expose them to visitors. */
export type GateCookieReason =
  | "ok"
  | "absent"
  | "malformed"
  | "bad_signature"
  | "expired"
  | "future_issued";

export interface GateCookieState {
  valid: boolean;
/** Whether the request contains at least one __gate cookie. */
  present: boolean;
/** Whether less than one quarter of the TTL remains and the response should renew the cookie. */
  shouldRenew: boolean;
  reason: GateCookieReason;
}

/** Validate a __gate cookie; its signature, format, and expiry must all be valid. */
export async function readGateCookie(
  value: string | undefined,
  key: string,
): Promise<GateCookieState> {
  const present = Boolean(value);
  const fail = (reason: GateCookieReason): GateCookieState => ({
    valid: false,
    present,
    shouldRenew: false,
    reason,
  });
  if (!present) return fail("absent");
  if (!key) return fail("malformed");

  const parts = (value as string).split(".");
  if (parts.length !== 3) return fail("malformed");
  const [issuedRaw, expiryRaw, signature] = parts;
  if (!/^\d{10,}$/.test(issuedRaw) || !/^\d{10,}$/.test(expiryRaw)) return fail("malformed");
  if (!/^[0-9a-f]{64}$/.test(signature)) return fail("malformed");

  const expected = await hmacSha256Hex(key, `${issuedRaw}.${expiryRaw}`);
  if (!timingSafeEqual(signature, expected)) return fail("bad_signature");

  const issued = Number(issuedRaw);
  const expiry = Number(expiryRaw);
  if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expiry)) return fail("malformed");
  const now = Math.floor(Date.now() / 1000);
  if (expiry <= now) return fail("expired");
// Reject a future issued-at time (clock skew or forgery) to prevent cookies that never renew.
  if (issued > now + 60) return fail("future_issued");

  return {
    valid: true,
    present: true,
    shouldRenew: now - issued >= GATE_RENEW_AFTER_SECONDS,
    reason: "ok",
  };
}

/**
 * Validation keyring for __gate cookies: the current key first, then the
 * previous rotation key when it is configured and differs.
 *
 * Never use this list for issuance. `mintGateCookie` and `gateCookieHeaders`
 * stay on the current key alone, otherwise a rotation can never complete.
 * Key material is used raw; trim only to test whether it is blank.
 */
export function gateValidationKeys(env: {
  GATE_HMAC_KEY?: string;
  GATE_HMAC_KEY_PREVIOUS?: string;
}): string[] {
  const current = env.GATE_HMAC_KEY ?? "";
  const keys: string[] = [];
  if (current.trim()) keys.push(current);
  const previous = env.GATE_HMAC_KEY_PREVIOUS ?? "";
  if (previous.trim() && previous !== current) keys.push(previous);
  return keys;
}

/** Issue a __gate cookie for the matching current or legacy root domain, with the contract TTL. */
export async function mintGateCookie(key: string, host: string = ROOT_DOMAIN): Promise<string> {
  const ttlSeconds = GATE_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + ttlSeconds;
  const payload = `${now}.${expiry}`;
  const signature = await hmacSha256Hex(key, payload);
  const rootDomain = rootDomainForHost(host);
  const domain = rootDomain ? ` Domain=.${rootDomain};` : "";
  return `${GATE_COOKIE}=${payload}.${signature};${domain} HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
}

/**
 * Remove an older host-only `__gate` cookie that has no Domain attribute.
 *
 * Same-name host-only and Domain=.comicine.com cookies can **coexist** and are
 * sent together. If an expired old cookie stays first, it can shadow the valid
 * one. Delete the host-only variant when issuing a new cookie to avoid a
 * state where verification succeeds but the visitor remains blocked.
 */
export function purgeLegacyGateCookie(): string {
  return `${GATE_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}

/** Set-Cookie headers for one issuance: clear the host-only cookie, then write the matching root-domain cookie. */
export async function gateCookieHeaders(key: string, host: string = ROOT_DOMAIN): Promise<string[]> {
  return [purgeLegacyGateCookie(), await mintGateCookie(key, host)];
}
