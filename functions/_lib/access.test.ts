/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
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
import type { Env } from "./env";

const TEAM = "https://limooo.cloudflareaccess.com";
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
    email: "lime@limooo.cn",
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
    expect(accessTeamDomain({ ...baseEnv, ACCESS_TEAM_DOMAIN: "limooo.cloudflareaccess.com/" })).toBe(
      TEAM,
    );
    expect(accessTeamDomain({ ...baseEnv, ACCESS_TEAM_DOMAIN: "" })).toBe("");
  });

  it("jwks / logout endpoints are built from the team domain", () => {
    expect(accessJwksUrl(baseEnv)).toBe(`${TEAM}/cdn-cgi/access/certs`);
    expect(accessLogoutUrl(baseEnv, "https://limooo.cn/")).toBe(
      `${TEAM}/cdn-cgi/access/logout?redirect_url=${encodeURIComponent("https://limooo.cn/")}`,
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
    const req = new Request("https://visitor.limooo.cn/", {
      headers: { "Cf-Access-Jwt-Assertion": "tok" },
    });
    expect(accessAssertion(req)).toBe("tok");
    expect(accessAssertion(new Request("https://visitor.limooo.cn/"))).toBeNull();
  });
});

describe("verifyAccessJwt", () => {
  it("a valid identity-app token returns its verified identity", async () => {
    const identity = await verifyAccessJwt(baseEnv, await signToken(baseClaims()));
    expect(identity).not.toBeNull();
    expect(identity?.email).toBe("lime@limooo.cn");
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
