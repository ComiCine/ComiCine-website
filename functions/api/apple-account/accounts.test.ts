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

/** Tests for Apple Account listing and creation; all external dependencies are mocked. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet, onRequestPost } from "./accounts";
import { execute, queryAll } from "../../_lib/d1";
import { authUnavailableResponse, requireAuth } from "../../_lib/session";
import { verifyCsrf } from "../../_lib/csrf";
import { logEvent } from "../../_lib/logging";
import { fernetEncrypt } from "../../_lib/fernet";
import type { Env } from "../../_lib/env";

vi.mock("../../_lib/d1", () => ({ queryAll: vi.fn(), execute: vi.fn() }));
vi.mock("../../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../../tests/helpers/admin-session");
  return createSessionModuleMock();
});
vi.mock("../../_lib/csrf", () => ({ verifyCsrf: vi.fn() }));
vi.mock("../../_lib/fernet", () => ({ fernetEncrypt: vi.fn() }));
vi.mock("../../_lib/logging", () => ({ logEvent: vi.fn() }));

const env = {
  APPLE_ACCOUNT_ENCRYPTION_KEY: "test-key",
} as Env;

function context(request: Request) {
  return {
    request,
    env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

function appleAccountRequest(method: string, body?: unknown): Request {
  return new Request("https://account.limooo.cn/api/apple-account/accounts", {
    method,
    headers: {
      "Content-Type": "application/json",
      Origin: "https://account.limooo.cn",
      "X-CSRF-Token": "valid",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  vi.mocked(fernetEncrypt).mockResolvedValue("encrypted");
  vi.mocked(execute).mockResolvedValue(true);
  vi.mocked(queryAll).mockResolvedValue([]);
});

describe("apple account accounts API", () => {
  it("returns a masked password and never a plaintext field", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      sid: "sid-1",
      sub: "user-1",
      user: { email: "viewer@example.com", name: "Viewer" },
      role: "viewer",
      authAt: 1,
    } as never);
    vi.mocked(queryAll).mockResolvedValueOnce([
      { id: 1, email: "a@account.limooo.cn", password: "cipher", notes: "", sort_order: 0 },
    ]);
    const resp = await onRequestGet(context(new Request("https://account.limooo.cn/api/apple-account/accounts")) as never);
    const data = await resp.json();
    expect(resp.status).toBe(200);
    expect(data[0].password).toBe("·".repeat(12));
    expect(data[0]).not.toHaveProperty("plain");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 401 when unauthenticated and 403 for viewers on POST", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const unauth = await onRequestPost(
      context(appleAccountRequest("POST", { email: "a", password: "p", notes: "" })) as never,
    );
    expect(unauth.status).toBe(401);

    vi.mocked(requireAuth).mockResolvedValue({
      sid: "sid-1",
      sub: "user-1",
      user: { email: "viewer@example.com", name: "Viewer" },
      role: "viewer",
      authAt: 1,
    } as never);
    const viewer = await onRequestPost(
      context(appleAccountRequest("POST", { email: "a", password: "p", notes: "" })) as never,
    );
    expect(viewer.status).toBe(403);
  });

  // W5-15: fail closed with 503 when the revocation table is unavailable; do not write account data.
  it("fails closed with 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestPost(
      context(appleAccountRequest("POST", { email: "a", password: "p", notes: "" })) as never,
    );
    expect(resp.status).toBe(503);
    // This also proves that authUnavailableResponse configured in beforeEach (the production JSON body)
    // is active rather than dead configuration; the previous stub had no catch, so this path was unreachable.
    expect(((await resp.json()) as { error: string }).error).toBe("auth_sessions_unavailable");
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });

  it("rejects a missing CSRF token", async () => {
    vi.mocked(verifyCsrf).mockResolvedValue(false);
    const resp = await onRequestPost(
      context(appleAccountRequest("POST", { email: "a", password: "p", notes: "" })) as never,
    );
    expect(resp.status).toBe(403);
  });

  it("rejects unknown fields and invalid payloads", async () => {
    const unknown = await onRequestPost(
      context(appleAccountRequest("POST", { email: "a", password: "p", notes: "", extra: 1 })) as never,
    );
    expect(unknown.status).toBe(400);
    const invalid = await onRequestPost(
      context(appleAccountRequest("POST", { email: "", password: "p", notes: "" })) as never,
    );
    expect(invalid.status).toBe(400);
  });

  it("creates an account for a valid admin request", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([{ n: 2 }]);
    const resp = await onRequestPost(
      context(appleAccountRequest("POST", { email: "alice", password: "secret", notes: "note" })) as never,
    );
    expect(resp.status).toBe(200);
    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      env.DB,
      expect.stringContaining("INSERT INTO apple_accounts"),
      "alice@account.limooo.cn",
      "encrypted",
      "note",
      2,
    );
  });

  it("does not write without an encryption key", async () => {
    delete env.APPLE_ACCOUNT_ENCRYPTION_KEY;
    const resp = await onRequestPost(
      context(appleAccountRequest("POST", { email: "alice", password: "secret", notes: "" })) as never,
    );
    expect(resp.status).toBe(500);
    env.APPLE_ACCOUNT_ENCRYPTION_KEY = "test-key";
  });

  /**
   * W9-4 / W9-6: Apple Account changes are among the most sensitive admin operations because they involve
   * plaintext passwords, so they must be audited. D1 failures must not be reported as "this email already exists."
   */
  describe("audit and error classification", () => {
    const payload = { email: "alice", password: "secret", notes: "note" };

    it("writes an audit row when the account is created", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ n: 0 }]);
      const resp = await onRequestPost(context(appleAccountRequest("POST", payload)) as never);
      expect(resp.status).toBe(200);

      const audit = vi
        .mocked(logEvent)
        .mock.calls.find((call) => call[1] === "audit_event");
      expect(audit, "创建账号必须写 audit_event").toBeTruthy();
      const details = audit?.[3] as { outcome?: string; status?: number; actorSub?: string } | undefined;
      expect(details?.outcome).toBe("account_created");
      expect(details?.status).toBe(200);
      expect(details?.actorSub).toBe("user-1");
      // Never write a password to the audit log.
      expect(JSON.stringify(audit)).not.toContain("secret");
    });

    it("still returns 409 for a real UNIQUE conflict", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ n: 0 }]);
      vi.mocked(execute).mockRejectedValueOnce(
        new Error("D1_ERROR: UNIQUE constraint failed: apple_accounts.email"),
      );
      const resp = await onRequestPost(context(appleAccountRequest("POST", payload)) as never);
      expect(resp.status).toBe(409);
      const audit = vi.mocked(logEvent).mock.calls.find((call) => call[1] === "audit_event");
      expect((audit?.[3] as { outcome?: string })?.outcome).toBe("account_create_conflict");
    });

    it("returns 500 and audits a non-UNIQUE D1 failure instead of claiming the email exists", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ n: 0 }]);
      vi.mocked(execute).mockRejectedValueOnce(new Error("D1_ERROR: Exceeded maximum DB size"));
      const resp = await onRequestPost(context(appleAccountRequest("POST", payload)) as never);
      expect(resp.status).toBe(500);
      const error = (await resp.json()) as { error: string };
      expect(error.error).not.toContain("已存在");
      const audit = vi.mocked(logEvent).mock.calls.find((call) => call[1] === "audit_event");
      expect((audit?.[3] as { outcome?: string })?.outcome).toBe("account_create_failed");
    });
  });
});
