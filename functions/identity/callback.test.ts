/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Source-site callback tests for the shared identity handoff. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../_lib/env";

const sessionMocks = vi.hoisted(() => ({
  configErrorResponse: vi.fn((reason: string) => new Response(reason, { status: 503 })),
  createAuthSession: vi.fn(),
  createSessionCookie: vi.fn(),
  randomToken: vi.fn(),
  runtimeConfigError: vi.fn(),
}));

vi.mock("../_lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_lib/session")>();
  return { ...actual, ...sessionMocks };
});

vi.mock("../_lib/logging", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

import { onRequestGet } from "./callback";

const STATE = "S".repeat(43);
const CODE = "C".repeat(43);
const OTHER_STATE = "O".repeat(43);
const STATE_COOKIE_PREFIX = "limooo_identity_state_";

function callbackRequest(
  host = "account.limooo.cn",
  state = STATE,
  cookie = `${STATE_COOKIE_PREFIX}${state}=${state}`,
) {
  const url = new URL(`https://${host}/identity/callback`);
  url.searchParams.set("code", CODE);
  url.searchParams.set("state", state);
  url.searchParams.set("next", "/apple");
  return new Request(url, { headers: { Cookie: cookie } });
}

function context(request: Request, env: Env) {
  return { request, env, params: {}, next: vi.fn(), waitUntil: vi.fn() };
}

describe("GET /identity/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionMocks.runtimeConfigError.mockReturnValue(null);
    sessionMocks.createAuthSession.mockResolvedValue(true);
    sessionMocks.createSessionCookie.mockResolvedValue("limooo_session_v3=session-token");
    sessionMocks.randomToken.mockReturnValue("local-session-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sourceHost: "account.limooo.cn",
      targetPath: "/apple",
      sub: "access:user-1",
      email: "admin@example.com",
      authAt: 1_800_000_000,
      role: "viewer",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
  });

  it("applies the source site's local role, ignoring role data from the handoff", async () => {
    const env = { SESSION_HMAC_KEY: "session-key" } as Env;
    const response = await onRequestGet(context(callbackRequest(), env) as never);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://account.limooo.cn/apple");
    expect(sessionMocks.createAuthSession).toHaveBeenCalledWith(env, expect.objectContaining({
      sub: "access:user-1",
      role: "admin",
    }));
    expect(response.headers.get("Set-Cookie")).toContain(`${STATE_COOKIE_PREFIX}${STATE}=`);
  });

  it("clears only the matching state cookie when multiple login flows are open", async () => {
    const request = callbackRequest(
      "account.limooo.cn",
      STATE,
      `${STATE_COOKIE_PREFIX}${STATE}=${STATE}; ${STATE_COOKIE_PREFIX}${OTHER_STATE}=${OTHER_STATE}`,
    );
    const response = await onRequestGet(
      context(request, { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toContain(`${STATE_COOKIE_PREFIX}${STATE}=`);
    expect(response.headers.get("Set-Cookie")).not.toContain(OTHER_STATE);
  });

  it("accepts a still-valid legacy state cookie during deployment rollout", async () => {
    const request = callbackRequest("account.limooo.cn", STATE, `limooo_identity_state=${STATE}`);
    const response = await onRequestGet(
      context(request, { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Set-Cookie")).toContain(`limooo_identity_state=`);
  });

  it("rejects a callback whose state belongs to another open login flow", async () => {
    const request = callbackRequest(
      "account.limooo.cn",
      STATE,
      `${STATE_COOKIE_PREFIX}${OTHER_STATE}=${OTHER_STATE}`,
    );
    const response = await onRequestGet(
      context(request, { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects callbacks from hosts not registered in the source contract", async () => {
    const response = await onRequestGet(
      context(callbackRequest("unknown.limooo.cn"), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
  });
});
