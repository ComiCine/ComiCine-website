/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Tests the GET /logout redirect target validation (tasks/22 W9-3).
 *
 * Regression: `next` used to be copied directly into the `Location` header. When the Access team domain
 * is empty, `accessTeamDomain(env)` is false and the code takes the `target = next` branch, allowing
 * arbitrary external open redirects. Invalid header values containing CR/LF also make workerd throw and return 500.
 * After aligning with `login.ts`, only site-relative paths and HTTPS URLs on allowlisted hosts are accepted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./logout";
import type { Env } from "./_lib/env";
import { revokeAuthSession, readSession } from "./_lib/session";

  // Logout writes an audit row; this test checks only Location, so D1 is not asserted here.
vi.mock("./_lib/logging", () => ({
  logEvent: async () => undefined,
}));
vi.mock("./_lib/session", async (importOriginal) => {
  const original = await importOriginal<typeof import("./_lib/session")>();
  return {
    ...original,
    readSession: vi.fn(),
    revokeAuthSession: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

const keys = {
  TURNSTILE_SECRET: "turnstile-secret",
  GATE_HMAC_KEY: "a".repeat(64),
  SESSION_HMAC_KEY: "b".repeat(64),
};

function env(extra: Partial<Env> = {}): Env {
  return { ...keys, ...extra } as Env;
}

function context(request: Request, extra: Partial<Env> = {}) {
  return {
    request,
    env: env(extra),
    next: async () => new Response("next", { status: 200 }),
    waitUntil: async () => undefined,
  };
}

const logout = (query: string, extra: Partial<Env> = {}) =>
  onRequestGet(
    context(new Request(`https://limooo.cn/logout${query}`), extra) as never,
  );

describe("logout next validation", () => {
  it("clears cookies and redirects when the session was already revoked", async () => {
    vi.mocked(readSession).mockResolvedValue({
      sid: "sid-already-revoked",
      sub: "admin",
      user: { email: "admin@example.com", name: "Admin" },
      role: "admin",
      authAt: 1,
    });
    vi.mocked(revokeAuthSession).mockResolvedValue(true);

    const resp = await logout("");

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/");
    expect(resp.headers.getSetCookie()).toHaveLength(3);
  });

  it("falls back to the site root for an off-site next when Access is unconfigured", async () => {
    const resp = await logout("?next=https://evil.example/phish");
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/");
  });

  it("still accepts a relative in-site next", async () => {
    const resp = await logout("?next=%2Fservices");
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("/services");
  });

  it("accepts an https next on a whitelisted host", async () => {
    const resp = await logout("?next=https%3A%2F%2Fvisitor.limooo.cn%2Fvisitors");
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://visitor.limooo.cn/visitors");
  });

  it("rejects control characters instead of throwing a 500", async () => {
  // %0d%0a encodes CRLF; these values used to reach Location directly and make workerd throw TypeError while building the response headers.
    const resp = await logout("?next=%2F%0d%0aX%3A%201");
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/");
    expect(resp.headers.get("Location")).not.toContain("\r");
    expect(resp.headers.get("Location")).not.toContain("\n");
  });

  it("rejects protocol-relative and backslash next values", async () => {
    for (const raw of ["//evil.example", "%2F%5Cevil.example", "http://evil.example"]) {
      const resp = await logout(`?next=${raw}`);
      expect(resp.status, `next=${raw}`).toBe(302);
      expect(resp.headers.get("Location"), `next=${raw}`).toBe("https://limooo.cn/");
    }
  });

  it("wraps the sanitised target in the Access logout URL when configured", async () => {
    const resp = await logout("?next=https://evil.example/phish", {
      ACCESS_TEAM_DOMAIN: "limooo.cloudflareaccess.com",
    });
    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe(
      "https://limooo.cloudflareaccess.com/cdn-cgi/access/logout?redirect_url=" +
        encodeURIComponent("https://limooo.cn/"),
    );
  });
});
