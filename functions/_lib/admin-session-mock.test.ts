/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Parity test for the shared `functions/_lib/session` module mock in
 * `tests/helpers/admin-session.ts`.
 *
 * The admin route tests replace the whole session module, so a hand-copied denial response can drift
 * from production without any route test failing. The previous helper returned a plain-text 503 that
 * three tests overrode with their own JSON copy, and every override omitted `Cache-Control: no-store`.
 * This file imports both the mock and the real implementation and compares each denial response item
 * by item: status, JSON body, and headers. Change a production message and this test (not the route
 * tests) is the one that notices if the mock stops delegating.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { queryAll } from "./d1";
import {
  ADMIN_REQUIRED_MESSAGE,
  authUnavailableResponse,
  createSessionCookie,
  requireAdminSession,
} from "./session";
import {
  UNAUTHENTICATED_ERROR,
  createSessionModuleMock,
} from "../../tests/helpers/admin-session";
import type { SessionModuleSource } from "../../tests/helpers/admin-session";

vi.mock("./d1", () => ({ execute: vi.fn(), queryAll: vi.fn() }));

const env = { DB: {}, SESSION_HMAC_KEY: "test-session-hmac-key" } as Env;

/** The real production surface the mock is expected to mirror. */
const production: SessionModuleSource = { ADMIN_REQUIRED_MESSAGE, authUnavailableResponse };

function requestWith(cookie: string): Request {
  return new Request("https://visitor.comicine.com/api/visitors", {
    headers: { Cookie: cookie },
  });
}

async function snapshot(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("Cache-Control"),
    contentType: response.headers.get("Content-Type"),
  };
}

async function signedCookie(role: "admin" | "viewer"): Promise<Request> {
  const header = await createSessionCookie(env, {
    sid: "sid-1",
    sub: "user-1",
    user: { email: `${role}@example.com`, name: role },
    role,
    authAt: 1,
  });
  return requestWith(header.split(";")[0]);
}

/** requireAuth only allows the request when this row exists in the D1 revocation table. */
function grantRow(role: "admin" | "viewer"): void {
  vi.mocked(queryAll).mockResolvedValue([
    { sid: "sid-1", sub: "user-1", role, auth_at: 1, exp: 9_999_999_999, revoked_at: null },
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin-session mock parity", () => {
  it("matches the production 401 for an unauthenticated request", async () => {
    const mock = createSessionModuleMock(production);
    mock.requireAuth.mockResolvedValue(null);

    const fromProduction = (await requireAdminSession(env, requestWith(""))) as Response;
    const fromMock = (await mock.requireAdminSession(env, requestWith(""))) as Response;

    const productionSnapshot = await snapshot(fromProduction);
    expect(await snapshot(fromMock)).toEqual(productionSnapshot);
    // Production has no exported constant for this body, so the test-side copy is asserted here.
    expect(productionSnapshot.body).toEqual({ error: UNAUTHENTICATED_ERROR });
    expect(productionSnapshot.cacheControl).toBe("no-store");
  });

  it("matches the production 403 for a read-only account and a custom message", async () => {
    grantRow("viewer");
    const mock = createSessionModuleMock(production);
    mock.requireAuth.mockResolvedValue({ role: "viewer" });

    const fromProduction = (await requireAdminSession(env, await signedCookie("viewer"))) as Response;
    const fromMock = (await mock.requireAdminSession(env, requestWith(""))) as Response;

    const productionSnapshot = await snapshot(fromProduction);
    expect(await snapshot(fromMock)).toEqual(productionSnapshot);
    expect(productionSnapshot.body).toEqual({ error: ADMIN_REQUIRED_MESSAGE });
    expect(productionSnapshot.cacheControl).toBe("no-store");

    // Callers such as the blocklist endpoint pass their own copy; both sides must forward it.
    const custom = "Administrator permission required";
    const productionCustom = (await requireAdminSession(
      env,
      await signedCookie("viewer"),
      custom,
    )) as Response;
    const mockCustom = (await mock.requireAdminSession(env, requestWith(""), custom)) as Response;
    expect(await snapshot(mockCustom)).toEqual(await snapshot(productionCustom));
  });

  it("matches the production 503 when the revocation table is unavailable", async () => {
    vi.mocked(queryAll).mockRejectedValue(new Error("d1 down"));
    const mock = createSessionModuleMock(production);
    mock.requireAuth.mockRejectedValue(new Error("d1 down"));

    const fromProduction = (await requireAdminSession(env, await signedCookie("admin"))) as Response;
    const fromMock = (await mock.requireAdminSession(env, requestWith("admin"))) as Response;

    const productionSnapshot = await snapshot(fromProduction);
    expect(await snapshot(fromMock)).toEqual(productionSnapshot);
    expect(productionSnapshot.body).toEqual({ error: "auth_sessions_unavailable" });
    expect(productionSnapshot.cacheControl).toBe("no-store");

    // The mock's exported stub returns production's response rather than a plain-text copy.
    expect(await snapshot(mock.authUnavailableResponse())).toEqual(
      await snapshot(authUnavailableResponse()),
    );
  });
});
