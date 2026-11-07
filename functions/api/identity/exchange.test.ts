/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Endpoint tests for POST /api/identity/exchange.
 *
 * The distinction under test: an unusable handoff (unknown, expired, already
 * consumed, wrong host) stays 401 with the existing copy, while an unavailable
 * handoff store returns 503 JSON, logs a locatable message without the code,
 * and is marked non-cacheable. D1 is the in-memory table described in
 * tests/helpers/identity-handoff-db.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_lib/logging", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));

import { logEvent } from "../../_lib/logging";
import { createIdentityHandoff } from "../../_lib/identity";
import { onRequestPost } from "./exchange";
import { createHandoffDb, type FakeHandoffDb } from "../../../tests/helpers/identity-handoff-db";
import type { Env } from "../../_lib/env";

const CODE = "C".repeat(43);
const STATE = "S".repeat(43);
const HOST = "account.comicine.com";
const OTHER_HOST = "visitor.comicine.com";
const IDENTITY_HOST = "identity.comicine.com";
const IDENTITY = {
  sub: "access:user-1",
  email: "admin@example.com",
  expiresAt: 9_999_999_999,
};

function envFor(store: FakeHandoffDb): Env {
  return { DB: store.db } as Env;
}

async function issue(store: FakeHandoffDb): Promise<void> {
  expect(await createIdentityHandoff(
    envFor(store),
    CODE,
    IDENTITY,
    { sourceHost: HOST, targetPath: "/apple", state: STATE },
  )).toBe(true);
}

