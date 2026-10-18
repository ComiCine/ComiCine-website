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

/** Short-lived, one-time handoffs from the shared Access identity app to Limooo sites. */

import { IDENTITY_SITE_ROLES } from "./config";
import { safeNextPath } from "./routing";
import { randomToken } from "./session";
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

export async function consumeIdentityHandoff(
  env: Env,
  code: string,
  sourceHost: string,
  state: string,
  now = Math.floor(Date.now() / 1000),
): Promise<ConsumedIdentityHandoff | null> {
  if (!env.DB || !isIdentitySite(sourceHost) || !TOKEN_PATTERN.test(code) || !TOKEN_PATTERN.test(state)) return null;

  try {
    const [codeHash, stateHash] = await Promise.all([sha256Hex(code), sha256Hex(state)]);
    const result = await env.DB.prepare(
      `DELETE FROM ${HANDOFF_TABLE}
       WHERE code_hash = ? AND state_hash = ? AND source_host = ? AND expires_at > ?
       RETURNING source_host, target_path, sub, email, auth_at`,
    ).bind(codeHash, stateHash, sourceHost, now).all<IdentityHandoffRow>();
    const row = result.results?.[0];
    if (result.success !== true || !row) return null;
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
  } catch {
    return null;
  }
}

export function newIdentityState(): string {
  return randomToken(32);
}
