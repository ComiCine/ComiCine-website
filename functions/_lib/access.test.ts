/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Cloudflare Access JWT validation tests (the seven cases specified in tasks/17 §11.6).
 *
 * Sign real JWTs with a locally generated RS256 key. Accept valid tokens and
 * reject mismatched iss, unregistered aud, expired tokens, alg:none, modified
 * payloads, and empty tokens.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accessAssertion,
  accessConfigError,
  accessJwksUrl,
  accessLogoutUrl,
  accessTeamDomain,
  verifyAccessJwt,
} from "./access";
import { BASE_URL } from "./config";
import type { Env } from "./env";

const TEAM = "https://comicine.cloudflareaccess.com";
const KID = "access-kid";
const IDENTITY_AUD = "identity-aud-0000";

const baseEnv: Env = {
  TURNSTILE_SITEKEY: "site",
  TURNSTILE_SECRET: "secret",
  GATE_HMAC_KEY: "gate",
  SESSION_HMAC_KEY: "session",
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_IDENTITY_AUD: IDENTITY_AUD,
};

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signToken(
  claims: Record<string, unknown>,
  alg = "RS256",
  kid: string = KID,
): Promise<string> {
  const header = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  if (alg !== "RS256") return `${signingInput}.${b64url("bogus-signature")}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64url(signature)}`;
}

function baseClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "user-sub-1",
    email: "lime@comicine.com",
    iss: TEAM,
    aud: [IDENTITY_AUD],
    exp: now + 600,
    iat: now - 10,
    nbf: now - 10,
    ...overrides,
  };
}

// Generate the key once because access.ts caches JWKS at module scope for one
// hour; using a different key in each case would contaminate the others.
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/cdn-cgi/access/certs")) {
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, use: "sig" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("access helpers", () => {
  it("team domain gains a scheme and loses the trailing slash", () => {
    expect(accessTeamDomain({ ...baseEnv, ACCESS_TEAM_DOMAIN: "comicine.cloudflareaccess.com/" })).toBe(
      TEAM,
    );
    expect(accessTeamDomain({ ...baseEnv, ACCESS_TEAM_DOMAIN: "" })).toBe("");
  });

  it("jwks / logout endpoints are built from the team domain", () => {
    expect(accessJwksUrl(baseEnv)).toBe(`${TEAM}/cdn-cgi/access/certs`);
    expect(accessLogoutUrl(baseEnv, "https://comicine.com/")).toBe(
      `${TEAM}/cdn-cgi/access/logout?redirect_url=${encodeURIComponent("https://comicine.com/")}`,
    );
  });

  it("fails closed on missing team domain / AUD, naming only the field", () => {
    expect(accessConfigError({ ...baseEnv, ACCESS_TEAM_DOMAIN: "" })).toBe(
      "missing_ACCESS_TEAM_DOMAIN",
    );
    expect(accessConfigError({ ...baseEnv, ACCESS_IDENTITY_AUD: "" })).toBe(
      "missing_ACCESS_IDENTITY_AUD",
    );
    expect(accessConfigError(baseEnv)).toBeNull();
  });

  it("reads the identity header injected by Access", () => {
    const req = new Request("https://visitor.comicine.com/", {
      headers: { "Cf-Access-Jwt-Assertion": "tok" },
    });
    expect(accessAssertion(req)).toBe("tok");
    expect(accessAssertion(new Request("https://visitor.comicine.com/"))).toBeNull();
  });
});

