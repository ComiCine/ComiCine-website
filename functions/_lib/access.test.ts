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
  roleForAud,
  verifyAccessJwt,
} from "./access";
import type { Env } from "./env";

const TEAM = "https://limooo.cloudflareaccess.com";
const KID = "access-kid";
const ADMIN_AUD = "0e7b7592c7b571b80a27228a4317d7e599d1c6470e7ed303047659b46c68e0dc";
const VIEWER_AUD = "viewer-aud-0000";

const baseEnv: Env = {
  TURNSTILE_SITEKEY: "site",
  TURNSTILE_SECRET: "secret",
  GATE_HMAC_KEY: "gate",
  SESSION_HMAC_KEY: "session",
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_ADMIN_AUDS: ADMIN_AUD,
  ACCESS_VIEWER_AUDS: VIEWER_AUD,
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
    aud: [ADMIN_AUD],
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
    expect(accessConfigError({ ...baseEnv, ACCESS_ADMIN_AUDS: "", ACCESS_VIEWER_AUDS: "" })).toBe(
      "missing_ACCESS_AUDS",
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

describe("roleForAud", () => {
  it("admin AUD takes precedence over viewer AUD", () => {
    expect(roleForAud(baseEnv, [ADMIN_AUD])).toBe("admin");
    expect(roleForAud(baseEnv, [VIEWER_AUD])).toBe("viewer");
    expect(roleForAud(baseEnv, [VIEWER_AUD, ADMIN_AUD])).toBe("admin");
  });

  it("unregistered AUD / empty value returns null", () => {
    expect(roleForAud(baseEnv, ["someone-else"])).toBeNull();
    expect(roleForAud(baseEnv, [])).toBeNull();
    expect(roleForAud(baseEnv, undefined)).toBeNull();
  });
});

describe("verifyAccessJwt", () => {
  it("a valid token passes and maps to admin", async () => {
    const identity = await verifyAccessJwt(baseEnv, await signToken(baseClaims()));
    expect(identity).not.toBeNull();
    expect(identity?.role).toBe("admin");
    expect(identity?.email).toBe("lime@limooo.cn");
    expect(identity?.sub).toBe("access:user-sub-1");
  });

  it("a viewer AUD maps to viewer", async () => {
    const identity = await verifyAccessJwt(baseEnv, await signToken(baseClaims({ aud: [VIEWER_AUD] })));
    expect(identity?.role).toBe("viewer");
  });

  it("rejects a mismatched iss", async () => {
    const token = await signToken(baseClaims({ iss: "https://evil.cloudflareaccess.com" }));
    expect(await verifyAccessJwt(baseEnv, token)).toBeNull();
  });

  it("rejects an unregistered aud", async () => {
    const token = await signToken(baseClaims({ aud: ["unregistered-aud"] }));
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
