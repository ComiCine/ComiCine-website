/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Custom HMAC-signed session cookie and D1 auth_sessions revocation table (Pages has no built-in session). */

import { execute, queryAll } from "./d1";
import type { Env } from "./env";
import {
  PENDING_COOKIE,
  REVEAL_MAX_AUTH_AGE_SECONDS,
  ROOT_DOMAIN,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "./config";
import { fromB64Url, hmacSha256Hex, timingSafeEqual, toB64Url } from "./crypto";

const textEncoder = new TextEncoder();
const AUTH_SESSION_TABLE = "auth_sessions";
const MAX_SIGNED_TOKEN_LENGTH = 8192;
const MAX_SESSION_FIELD_LENGTH = 512;

export interface SessionUser {
  email: string;
  name: string;
}

export interface SessionData {
  sid: string;
  sub: string;
  user: SessionUser;
  role: "admin" | "viewer";
  authAt: number;
}

interface SignedSession extends SessionData {
  exp: number;
}

interface AuthSessionRow {
  sid: string;
  sub: string;
  role: "admin" | "viewer";
  auth_at: number;
  exp: number;
  revoked_at: number | null;
}

export class AuthSessionUnavailableError extends Error {
  constructor(message = "auth_sessions_unavailable") {
    super(message);
    this.name = "AuthSessionUnavailableError";
  }
}

/**
 * Strict base64url decoder with additional alphabet and length validation.
 *
 * Session tokens are request-controlled; reject malformed input before
 * decoding so exceptions cannot become control flow.
 */
function fromB64UrlStrict(input: string): Uint8Array {
  if (!input || !/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
    throw new Error("invalid_base64url");
  }
  return fromB64Url(input);
}

function getCookie(name: string, header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

async function signPayload(key: string, payload: string): Promise<string> {
  return `${toB64Url(textEncoder.encode(payload))}.${await hmacSha256Hex(key, payload)}`;
}

async function verifyPayload<T>(key: string, token: string | undefined): Promise<T | null> {
  try {
    if (!key || !token || token.length > MAX_SIGNED_TOKEN_LENGTH) return null;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^[0-9a-f]{64}$/.test(sig)) return null;
    const payload = new TextDecoder().decode(fromB64UrlStrict(b64));
    const expected = await hmacSha256Hex(key, payload);
    if (!timingSafeEqual(sig, expected)) return null;
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookieHeader(name: string, sharedDomain = true): string {
  const domain = sharedDomain ? ` Domain=.${ROOT_DOMAIN};` : "";
  return `${name}=;${domain} Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return toB64Url(value);
}

export async function createSessionCookie(env: Env, data: SessionData): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload: SignedSession = { ...data, exp };
  return cookieHeader(SESSION_COOKIE, await signPayload(env.SESSION_HMAC_KEY ?? "", JSON.stringify(payload)), SESSION_TTL_SECONDS);
}

export function clearSessionCookie(): string {
  return clearCookieHeader(SESSION_COOKIE, false);
}

export function clearLegacySharedSessionCookie(): string {
  return clearCookieHeader("limooo_session_v2");
}

export async function readSession(
  env: Env,
  cookieHeaderValue: string | null,
): Promise<SessionData | null> {
  const token = getCookie(SESSION_COOKIE, cookieHeaderValue);
  const data = await verifyPayload<SignedSession>(env.SESSION_HMAC_KEY ?? "", token);
  if (!data) return null;
  if (
    typeof data.exp !== "number" ||
    data.exp <= Math.floor(Date.now() / 1000) ||
    !Number.isSafeInteger(data.exp) ||
    typeof data.sid !== "string" ||
    data.sid.length === 0 || data.sid.length > MAX_SESSION_FIELD_LENGTH ||
    typeof data.sub !== "string" ||
    data.sub.length === 0 || data.sub.length > MAX_SESSION_FIELD_LENGTH ||
    !data.user ||
    typeof data.user.email !== "string" ||
    data.user.email.length === 0 || data.user.email.length > 254 ||
    typeof data.user.name !== "string" ||
    data.user.name.length > MAX_SESSION_FIELD_LENGTH ||
    !["admin", "viewer"].includes(data.role) ||
    !Number.isSafeInteger(data.authAt) || data.authAt < 0
  ) {
    return null;
  }
  return {
    sid: data.sid,
    sub: data.sub,
    user: { email: data.user.email, name: data.user.name },
    role: data.role,
    authAt: data.authAt,
  };
}

/**
 * After validating the signed cookie, also check D1 auth_sessions. Throw
 * AuthSessionUnavailableError when the table is missing or unavailable so the
 * caller returns 503. Never fall back to trusting only the signed cookie.
 */
export async function requireAuth(env: Env, request: Request): Promise<SessionData | null> {
  const session = await readSession(env, request.headers.get("Cookie"));
  if (!session) return null;
  if (!env.DB) throw new AuthSessionUnavailableError();

  try {
    const rows = await queryAll<AuthSessionRow>(
      env.DB,
      `SELECT sid, sub, role, auth_at, exp, revoked_at
       FROM ${AUTH_SESSION_TABLE}
       WHERE sid = ? AND sub = ?`,
      session.sid,
      session.sub,
    );
    if (!rows.length) return null;
    const row = rows[0];
    if (row.revoked_at != null) return null;
    if (Number(row.exp) <= Math.floor(Date.now() / 1000)) return null;
    if (row.sub !== session.sub || row.role !== session.role) return null;
    return session;
  } catch (error) {
    if (error instanceof AuthSessionUnavailableError) throw error;
    throw new AuthSessionUnavailableError(
      error instanceof Error ? error.message : "auth_sessions_unavailable",
    );
  }
}

export async function createAuthSession(env: Env, session: SessionData): Promise<boolean> {
  if (!env.DB || !session.sid || !session.sub) return false;
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  try {
    return await execute(
      env.DB,
      `INSERT INTO ${AUTH_SESSION_TABLE}
        (sid, sub, role, auth_at, exp, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      session.sid,
      session.sub,
      session.role,
      session.authAt,
      exp,
    );
  } catch {
    return false;
  }
}

export async function revokeAuthSession(env: Env, sid: string): Promise<boolean> {
  if (!env.DB || !sid) return false;
  try {
    const result = await env.DB.prepare(
      `UPDATE ${AUTH_SESSION_TABLE}
       SET revoked_at = unixepoch()
       WHERE sid = ? AND revoked_at IS NULL`,
    ).bind(sid).run();
    return result.success === true;
  } catch {
    return false;
  }
}

export function clearPendingCookie(): string {
  return clearCookieHeader(PENDING_COOKIE);
}

/** Required gate/session secrets; return field names only and never expose values. */
export function runtimeConfigError(env: Env): string | null {
  const missing: string[] = [];
  if (!env.TURNSTILE_SECRET?.trim()) missing.push("TURNSTILE_SECRET");
  if (!env.GATE_HMAC_KEY?.trim()) missing.push("GATE_HMAC_KEY");
  if (!env.SESSION_HMAC_KEY?.trim()) missing.push("SESSION_HMAC_KEY");
  return missing.length ? `missing_${missing.join("_")}` : null;
}

export function configErrorResponse(reason: string): Response {
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>503</title></head>
<body style="font-family:system-ui,sans-serif;padding:2rem">
  <h1>503 Service Configuration Error</h1>
  <p>Service configuration is incomplete. Please contact the administrator.</p>
  <p hidden data-reason="${reason.replace(/"/g, "&quot;")}"></p>
</body>
</html>`;
  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function authUnavailableResponse(): Response {
  return Response.json(
    { error: "auth_sessions_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

/** Default denial message for read-only accounts and non-admins. */
export const ADMIN_REQUIRED_MESSAGE = "只读账户，无写入权限";

/**
 * Shared authorization for admin endpoints, including session lookup and 401/403 responses.
 *
 * This try/catch and 401/403 handling was duplicated in seven admin handlers
 * (accounts, accounts/[id], reveal, reorder, visitors, visitors/[hash]/ip,
 * and ray/[id]). Keep it here to prevent missing no-store headers or
 * unnoticed status-code drift.
 *
 * Return a Response for a denial (the caller returns it directly), or an
 * object to allow the request. `forbiddenMessage` supports callers that need
 * custom copy, such as the blocklist endpoint.
 */
export async function requireAdminSession(
  env: Env,
  request: Request,
  forbiddenMessage: string = ADMIN_REQUIRED_MESSAGE,
): Promise<{ session: NonNullable<SessionData> } | Response> {
  let session: SessionData | null;
  try {
    session = await requireAuth(env, request);
  } catch {
    return authUnavailableResponse();
  }
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (session.role !== "admin") {
    return Response.json(
      { error: forbiddenMessage },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  return { session };
}

/** Default recent-authentication window in seconds, from `config-contract.json`. */
export const REVEAL_MAX_AUTH_AGE = REVEAL_MAX_AUTH_AGE_SECONDS;

/** Recent authentication expired; the frontend uses this to repeat Access authentication at /login?next=<current page>. */
export const REAUTH_REQUIRED_MESSAGE = "需要重新验证";

/**
 * Step-up authorization: require **recent authentication** in addition to `requireAdminSession`.
 *
 * Only Cloudflare Access can issue `authAt` (`functions/login.ts`), while the
 * session cookie lasts 30 days. Revealing a plaintext password is highly
 * sensitive; a login from 30 days ago is not enough. Require
 * `now - session.authAt <= maxAgeSeconds` (600 seconds by default; see
 * `reveal_max_auth_age_seconds`). On expiry, return 401 with
 * `{ error: "reauthentication required", reauth: true }` so the frontend
 * sends the user to `/login` for fresh authentication.
 *
 * Preserve `requireAdminSession` ordering: authenticate, return 403 for
 * non-admins, then return 401 when recent authentication is required. Thus
 * unauthenticated users still get 401 and read-only accounts still get 403;
 * callers return a Response directly.
 *
 * The Apple Account frontend sends this flow through `/logout`, which revokes
 * the local session and clears the Cloudflare Access session before returning
 * to the protected page. That prevents a still-valid Access application token
 * from silently refreshing `authAt` without a new Access authentication flow.
 */
export async function requireRecentAdminSession(
  env: Env,
  request: Request,
  maxAgeSeconds: number = REVEAL_MAX_AUTH_AGE,
): Promise<{ session: SessionData } | Response> {
  const auth = await requireAdminSession(env, request);
  if (auth instanceof Response) return auth;
  const now = Math.floor(Date.now() / 1000);
  const age = now - auth.session.authAt;
// Checking only the upper bound would let a **future** authAt pass forever
// because age is negative. The signed cookie currently prevents forgery, but
// this is the only gate protecting plaintext password access, so reject future
// values just as the gate cookie validator does.
  if (!Number.isFinite(age) || age < 0 || age > maxAgeSeconds) {
    return Response.json(
      { error: REAUTH_REQUIRED_MESSAGE, reauth: true },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return { session: auth.session };
}
