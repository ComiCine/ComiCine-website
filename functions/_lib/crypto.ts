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

/**
 * Shared cryptographic and encoding primitives for Pages Functions.
 *
 * These implementations were duplicated across csrf.ts, gate.ts, logging.ts,
 * and session.ts (toHex ×4, hmacSha256Hex ×4, timingSafeEqual ×3, and
 * toB64Url ×2). Security-sensitive constant-time comparisons and HMAC code
 * should have one consistent implementation, so they are centralized here.
 *
 * Keep only **semantics-free** primitives here. Business logic, such as
 * verifyPayload's token structure validation, remains in its owning module.
 */

const textEncoder = new TextEncoder();

/** Convert bytes to a lowercase hexadecimal string. */
export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** Convert bytes to unpadded base64url, safe for cookie values and JWTs. */
export function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode unpadded base64url to bytes. */
export function fromB64Url(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Maximum number of cached `importKey` results.
 *
 * The repository uses only a few HMAC keys: `GATE_HMAC_KEY`,
 * `SESSION_HMAC_KEY`, and caller-provided IP hashing keys. Fewer than eight
 * distinct keys are active at once, so eight entries cover current and
 * recently rotated keys plus test keys. The cap is not required for
 * correctness; it prevents unbounded memory growth if key strings are
 * uncontrolled.
 */
const HMAC_KEY_CACHE_LIMIT = 8;

/**
 * HMAC signing-key cache: key string -> imported CryptoKey.
 *
 * **The complete key string is the cache key**; do not bucket by prefix or
 * length. A rotated key naturally misses and is imported once. The old entry
 * remains useful during rotation because existing session and gate cookies
 * are still verified with the old key. Prefix-based buckets could put
 * different keys in one slot and return the wrong CryptoKey, producing an
 * invalid signature.
 *
 * Bounded policy: Map insertion order tracks LRU order. On a hit, delete and
 * reinsert the entry to move it to the end; over the limit, remove
 * `keys().next().value`, the least recently used entry. LRU is preferable to
 * clearing everything because old and new keys are both active during
 * rotation. The eight-entry limit makes individual eviction inexpensive.
 *
 * The cache is scoped to a process or Worker isolate. Each isolate keeps its
 * own copy; `importKey` is a reentrant pure operation, so these copies are
 * equivalent and safe. Failed imports are not cached: the exception propagates
 * and the next call retries.
 */
const hmacKeyCache = new Map<string, CryptoKey>();

/** Get or import an HMAC-SHA256 key; reuse the same CryptoKey for each key string. */
async function hmacSigningKey(key: string): Promise<CryptoKey> {
  const cached = hmacKeyCache.get(key);
  if (cached !== undefined) {
// Refresh the LRU position on a cache hit.
    hmacKeyCache.delete(key);
    hmacKeyCache.set(key, cached);
    return cached;
  }
  const imported = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  hmacKeyCache.set(key, imported);
  while (hmacKeyCache.size > HMAC_KEY_CACHE_LIMIT) {
    const oldest = hmacKeyCache.keys().next();
    if (oldest.done) break;
    hmacKeyCache.delete(oldest.value);
  }
  return imported;
}

/** Return an HMAC-SHA256 digest as hexadecimal; callers define key usage and domain separation. */
export async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const cryptoKey = await hmacSigningKey(key);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(data)));
  return toHex(sig);
}

/** Test helper: clear the key cache so each case starts cold. */
export function resetHmacKeyCacheForTests(): void {
  hmacKeyCache.clear();
}

/** Compare strings in constant time to avoid timing leaks during signature validation. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
