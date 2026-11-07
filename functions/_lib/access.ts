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

import { BASE_URL } from "./config";
import { hmacSha256Hex } from "./crypto";
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
/**
 * How long a data-center cache entry stays readable.
 *
 * Freshness is still one hour: readers compare the embedded `fetchedAt` with
 * `JWKS_TTL_MS`. The longer edge lifetime only keeps a stale copy around, so a
 * failed refetch after the TTL can still verify tokens. That is the same
 * fallback the isolate memory always provided, now visible to every isolate in
 * the data center instead of only the one that fetched the keys.
 */
const JWKS_CACHE_MAX_AGE_SECONDS = 6 * 60 * 60;
/** Synthetic path on our own zone; the entry holds public signing keys only. */
const JWKS_CACHE_PATH = "/__jwks/";
const CLOCK_SKEW_SECONDS = 60;
const MAX_JWT_LENGTH = 16 * 1024;

interface JwksCacheEntry {
  keys: JwkLike[];
  fetchedAt: number;
}

interface JwksCacheLike {
  match(request: Request): Promise<Response | null | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete?(request: Request): Promise<boolean>;
}

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

let jwksCacheProbed = false;

/** The `caches.default` instance, or undefined where the Cache API is unavailable. */
function jwksCacheDefault(): JwksCacheLike | undefined {
  try {
    if (typeof caches === "undefined") return undefined;
    return (caches as unknown as { default?: JwksCacheLike }).default;
  } catch {
    // Some runtimes make the global throw; the cache is only an optimization.
    return undefined;
  }
}

/**
 * Return the data-center cache and report once per isolate whether it works.
 *
 * The Workers docs still say the Cache API is unavailable for Workers behind
 * Access, and the failure mode is undocumented: the global may be missing,
 * `caches.default` may be missing, or the operations may throw. A presence
 * check cannot tell an empty cache from a broken one, so the first call does a
 * tiny put/match/delete roundtrip and logs the result. Later calls only return
 * the cache; the probe never runs again in this isolate.
 *
 * This closes the requirement's blind spot: after a deploy, one `jwks_cache_probe`
 * line per isolate shows `available` plus `roundtrip`, and the `jwks_fetch`
 * lines show whether fetches actually drop.
 */
async function jwksL2Cache(): Promise<JwksCacheLike | undefined> {
  const cache = jwksCacheDefault();
  if (jwksCacheProbed) return cache;
  jwksCacheProbed = true;

  let roundtrip = false;
  let error = "";
  if (cache) {
    try {
      const key = new Request(`${BASE_URL}${JWKS_CACHE_PATH}__probe-${crypto.randomUUID()}`);
      await cache.put(
        key,
        new Response("1", { headers: { "Cache-Control": "public, max-age=60" } }),
      );
      roundtrip = Boolean(await cache.match(key));
      await cache.delete?.(key);
    } catch (caught) {
      error = String(caught);
    }
  }

  console.log(
    JSON.stringify({
      event: "jwks_cache_probe",
      ts: Math.floor(Date.now() / 1000),
      available: cache !== undefined,
      roundtrip,
      error: error.slice(0, 200),
    }),
  );
  return cache;
}

/**
 * Synthetic cache key on our own zone.
 *
 * Salted with a Pages secret so the key cannot be derived from the public team
 * domain: the entry lives in the cache shared with `fetch`, and guessing the URL
 * must not be a way to probe or pre-seed it. Only public keys are stored.
 */
async function jwksCacheRequest(env: Env, url: string): Promise<Request> {
  const hash = await hmacSha256Hex((env.SESSION_HMAC_KEY ?? "").trim(), url);
  return new Request(`${BASE_URL}${JWKS_CACHE_PATH}${hash.slice(0, 32)}`);
}

/** Keep only keys that can verify an RS256 signature; drop rotated or malformed entries. */
function validJwks(value: unknown): JwkLike[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JwkLike => {
    if (!item || typeof item !== "object") return false;
    const key = item as JwkLike;
    return (
      key.kty === "RSA" &&
      typeof key.n === "string" &&
      key.n !== "" &&
      typeof key.e === "string" &&
      key.e !== ""
    );
  });
}

async function readJwksCache(
  cache: JwksCacheLike,
  key: Request,
): Promise<JwksCacheEntry | null> {
  try {
    const cached = await cache.match(key);
    if (!cached) return null;
    const body = (await cached.json()) as { fetchedAt?: unknown; keys?: unknown } | null;
    if (!body || typeof body !== "object") return null;
    if (typeof body.fetchedAt !== "number" || !Number.isFinite(body.fetchedAt)) return null;
    // A corrupt or clock-skewed future timestamp must not look fresh forever.
    if (body.fetchedAt > Date.now() + CLOCK_SKEW_SECONDS * 1000) return null;
    const keys = validJwks(body.keys);
    if (!keys.length) return null;
    return { keys, fetchedAt: body.fetchedAt };
  } catch {
    // A missing, expired, or corrupt entry is a miss, not an error.
    return null;
  }
}

