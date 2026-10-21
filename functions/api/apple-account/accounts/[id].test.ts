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

/** Tests for the Apple Account update and delete endpoints; all external dependencies are mocked. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestDelete, onRequestPut } from "./[id]";
import { execute, queryAll } from "../../../_lib/d1";
import { authUnavailableResponse, requireAuth } from "../../../_lib/session";
import { verifyCsrf } from "../../../_lib/csrf";
import { fernetEncrypt } from "../../../_lib/fernet";
import { logEvent } from "../../../_lib/logging";
import type { Env } from "../../../_lib/env";

vi.mock("../../../_lib/d1", () => ({ queryAll: vi.fn(), execute: vi.fn() }));
vi.mock("../../../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../../../tests/helpers/admin-session");
  return createSessionModuleMock();
});
vi.mock("../../../_lib/csrf", () => ({ verifyCsrf: vi.fn() }));
vi.mock("../../../_lib/fernet", () => ({ fernetEncrypt: vi.fn() }));
vi.mock("../../../_lib/logging", () => ({ logEvent: vi.fn() }));

const env = { APPLE_ACCOUNT_ENCRYPTION_KEY: "test-key" } as Env;

function context(request: Request) {
  return {
    request,
    env,
    params: { id: "1" },
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
  vi.mocked(fernetEncrypt).mockResolvedValue("encrypted");
  // Use mockReset rather than clear: clearAllMocks does not clear the "Once" queue,
  // so a mockRejectedValueOnce left by the previous case can leak into the next one
  // (for example, a case expecting 500 receives 404).
  vi.mocked(execute).mockReset();
  vi.mocked(execute).mockResolvedValue(true);
  vi.mocked(queryAll).mockReset();
  vi.mocked(queryAll).mockResolvedValue([{ id: 1 }]);
});

function request(method: string, body?: unknown): Request {
  return new Request("https://account.limooo.cn/api/apple-account/accounts/1", {
    method,
    headers: {
      Origin: "https://account.limooo.cn",
      "X-CSRF-Token": "valid",
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("apple-account account id API", () => {
  it("updates an account with CSRF and returns 404 for missing rows", async () => {
    vi.mocked(queryAll).mockResolvedValueOnce([{ password: "old-cipher" }]);
    const ok = await onRequestPut(
      context(request("PUT", {
        email: "alice@account.limooo.cn",
        password: "",
        notes: "",
        password_changed: false,
      })) as never,
    );
    expect(ok.status).toBe(200);
    // W5-2: metadata-only updates must write the stored ciphertext back **unchanged**. This case previously
    // seeded `old-cipher` but did not assert that it was written back. Replacing `existing[0].password`
    // with `""` in production would silently clear every stored password while still returning 200
    // and passing the full test suite.
    // `execute(db, sql, ...values)`: values = [email, password, notes, id]; password is the second bound value.
    const write = vi.mocked(execute).mock.calls.at(-1);
    expect(write?.[1]).toContain("UPDATE apple_accounts");
    expect(write?.[3]).toBe("old-cipher");

    vi.mocked(queryAll).mockResolvedValueOnce([]);
    const missing = await onRequestPut(
      context(request("PUT", {
        email: "alice@account.limooo.cn",
        password: "",
        notes: "",
        password_changed: false,
      })) as never,
    );
    expect(missing.status).toBe(404);
  });

  it("rejects a CSRF failure and invalid id", async () => {
    vi.mocked(verifyCsrf).mockResolvedValue(false);
    const csrf = await onRequestPut(
      context(request("PUT", {
        email: "alice",
        password: "",
        notes: "",
        password_changed: false,
      })) as never,
    );
    expect(csrf.status).toBe(403);

    vi.mocked(verifyCsrf).mockResolvedValue(true);
    const badId = await onRequestDelete(
      {
        request: request("DELETE"),
        env,
        params: { id: "-1" },
        next: async () => new Response("next"),
        waitUntil: vi.fn(),
      } as never,
    );
    expect(badId.status).toBe(400);
  });

  // W5-15: fail closed with 503 when the revocation table is unavailable; do not read or write account data.
  it("fails closed with 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestPut(
      context(request("PUT", {
        email: "alice@account.limooo.cn",
        password: "",
        notes: "",
        password_changed: false,
      })) as never,
    );
    expect(resp.status).toBe(503);
    expect(((await resp.json()) as { error: string }).error).toBe("auth_sessions_unavailable");
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });

  it("deletes an existing account", async () => {
    const resp = await onRequestDelete(context(request("DELETE")) as never);
    expect(resp.status).toBe(200);
    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      env.DB,
      "DELETE FROM apple_accounts WHERE id = ?",
      1,
    );
  });

  /**
   * W9-4 / W9-6: password changes and deletions are sensitive admin operations and must be audited;
   * D1 failures must not be reported as "this email already exists."
   */
  describe("audit and error classification", () => {
    const updateBody = {
      email: "alice@account.limooo.cn",
      password: "",
      notes: "",
      password_changed: false,
    };

    function auditCall() {
      return vi.mocked(logEvent).mock.calls.find((call) => call[1] === "audit_event");
    }

    it("audits a successful update with the actor and never the password", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ password: "old-cipher" }]);
      const resp = await onRequestPut(context(request("PUT", updateBody)) as never);
      expect(resp.status).toBe(200);
      const audit = auditCall();
      expect(audit).toBeTruthy();
      const details = audit?.[3] as { outcome?: string; actorSub?: string; status?: number };
      expect(details?.outcome).toBe("account_updated");
      expect(details?.actorSub).toBe("user-1");
      expect(details?.status).toBe(200);
      expect(JSON.stringify(audit)).not.toContain("old-cipher");
    });

    /**
     * W5-2: This is the positive contract case that metadata updates must not change passwords.
     *
     * Use recognizable ciphertext and assert every bound value passed to `execute`
     * (`values[1]` is the password field). This fails immediately if production code replaces
     * `existing[0].password` with `""` or swaps the email and password positions in the SQL.
     */
    it("writes the stored password back verbatim on a metadata-only update", async () => {
      const stored = "old-cipher-W5-2";
      vi.mocked(queryAll).mockResolvedValueOnce([{ password: stored }]);
      const resp = await onRequestPut(context(request("PUT", updateBody)) as never);
      expect(resp.status).toBe(200);
      const values = vi.mocked(execute).mock.calls.at(-1)?.slice(2);
      expect(values).toEqual(["alice@apple.account.limooo.cn", stored, "", 1]);
      expect(values?.[1]).not.toBe("");
    });

    it("audits a password change without recording the new password", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([]);
      const resp = await onRequestPut(
        context(
          request("PUT", {
            email: "alice@account.limooo.cn",
            password: "brand-new-secret",
            notes: "",
            password_changed: true,
          }),
        ) as never,
      );
      expect(resp.status).toBe(200);
      const details = auditCall()?.[3] as { message?: string } | undefined;
      expect(details?.message).toBe("password_changed");
      expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain("brand-new-secret");
    });

    it("returns 500 for a non-UNIQUE D1 failure on update", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ password: "old-cipher" }]);
      vi.mocked(execute).mockRejectedValueOnce(new Error("D1_ERROR: Exceeded maximum DB size"));
      const resp = await onRequestPut(context(request("PUT", updateBody)) as never);
      expect(resp.status).toBe(500);
      expect(((await resp.json()) as { error: string }).error).not.toContain("已存在");
      expect((auditCall()?.[3] as { outcome?: string })?.outcome).toBe("account_update_failed");
    });

    it("still returns 409 for a real UNIQUE conflict on update", async () => {
      vi.mocked(queryAll).mockResolvedValueOnce([{ password: "old-cipher" }]);
      vi.mocked(execute).mockRejectedValueOnce(
        new Error("D1_ERROR: UNIQUE constraint failed: apple_accounts.email"),
      );
      const resp = await onRequestPut(context(request("PUT", updateBody)) as never);
      expect(resp.status).toBe(409);
      expect((auditCall()?.[3] as { outcome?: string })?.outcome).toBe("account_update_conflict");
    });

    it("audits a successful delete and a 404", async () => {
      const ok = await onRequestDelete(context(request("DELETE")) as never);
      expect(ok.status).toBe(200);
      expect((auditCall()?.[3] as { outcome?: string })?.outcome).toBe("account_deleted");

      vi.mocked(logEvent).mockClear();
      vi.mocked(queryAll).mockResolvedValueOnce([]);
      const missing = await onRequestDelete(context(request("DELETE")) as never);
      expect(missing.status).toBe(404);
      expect((auditCall()?.[3] as { outcome?: string })?.outcome).toBe("account_delete_not_found");
    });
  });
});
