/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * CryptoKey cache for `hmacSha256Hex` (tasks/22 follow-up).
 *
 * Verify both properties directly:
 *
 * 1. **Equivalence**: signatures are byte-for-byte identical before and after
 *    caching. Use Node's independent `createHmac` implementation as the
 *    baseline rather than this implementation's old version.
 * 2. **Benefit**: count `importKey` calls by spying on the real
 *    `crypto.subtle.importKey`. Repeated calls with one key should import once;
 *    alternating keys should each import once.
 *
 * The cache is module-level state. Call `resetHmacKeyCacheForTests()` before
 * each case so it starts cold; otherwise the first call may reuse an entry
 * from a previous case and invalidate the call count.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hmacSha256Hex, resetHmacKeyCacheForTests, timingSafeEqual, toHex } from "./crypto";
import { mintGateCookie, readGateCookie } from "./gate";

/** Independent HMAC-SHA256 baseline using Node's built-in implementation. */
function referenceHex(key: string, data: string): string {
  return createHmac("sha256", key).update(data, "utf8").digest("hex");
}

/**
 * Fixed test inputs: short keys, non-ASCII data, and keys that are prefixes of one another.
 *
 * There is **no empty key** here: WebCrypto rejects zero-length HMAC keys
 * (`DataError: Zero-length key is not supported` in Node and Workers). The
 * production callers also fail closed: middleware returns 503 when
 * `GATE_HMAC_KEY` or `SESSION_HMAC_KEY` is empty, before reaching
 * `hmacSha256Hex`. Empty keys are not a required cache input.
 */
const KEYS = {
  gate: "gate-hmac-secret-aaaaaaaaaaaaaaaa",
  session: "session-hmac-secret-bbbbbbbbbbbb",
  rotated: "session-hmac-secret-cccccccccccc",
  short: "k",
  prefix: "session-hmac-secret-bbbbbbbbbbbb-extra",
  unicode: "密钥-🔑-ключ",
} as const;

const DATASETS = {
  empty: "",
  ascii: "issued.expiry",
  json: JSON.stringify({ sub: "user-1", sid: "sid-1", exp: 1790000000 }),
  unicode: "中文-データ-🚀",
  long: "x".repeat(4096),
} as const;

/** Count importKey calls before each case; the spy wraps the real implementation. */
let importKeyCalls = 0;
let importKeySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetHmacKeyCacheForTests();
  importKeyCalls = 0;
  const real = crypto.subtle.importKey.bind(crypto.subtle);
  importKeySpy = vi
    .spyOn(crypto.subtle, "importKey")
    .mockImplementation((...args: Parameters<typeof real>) => {
      importKeyCalls += 1;
      return real(...args);
    });
});

afterEach(() => {
  importKeySpy.mockRestore();
  resetHmacKeyCacheForTests();
});