async function writeJwksCache(
  cache: JwksCacheLike,
  key: Request,
  keys: JwkLike[],
  fetchedAt: number,
): Promise<boolean> {
  try {
    await cache.put(
      key,
      new Response(JSON.stringify({ fetchedAt, keys }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${JWKS_CACHE_MAX_AGE_SECONDS}`,
        },
      }),
    );
    // `cache.put` resolves even when the entry was not stored, so `true` means
    // the call was accepted, not that the entry is guaranteed to be present.
    return true;
  } catch {
    // Cache writes are best effort; verification must not depend on them.
    return false;
  }
}

interface JwksFetchLog {
  outcome: "ok" | "http_error" | "empty" | "exception";
  status?: number;
  durationMs: number;
  cache: "miss" | "stale" | "bypass" | "unavailable";
  fallback?: "l1" | "l2";
  keys?: number;
  wroteCache?: boolean;
}

/**
 * Emit one line per real network fetch of the key set.
 *
 * Cache hits stay silent, so counting `event:"jwks_fetch"` lines is the fetch
 * count and `duration_ms` shows what the fetch cost. Never log the keys.
 */
function logJwksFetch(fields: JwksFetchLog): void {
  console.log(
    JSON.stringify({
      event: "jwks_fetch",
      ts: Math.floor(Date.now() / 1000),
      outcome: fields.outcome,
      status: fields.status ?? 0,
      duration_ms: fields.durationMs,
      keys: fields.keys ?? 0,
      cache: fields.cache,
      fallback: fields.fallback ?? "",
      wrote_cache: fields.wroteCache ?? false,
    }),
  );
}

/**
 * Fetch and cache signing keys.
 *
 * Two layers:
 * - L1 is isolate memory, fresh for one hour; it is the fast path.
 * - L2 is `caches.default`, shared by every isolate in the same data center,
 *   so cold starts and new isolates do not download the key set again. Entries
 *   are stored under a synthetic URL on our own zone and hold public keys only.
 *
 * `force` **bypasses both freshness checks for one refetch when a kid is
 * missing**. Cloudflare rotates signing keys every six weeks, so a new kid may
 * be absent from an hour-old cache. Without a refetch, tokens signed with the
 * new key are rejected until expiry (`/login` returns 401 and protected
 * subdomains loop through 302s). If refetching fails, the newest known key set
 * (L1 or L2) is used so a transient network failure does not prevent everyone
 * from signing in.
 */
async function fetchJwks(env: Env, force = false): Promise<JwkLike[] | { error: string }> {
  const url = accessJwksUrl(env);
  if (!url) return { error: "missing_ACCESS_TEAM_DOMAIN" };
  const now = Date.now();
  if (
    !force &&
    jwksCache &&
    jwksCache.url === url &&
    now - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }

  // Keep the newest copy seen so far; it is reused if the refetch fails.
  let stale: JwksCacheEntry | null =
    jwksCache && jwksCache.url === url
      ? { keys: jwksCache.keys, fetchedAt: jwksCache.fetchedAt }
      : null;
  let staleFrom: "l1" | "l2" = "l1";

  const cache = await jwksL2Cache();
  let cacheKey: Request | null = null;
  if (cache) {
    try {
      cacheKey = await jwksCacheRequest(env, url);
    } catch {
      cacheKey = null;
    }
  }
  let cacheState: JwksFetchLog["cache"] = cacheKey ? "miss" : "unavailable";

  if (cache && cacheKey) {
    const entry = await readJwksCache(cache, cacheKey);
    if (entry) {
      if (!stale || entry.fetchedAt > stale.fetchedAt) {
        stale = entry;
        staleFrom = "l2";
      }
      if (!force && now - entry.fetchedAt < JWKS_TTL_MS) {
        jwksCache = { url, keys: entry.keys, fetchedAt: entry.fetchedAt };
        return entry.keys;
      }
      cacheState = force ? "bypass" : "stale";
    }
  }

  const startedAt = Date.now();
  const fallback = (
    error: string,
    outcome: JwksFetchLog["outcome"],
    status = 0,
  ): JwkLike[] | { error: string } => {
    logJwksFetch({
      outcome,
      status,
      durationMs: Date.now() - startedAt,
      cache: cacheState,
      fallback: stale ? staleFrom : undefined,
    });
    return stale ? stale.keys : { error };
  };

  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json", "User-Agent": "comicine-pages/1.0" } },
      JWKS_TIMEOUT_MS,
    );
    // After the TTL a transient 5xx/429 must still fall back to the previous keys;
    // otherwise every login returns 401 while the cached keys would verify fine.
    if (!resp.ok) return fallback(`jwks_http_${resp.status}`, "http_error", resp.status);
    const body = (await resp.json()) as { keys?: unknown };
    const keys = validJwks(body?.keys);
    if (!keys.length) return fallback("jwks_empty", "empty");
    const fetchedAt = Date.now();
    // Report fetch + parse time, not the time spent waiting for the cache write.
    const durationMs = fetchedAt - startedAt;
    jwksCache = { url, keys, fetchedAt };
    let wroteCache = false;
    if (cache && cacheKey) wroteCache = await writeJwksCache(cache, cacheKey, keys, fetchedAt);
    logJwksFetch({
      outcome: "ok",
      status: resp.status,
      durationMs,
      cache: cacheState,
      keys: keys.length,
      wroteCache,
    });
    return keys;
  } catch {
    // Cloudflare rotates signing keys every six weeks, and one transient network
    // failure during rotation must not block everyone from signing in.
    return fallback("jwks_fetch_exception", "exception");
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
  if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= now) {
    return null;
  }
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_SECONDS) return null;
  if (typeof claims.iat === "number" && claims.iat > now + CLOCK_SKEW_SECONDS) return null;

  const expectedAud = (env.ACCESS_IDENTITY_AUD ?? "").trim();
  const auds = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!expectedAud || !auds.includes(expectedAud)) return null;

  const sub = String(claims.sub ?? "").trim();
  if (!sub || sub.length > 512) return null;
  const email = String(claims.email ?? "").trim();
  if (email.length > 254) return null;

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
