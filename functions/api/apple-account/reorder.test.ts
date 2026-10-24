/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Tests for the reorder endpoint: admin access, CSRF, input-set validation, and D1 batch atomicity. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestPut } from "./reorder";
import { executeBatch, queryAll } from "../../_lib/d1";
import { authUnavailableResponse, requireAuth } from "../../_lib/session";
import { verifyCsrf } from "../../_lib/csrf";
import { logEvent } from "../../_lib/logging";
import type { Env } from "../../_lib/env";

vi.mock("../../_lib/d1", () => ({ queryAll: vi.fn(), executeBatch: vi.fn() }));
vi.mock("../../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../../tests/helpers/admin-session");
  return createSessionModuleMock();
});
vi.mock("../../_lib/csrf", () => ({ verifyCsrf: vi.fn() }));
vi.mock("../../_lib/logging", () => ({ logEvent: vi.fn() }));

const prepared = {
  bind: vi.fn(() => prepared),
  run: vi.fn(),
  all: vi.fn(),
} as never;
const db = {
  prepare: vi.fn(() => prepared),
  batch: vi.fn(async () => [{ success: true }]),
} as never;
const env = { DB: db } as Env;

function context(body: unknown) {
  return {
    request: new Request("https://account.limooo.cn/api/apple-account/reorder", {
      method: "PUT",
      headers: {
        Origin: "https://account.limooo.cn",
        "X-CSRF-Token": "valid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    env,
    params: {},
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
  vi.mocked(authUnavailableResponse).mockReturnValue(
    Response.json({ error: "auth_sessions_unavailable" }, { status: 503 }),
  );
  vi.mocked(verifyCsrf).mockResolvedValue(true);
  vi.mocked(queryAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
  vi.mocked(executeBatch).mockResolvedValue(true);
});

describe("apple-account reorder API", () => {
  it("updates all ids in one batch", async () => {
    const resp = await onRequestPut(context({ order: [2, 1] }) as never);
    expect(resp.status).toBe(200);
    expect(vi.mocked(executeBatch)).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate, unknown, or malformed order arrays", async () => {
    expect((await onRequestPut(context({ order: [1, 1] }) as never)).status).toBe(400);
    expect((await onRequestPut(context({ order: [3] }) as never)).status).toBe(400);
    expect((await onRequestPut(context({ order: "bad" }) as never)).status).toBe(400);
    expect((await onRequestPut(context({ order: [1, 2], extra: 1 }) as never)).status).toBe(400);
  });

  it("rejects a partial order so no two rows can share one sort_order", async () => {
  // If validation checks only that submitted IDs exist, omitted rows keep their old sort_order and
  // can collide with submitted rows, making the order ambiguous. Require an **exact match** with the database set.
    vi.mocked(queryAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const resp = await onRequestPut(context({ order: [1] }) as never);
    expect(resp.status).toBe(400);
    expect(await resp.json()).toMatchObject({ error: "无效请求" });
    expect(vi.mocked(executeBatch)).not.toHaveBeenCalled();
  });

  it("rejects an order that is a superset of the account ids", async () => {
    vi.mocked(queryAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect((await onRequestPut(context({ order: [1, 2, 3] }) as never)).status).toBe(400);
  });

  it("still ignores the CSRF result on a partial order (validation first)", async () => {
    vi.mocked(queryAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    vi.mocked(verifyCsrf).mockResolvedValue(false);
    const resp = await onRequestPut(context({ order: [1] }) as never);
    expect([400, 403]).toContain(resp.status);
  });

  it("returns 403 when CSRF is invalid", async () => {
    vi.mocked(verifyCsrf).mockResolvedValue(false);
  // Submit both IDs so that the 403 comes from CSRF validation rather than set validation.
    expect((await onRequestPut(context({ order: [1, 2] }) as never)).status).toBe(403);
  });

  // W5-15: fail closed with 503 when the revocation table is unavailable; do not run a batch.
  it("fails closed with 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestPut(context({ order: [1, 2] }) as never);
    expect(resp.status).toBe(503);
    expect(((await resp.json()) as { error: string }).error).toBe("auth_sessions_unavailable");
    expect(vi.mocked(executeBatch)).not.toHaveBeenCalled();
  });

/** W9-4: Reordering changes the displayed order, so it is an account change and must be audited. */
  it("audits a successful reorder and a failed reorder", async () => {
    vi.mocked(queryAll).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const ok = await onRequestPut(context({ order: [2, 1] }) as never);
    expect(ok.status).toBe(200);
    const audit = vi.mocked(logEvent).mock.calls.find((call) => call[1] === "audit_event");
    expect((audit?.[3] as { outcome?: string })?.outcome).toBe("accounts_reordered");
    expect((audit?.[3] as { actorSub?: string })?.actorSub).toBe("user-1");

    vi.mocked(logEvent).mockClear();
    vi.mocked(executeBatch).mockResolvedValue(false);
    const failed = await onRequestPut(context({ order: [2, 1] }) as never);
    expect(failed.status).toBe(500);
    const failedAudit = vi.mocked(logEvent).mock.calls.find((call) => call[1] === "audit_event");
    expect((failedAudit?.[3] as { outcome?: string })?.outcome).toBe("accounts_reorder_failed");
  });
});
