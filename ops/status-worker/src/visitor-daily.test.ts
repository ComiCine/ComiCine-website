/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Visitor daily aggregation tests.
 *
 * `visitorDailyAggregateSql` is a hand-maintained copy of `_aggregate_sql` in `ops/prune_d1.py`
 * (see the module docstring in visitor-daily.ts). These tests lock down the statement before it
 * runs against production D1: the complete-day window, both source tables, the deduplication key,
 * the monotonic upsert, and the requirement that a failed aggregate never throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VISITOR_DAILY_AGGREGATE_DAYS,
  runVisitorDailyAggregate,
  visitorDailyAggregateSql,
} from "./visitor-daily";

const DAY_SECONDS = 86_400;
/** Current UTC midnight, the end of every aggregation window. */
const DAY_START = "(unixepoch() / 86400) * 86400";

/** Record the SQL that actually runs; optionally fail at prepare or at run time. */
function fakeDb(failure?: "prepare" | "run") {
  const calls: string[] = [];
  const db = {
    prepare(sql: string) {
      if (failure === "prepare") throw new Error("D1_ERROR: prepare failed");
      return {
        run: async () => {
          if (failure === "run") throw new Error("D1_ERROR: no such table: visitors_daily");
          calls.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  return { db: db as never, calls };
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("visitorDailyAggregateSql", () => {
  it("runs exactly one statement that starts with the visitors_daily insert", async () => {
    const { db, calls } = fakeDb();
    await expect(runVisitorDailyAggregate({ DB: db })).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith("INSERT INTO visitors_daily")).toBe(true);
    expect(calls[0]).toBe(visitorDailyAggregateSql());
    expect(calls[0]).not.toContain("INSERT OR REPLACE");
  });

  it("combines both source tables and upserts monotonically on the daily key", () => {
    const sql = visitorDailyAggregateSql();

    expect(visitorDailyAggregateSql()).toContain("INSERT INTO visitors_daily");
    for (const fragment of [
      "FROM visitors_v2",
      "FROM visitor_rollups",
      "ON CONFLICT (day, country, page_slug, status) DO UPDATE",
      "MAX(unique_ips, excluded.unique_ips)",
      "MAX(requests, excluded.requests)",
      "strftime('%Y-%m-%d', ts, 'unixepoch')",
      DAY_START,
    ]) {
      expect(sql, `missing fragment: ${fragment}`).toContain(fragment);
    }
  });

  it("shifts the window start by the requested number of complete days", () => {
    const oneDay = visitorDailyAggregateSql(1);
    expect(oneDay).toContain(`WHERE ts >= ${DAY_START} - 86400 AND ts < ${DAY_START} `);
    expect(oneDay).toContain(`WHERE last_ts >= ${DAY_START} - 86400 AND last_ts < ${DAY_START})`);

    const thirtyDays = visitorDailyAggregateSql(30);
    expect(thirtyDays).toContain(`WHERE ts >= ${DAY_START} - 2592000 AND ts < ${DAY_START} `);
    expect(thirtyDays).toContain(
      `WHERE last_ts >= ${DAY_START} - 2592000 AND last_ts < ${DAY_START})`,
    );

    // The default must stay the seven days documented next to AGGREGATE_COMPLETE_DAYS in prune_d1.py.
    expect(VISITOR_DAILY_AGGREGATE_DAYS).toBe(7);
    const sevenDays = visitorDailyAggregateSql();
    expect(sevenDays).toContain(`WHERE ts >= ${DAY_START} - 604800 AND ts < ${DAY_START} `);
    expect(sevenDays).not.toBe(oneDay);
    expect(thirtyDays).not.toBe(sevenDays);
  });

  it("covers complete UTC days only, never today", () => {
    const sql = visitorDailyAggregateSql();

    // Exactly one window per source table, so no unbounded or duplicated scan can sneak in.
    expect(sql.match(/\bts >=/g)).toHaveLength(1);
    expect(sql.match(/\bts </g)).toHaveLength(1);
    expect(sql.match(/last_ts >=/g)).toHaveLength(1);
    expect(sql.match(/last_ts </g)).toHaveLength(1);

    // The window ends at UTC midnight; comparing against `unixepoch()` directly would include today.
    expect(sql).toContain(`AND ts < ${DAY_START} UNION ALL`);
    expect(sql).toContain(`AND last_ts < ${DAY_START})`);
    expect(sql).not.toMatch(/[<>]=?\s*unixepoch\(\)/);
    expect(sql).not.toContain("CURRENT_DATE");
  });

  it("respects a custom day count passed to the runner", async () => {
    const { db, calls } = fakeDb();
    await expect(runVisitorDailyAggregate({ DB: db }, 30)).resolves.toBe(true);

    expect(calls[0]).toBe(visitorDailyAggregateSql(30));
    expect(calls[0]).toContain("- 2592000 ");
    expect(JSON.parse(String(logSpy.mock.calls.at(-1)?.[0]))).toEqual({
      event: "visitor_daily_aggregate",
      days: 30,
      ok: true,
    });
  });
});

describe("runVisitorDailyAggregate failures", () => {
  it("resolves false and logs when the statement rejects", async () => {
    const { db, calls } = fakeDb("run");
    await expect(runVisitorDailyAggregate({ DB: db })).resolves.toBe(false);
    expect(calls).toHaveLength(0);

    const logged = JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0]));
    expect(logged.event).toBe("visitor_daily_aggregate");
    expect(logged.ok).toBe(false);
    expect(logged.days).toBe(VISITOR_DAILY_AGGREGATE_DAYS);
    expect(logged.error).toContain("no such table");
    expect(String(logged.error).length).toBeLessThanOrEqual(140);
  });

  it("resolves false when prepare throws synchronously", async () => {
    const { db } = fakeDb("prepare");
    await expect(runVisitorDailyAggregate({ DB: db })).resolves.toBe(false);

    const logged = JSON.parse(String(errorSpy.mock.calls.at(-1)?.[0]));
    expect(logged.event).toBe("visitor_daily_aggregate");
    expect(logged.ok).toBe(false);
    expect(logged.error).toContain("prepare failed");
  });
});
