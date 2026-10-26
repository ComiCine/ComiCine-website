/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Tests for the /api/blocklist admin API (tasks/10). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestDelete, onRequestGet, onRequestPost } from "./blocklist";
import { execute, executeBatch, queryAll } from "../_lib/d1";
import { logEvent } from "../_lib/logging";
import { requireAuth } from "../_lib/session";

vi.mock("../_lib/d1", () => ({
  queryAll: vi.fn(),
  execute: vi.fn(),
  executeBatch: vi.fn(),
}));
vi.mock("../_lib/logging", () => ({ logEvent: vi.fn() }));
vi.mock("../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../tests/helpers/admin-session");
  return createSessionModuleMock();
});
vi.mock("../_lib/csrf", () => ({ verifyCsrf: vi.fn() }));
import { verifyCsrf } from "../_lib/csrf";

const env = {
  DB: { batch: undefined as (() => unknown) | undefined },
} as never;

function context(request: Request) {
  return {
    request,
    env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

function adminSession() {
  return {
    sid: "sid-1",
    sub: "sub-1",
    user: { email: "admin@example.com", name: "Admin" },
    role: "admin" as const,
    authAt: 1,
    exp: 9999999999,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue(adminSession());
  vi.mocked(execute).mockResolvedValue(true);
  vi.mocked(executeBatch).mockResolvedValue(true);
  vi.mocked(verifyCsrf).mockResolvedValue(true);
});

describe("blocklist API", () => {
  it("returns paginated rows for admins", async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([{ n: 1 }])
      .mockResolvedValueOnce([
        {
          cidr: "1.2.3.0/24",
          network: "1.2.3.0",
          prefix: 24,
          reason: "",
          source: "auto_block",
          created_at: "2026-08-27 00:00:00",
          updated_at: "2026-08-27 00:00:00",
          updated_by: "auto_block",
          active: 1,
        },
      ]);
    const resp = await onRequestGet(
      context(new Request("https://limooo.cn/api/blocklist?page=1&page_size=10")) as never,
    );
    const data = await resp.json();
    expect(resp.status).toBe(200);
    expect(data.total).toBe(1);
    expect(data.items[0].cidr).toBe("1.2.3.0/24");
  });

  it("rejects unauthenticated requests", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const resp = await onRequestGet(context(new Request("https://limooo.cn/api/blocklist")) as never);
    expect(resp.status).toBe(401);
  });

  // W5-15: fail closed when the revocation table is unavailable. In production, requireAuth throws
  // AuthSessionUnavailableError and requireAdminSession returns 503.
  it("fails closed with 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestGet(context(new Request("https://limooo.cn/api/blocklist")) as never);
    expect(resp.status).toBe(503);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  it("adds a canonical cidr with audit", async () => {
    const resp = await onRequestPost(
      context(
        new Request("https://limooo.cn/api/blocklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cidr: "1.2.3.4", reason: "manual block" }),
        }),
      ) as never,
    );
    const data = await resp.json();
    expect(resp.status).toBe(201);
    expect(data.cidr).toBe("1.2.3.4/32");
    expect(vi.mocked(execute)).toHaveBeenCalled();
    expect(vi.mocked(logEvent)).toHaveBeenCalled();
  });

  it("soft-deletes an active row with audit", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([
      {
        cidr: "1.2.3.0/24",
        network: "1.2.3.0",
        prefix: 24,
        reason: "old",
        source: "auto_block",
        created_at: "2026-08-27 00:00:00",
        updated_at: "2026-08-27 00:00:00",
        updated_by: "auto_block",
        active: 1,
      },
    ]);
    const resp = await onRequestDelete(
      context(new Request("https://limooo.cn/api/blocklist?cidr=1.2.3.0/24", {
        method: "DELETE",
        headers: { Origin: "https://limooo.cn" },
      })) as never,
    );
    const data = await resp.json();
    expect(resp.status).toBe(200);
    expect(data.action).toBe("unblock");
    expect(vi.mocked(execute).mock.calls[0][1]).toContain("UPDATE blocked_ips");
  });

  it("caps the stored reason so one request cannot write hundreds of KB", async () => {
    // Other string fields have limits, but reason did not. It could store hundreds of KB per row,
    // overwhelming paginated responses and the 500 MB database. Because the audit and change share
    // one batch, an oversized statement could also discard the audit event.
    const long = "x".repeat(5000);
    const resp = await onRequestPost(
      context(
        new Request("https://limooo.cn/api/blocklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cidr: "5.6.7.8", reason: long }),
        }),
      ) as never,
    );
    expect(resp.status).toBe(201);
    const mutation = vi.mocked(execute).mock.calls.find((call) =>
      String(call[1]).includes("INSERT INTO blocked_ips"),
    );
    expect(mutation).toBeTruthy();
    const bound = (mutation ?? []).slice(2) as unknown[];
    const reason = bound.find((value) => typeof value === "string" && value.startsWith("xxx"));
    expect(typeof reason).toBe("string");
    expect(String(reason).length).toBe(255);
    expect(String(reason)).toBe("x".repeat(255));
  });

  it("keeps a normal short reason intact", async () => {
    const resp = await onRequestPost(
      context(
        new Request("https://limooo.cn/api/blocklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cidr: "5.6.7.8", reason: "manual block" }),
        }),
      ) as never,
    );
    expect(resp.status).toBe(201);
    const mutation = vi.mocked(execute).mock.calls.find((call) =>
      String(call[1]).includes("INSERT INTO blocked_ips"),
    );
    const bound = (mutation ?? []).slice(2) as unknown[];
    expect(bound[3]).toBe("manual block");
  });

  it("rejects mutating requests without CSRF", async () => {
    vi.mocked(verifyCsrf).mockResolvedValue(false);
    const resp = await onRequestPost(
      context(new Request("https://limooo.cn/api/blocklist", {
        method: "POST",
        body: JSON.stringify({ cidr: "1.2.3.4" }),
      })) as never,
    );
    expect(resp.status).toBe(403);
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});
