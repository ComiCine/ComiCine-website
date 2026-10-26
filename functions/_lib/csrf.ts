/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Synchronous double-submit CSRF protection for sensitive APIs.
 *
 * Cross-site writes are blocked by two checks, both required:
 * 1. **Origin validation**: accept only first-party subdomains in
 *    `PROD_ORIGINS` (`visitor.` / `account.`); **localhost is denied by default
 *    in production**. Cross-site forms and scripts cannot supply a valid
 *    Origin header.
 * 2. **Double-submit plus a custom header**: the cookie (not HttpOnly because
 *    the frontend reads it) must exactly match the `X-CSRF-Token` header.
 *    Cross-site requests cannot read the cookie or add a custom header to a
 *    normal form submission.
 *
 * Also **bind the token to a session** by signing `csrf:<sid>:<payload>`.
 * A token issued in session A then fails in session B, even if another
 * same-site subdomain can set a cookie. Callers pass the `sid` from a verified
 * session (`/api/auth/status` issues tokens and write endpoints validate
 * them). Unauthenticated requests have no issuer, so there is no empty-`sid`
 * exception.
 *
 * Allow localhost only for local `wrangler pages dev`: set
 * `ALLOW_LOCAL_ORIGINS=1` in local `.dev.vars`. It is disabled by default in
 * production.
 */

import {
  APPLE_ACCOUNT_HOSTNAME,
  CSRF_COOKIE,
  VISITOR_HOSTNAME,
} from "./config";
import type { Env } from "./env";
import { getCookie } from "./routing";
import { hmacSha256Hex, timingSafeEqual, toB64Url } from "./crypto";

export const CSRF_HEADER_NAME = "X-CSRF-Token";
export const CSRF_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

const PROD_ORIGINS = new Set([
  `https://${VISITOR_HOSTNAME}`,
  `https://${APPLE_ACCOUNT_HOSTNAME}`,
]);
const LOCAL_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i;

/** Explicit local-development switch; allow localhost Origin only when set to `1`. */
function localOriginsAllowed(env: Env): boolean {
  return (env.ALLOW_LOCAL_ORIGINS ?? "").trim() === "1";
}

function csrfSecret(env: Env): string {
  return env.SESSION_HMAC_KEY || env.GATE_HMAC_KEY || "";
}

/** Signed payload binds the token to a session; changing `sid` invalidates it. */
function csrfPayload(sid: string, payload: string): string {
  return `csrf:${sid}:${payload}`;
}

async function validToken(token: string, sid: string, secret: string): Promise<boolean> {
  if (!secret || !token || !sid) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  return timingSafeEqual(signature, await hmacSha256Hex(secret, csrfPayload(sid, payload)));
}

function isAllowedOrigin(env: Env, origin: string): boolean {
  const normalized = origin.replace(/\/+$/, "");
  if (PROD_ORIGINS.has(normalized)) return true;
  return localOriginsAllowed(env) && LOCAL_ORIGIN_RE.test(normalized);
}

/**
 * Issue a CSRF token bound to `sid`. The cookie cannot be HttpOnly because
 * the frontend must read it and add it to the request header. `sid` is
 * required; callers must validate the session first.
 */
export async function createCsrfToken(env: Env, sid: string): Promise<{ token: string }> {
  const secret = csrfSecret(env);
  if (!secret) throw new Error("CSRF secret is not configured");
  if (!sid) throw new Error("CSRF session id is required");
  const payload = toB64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { token: `${payload}.${await hmacSha256Hex(secret, csrfPayload(sid, payload))}` };
}

export function csrfCookieHeader(token: string, secure = true): string {
  return `${CSRF_COOKIE}=${token}; Path=/; Max-Age=${CSRF_COOKIE_MAX_AGE}; SameSite=Lax; ${secure ? "Secure; " : ""}`;
}

/**
 * Validate a write request: trusted Origin, matching cookie and header, valid
 * server signature, and binding to the current `sid` from the caller's
 * already-validated session.
 */
export async function verifyCsrf(env: Env, request: Request, sid: string): Promise<boolean> {
  const origin = request.headers.get("Origin") ?? "";
  if (!isAllowedOrigin(env, origin)) return false;
  const header = request.headers.get(CSRF_HEADER_NAME) ?? "";
  const cookie = getCookie(CSRF_COOKIE, request.headers.get("Cookie")) ?? "";
  if (!header || !cookie || header !== cookie) return false;
  return validToken(header, sid, csrfSecret(env));
}
