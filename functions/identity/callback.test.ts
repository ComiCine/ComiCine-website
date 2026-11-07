/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
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

import { logEvent } from "../_lib/logging";
import { onRequestGet } from "./callback";

const STATE = "S".repeat(43);
const CODE = "C".repeat(43);
const OTHER_STATE = "O".repeat(43);
const STATE_COOKIE_PREFIX = "comicine_identity_state_";

function callbackRequest(
  host = "account.comicine.com",
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
    sessionMocks.createSessionCookie.mockResolvedValue("__Host-comicine_session=session-token");
    sessionMocks.randomToken.mockReturnValue("local-session-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sourceHost: "account.comicine.com",
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
    expect(response.headers.get("Location")).toBe("https://account.comicine.com/apple");
    expect(sessionMocks.createAuthSession).toHaveBeenCalledWith(env, expect.objectContaining({
      sub: "access:user-1",
      role: "admin",
    }));
    expect(response.headers.get("Set-Cookie")).toContain(`${STATE_COOKIE_PREFIX}${STATE}=`);
  });

  it("clears only the matching state cookie when multiple login flows are open", async () => {
    const request = callbackRequest(
      "account.comicine.com",
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

  it("rejects a callback whose state belongs to another open login flow", async () => {
    const request = callbackRequest(
      "account.comicine.com",
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
      context(callbackRequest("unknown.comicine.com"), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
  });

  it("reports an exchange outage as 503 service unavailable, not an invalid handoff", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ error: "identity_store_unavailable" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("Identity service unavailable");
    expect(text).not.toContain("Identity handoff rejected");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "login_attempt",
      expect.any(Request),
      expect.objectContaining({ outcome: "failed", status: 503 }),
    );
  });

  it("reports a rejected handoff as 401 without the outage copy", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      "Invalid or expired identity handoff\n",
      { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    ));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(text).toContain("Identity handoff rejected");
    expect(text).not.toContain("Identity service unavailable");
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("reports an unreachable exchange as 503 service unavailable", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network down"));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Identity service unavailable");
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "login_attempt",
      expect.any(Request),
      expect.objectContaining({ status: 503, message: "identity_exchange_unreachable" }),
    );
  });

  it("treats a malformed exchange body as a service failure, not a rejected handoff", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      "not json",
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Identity service unavailable");
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "login_attempt",
      expect.any(Request),
      expect.objectContaining({ status: 503, message: "identity_exchange_invalid_response" }),
    );
  });

  it("treats a structurally invalid handoff as a service failure too", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      sourceHost: "account.comicine.com",
      targetPath: "/apple",
      sub: "",
      email: "admin@example.com",
      authAt: 1_800_000_000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Identity service unavailable");
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "login_attempt",
      expect.any(Request),
      expect.objectContaining({ status: 503, message: "identity_exchange_invalid_response" }),
    );
  });

  it("keeps a handoff bound to another host as a 401 credential failure", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      sourceHost: "visitor.comicine.com",
      targetPath: "/apple",
      sub: "access:user-1",
      email: "admin@example.com",
      authAt: 1_800_000_000,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const response = await onRequestGet(
      context(callbackRequest(), { SESSION_HMAC_KEY: "session-key" } as Env) as never,
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Invalid identity response");
    expect(sessionMocks.createAuthSession).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });
});
