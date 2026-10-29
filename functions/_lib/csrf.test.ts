/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** CSRF double-submit protection tests; no real secrets are read. */

import { describe, expect, it } from "vitest";
import type { Env } from "./env";
import { createCsrfToken, csrfCookieHeader, verifyCsrf } from "./csrf";

const env = {
  SESSION_HMAC_KEY: "csrf-test-secret",
  GATE_HMAC_KEY: "csrf-test-gate",
} as Env;

const SID_A = "sid-a";
const SID_B = "sid-b";

function request(
  origin: string,
  token: string,
  cookieToken = token,
  method = "POST",
): Request {
  return new Request("https://account.comicine.com/api/apple-account/accounts/1/reveal", {
    method,
    headers: {
      Origin: origin,
      "X-CSRF-Token": token,
      Cookie: `comicine_csrf=${cookieToken}`,
    },
  });
}

describe("csrf", () => {
  it("round-trips a signed token with matching cookie and header", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("https://account.comicine.com", token), SID_A)).toBe(true);
  });

  it("rejects missing or mismatched header/cookie", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("https://account.comicine.com", "", token), SID_A)).toBe(false);
    expect(
      await verifyCsrf(env, request("https://account.comicine.com", token, "different"), SID_A),
    ).toBe(false);
  });

  it("rejects a token issued for a different session", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("https://account.comicine.com", token), SID_B)).toBe(false);
// The same token remains valid in its own session, ruling out a false pass caused by rejecting every signature.
    expect(await verifyCsrf(env, request("https://account.comicine.com", token), SID_A)).toBe(true);
  });

  it("rejects an empty session id even when the signature matches", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("https://account.comicine.com", token), "")).toBe(false);
    await expect(createCsrfToken(env, "")).rejects.toThrow();
  });

  it("rejects cross-site origins", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("https://evil.example", token), SID_A)).toBe(false);
  });

  it("rejects localhost origins unless ALLOW_LOCAL_ORIGINS=1 is set", async () => {
    const { token } = await createCsrfToken(env, SID_A);
    expect(await verifyCsrf(env, request("http://localhost:8788", token), SID_A)).toBe(false);
    expect(await verifyCsrf(env, request("http://127.0.0.1:8080", token), SID_A)).toBe(false);

    const localEnv = { ...env, ALLOW_LOCAL_ORIGINS: "1" } as Env;
    expect(await verifyCsrf(localEnv, request("http://localhost:8788", token), SID_A)).toBe(true);
    expect(await verifyCsrf(localEnv, request("http://127.0.0.1:8080", token), SID_A)).toBe(true);
// Treat every value except "1" as disabled.
    const offEnv = { ...env, ALLOW_LOCAL_ORIGINS: "true" } as Env;
    expect(await verifyCsrf(offEnv, request("http://localhost:8788", token), SID_A)).toBe(false);
  });

  it("cookie header is not HttpOnly and can be read by JavaScript", () => {
    const header = csrfCookieHeader("token", true);
    expect(header).not.toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Secure");
  });
});
