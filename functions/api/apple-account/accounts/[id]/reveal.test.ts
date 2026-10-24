/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Tests for the Apple Account plaintext reveal endpoint: admin access, recent authentication,
 * CSRF, auditing, and fallback behavior without plaintext.
 *
 * The session layer uses the **real implementation** (`requireAuth` → `requireAdminSession` →
 * `requireRecentAdminSession`); only D1, CSRF, Fernet, and logging are stubbed. See
 * `_lib/session.test.ts`: calls within the session module use its local bindings, so `vi.mock`
 * does not replace them. Stubbing the exports directly would test the stubs instead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPost } from "./reveal";
import { queryAll } from "../../../../_lib/d1";
import { createSessionCookie } from "../../../../_lib/session";
import { verifyCsrf } from "../../../../_lib/csrf";
import { fernetDecrypt } from "../../../../_lib/fernet";
import { logEvent } from "../../../../_lib/logging";
import type { Env } from "../../../../_lib/env";

vi.mock("../../../../_lib/d1", () => ({ queryAll: vi.fn(), execute: vi.fn() }));
vi.mock("../../../../_lib/csrf", () => ({ verifyCsrf: vi.fn() }));
vi.mock("../../../../_lib/fernet", () => ({ fernetDecrypt: vi.fn() }));
vi.mock("../../../../_lib/logging", () => ({ logEvent: vi.fn() }));

const env = {
  APPLE_ACCOUNT_ENCRYPTION_KEY: "test-key",
  SESSION_HMAC_KEY: "test-session",
  DB: {},
} as unknown as Env;

/** Fix the current time so assertions can compare authAt with the 600-second reveal window. */
const NOW_SECONDS = 1_800_000_000;

let requestCookie = "";

function context() {
  return {
    request: new Request("https://account.limooo.cn/api/apple-account/accounts/1/reveal", {
      method: "POST",
      headers: {
        Origin: "https://account.limooo.cn",
        "X-CSRF-Token": "valid",
        Cookie: requestCookie,
      },
    }),
    env,
    params: { id: "1" },
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

/** Sign a real session cookie with authAt set `ageSeconds` seconds in the past. */
async function sessionCookie(ageSeconds: number, role: "admin" | "viewer" = "admin"): Promise<string> {
  const header = await createSessionCookie(env, {
    sid: "sid-1",
    sub: "user-1",
    user: { email: `${role}@example.com`, name: role },
    role,
    authAt: NOW_SECONDS - ageSeconds,
  });
  return header.split(";")[0];
}

/** requireAuth allows the request only when this row exists in the D1 revocation table. */
function authRow(role: "admin" | "viewer" = "admin") {
  return {
    sid: "sid-1",
    sub: "user-1",
    role,
    auth_at: NOW_SECONDS,
    exp: 9_999_999_999,
    revoked_at: null,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SECONDS * 1000);
  vi.mocked(queryAll).mockResolvedValue([authRow("admin")]);
  vi.mocked(verifyCsrf).mockResolvedValue(true);
  vi.mocked(fernetDecrypt).mockResolvedValue("plain-password");
  vi.mocked(logEvent).mockResolvedValue();
  requestCookie = await sessionCookie(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("apple-account reveal API", () => {
  it("returns 401/403 before touching data", async () => {
    requestCookie = "";
    expect((await onRequestPost(context() as never)).status).toBe(401);

    vi.mocked(queryAll).mockResolvedValue([authRow("viewer")]);
    requestCookie = await sessionCookie(0, "viewer");
    expect((await onRequestPost(context() as never)).status).toBe(403);
    // A read-only account cannot reveal a password, even immediately after login.
    expect(vi.mocked(fernetDecrypt)).not.toHaveBeenCalled();
  });

  it("returns 401 with reauth:true and audits when authAt is outside the window", async () => {
    requestCookie = await sessionCookie(601);

    const resp = await onRequestPost(context() as never);

    expect(resp.status).toBe(401);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    await expect(resp.json()).resolves.toEqual({ error: "需要重新验证", reauth: true });
    expect(vi.mocked(fernetDecrypt)).not.toHaveBeenCalled();
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      env,
      "audit_event",
      expect.any(Request),
      expect.objectContaining({ outcome: "reauth_required", status: 401 }),
    );
  });

  it("accepts authAt exactly at the window boundary", async () => {
    requestCookie = await sessionCookie(600);
    expect((await onRequestPost(context() as never)).status).toBe(200);
  });

  it("checks the session before CSRF and binds the token to the session id", async () => {
    const resp = await onRequestPost(context() as never);
    expect(resp.status).toBe(200);
    expect(vi.mocked(verifyCsrf)).toHaveBeenCalledWith(env, expect.any(Request), "sid-1");
  });

  it("returns 403 when CSRF is missing", async () => {
    vi.mocked(verifyCsrf).mockResolvedValue(false);
    expect((await onRequestPost(context() as never)).status).toBe(403);
  });

  it("reveals to admin and writes an audit event", async () => {
    // requireAuth reads the session first and reveal reads the password second; return results in call order.
    vi.mocked(queryAll)
      .mockResolvedValueOnce([authRow()])
      .mockResolvedValueOnce([{ password: "cipher" }]);

    const resp = await onRequestPost(context() as never);
    const data = await resp.json();
    expect(resp.status).toBe(200);
    expect(data.password).toBe("plain-password");
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      env,
      "audit_event",
      expect.any(Request),
      expect.objectContaining({
        accountId: 1,
        actorSub: "user-1",
        outcome: "password_revealed",
      }),
    );
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("never returns plaintext when decryption fails, and audits the failure", async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([authRow()])
      .mockResolvedValueOnce([{ password: "cipher" }]);
    vi.mocked(fernetDecrypt).mockRejectedValue(new Error("bad token"));

    const resp = await onRequestPost(context() as never);
    const body = await resp.text();
    expect(resp.status).toBe(500);
    expect(body).not.toContain("plain-password");
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      env,
      "audit_event",
      expect.any(Request),
      expect.objectContaining({ outcome: "decrypt_failed" }),
    );
  });
});
