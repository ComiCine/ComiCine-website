/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/** Tests Ray API authorization and minimal response fields. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./[id]";
import { queryAll } from "../../_lib/d1";
import { requireAuth } from "../../_lib/session";
import type { Env } from "../../_lib/env";

vi.mock("../../_lib/d1", () => ({ queryAll: vi.fn() }));
vi.mock("../../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../../tests/helpers/admin-session");
  return createSessionModuleMock();
});

const env = {} as Env;

function context(id = "0123456789abcdef") {
  return {
    request: new Request(`https://visitor.limooo.cn/api/ray/${id}`),
    env,
    params: { id },
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    sid: "sid-1",
    sub: "user-1",
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin",
    authAt: 1,
  } as never);
  vi.mocked(queryAll).mockResolvedValue([{
    ray: "0123456789abcdef-ABC",
    ts: 1,
    host: "limooo.cn",
    path: "/",
    method: "GET",
    status: 200,
    ip_hash: "abc123",
    ua_family: "chrome",
    ip: "1.2.3.4",
    ua: "full-user-agent",
    country: "US",
  }] as never);
});

describe("ray API", () => {
  it("requires an admin session", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    expect((await onRequestGet(context() as never)).status).toBe(401);
    vi.mocked(requireAuth).mockResolvedValue({
      sid: "sid-1",
      sub: "user-1",
      user: { email: "viewer@example.com", name: "Viewer" },
      role: "viewer",
      authAt: 1,
    } as never);
    expect((await onRequestGet(context() as never)).status).toBe(403);
  });

  // W5-15: fail closed with 503 when the revocation table is unavailable; do not allow the request or downgrade to 401.
  it("fails closed with 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestGet(context() as never);
    expect(resp.status).toBe(503);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  it("returns only minimal fields and no-store headers", async () => {
    const resp = await onRequestGet(context() as never);
    const data = await resp.json();
    expect(resp.status).toBe(200);
    expect(data.rows[0]).toMatchObject({
      ray: "0123456789abcdef-ABC",
      ip_hash: "abc123",
      ua_family: "chrome",
      method: "GET",
      status: 200,
    });
    expect(data.rows[0]).not.toHaveProperty("ip");
    expect(data.rows[0]).not.toHaveProperty("ua");
    expect(data.rows[0]).not.toHaveProperty("country");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(resp.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  // Observed in production on 2026-10-11: `LIKE '<id>%'` makes D1 scan the table using
  // `idx_ray_log_v2_ts`, while `ray` is a TEXT PRIMARY KEY. A primary-key range changes the
  // plan to `SEARCH … USING INDEX sqlite_autoindex_ray_log_v2_1 (ray>? AND ray<?)`.
  // This case locks in that query plan and fails if the code switches back to LIKE.
  it("looks the ray up with a primary-key range, not a LIKE scan", async () => {
    await onRequestGet(context() as never);

  // queryAll(db, sql, ...values): the first argument is the D1 binding and SQL is second.
    const [, sql, ...bounds] = vi.mocked(queryAll).mock.calls[0] as [unknown, string, ...string[]];
    expect(sql).toContain("WHERE ray >= ? AND ray < ?");
    expect(sql).not.toMatch(/ray\s+LIKE/i);
  // The lower bound is the 16-character hexadecimal ID. The upper bound must exceed every possible suffix,
  // or stored values with colo suffixes such as `…-LAX` will be missed, as could values with future suffixes.
    expect(bounds[0]).toBe("0123456789abcdef");
    expect(bounds[1]).toBe("0123456789abcdef\u{10ffff}");
    expect(bounds[1]! > "0123456789abcdef-LAX").toBe(true);
  });

  it("matches a stored ray that carries a colo suffix", async () => {
  // Regression guard: the stored value is `a48923a17e543777-LAX` (20 characters), while callers provide only 16 hex characters.
  // The stub returns the suffixed database row to verify that the endpoint matches it instead of returning an empty result.
    vi.mocked(queryAll).mockResolvedValueOnce([{
      ray: "0123456789abcdef-LAX",
      ts: 7,
      host: "limooo.cn",
      path: "/x",
      method: "GET",
      status: 200,
      ip_hash: "h",
      ua_family: "chrome",
    }] as never);

    const resp = await onRequestGet(context("0123456789ABCDEF-LAX") as never);
    const data = await resp.json();

    expect(resp.status).toBe(200);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].ray).toBe("0123456789abcdef-LAX");
  });
});
