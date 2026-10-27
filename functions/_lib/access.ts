/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Cloudflare Access JWT validation (tasks/17 §11.6 / §11.10).
 *
 * Access runs before Pages and passes the authenticated identity to the Worker
 * in the `Cf-Access-Jwt-Assertion` header (browsers also use the
 * `CF_Authorization` cookie). **The Worker must verify the signature itself**
 * (see the official Validate JWTs guide), or forged headers could impersonate
 * an administrator.
 *
 * Design decisions:
 * - This module verifies the single Access application for the identity host.
 *   The source-site host determines the local role after the verified identity
 *   is returned through a short-lived, one-time handoff.
 * - Store the team domain and application AUD in Pages environment variables,
 *   not in `config-contract.json`. Access is an edge-only capability, so these
 *   values should not appear in build output.
 */

import type { Env } from "./env";

export interface AccessIdentity {
  sub: string;
  email: string;
  expiresAt: number;
}

interface JwkLike {
  kid?: string;
  n?: string;
  e?: string;
  kty?: string;
  alg?: string;
  use?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface AccessClaims {
  sub?: string;
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
}

const textEncoder = new TextEncoder();
const JWKS_TIMEOUT_MS = 8000;
const JWKS_TTL_MS = 3600_000;
const CLOCK_SKEW_SECONDS = 60;
const MAX_JWT_LENGTH = 16 * 1024;

let jwksCache: { url: string; keys: JwkLike[]; fetchedAt: number } | null = null;

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** Return the team domain, such as https://comicine.cloudflareaccess.com, or an empty string if missing. */
export function accessTeamDomain(env: Env): string {
  const raw = (env.ACCESS_TEAM_DOMAIN ?? "").trim();
  if (!raw) return "";
  return stripTrailingSlash(raw.startsWith("http") ? raw : `https://${raw}`);
}

export function accessJwksUrl(env: Env): string {
  const base = accessTeamDomain(env);
  return base ? `${base}/cdn-cgi/access/certs` : "";
}

export function accessLogoutUrl(env: Env, redirectUrl: string): string {
  const base = accessTeamDomain(env);
  if (!base) return redirectUrl;
  return `${base}/cdn-cgi/access/logout?redirect_url=${encodeURIComponent(redirectUrl)}`;
}

/** Report only the field name for configuration errors; never expose secret values. */
export function accessConfigError(env: Env): string | null {
  if (!accessTeamDomain(env)) return "missing_ACCESS_TEAM_DOMAIN";
  if (!(env.ACCESS_IDENTITY_AUD ?? "").trim()) return "missing_ACCESS_IDENTITY_AUD";
  return null;
}

function b64urlDecode(input: string): Uint8Array {
  if (!input || !/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
    throw new Error("invalid_base64url");
  }
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebCrypto accepts only ArrayBuffer-backed views; TypeScript Uint8Array defaults to ArrayBufferLike. */
function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

function decodeJson<T>(input: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(input))) as T;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and cache signing keys.
 *
 * `force` **bypasses the TTL for one refetch when a kid is missing**. Cloudflare
 * rotates signing keys every six weeks, so a new kid may be absent from our
 * one-hour cache. Without a refetch, tokens signed with the new key are
 * rejected until expiry (`/login` returns 401 and protected subdomains loop
 * through 302s). If refetching fails, use the previous cache so a transient
 * network failure does not prevent everyone from signing in.
 */
async function fetchJwks(env: Env, force = false): Promise<JwkLike[] | { error: string }> {
  const url = accessJwksUrl(env);
  if (!url) return { error: "missing_ACCESS_TEAM_DOMAIN" };
  if (
    !force &&
    jwksCache &&
    jwksCache.url === url &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }
  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", "User-Agent": "comicine-pages/1.0" } },
      JWKS_TIMEOUT_MS,
    );
    if (!resp.ok) return { error: `jwks_http_${resp.status}` };
    const body = (await resp.json()) as { keys?: JwkLike[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (!keys.length) return { error: "jwks_empty" };
    jwksCache = { url, keys, fetchedAt: Date.now() };
    return keys;
  } catch {
// Fall back to the previous cache when fetching fails. Cloudflare rotates
// signing keys every six weeks, and one transient network failure during
// rotation must not block everyone from signing in.
    if (jwksCache && jwksCache.url === url) return jwksCache.keys;
    return { error: "jwks_fetch_exception" };
  }
}

async function verifySignature(
  signingInput: string,
  signature: Uint8Array,
  key: JwkLike,
): Promise<boolean> {
  if (key.kty !== "RSA" || !key.n || !key.e) return false;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: key.n, e: key.e, alg: "RS256" },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    copyBytes(signature),
    copyBytes(textEncoder.encode(signingInput)),
  );
}

/**
 * Validate an Access JWT. Return null on any failure (fail closed); do not throw.
 *
 * The order is deliberate: **verify the signature before reading claims**.
 * Never make decisions from an unverified payload.
 */
export async function verifyAccessJwt(
  env: Env,
  token: string | null | undefined,
): Promise<AccessIdentity | null> {
  if (!token || token.length > MAX_JWT_LENGTH) return null;
  const expectedIssuer = accessTeamDomain(env);
  if (!expectedIssuer) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  let header: JwtHeader;
  try {
    header = decodeJson<JwtHeader>(parts[0]);
  } catch {
    return null;
  }
// Accept only RS256; explicitly reject alg:none and all downgraded algorithms.
  if (header.alg !== "RS256") return null;

  const pickKey = (keys: JwkLike[]): JwkLike | undefined =>
    keys.find((item) => (header.kid ? item.kid === header.kid : item.kty === "RSA"));

  let jwks = await fetchJwks(env);
  if (!Array.isArray(jwks)) return null;
  let key = pickKey(jwks);
  if (!key && header.kid) {
// A missing kid may mean Cloudflare rotated keys before our cache expired.
// Refetch once while bypassing the TTL to avoid an hour-long login outage.
    jwks = await fetchJwks(env, true);
    if (!Array.isArray(jwks)) return null;
    key = pickKey(jwks);
  }
  if (!key) return null;

  let signature: Uint8Array;
  try {
    signature = b64urlDecode(parts[2]);
  } catch {
    return null;
  }

  let signatureOk = false;
  try {
    signatureOk = await verifySignature(`${parts[0]}.${parts[1]}`, signature, key);
  } catch {
    return null;
  }
  if (!signatureOk) return null;

  let claims: AccessClaims;
  try {
    claims = decodeJson<AccessClaims>(parts[1]);
  } catch {
    return null;
  }

  if (stripTrailingSlash(String(claims.iss ?? "")) !== expectedIssuer) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS) return null;
  if (typeof claims.iat === "number" && claims.iat > now + CLOCK_SKEW_SECONDS) return null;

  const expectedAud = (env.ACCESS_IDENTITY_AUD ?? "").trim();
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!expectedAud || !auds.includes(expectedAud)) return null;

  const sub = String(claims.sub ?? "").trim();
  if (!sub) return null;
  const email = String(claims.email ?? "").trim();

  return {
    sub: `access:${sub}`,
    email: email || sub,
    expiresAt: claims.exp,
  };
}

/** Read the identity header injected by Access for login.ts. */
export function accessAssertion(request: Request): string | null {
  return request.headers.get("Cf-Access-Jwt-Assertion");
}
