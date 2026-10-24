/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Write-wrapper behavior in functions/_lib/d1.ts (tasks/22 W9-7).
 *
 * Regression: `execute()` used to inspect only `res.success === true` and
 * ignore `meta.changes`. D1 `run()` reports `success: true` when an UPDATE or
 * DELETE affects zero rows, causing password updates for missing accounts to
 * return 200 without changing anything and revocation of missing sessions to
 * report success. Now an explicit `meta.changes` value of zero is a failure;
 * drivers and stubs without `meta` remain compatible and count as success.
 */

import { describe, expect, it, vi } from "vitest";
import { execute, executeBatch, queryAll, type D1Database } from "./d1";

function dbWithRun(run: (sql: string) => unknown): { db: D1Database; sqls: string[] } {
  const sqls: string[] = [];
  const db = {
    prepare(sql: string) {
      sqls.push(sql);
      const stmt = {
        bind: (..._values: unknown[]) => stmt,
        first: async () => null,
        all: async () => ({ results: [], success: true }),
        run: async () => run(sql),
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, sqls };
}

describe("execute", () => {
  it("returns true when the statement changed rows", async () => {
    const { db } = dbWithRun(() => ({ success: true, meta: { changes: 1 } }));
    expect(await execute(db, "UPDATE t SET x = 1 WHERE id = 1")).toBe(true);
  });

  it("returns false when the statement affected zero rows", async () => {
    const { db } = dbWithRun(() => ({ success: true, meta: { changes: 0 } }));
    expect(
      await execute(
        db,
        "UPDATE apple_accounts SET password = ? WHERE id = ?",
        "enc",
        999,
      ),
    ).toBe(false);
  });

  it("passes bound values through and still reports zero changes as false", async () => {
    const seen: unknown[][] = [];
    const db = {
      prepare() {
        const stmt = {
          bind: (...values: unknown[]) => {
            seen.push(values);
            return stmt;
          },
          first: async () => null,
          all: async () => ({ results: [], success: true }),
          run: async () => ({ success: true, meta: { changes: 0 } }),
        };
        return stmt;
      },
    } as unknown as D1Database;
    expect(await execute(db, "DELETE FROM t WHERE id = ?", 7)).toBe(false);
    expect(seen).toEqual([[7]]);
  });

  it("keeps working when the driver reports no meta at all", async () => {
// Compatibility: a successful write without meta from a mock or old driver must not be treated as a failure.
    const { db } = dbWithRun(() => ({ success: true }));
    expect(await execute(db, "INSERT INTO t (x) VALUES (1)")).toBe(true);
  });

  it("returns false on success:false and on throw", async () => {
    const failed = dbWithRun(() => ({ success: false, meta: { changes: 0 } }));
    expect(await execute(failed.db, "UPDATE t SET x = 1")).toBe(false);

    const throwing = dbWithRun(() => {
      throw new Error("D1_ERROR: quota exceeded");
    });
    await expect(execute(throwing.db, "UPDATE t SET x = 1")).rejects.toThrow(/quota/);
  });

  it("returns false without a database binding", async () => {
    expect(await execute(undefined, "UPDATE t SET x = 1")).toBe(false);
  });
});

describe("queryAll / executeBatch", () => {
  it("queryAll returns the results array and tolerates a missing db", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ id: 1 }], success: true }),
        }),
        all: async () => ({ results: [{ id: 1 }], success: true }),
      }),
    } as unknown as D1Database;
    expect(await queryAll<{ id: number }>(db, "SELECT id FROM t")).toEqual([{ id: 1 }]);
    expect(await queryAll<{ id: number }>(undefined, "SELECT id FROM t")).toEqual([]);
  });

  it("executeBatch requires every statement to succeed and a full-length result", async () => {
    const stmt = { bind: vi.fn() } as never;
    const ok = {
      batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
    } as unknown as D1Database;
    expect(await executeBatch(ok, [stmt, stmt])).toBe(true);

    const partial = {
      batch: async () => [{ success: true }, { success: false }],
    } as unknown as D1Database;
    expect(await executeBatch(partial, [stmt, stmt])).toBe(false);

    const short = {
      batch: async () => [{ success: true }],
    } as unknown as D1Database;
    expect(await executeBatch(short, [stmt, stmt])).toBe(false);

    const noBatch = {} as unknown as D1Database;
    expect(await executeBatch(noBatch, [stmt])).toBe(false);
    expect(await executeBatch(ok, [])).toBe(false);
  });
});