describe("hmacSha256Hex CryptoKey cache", () => {
  it("matches Node's own HMAC-SHA256 byte for byte across keys and payloads", async () => {
    for (const key of Object.values(KEYS)) {
      for (const data of Object.values(DATASETS)) {
        const actual = await hmacSha256Hex(key, data);
        expect(actual).toBe(referenceHex(key, data));
      }
    }
  });

  it("is stable across repeated and interleaved calls (no cache-induced drift)", async () => {
// Use the first cold-cache signature as the baseline; signatures must remain equal across repeated and alternating keys.
    const baseline = new Map<string, string>();
    for (const key of Object.values(KEYS)) {
      baseline.set(key, await hmacSha256Hex(key, "issued.expiry"));
    }

    for (let round = 0; round < 5; round += 1) {
      for (const [name, key] of Object.entries(KEYS)) {
// Alternate keys by inserting a different key between calls to force cache turnover.
        await hmacSha256Hex(KEYS.gate, `filler-${round}`);
        expect(await hmacSha256Hex(key, "issued.expiry")).toBe(baseline.get(key));
        expect(await hmacSha256Hex(key, "issued.expiry")).toBe(referenceHex(key, "issued.expiry"));
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });

  it("imports the key once for 50 calls with the same key", async () => {
    const expected = referenceHex(KEYS.gate, "payload");
    for (let i = 0; i < 50; i += 1) {
      expect(await hmacSha256Hex(KEYS.gate, `payload-${i}`)).toBe(
        referenceHex(KEYS.gate, `payload-${i}`),
      );
    }
    expect(await hmacSha256Hex(KEYS.gate, "payload")).toBe(expected);
    expect(importKeyCalls).toBe(1);
  });

  it("imports one key each when two keys alternate", async () => {
    for (let i = 0; i < 20; i += 1) {
      await hmacSha256Hex(i % 2 === 0 ? KEYS.gate : KEYS.session, `p-${i}`);
    }
    expect(importKeyCalls).toBe(2);

// The third switch must not import again; both keys are cached.
    await hmacSha256Hex(KEYS.gate, "again");
    await hmacSha256Hex(KEYS.session, "again");
    expect(importKeyCalls).toBe(2);
  });

  it("keeps keys that are prefixes of each other in separate cache slots", async () => {
    await hmacSha256Hex(KEYS.gate, "d");
    await hmacSha256Hex(KEYS.session, "d");
    await hmacSha256Hex(KEYS.prefix, "d");
    await hmacSha256Hex(KEYS.short, "d");
    await hmacSha256Hex(KEYS.unicode, "d");
    expect(importKeyCalls).toBe(5);

// Keys that are prefixes of one another must have separate cache entries.
    expect(await hmacSha256Hex(KEYS.prefix, "d")).toBe(referenceHex(KEYS.prefix, "d"));
    expect(await hmacSha256Hex(KEYS.short, "d")).toBe(referenceHex(KEYS.short, "d"));
    expect(await hmacSha256Hex(KEYS.session, "d")).toBe(referenceHex(KEYS.session, "d"));
    expect(importKeyCalls).toBe(5);
  });

  it("bounds the cache: the 9th distinct key evicts the least recently used one", async () => {
// Fill the eight-entry limit with k0..k7; k8 must evict the least recently used key, k0.
    for (let i = 0; i < 8; i += 1) {
      await hmacSha256Hex(`cache-key-${i}`, "d");
    }
    expect(importKeyCalls).toBe(8);

    await hmacSha256Hex("cache-key-8", "d");
    expect(importKeyCalls).toBe(9);

// k0 was evicted, so the next call must import it again and prove the cache is bounded.
    await hmacSha256Hex("cache-key-0", "d");
    expect(importKeyCalls).toBe(10);

// k8 is still cached and must not be imported again.
    await hmacSha256Hex("cache-key-8", "d");
    expect(importKeyCalls).toBe(10);

// The signature for re-imported k0 must still match the baseline.
    expect(await hmacSha256Hex("cache-key-0", "d")).toBe(referenceHex("cache-key-0", "d"));
  });

  it("evicts the least recently used entry, not merely the oldest one", async () => {
    for (let i = 0; i < 8; i += 1) {
      await hmacSha256Hex(`lru-key-${i}`, "d");
    }
// Touching k0 makes it newest, so k1 should be evicted next.
    await hmacSha256Hex("lru-key-0", "d");
    expect(importKeyCalls).toBe(8);

    await hmacSha256Hex("lru-key-8", "d");
    expect(importKeyCalls).toBe(9);

    await hmacSha256Hex("lru-key-0", "d");
    expect(importKeyCalls).toBe(9); // Still cached.
    await hmacSha256Hex("lru-key-1", "d");
    expect(importKeyCalls).toBe(10); // Evicted.
  });

  it("keeps verifying signatures after a key rotation (old key still works, new key signs new)", async () => {
    const issuedAt = Math.floor(Date.now() / 1000);
    const oldCookie = (await mintGateCookie(KEYS.session)).split(";")[0];
    const oldValue = oldCookie.slice(oldCookie.indexOf("=") + 1);
    const [issuedRaw, expiryRaw, oldSignature] = oldValue.split(".");

// After key rotation, an old cookie's signature must remain byte-for-byte identical and use the **old key**.
    expect(oldSignature).toBe(referenceHex(KEYS.session, `${issuedRaw}.${expiryRaw}`));

    const rotatedCookie = (await mintGateCookie(KEYS.rotated)).split(";")[0];
    const rotatedValue = rotatedCookie.slice(rotatedCookie.indexOf("=") + 1);
    const [, , newSignature] = rotatedValue.split(".");
    expect(newSignature).toBe(referenceHex(KEYS.rotated, `${issuedRaw}.${expiryRaw}`));
    expect(newSignature).not.toBe(oldSignature);
    expect(timingSafeEqual(oldSignature, newSignature)).toBe(false);

// The old key must still validate old cookies; rotation must preserve already-issued credentials.
    const oldState = await readGateCookie(oldValue, KEYS.session);
    expect(oldState.valid).toBe(true);
    expect(oldState.reason).toBe("ok");

// The new key must reject old cookies, or a retired key would still be accepted.
    const mixed = await readGateCookie(oldValue, KEYS.rotated);
    expect(mixed.valid).toBe(false);
    expect(mixed.reason).toBe("bad_signature");

// After rotation, both the cached new key and matching old key must produce stable signatures.
    const callsBefore = importKeyCalls;
    await hmacSha256Hex(KEYS.session, `${issuedRaw}.${expiryRaw}`);
    await hmacSha256Hex(KEYS.rotated, `${issuedRaw}.${expiryRaw}`);
    expect(importKeyCalls).toBe(callsBefore);

    expect(issuedAt).toBeGreaterThan(0);
  });

  it("re-imports after an explicit cache reset (cold start parity)", async () => {
    const warm = await hmacSha256Hex(KEYS.gate, "d");
    expect(importKeyCalls).toBe(1);
    resetHmacKeyCacheForTests();
    expect(await hmacSha256Hex(KEYS.gate, "d")).toBe(warm);
    expect(importKeyCalls).toBe(2);
  });

  it("leaves toHex untouched by the cache", () => {
// Keep toHex behavior unchanged; it is outside this change.
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });
});