function exchangeRequest(
  body: unknown,
  host = IDENTITY_HOST,
  contentType = "application/json",
): Request {
  return new Request(`https://${host}/api/identity/exchange`, {
    method: "POST",
    headers: { "Content-Type": contentType, "CF-Ray": "test-ray" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function context(request: Request, env: Env) {
  return { request, env, params: {}, next: vi.fn(), waitUntil: vi.fn() };
}

function post(request: Request, env: Env) {
  return onRequestPost(context(request, env) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/identity/exchange", () => {
  it("exchanges a valid handoff once and returns the identity as JSON", async () => {
    const store = createHandoffDb();
    const env = envFor(store);
    await issue(store);

    const response = await post(exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      sourceHost: HOST,
      targetPath: "/apple",
      sub: IDENTITY.sub,
      email: IDENTITY.email,
      authAt: expect.any(Number),
    });
  });

  it("rejects a second exchange of the same code with the existing 401 copy", async () => {
    const store = createHandoffDb();
    const env = envFor(store);
    await issue(store);
    const body = { code: CODE, sourceHost: HOST, state: STATE };

    expect((await post(exchangeRequest(body), env)).status).toBe(200);
    const response = await post(exchangeRequest(body), env);

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Invalid or expired identity handoff\n");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("lets only one of two concurrent exchanges win", async () => {
    const store = createHandoffDb();
    const env = envFor(store);
    await issue(store);
    const body = { code: CODE, sourceHost: HOST, state: STATE };

    const responses = await Promise.all([
      post(exchangeRequest(body), env),
      post(exchangeRequest(body), env),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
  });

  it("rejects an expired handoff with 401", async () => {
    const store = createHandoffDb();
    await issue(store);
    store.expireAll();

    const response = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }),
      envFor(store),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toContain("Invalid or expired identity handoff");
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("rejects a host mismatch with 401 while leaving the handoff for its own host", async () => {
    const store = createHandoffDb();
    const env = envFor(store);
    await issue(store);

    const wrongHost = await post(
      exchangeRequest({ code: CODE, sourceHost: OTHER_HOST, state: STATE }),
      env,
    );
    expect(wrongHost.status).toBe(401);
    expect(await wrongHost.text()).toContain("Invalid or expired identity handoff");

    const rightHost = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }),
      env,
    );
    expect(rightHost.status).toBe(200);
  });

  it("rejects a malformed code with 401 without reading D1", async () => {
    const store = createHandoffDb();
    const response = await post(
      exchangeRequest({ code: "not-a-token", sourceHost: HOST, state: STATE }),
      envFor(store),
    );

    expect(response.status).toBe(401);
    expect(store.statements).toHaveLength(0);
  });

  it("returns 503 JSON when D1 throws, not 500", async () => {
    const store = createHandoffDb();
    store.failure = "throw";
    // Simulate a driver that echoes its bound values: the log must still not
    // contain either credential.
    store.failureError = new Error(`D1_ERROR: bind failed for ${CODE} ${STATE}`);

    const response = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }),
      envFor(store),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "identity_store_unavailable" });

    expect(logEvent).toHaveBeenCalledTimes(1);
    const fields = vi.mocked(logEvent).mock.calls[0][3];
    expect(fields).toMatchObject({ outcome: "failed", status: 503 });
    expect(fields?.message).toContain("identity_store_unavailable:delete_failed");
    // Diagnostics survive while both credentials are scrubbed.
    expect(fields?.message).toContain("D1_ERROR");
    expect(fields?.message).toContain("[redacted]");
    expect(fields?.message).not.toContain(CODE);
    expect(fields?.message).not.toContain(STATE);
  });

  it("returns 503 when D1 reports success:false", async () => {
    const store = createHandoffDb();
    store.failure = "failed";

    const response = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }),
      envFor(store),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "identity_store_unavailable" });
  });

  it("returns 503 when the database binding is missing", async () => {
    const response = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }),
      {} as Env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "identity_store_unavailable" });
    expect(logEvent).toHaveBeenCalledWith(
      expect.anything(),
      "login_attempt",
      expect.any(Request),
      expect.objectContaining({ status: 503 }),
    );
  });

  it("answers 404 on hosts that do not serve the exchange", async () => {
    const store = createHandoffDb();
    const response = await post(
      exchangeRequest({ code: CODE, sourceHost: HOST, state: STATE }, "comicine.com"),
      envFor(store),
    );

    expect(response.status).toBe(404);
    expect(store.statements).toHaveLength(0);
  });

  it("keeps the existing 415 and 400 responses for bad requests", async () => {
    const store = createHandoffDb();
    const env = envFor(store);
    const body = { code: CODE, sourceHost: HOST, state: STATE };

    expect((await post(exchangeRequest(body, IDENTITY_HOST, "text/plain"), env)).status).toBe(415);
    expect((await post(exchangeRequest("{not json"), env)).status).toBe(400);
    expect((await post(exchangeRequest({ code: CODE, sourceHost: HOST }), env)).status).toBe(400);
    expect(store.statements).toHaveLength(0);
  });

  it("rejects invalid UTF-8 with 400 before reaching D1", async () => {
    const store = createHandoffDb();
    const request = new Request(`https://${IDENTITY_HOST}/api/identity/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "3" },
      body: new Uint8Array([0xff, 0xfe, 0xfd]),
    });

    const response = await post(request, envFor(store));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid request\n");
    expect(store.statements).toHaveLength(0);
  });

  it("rejects non-string code/sourceHost/state with 400", async () => {
    const store = createHandoffDb();
    const env = envFor(store);

    for (const body of [
      { code: 123, sourceHost: HOST, state: STATE },
      { code: CODE, sourceHost: null, state: STATE },
      { code: CODE, sourceHost: HOST, state: {} },
    ]) {
      const response = await post(exchangeRequest(body), env);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await response.text()).toBe("Invalid request\n");
    }
    expect(store.statements).toHaveLength(0);
  });

  // The task book expected 400 here, but the shared _lib/request.readJsonBody
  // helper now classifies an oversized body as 413 and exchange.ts maps it through.
  it("rejects an oversized body before parsing it", async () => {
    const store = createHandoffDb();
    const request = new Request(`https://${IDENTITY_HOST}/api/identity/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "4096",
      },
      body: "{}",
    });

    const response = await post(request, envFor(store));

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("Payload Too Large\n");
    expect(store.statements).toHaveLength(0);
  });
});
