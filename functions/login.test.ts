/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/** Login entry and central Access identity handoff. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./login";
import { verifyAccessJwt } from "./_lib/access";
import type { Env } from "./_lib/env";

vi.mock("./_lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_lib/access")>();
  return { ...actual, verifyAccessJwt: vi.fn() };
});

const CONFIG = {
  TURNSTILE_SECRET: "turnstile-secret",
  GATE_HMAC_KEY: "a".repeat(64),
  SESSION_HMAC_KEY: "b".repeat(64),
  ACCESS_TEAM_DOMAIN: "https://limooo.cloudflareaccess.com",
  ACCESS_IDENTITY_AUD: "identity-aud",
};

/** Minimal D1 stub implementing only the methods used by login.ts. */
function fakeDb(mode: "ok" | "throw") {
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(...values: unknown[]) {
          statements.push({ sql, values });
          return statement;
        },
        run: async () => {
          if (mode === "throw") throw new Error("d1 unavailable");
          return { success: true };
        },
        all: async () => ({ results: [] }),
        first: async () => null,
      };
      return statement;
    },
  };
  return { db: db as unknown as Env["DB"], statements };
}

function context(request: Request, env: Env) {
  return {
    request,
    env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

const state = "A".repeat(43);
const callbackUrl = (target = "/apple") => {
  const callback = new URL("https://account.limooo.cn/identity/callback");
  callback.searchParams.set("state", state);
  callback.searchParams.set("next", target);
  return callback.toString();
};

const identityLoginRequest = (callback = callbackUrl()) => {
  const url = new URL("https://identity.limooo.cn/login");
  url.searchParams.set("next", callback);
  return new Request(url, { headers: { "Cf-Access-Jwt-Assertion": "signed-access-jwt" } });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /login", () => {
  it("starts a host-bound handoff through identity.limooo.cn", async () => {
    const resp = await onRequestGet(
      context(new Request("https://account.limooo.cn/login?next=%2Fapple"), CONFIG as Env) as never,
    );
    expect(resp.status).toBe(302);
    const destination = new URL(resp.headers.get("Location") ?? "");
    expect(destination.origin).toBe("https://identity.limooo.cn");
    expect(destination.pathname).toBe("/login");
    const callback = new URL(destination.searchParams.get("next") ?? "");
    expect(callback.origin).toBe("https://account.limooo.cn");
    expect(callback.pathname).toBe("/identity/callback");
    expect(callback.searchParams.get("next")).toBe("/apple");
    const state = callback.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(resp.headers.get("Set-Cookie")).toContain(`limooo_identity_state_${state}=${state};`);
    expect(resp.headers.get("Set-Cookie")).toContain("Path=/identity/callback");
    expect(resp.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(resp.headers.get("Set-Cookie")).toContain("Secure");
    expect(vi.mocked(verifyAccessJwt)).not.toHaveBeenCalled();

    const secondResponse = await onRequestGet(
      context(new Request("https://account.limooo.cn/login?next=%2Fapple"), CONFIG as Env) as never,
    );
    const secondDestination = new URL(secondResponse.headers.get("Location") ?? "");
    const secondCallback = new URL(secondDestination.searchParams.get("next") ?? "");
    const secondState = secondCallback.searchParams.get("state");

    expect(secondState).not.toBe(state);
    expect(secondResponse.headers.get("Set-Cookie")).toContain(
      `limooo_identity_state_${secondState}=${secondState};`,
    );
  });

  it("rejects unregistered hosts and off-site return URLs", async () => {
    const unregistered = await onRequestGet(
      context(new Request("https://unknown.limooo.cn/login"), CONFIG as Env) as never,
    );
    expect(unregistered.status).toBe(404);

    const unsafe = await onRequestGet(
      context(new Request("https://account.limooo.cn/login?next=https%3A%2F%2Fevil.example"), CONFIG as Env) as never,
    );
    expect(unsafe.status).toBe(400);
  });

  it("requires the single identity AUD only on the identity login host", async () => {
    const source = await onRequestGet(
      context(new Request("https://account.limooo.cn/login"), { ...CONFIG, ACCESS_IDENTITY_AUD: "" } as Env) as never,
    );
    expect(source.status).toBe(302);

    const identity = await onRequestGet(
      context(identityLoginRequest(), { ...CONFIG, ACCESS_IDENTITY_AUD: "" } as Env) as never,
    );
    expect(identity.status).toBe(503);
    expect(vi.mocked(verifyAccessJwt)).not.toHaveBeenCalled();
  });

  it("verifies Access and stores a one-time source-bound handoff", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({
      sub: "access:user-1",
      email: "admin@example.com",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const { db, statements } = fakeDb("ok");
    const resp = await onRequestGet(
      context(identityLoginRequest(), { ...CONFIG, DB: db } as Env) as never,
    );

    expect(resp.status).toBe(302);
    const destination = new URL(resp.headers.get("Location") ?? "");
    expect(destination.origin).toBe("https://account.limooo.cn");
    expect(destination.pathname).toBe("/identity/callback");
    expect(destination.searchParams.get("state")).toBe(state);
    expect(destination.searchParams.get("next")).toBe("/apple");
    expect(destination.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    const insert = statements.find((statement) => statement.sql.includes("INSERT INTO identity_handoffs"));
    expect(insert).toBeDefined();
    expect(insert!.values).toHaveLength(8);
    expect(insert!.values).toContain("account.limooo.cn");
    expect(insert!.values).not.toContain("admin");
  });

  it("fails closed if the handoff record cannot be written", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({
      sub: "access:user-1",
      email: "admin@example.com",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const { db } = fakeDb("throw");
    const resp = await onRequestGet(
      context(identityLoginRequest(), { ...CONFIG, DB: db } as Env) as never,
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("Location")).toBeNull();
    expect(resp.headers.get("Set-Cookie")).toBeNull();
  });
});