describe("verifyAccessJwt", () => {
  it("a valid identity-app token returns its verified identity", async () => {
    const identity = await verifyAccessJwt(baseEnv, await signToken(baseClaims()));
    expect(identity).not.toBeNull();
    expect(identity?.email).toBe("lime@comicine.com");
    expect(identity?.sub).toBe("access:user-sub-1");
  });

  it("rejects a mismatched iss", async () => {
    const token = await signToken(baseClaims({ iss: "https://evil.cloudflareaccess.com" }));
    expect(await verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("rejects a token from another Access application", async () => {
    const token = await signToken(baseClaims({ aud: ["another-app-aud"] }));
    expect(await verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signToken(baseClaims({ exp: Math.floor(Date.now() / 1000) - 5 }));
    expect(await verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("rejects alg:none", async () => {
    expect(await verifyAccessJwt(baseEnv, await signToken(baseClaims(), "none"))).toBeNull();
  });

  it("rejects a tampered payload whose signature no longer matches", async () => {
    const token = await signToken(baseClaims());
    const [header, , signature] = token.split(".");
    const tampered = b64url(JSON.stringify(baseClaims({ email: "attacker@evil.com" })));
    expect(await verifyAccessJwt(baseEnv, `${header}.${tampered}.${signature}`)).toBeNull();
  });

  it("rejects empty / malformed tokens", async () => {
    expect(await verifyAccessJwt(baseEnv, "")).toBeNull();
    expect(await verifyAccessJwt(baseEnv, null)).toBeNull();
    expect(await verifyAccessJwt(baseEnv, undefined)).toBeNull();
    expect(await verifyAccessJwt(baseEnv, "not-a-jwt")).toBeNull();
    expect(await verifyAccessJwt(baseEnv, "a.b")).toBeNull();
  });

  it("rejects a future nbf", async () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    expect(await verifyAccessJwt(baseEnv, await signToken(baseClaims({ nbf: future })))).toBeNull();
  });

  it("rejects a missing sub", async () => {
    const token = await signToken(baseClaims({ sub: "" }));
    expect(await verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("fails closed with no team domain (issues no request)", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const token = await signToken(baseClaims());
    expect(await verifyAccessJwt({ ...baseEnv, ACCESS_TEAM_DOMAIN: "" }, token)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects when JWKS fetch fails and nothing is cached", async () => {
// Run this case with a cold cache or it may reuse an entry left by an earlier case.
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    const token = await signToken(baseClaims());
    expect(await cold.verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("reuses the cache when JWKS fetch fails but a cache exists", async () => {
// Warm the cache once, then simulate a network failure.
    expect(await verifyAccessJwt(baseEnv, await signToken(baseClaims()))).not.toBeNull();
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    const token = await signToken(baseClaims());
    expect(await verifyAccessJwt(baseEnv, token)).not.toBeNull();
  });

  it("falls back to cached JWKS when a refetch after the TTL returns HTTP 500", async () => {
    vi.resetModules();
    const fresh = await import("./access");
    vi.useFakeTimers();
    const start = new Date("2026-01-01T00:00:00Z");
    vi.setSystemTime(start);
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, use: "sig" }] }), {
          status: 200,
        });
      }
      return new Response("boom", { status: 500 });
    });

    const expiresAt = Math.floor(start.getTime() / 1000) + 86_400;
    const token = await signToken(baseClaims({ exp: expiresAt }));
    expect(await fresh.verifyAccessJwt(baseEnv, token)).not.toBeNull();

    // Past the one-hour cache TTL: the refetch fails, but the cached key still verifies.
    vi.setSystemTime(new Date(start.getTime() + 2 * 60 * 60 * 1000));
    expect(await fresh.verifyAccessJwt(baseEnv, token)).not.toBeNull();
    expect(calls).toBe(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refetches JWKS once when the token's kid is not in the cache", async () => {
// Cloudflare rotates signing keys every six weeks. With a one-hour cache that
// does not refresh on a kid miss, new tokens are rejected until expiry, causing
// /login 401s and 302 loops on protected subdomains.
    vi.resetModules();
    const fresh = await import("./access");

// Warm the cache with only the old kid.
    let jwksCalls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/cdn-cgi/access/certs")) return new Response("not found", { status: 404 });
      jwksCalls += 1;
      const kid = jwksCalls === 1 ? "old-kid" : KID;
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid, use: "sig" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const warm = await fresh.verifyAccessJwt(
      baseEnv,
      await signToken(baseClaims(), "RS256", "old-kid"),
    );
    expect(warm).not.toBeNull();
    const callsAfterWarm = jwksCalls;

// After rotation, a missing kid must bypass the TTL, refetch JWKS, and validate the token.
    const rotated = await signToken(baseClaims(), "RS256", KID);
    expect(await fresh.verifyAccessJwt(baseEnv, rotated)).not.toBeNull();
    expect(jwksCalls).toBe(callsAfterWarm + 1);
  });

  it("does not refetch when the kid is already cached", async () => {
    vi.resetModules();
    const fresh = await import("./access");
    let jwksCalls = 0;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/cdn-cgi/access/certs")) return new Response("not found", { status: 404 });
      jwksCalls += 1;
      return new Response(JSON.stringify({ keys: [{ ...publicJwk, kid: KID, use: "sig" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const token = await signToken(baseClaims());
    expect(await fresh.verifyAccessJwt(baseEnv, token)).not.toBeNull();
    expect(await fresh.verifyAccessJwt(baseEnv, token)).not.toBeNull();
    expect(jwksCalls).toBe(1);
  });
});

/**
 * The isolate memory (L1) is covered above; these cases drive the data-center
 * Cache API (L2) with a fake `caches.default` store. Node has no Cache API, so
 * installing and removing the stub also exercises the production degradation
 * path where `caches` is unavailable.
 */
describe("JWKS cache layers", () => {
  interface FakeJwksCache {
    store: Map<string, Response>;
    match: ReturnType<typeof vi.fn<(request: Request) => Promise<Response | undefined>>>;
    put: ReturnType<typeof vi.fn<(request: Request, response: Response) => Promise<void>>>;
    delete: ReturnType<typeof vi.fn<(request: Request) => Promise<boolean>>>;
  }

  function defaultJwks(): Array<Record<string, unknown>> {
    return [{ ...publicJwk, kid: KID, use: "sig" }];
  }

  function jwksResponse(keys: Array<Record<string, unknown>>): Response {
    return new Response(JSON.stringify({ keys }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function installFakeJwksCache(): FakeJwksCache {
    const store = new Map<string, Response>();
    const cache = {
      store,
      match: vi.fn(async (request: Request) => {
        const hit = store.get(request.url);
        return hit ? hit.clone() : undefined;
      }),
      put: vi.fn(async (request: Request, response: Response) => {
        store.set(request.url, response.clone());
      }),
      delete: vi.fn(async (request: Request) => store.delete(request.url)),
    };
    vi.stubGlobal("caches", { default: cache });
    return cache;
  }

  /** Count cache writes of the real entry, ignoring the isolate's one-shot probe entry. */
  function realJwksPuts(fake: FakeJwksCache): number {
    return fake.put.mock.calls.filter(
      ([request]: [Request, Response]) =>
        request.url.includes("/__jwks/") && !request.url.includes("__probe-"),
    ).length;
  }

  async function verifyWith(fresh: typeof import("./access")): Promise<unknown> {
    return fresh.verifyAccessJwt(baseEnv, await signToken(baseClaims()));
  }

  /** Run one real fetch so the module writes its cache entry, then return the fake cache. */
  async function seedJwksCache(): Promise<{ fake: FakeJwksCache; key: string }> {
    const fake = installFakeJwksCache();
    vi.resetModules();
    const warm = await import("./access");
    vi.stubGlobal("fetch", async () => jwksResponse(defaultJwks()));
    expect(await verifyWith(warm)).not.toBeNull();
    expect(realJwksPuts(fake)).toBe(1);
    const key = [...fake.store.keys()][0];
    const keyUrl = new URL(key);
    expect(keyUrl.origin).toBe(new URL(BASE_URL).origin);
    expect(keyUrl.pathname).toMatch(/^\/__jwks\/[0-9a-f]{32}$/);
    return { fake, key };
  }

  /** Rewrite the stored entry with an old timestamp so the next read sees it as expired. */
  async function ageCacheEntry(fake: FakeJwksCache, fetchedAt: number): Promise<void> {
    const key = [...fake.store.keys()][0];
    const body = (await fake.store.get(key)!.clone().json()) as { keys: unknown };
    fake.store.set(
      key,
      new Response(JSON.stringify({ fetchedAt, keys: body.keys }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" },
      }),
    );
  }

  it("a cold isolate reads the data-center cache instead of refetching", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { fake, key } = await seedJwksCache();
      const stored = (await fake.store.get(key)!.clone().json()) as {
        fetchedAt: number;
        keys: unknown[];
      };
      expect(typeof stored.fetchedAt).toBe("number");
      expect(stored.keys).toHaveLength(1);
      expect(fake.store.get(key)!.headers.get("Cache-Control")).toContain("max-age=21600");

      // A new module instance is a cold isolate: empty memory, same data center.
      let fetches = 0;
      vi.resetModules();
      const cold = await import("./access");
      vi.stubGlobal("fetch", async () => {
        fetches += 1;
        return jwksResponse(defaultJwks());
      });
      expect(await verifyWith(cold)).not.toBeNull();
      expect(fetches).toBe(0);

      // Only the seeding fetch reached the network, and it reported duration and outcome.
      const logs = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_fetch"'));
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0])).toMatchObject({
        event: "jwks_fetch",
        outcome: "ok",
        cache: "miss",
        wrote_cache: true,
        keys: 1,
      });
      expect(Number.isFinite(JSON.parse(logs[0]).duration_ms)).toBe(true);

      // One probe per isolate (the seeding module and the cold module).
      const probes = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_cache_probe"'));
      expect(probes).toHaveLength(2);
      for (const probe of probes) {
        expect(JSON.parse(probe)).toMatchObject({
          event: "jwks_cache_probe",
          available: true,
          roundtrip: true,
          error: "",
        });
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it("uses a fresh entry that is 30 minutes old without refetching", async () => {
    const { fake } = await seedJwksCache();
    await ageCacheEntry(fake, Date.now() - 30 * 60 * 1000);

    let fetches = 0;
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jwksResponse(defaultJwks());
    });
    expect(await verifyWith(cold)).not.toBeNull();
    expect(fetches).toBe(0);
  });

  it("refetches after the one-hour freshness window and replaces the entry", async () => {
    const { fake, key } = await seedJwksCache();
    const old = Date.now() - 61 * 60 * 1000;
    await ageCacheEntry(fake, old);

    let fetches = 0;
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jwksResponse([{ ...publicJwk, kid: "rotated-kid", use: "sig" }]);
    });
    const token = await signToken(baseClaims(), "RS256", "rotated-kid");
    expect(await cold.verifyAccessJwt(baseEnv, token)).not.toBeNull();
    expect(fetches).toBe(1);
    expect(realJwksPuts(fake)).toBe(2);

    const stored = (await fake.store.get(key)!.clone().json()) as {
      fetchedAt: number;
      keys: Array<{ kid?: string }>;
    };
    expect(stored.fetchedAt).toBeGreaterThan(old);
    expect(stored.keys[0]?.kid).toBe("rotated-kid");
  });

  it("keeps verifying with the stale entry when the refetch fails and never overwrites it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { fake, key } = await seedJwksCache();
      const old = Date.now() - 2 * 60 * 60 * 1000;
      await ageCacheEntry(fake, old);
      const putsBefore = realJwksPuts(fake);

      vi.resetModules();
      const cold = await import("./access");
      vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
      expect(await verifyWith(cold)).not.toBeNull();
      expect(realJwksPuts(fake)).toBe(putsBefore);

      const stored = (await fake.store.get(key)!.clone().json()) as { fetchedAt: number };
      expect(stored.fetchedAt).toBe(old);

      const logs = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_fetch"'));
      expect(logs).toHaveLength(2);
      expect(JSON.parse(logs[1])).toMatchObject({
        event: "jwks_fetch",
        outcome: "http_error",
        status: 500,
        fallback: "l2",
        cache: "stale",
      });
    } finally {
      logSpy.mockRestore();
    }
  });

  it("never overwrites the cached copy with an empty or malformed key set", async () => {
    const bodies = ['{"keys":[]}', '{"keys":[{"kty":"EC"}]}', "not-json"];
    for (const body of bodies) {
      vi.unstubAllGlobals();
      const { fake, key } = await seedJwksCache();
      const old = Date.now() - 2 * 60 * 60 * 1000;
      await ageCacheEntry(fake, old);

      vi.resetModules();
      const cold = await import("./access");
      vi.stubGlobal("fetch", async () => new Response(body, { status: 200 }));
      expect(await verifyWith(cold)).not.toBeNull();

      const stored = (await fake.store.get(key)!.clone().json()) as { fetchedAt: number };
      expect(stored.fetchedAt).toBe(old);
      expect(realJwksPuts(fake)).toBe(1);
    }
  });

  it("fails closed when the key set is empty and nothing is cached", async () => {
    vi.stubGlobal("caches", {
      default: { match: async () => undefined, put: async () => undefined },
    });
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => new Response('{"keys":[]}', { status: 200 }));
    expect(await verifyWith(cold)).toBeNull();
  });

  it("ignores a corrupt cached entry and refetches", async () => {
    const { fake, key } = await seedJwksCache();
    fake.store.set(
      key,
      new Response('{"fetchedAt":"yesterday","keys":[]}', {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    let fetches = 0;
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jwksResponse(defaultJwks());
    });
    expect(await verifyWith(cold)).not.toBeNull();
    expect(fetches).toBe(1);
    expect(realJwksPuts(fake)).toBe(2);
  });

  it("a kid miss bypasses the fresh cache and replaces it", async () => {
    const { fake } = await seedJwksCache();

    let fetches = 0;
    vi.resetModules();
    const cold = await import("./access");
    vi.stubGlobal("fetch", async () => {
      fetches += 1;
      return jwksResponse([{ ...publicJwk, kid: "rotated-kid", use: "sig" }]);
    });
    const token = await signToken(baseClaims(), "RS256", "rotated-kid");
    expect(await cold.verifyAccessJwt(baseEnv, token)).not.toBeNull();
    expect(fetches).toBe(1);
    expect(realJwksPuts(fake)).toBe(2);

    const stored = (await [...fake.store.values()][0].clone().json()) as {
      keys: Array<{ kid?: string }>;
    };
    expect(stored.keys[0]?.kid).toBe("rotated-kid");
  });

  it("falls back to isolate memory when the Cache API is absent", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      vi.resetModules();
      const cold = await import("./access");
      let fetches = 0;
      vi.stubGlobal("fetch", async () => {
        fetches += 1;
        return jwksResponse(defaultJwks());
      });
      expect(await verifyWith(cold)).not.toBeNull();
      expect(await verifyWith(cold)).not.toBeNull();
      expect(fetches).toBe(1);

      const probes = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_cache_probe"'));
      expect(probes).toHaveLength(1);
      expect(JSON.parse(probes[0]).available).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("cache read and write failures do not fail the login", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const cache = {
        match: vi.fn(async () => {
          throw new Error("cache unavailable");
        }),
        put: vi.fn(async () => {
          throw new Error("cache write failed");
        }),
      };
      vi.stubGlobal("caches", { default: cache });
      vi.resetModules();
      const cold = await import("./access");
      let fetches = 0;
      vi.stubGlobal("fetch", async () => {
        fetches += 1;
        return jwksResponse(defaultJwks());
      });
      expect(await verifyWith(cold)).not.toBeNull();
      expect(fetches).toBe(1);
      // The probe write and the real write both throw; the fetch still succeeds.
      expect(cache.put).toHaveBeenCalledTimes(2);

      const logs = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_fetch"'));
      expect(logs).toHaveLength(1);
      expect(JSON.parse(logs[0]).wrote_cache).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("reports the Cache API unavailable when the global itself throws", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
    Object.defineProperty(globalThis, "caches", {
      configurable: true,
      get() {
        throw new Error("Cache API unavailable");
      },
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      vi.resetModules();
      const cold = await import("./access");
      vi.stubGlobal("fetch", async () => jwksResponse(defaultJwks()));
      expect(await verifyWith(cold)).not.toBeNull();

      const probes = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('"jwks_cache_probe"'));
      expect(probes).toHaveLength(1);
      expect(JSON.parse(probes[0])).toMatchObject({ available: false, roundtrip: false });
    } finally {
      logSpy.mockRestore();
      if (descriptor) Object.defineProperty(globalThis, "caches", descriptor);
      else delete (globalThis as { caches?: unknown }).caches;
    }
  });
});
