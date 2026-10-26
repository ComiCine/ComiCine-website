/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * D1 retention job tests (tasks/22 W5-8).
 *
 * `runRetention` issues DELETEs against **production** D1 daily from the scheduled handler, but
 * previously had no tests. Table names and timestamp columns are assembled at runtime from two
 * string maps, so a typo could silently disable pruning or delete from the wrong table. This
 * minimal D1 stub locks down the SQL, bound parameters, windows, and failure isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUCKETS, DAY_SECONDS, TIMESTAMP_COLUMNS, runRetention } from "./retention";

interface Call {
  sql: string;
  values: unknown[];
  meta: { changes: number } | undefined;
}

/** Record prepare/bind calls; return a change count or throw based on the table name. */
function fakeDb(options: { failTables?: string[]; changes?: number } = {}) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        bind(...values: unknown[]) {
          calls.push({
            sql,
            values,
            meta: options.failTables?.some((table) => sql.includes(`FROM ${table} `))
              ? undefined
              : { changes: options.changes ?? 0 },
          });
          return statement;
        },
        run: async () => {
          const last = calls[calls.length - 1];
          if (last.meta === undefined) throw new Error("D1_ERROR: no such column");
          return { success: true, meta: last.meta };
        },
      };
      return statement;
    },
  };
  return { db: db as never, calls };
}

const NOW = 1_800_000_000;

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("retention buckets", () => {
  it("covers the documented tables with whole-day windows", () => {
    expect(Object.keys(BUCKETS).sort()).toEqual([
      "auth_sessions",
      "events",
      "heartbeats",
      "identity_handoffs",
      "probe_uptime_daily",
      "ray_log_v2",
      "visitor_rollups",
      "visitors_v2",
    ]);
    for (const [table, seconds] of Object.entries(BUCKETS)) {
      expect(seconds, `${table} window`).toBeGreaterThan(0);
      expect(seconds % DAY_SECONDS, `${table} window must be whole days`).toBe(0);
    }
    // These tables use a timestamp column other than the default `ts`.
    expect(TIMESTAMP_COLUMNS).toEqual({
      visitor_rollups: "last_ts",
      probe_uptime_daily: "day",
      auth_sessions: "exp",
      identity_handoffs: "expires_at",
    });
  });

  it("prunes auth_sessions only well after the session TTL", async () => {
    // Each login adds one auth_sessions row, which would grow without bound without pruning (tasks/22 W9-18).
    // The retention window must be **longer than** the session TTL to avoid deleting active sessions.
    const sessionTtlSeconds = 2_592_000; // config-contract.json: session_ttl_seconds
    expect(BUCKETS.auth_sessions).toBeGreaterThan(sessionTtlSeconds);
    expect(TIMESTAMP_COLUMNS.auth_sessions).toBe("exp");

    const { db, calls } = fakeDb({ changes: 2 });
    await runRetention({ DB: db }, NOW);
    const call = calls.find((entry) => entry.sql.startsWith("DELETE FROM auth_sessions "));
    expect(call).toBeDefined();
    expect(call!.sql).toBe("DELETE FROM auth_sessions WHERE exp < ?1");
    expect(call!.values).toEqual([NOW - BUCKETS.auth_sessions]);
  });

  it("deletes one table at a time with the configured window and column", async () => {
    const { db, calls } = fakeDb({ changes: 7 });
    const results = await runRetention({ DB: db }, NOW);

    expect(results).toHaveLength(Object.keys(BUCKETS).length);
    for (const [table, seconds] of Object.entries(BUCKETS)) {
      const column = TIMESTAMP_COLUMNS[table] ?? "ts";
      const call = calls.find((entry) => entry.sql.startsWith(`DELETE FROM ${table} `));
      expect(call, `DELETE for ${table}`).toBeDefined();
      expect(call!.sql).toBe(`DELETE FROM ${table} WHERE ${column} < ?1`);
      // The cutoff must be passed as a bound parameter, not interpolated into SQL.
      expect(call!.sql).not.toContain(String(NOW - seconds));
      expect(call!.values).toEqual([NOW - seconds]);
    }
  });

  it("reports the number of deleted rows per table", async () => {
    const { db } = fakeDb({ changes: 12 });
    const results = await runRetention({ DB: db }, NOW);
    expect(results.every((result) => result.deleted === 12)).toBe(true);
    expect(results.every((result) => result.error === undefined)).toBe(true);
    expect(results.every((result) => result.cutoff === NOW - BUCKETS[result.table])).toBe(true);

    const logged = String(logSpy.mock.calls[0][0]);
    expect(JSON.parse(logged).event).toBe("d1_retention");
  });

  it("keeps pruning the other tables when one table fails", async () => {
    const { db, calls } = fakeDb({ failTables: ["visitor_rollups"], changes: 3 });
    const results = await runRetention({ DB: db }, NOW);

    const failed = results.find((result) => result.table === "visitor_rollups");
    expect(failed?.deleted).toBe(0);
    expect(failed?.error).toContain("no such column");
    expect(failed!.error!.length).toBeLessThanOrEqual(140);

    const healthy = results.filter((result) => result.table !== "visitor_rollups");
    expect(healthy).toHaveLength(Object.keys(BUCKETS).length - 1);
    expect(healthy.every((result) => result.deleted === 3 && !result.error)).toBe(true);
    // Continue issuing DELETEs after a table fails; do not break out of the loop.
    expect(calls.filter((call) => call.sql.startsWith("DELETE FROM")).length).toBe(
      Object.keys(BUCKETS).length,
    );
  });

  it("defaults the cutoff to the current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    try {
      const { db, calls } = fakeDb({ changes: 0 });
      await runRetention({ DB: db });
      const call = calls.find((entry) => entry.sql.startsWith("DELETE FROM events "));
      expect(call!.values).toEqual([NOW - BUCKETS.events]);
    } finally {
      vi.useRealTimers();
    }
  });
});
