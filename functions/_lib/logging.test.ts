/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Pure logging-privacy tests for the separate observability key and sensitive-text redaction; no D1 or network access. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import { ipHash, logEvent, sanitizeLogMessage } from "./logging";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logging privacy", () => {
  it("uses only OBSERVABILITY_HMAC_KEY and fails closed when it is missing", async () => {
    const obs = await ipHash("8.8.8.8", { OBSERVABILITY_HMAC_KEY: "obs" } as Env);
    const gate = await ipHash("8.8.8.8", {
      GATE_HMAC_KEY: "gate",
      OBSERVABILITY_HMAC_KEY: "obs",
    } as Env);
    expect(obs).toBe(gate);
    expect(obs).toMatch(/^[0-9a-f]{16}$/);
    expect(await ipHash("8.8.8.8", { GATE_HMAC_KEY: "gate" } as Env)).toBe("");
  });

  it("hashes the connecting IP, never a client-supplied X-Limooo-Client-IP", async () => {
    const env = { OBSERVABILITY_HMAC_KEY: "obs" } as unknown as Env;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = new Request("https://limooo.cn/", {
      headers: {
        "CF-Connecting-IP": "43.108.57.161",
        "X-Limooo-Client-IP": "1.2.3.4",
        "X-Limooo-Client-Country": "CN",
      },
    });

    await logEvent(env, "gate_entry", request, {});

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as { ip_hash: string };
    expect(payload.ip_hash).toBe(await ipHash("43.108.57.161", env));
    expect(payload.ip_hash).not.toBe(await ipHash("1.2.3.4", env));
  });

  it("redacts passwords, bearer tokens, cookies and query strings", () => {
    const clean = sanitizeLogMessage(
      'login password=seekrit&token=abc123 | Bearer abc.def | Cookie: __gate=xyz | /api/a?q=secret',
    );
    expect(clean).not.toContain("seekrit");
    expect(clean).not.toContain("abc.def");
    expect(clean).not.toContain("__gate=xyz");
    expect(clean).not.toContain("q=secret");
    expect(clean).toContain("[redacted]");
  });
});

/**
 * W9-19: do not run table-creation statements for every request during a D1 failure.
 *
 * If ready is set only after success, **every** request sends a batch of DDL
 * that is certain to fail during quota exhaustion or a broken binding. This
 * amplifies one failure into N failures. Remember each attempt, retry at most
 * once per minute, and combine DDL into one db.batch round trip.
 */
describe("event schema bootstrap", () => {
/** Minimal D1 stub that records prepare and batch calls. */
  function fakeDb(options: { batch?: boolean; fail?: boolean } = {}) {
    const preparedSql: string[] = [];
    const batches: string[][] = [];
    const db: Record<string, unknown> = {
      prepare(sql: string) {
        preparedSql.push(sql);
// Real D1PreparedStatement exposes SQL; include it in the stub so the test can
// assert that batch contains actual table-creation statements rather than empty strings.
        const stmt = {
          sql,
          bind: (..._values: unknown[]) => stmt,
          first: async () => null,
          all: async () => ({ results: [], success: true }),
          run: async () => {
            if (options.fail) throw new Error("D1_ERROR: quota exceeded");
            return { success: true, meta: { changes: 1 } };
          },
        };
        return stmt;
      },
    };
    if (options.batch !== false) {
      db.batch = async (statements: Array<{ sql?: string }>) => {
        const sqls = statements.map((s) => String((s as { sql?: string }).sql ?? ""));
        batches.push(sqls);
        if (options.fail) throw new Error("D1_ERROR: quota exceeded");
        return statements.map(() => ({ success: true, meta: { changes: 1 } }));
      };
    }
    return { db: db as never, preparedSql, batches };
  }

  it("attempts the DDL once for many events while D1 keeps failing", async () => {
    vi.resetModules();
    const mod = await import("./logging");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { db, preparedSql, batches } = fakeDb({ fail: true });
    const env = { DB: db, OBSERVABILITY_HMAC_KEY: "obs" } as unknown as Env;
    const request = new Request("https://limooo.cn/");

    for (let i = 0; i < 5; i++) await mod.logEvent(env, "gate_entry", request, {});
    consoleSpy.mockRestore();

// Five requests should cause only one DDL attempt (one batch round trip for all statements).
    expect(batches).toHaveLength(1);
    expect(batches[0].length).toBeGreaterThanOrEqual(4);
// DDL is prepared, not run statement by statement. preparedSql contains only
// the DDL and the expected failing INSERT; no per-statement table creation
// should add another 13 round trips.
    const preparedDdl = preparedSql.filter((sql) => sql.startsWith("CREATE TABLE"));
    expect(preparedDdl).toHaveLength(1);
  });

  it("does not run the DDL again once it has succeeded", async () => {
    vi.resetModules();
    const mod = await import("./logging");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { db, batches } = fakeDb();
    const env = { DB: db } as unknown as Env;
    const request = new Request("https://limooo.cn/");

    for (let i = 0; i < 3; i++) await mod.logEvent(env, "gate_entry", request, {});
    consoleSpy.mockRestore();
    expect(batches).toHaveLength(1);
  });

  it("retries the DDL once the cooldown has elapsed", async () => {
    vi.resetModules();
    const mod = await import("./logging");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { db, batches } = fakeDb({ fail: true });
    const env = { DB: db } as unknown as Env;
    const request = new Request("https://limooo.cn/");

    await mod.logEvent(env, "gate_entry", request, {});
    expect(batches).toHaveLength(1);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 61_000);
    await mod.logEvent(env, "gate_entry", request, {});
    vi.useRealTimers();
    consoleSpy.mockRestore();

    expect(batches).toHaveLength(2);
  });

  it("falls back to per-statement DDL only when batch is unavailable", async () => {
    vi.resetModules();
    const mod = await import("./logging");
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { db, preparedSql, batches } = fakeDb({ batch: false, fail: true });
    const env = { DB: db } as unknown as Env;
    const request = new Request("https://limooo.cn/");

    await mod.logEvent(env, "gate_entry", request, {});
    consoleSpy.mockRestore();

    expect(batches).toHaveLength(0);
    expect(preparedSql.filter((sql) => sql.startsWith("CREATE TABLE")).length).toBeGreaterThan(0);
  });
});
