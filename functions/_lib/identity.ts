/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Short-lived, one-time handoffs from the shared Access identity app to ComiCine sites. */

import { IDENTITY_SITE_ROLES } from "./config";
import { safeNextPath } from "./routing";
import type { AccessIdentity } from "./access";
import type { Env } from "./env";

const HANDOFF_TABLE = "identity_handoffs";
const HANDOFF_TTL_SECONDS = 120;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CALLBACK_LENGTH = 4096;
const textEncoder = new TextEncoder();

export interface IdentityCallback {
  sourceHost: string;
  targetPath: string;
  state: string;
}

export interface ConsumedIdentityHandoff {
  sourceHost: string;
  targetPath: string;
  sub: string;
  email: string;
  authAt: number;
}

/**
 * Raised when the identity handoff store cannot be reached or reports failure.
 *
 * This is deliberately separate from a `null` result: `null` means the code
 * itself is not usable (unknown, expired, already consumed, bound to another
 * host, or a corrupted row), which callers must keep returning as 401. A store
 * outage is retryable, so callers map it to 503 instead of telling the user the
 * credential is invalid.
 */
export class IdentityStoreUnavailable extends Error {
  constructor(readonly reason: string, options?: { cause?: unknown }) {
    super(`identity_store_unavailable:${reason}`, options);
    this.name = "IdentityStoreUnavailable";
  }
}

interface IdentityHandoffRow {
  source_host: string;
  target_path: string;
  sub: string;
  email: string;
  auth_at: number;
}

export function identityRoleForHost(host: string): "admin" | "viewer" | null {
  if (!Object.prototype.hasOwnProperty.call(IDENTITY_SITE_ROLES, host)) return null;
  const role = IDENTITY_SITE_ROLES[host];
  return role === "admin" || role === "viewer" ? role : null;
}

export function isIdentitySite(host: string): boolean {
  return Object.prototype.hasOwnProperty.call(IDENTITY_SITE_ROLES, host);
}

export function safeIdentityTarget(raw: string | null): string | null {
  if (raw === null || raw === "") return "/";
  if (raw.length > 2048) return null;
  const safe = safeNextPath(raw);
  return safe === raw ? safe : null;
}

export function parseIdentityCallback(raw: string | null): IdentityCallback | null {
  if (!raw || raw.length > MAX_CALLBACK_LENGTH) return null;
  try {
    const url = new URL(raw);
    const sourceHost = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "" ||
      url.pathname !== "/identity/callback" ||
      !isIdentitySite(sourceHost) ||
      url.origin !== `https://${sourceHost}`
    ) return null;

    const states = url.searchParams.getAll("state");
    const targets = url.searchParams.getAll("next");
    if (states.length !== 1 || targets.length !== 1 || [...url.searchParams.keys()].length !== 2) {
      return null;
    }
    const state = states[0];
    const targetPath = safeIdentityTarget(targets[0]);
    if (!TOKEN_PATTERN.test(state) || targetPath === null) return null;
    return { sourceHost, targetPath, state };
  } catch {
    return null;
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Issue a one-time handoff, reporting only success.
 *
 * Issuance keeps its boolean contract because the login endpoint already maps a
 * failure to its 503 configuration response and the Access-side contract must
 * not change here. Consumption needs the finer split, so it throws instead.
 */
export async function createIdentityHandoff(
  env: Env,
  code: string,
  identity: AccessIdentity,
  callback: IdentityCallback,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!env.DB || !isIdentitySite(callback.sourceHost) || !TOKEN_PATTERN.test(code) || !TOKEN_PATTERN.test(callback.state)) return false;
  if (!identity.sub || identity.sub.length > 512 || !identity.email || identity.email.length > 254) return false;
  if (!Number.isSafeInteger(identity.expiresAt) || identity.expiresAt <= now) return false;

  try {
    const codeHash = await sha256Hex(code);
    const stateHash = await sha256Hex(callback.state);
    const cleanup = await env.DB.prepare(
      `DELETE FROM ${HANDOFF_TABLE} WHERE expires_at <= ?`,
    ).bind(now).run();
    if (cleanup.success !== true) return false;

    const inserted = await env.DB.prepare(
      `INSERT INTO ${HANDOFF_TABLE}
        (code_hash, state_hash, source_host, target_path, sub, email, auth_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      codeHash,
      stateHash,
      callback.sourceHost,
      callback.targetPath,
      identity.sub,
      identity.email,
      now,
      Math.min(identity.expiresAt, now + HANDOFF_TTL_SECONDS),
    ).run();
    return inserted.success === true && (typeof inserted.meta?.changes !== "number" || inserted.meta.changes > 0);
  } catch {
    return false;
  }
}

/**
 * Consume a one-time handoff, returning `null` for every credential failure.
 *
 * The row is removed by a single `DELETE ... RETURNING`, so two concurrent
 * exchanges cannot both win: D1 applies the delete atomically and only one
 * caller receives the row. A duplicate consumption therefore yields an empty
 * result (401), never a unique-constraint error.
 *
 * Only the D1 call is wrapped. Hashing failures and programming errors keep
 * propagating; a missing binding or a failed statement throws
 * `IdentityStoreUnavailable` so the endpoint can answer 503 instead of
 * mislabelling storage trouble as an invalid handoff.
 */
export async function consumeIdentityHandoff(
  env: Env,
  code: string,
  sourceHost: string,
  state: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ConsumedIdentityHandoff | null> {
  if (!isIdentitySite(sourceHost) || !TOKEN_PATTERN.test(code) || !TOKEN_PATTERN.test(state)) return null;
  if (!env.DB) throw new IdentityStoreUnavailable("db_unbound");

  const [codeHash, stateHash] = await Promise.all([sha256Hex(code), sha256Hex(state)]);
  let row: IdentityHandoffRow | undefined;
  try {
    const result = await env.DB.prepare(
      `DELETE FROM ${HANDOFF_TABLE}
       WHERE code_hash = ? AND state_hash = ? AND source_host = ? AND expires_at > ?
       RETURNING source_host, target_path, sub, email, auth_at`,
    ).bind(codeHash, stateHash, sourceHost, now).all<IdentityHandoffRow>();
    if (result.success !== true) throw new IdentityStoreUnavailable("delete_failed");
    row = result.results?.[0];
  } catch (error) {
    if (error instanceof IdentityStoreUnavailable) throw error;
    throw new IdentityStoreUnavailable("delete_failed", { cause: error });
  }

  if (!row) return null;
  if (
    row.source_host !== sourceHost ||
    !row.sub || row.sub.length > 512 ||
    !row.email || row.email.length > 254 ||
    !Number.isSafeInteger(row.auth_at) || row.auth_at < 0 ||
    safeIdentityTarget(row.target_path) !== row.target_path
  ) return null;
  return {
    sourceHost: row.source_host,
    targetPath: row.target_path,
    sub: row.sub,
    email: row.email,
    authAt: row.auth_at,
  };
}
