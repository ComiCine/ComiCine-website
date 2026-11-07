/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Handoff lifecycle tests for functions/_lib/identity.ts.
 *
 * Scope: issue, single consumption, expiry, host binding, concurrency, and the
 * boundary between an invalid credential (`null`) and a storage outage
 * (`IdentityStoreUnavailable`). D1 is replaced by the in-memory table in
 * tests/helpers/identity-handoff-db.ts; nothing here touches the network.
 */

import { describe, expect, it } from "vitest";
import {
  consumeIdentityHandoff,
  createIdentityHandoff,
  IdentityStoreUnavailable,
  type IdentityCallback,
} from "./identity";
import { createHandoffDb, type FakeHandoffDb } from "../../tests/helpers/identity-handoff-db";
import type { Env } from "./env";

const NOW = 1_800_000_000;
const CODE = "C".repeat(43);
const STATE = "S".repeat(43);
const OTHER_STATE = "O".repeat(43);
const HOST = "account.comicine.com";
const OTHER_HOST = "visitor.comicine.com";
const IDENTITY = {
  sub: "access:user-1",
  email: "admin@example.com",
  expiresAt: NOW + 600,
};

function callback(overrides: Partial<IdentityCallback> = {}): IdentityCallback {
  return { sourceHost: HOST, targetPath: "/apple", state: STATE, ...overrides };
}

function envFor(store: FakeHandoffDb): Env {
  return { DB: store.db } as Env;
}

async function issue(store: FakeHandoffDb, overrides: Partial<IdentityCallback> = {}): Promise<void> {
  expect(await createIdentityHandoff(envFor(store), CODE, IDENTITY, callback(overrides), NOW)).toBe(true);
}

describe("identity handoff lifecycle", () => {
  it("consumes a handoff exactly once and returns the verified identity", async () => {
    const store = createHandoffDb();
    await issue(store);

    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).toEqual({
      sourceHost: HOST,
      targetPath: "/apple",
      sub: IDENTITY.sub,
      email: IDENTITY.email,
      authAt: NOW,
    });
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).toBeNull();
    expect(store.rows).toHaveLength(0);
  });

  it("rejects a handoff after its expiry instead of consuming it", async () => {
    const store = createHandoffDb();
    await issue(store);

    // createIdentityHandoff caps the lifetime at two minutes.
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW + 121)).toBeNull();
  });

  it("rejects a handoff presented by a different registered host without burning it", async () => {
    const store = createHandoffDb();
    await issue(store);

    expect(await consumeIdentityHandoff(envFor(store), CODE, OTHER_HOST, STATE, NOW)).toBeNull();
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).not.toBeNull();
  });

  it("rejects a handoff presented with the wrong state without burning it", async () => {
    const store = createHandoffDb();
    await issue(store);

    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, OTHER_STATE, NOW)).toBeNull();
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).not.toBeNull();
  });

  it("lets only one of two concurrent consumptions win", async () => {
    const store = createHandoffDb();
    await issue(store);

    const results = await Promise.all([
      consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW),
      consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    expect(store.rows).toHaveLength(0);
  });

  it("rejects unregistered hosts and malformed codes without touching D1", async () => {
    const store = createHandoffDb();
    await issue(store);
    store.statements.length = 0;

    expect(await consumeIdentityHandoff(envFor(store), CODE, "unknown.comicine.com", STATE, NOW)).toBeNull();
    expect(await consumeIdentityHandoff(envFor(store), "short", HOST, STATE, NOW)).toBeNull();
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, "bad state", NOW)).toBeNull();
    expect(store.statements).toHaveLength(0);
  });

  it("rejects a corrupted stored row as invalid, not as an outage", async () => {
    const store = createHandoffDb();
    await issue(store);
    store.rows[0].sub = "";

    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).toBeNull();
  });

  it("reports a duplicate code as a failed issue without disturbing the existing handoff", async () => {
    const store = createHandoffDb();
    await issue(store);

    // A duplicate code_hash reaches SQLite's unique constraint, which the issuer
    // reports as a failed issue instead of throwing; the first row stays usable.
    expect(await createIdentityHandoff(
      envFor(store),
      CODE,
      IDENTITY,
      callback({ state: OTHER_STATE }),
      NOW,
    )).toBe(false);
    expect(await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)).not.toBeNull();
  });
});

describe("identity handoff storage failures", () => {
  it("throws IdentityStoreUnavailable when D1 rejects the consuming statement", async () => {
    const store = createHandoffDb();
    await issue(store);
    store.failure = "throw";

    const failure = await consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IdentityStoreUnavailable);
    expect(failure).toMatchObject({ reason: "delete_failed" });
    // The original driver error stays reachable for logs and diagnostics.
    expect(failure).toMatchObject({ cause: store.failureError });
  });

  it("throws IdentityStoreUnavailable when D1 reports success:false", async () => {
    const store = createHandoffDb();
    await issue(store);
    store.failure = "failed";

    await expect(
      consumeIdentityHandoff(envFor(store), CODE, HOST, STATE, NOW),
    ).rejects.toMatchObject({ name: "IdentityStoreUnavailable", reason: "delete_failed" });
  });

  it("throws IdentityStoreUnavailable when the database binding is missing", async () => {
    await expect(
      consumeIdentityHandoff({} as Env, CODE, HOST, STATE, NOW),
    ).rejects.toMatchObject({ name: "IdentityStoreUnavailable", reason: "db_unbound" });
  });

  it("keeps malformed credentials as 401 even when the store is unavailable", async () => {
    // Input validation runs before the binding check, so a bad code or host is
    // never promoted to a 503 just because D1 would also be unusable.
    await expect(
      consumeIdentityHandoff({} as Env, "short", HOST, STATE, NOW),
    ).resolves.toBeNull();
    await expect(
      consumeIdentityHandoff({} as Env, CODE, "unknown.comicine.com", STATE, NOW),
    ).resolves.toBeNull();
  });
});
