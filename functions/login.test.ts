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
 * Tests for GET /login (tasks/22 W5-7): Access identity handoff and the guarantee that failures never issue cookies.
 *
 * This endpoint is risky without tests: it is the only place that issues session cookies, and a
 * `createAuthSession` failure **must** return 503. If the code issues a cookie despite a failed D1 write,
 * it becomes a credential that `requireAuth` can never find or revoke.
 *
 * `verifyAccessJwt` is stubbed because real verification requires an RS256 key and JWKS endpoint.
 * Other branches (missing configuration, missing assertion header, unavailable D1, and next fallback)
 * use the real implementation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./login";
import { verifyAccessJwt } from "./_lib/access";
import { SESSION_COOKIE } from "./_lib/config";
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
  ACCESS_ADMIN_AUDS: "admin-aud",
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

const loginRequest = (url = "https://account.limooo.cn/login?next=/apple") => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /login", () => {
  it("503s when the runtime config is incomplete, without issuing a cookie", async () => {
    for (const env of [
      { ...CONFIG, TURNSTILE_SECRET: "" },
      { ...CONFIG, GATE_HMAC_KEY: "" },
      { ...CONFIG, SESSION_HMAC_KEY: "" },
      { ...CONFIG, ACCESS_TEAM_DOMAIN: "" },
      { ...CONFIG, ACCESS_ADMIN_AUDS: "", ACCESS_VIEWER_AUDS: "" },
    ] as Env[]) {
      const resp = await onRequestGet(context(loginRequest(), env) as never);
      expect(resp.status).toBe(503);
      expect(resp.headers.get("Set-Cookie")).toBeNull();
      expect(resp.headers.get("Cache-Control")).toBe("no-store");
    }
    // Do not attempt JWT verification when configuration is incomplete.
    expect(vi.mocked(verifyAccessJwt)).not.toHaveBeenCalled();
  });

  it("401s without a valid Access assertion and issues no cookie", async () => {
    for (const headers of [{}, { "Cf-Access-Jwt-Assertion": "not-a-jwt" }]) {
      const resp = await onRequestGet(
        context(
          new Request("https://account.limooo.cn/login", { headers }),
          CONFIG as Env,
        ) as never,
      );
      expect(resp.status).toBe(401);
      expect(resp.headers.get("Set-Cookie")).toBeNull();
      expect(resp.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("302s to next and persists the session before issuing the cookie", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({
      sub: "access:user-1",
      email: "admin@example.com",
      role: "admin",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const { db, statements } = fakeDb("ok");
    const resp = await onRequestGet(
      context(loginRequest(), { ...CONFIG, DB: db } as Env) as never,
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://account.limooo.cn/apple");
    const cookies = resp.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`${SESSION_COOKIE}=`);
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("Secure");

    // The session must be written to the D1 revocation table before signing a cookie, or the cookie cannot be revoked.
    const insert = statements.find((s) => s.sql.includes("INSERT INTO auth_sessions"));
    expect(insert).toBeDefined();
    expect(insert!.values).toHaveLength(5);
    expect(String(insert!.values[0]).length).toBeGreaterThan(0);
  });

  it("503s and issues no cookie when the revocation table cannot be written", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({
      sub: "access:user-1",
      email: "admin@example.com",
      role: "admin",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const { db } = fakeDb("throw");
    const resp = await onRequestGet(
      context(loginRequest(), { ...CONFIG, DB: db } as Env) as never,
    );

    expect(resp.status).toBe(503);
    // Critical: a failed D1 write must never issue a session cookie that cannot be found or revoked.
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("never lets next point off-site, and keeps relative next on the requesting host", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({
      sub: "access:user-1",
      email: "admin@example.com",
      role: "admin",
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    });
    const cases: Array<[string, string]> = [
      ["/login?next=/apple", "https://account.limooo.cn/apple"],
      ["/login", "https://limooo.cn/"],
      ["/login?next=https://evil.example.com/", "https://limooo.cn/"],
      ["/login?next=//evil.example.com/", "https://limooo.cn/"],
    ];
    for (const [path, expected] of cases) {
      const { db } = fakeDb("ok");
      const resp = await onRequestGet(
        context(
          new Request(`https://account.limooo.cn${path}`),
          { ...CONFIG, DB: db } as Env,
        ) as never,
      );
      expect(resp.status).toBe(302);
      const location = resp.headers.get("Location") ?? "";
      expect(location).toBe(expected);
      expect(location.startsWith("https://evil.example.com")).toBe(false);
    }
  });
});
