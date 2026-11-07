/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * In-memory stand-in for the `identity_handoffs` D1 table, shared by the
 * identity handoff tests.
 *
 * It lives in `tests/` for the same reason as `admin-session.ts`: files under
 * the Pages `functions/` root risk being pulled into the production bundle,
 * while this directory cannot be. The stub implements only the three
 * statements `functions/_lib/identity.ts` issues, with the semantics that
 * matter for the tests:
 *
 * - `DELETE ... WHERE expires_at <= ?` removes expired rows.
 * - `INSERT` rejects a duplicate `code_hash` with SQLite's unique-constraint
 *   error, which issue failures must treat as "not issued", not as an outage.
 * - `DELETE ... RETURNING` removes the matching row before returning it, so
 *   concurrent consumptions behave like D1's atomic statement: one wins and
 *   the rest see an empty result.
 */
import type { D1Database, D1Result } from "../../functions/_lib/d1";

export interface HandoffRow {
  code_hash: string;
  state_hash: string;
  source_host: string;
  target_path: string;
  sub: string;
  email: string;
  auth_at: number;
  expires_at: number;
}

export interface FakeHandoffDb {
  db: D1Database;
  rows: HandoffRow[];
  statements: Array<{ sql: string; values: unknown[] }>;
  /** While set, every statement fails; tests reset it to null to recover. */
  failure: "throw" | "failed" | null;
  /** Error raised in "throw" mode; override to simulate a driver echoing values. */
  failureError: Error;
  /** Move every stored handoff into the past without issuing a statement. */
  expireAll(): void;
}

export function createHandoffDb(): FakeHandoffDb {
  const rows: HandoffRow[] = [];
  const statements: Array<{ sql: string; values: unknown[] }> = [];
  const store = {} as FakeHandoffDb;

  const fail = (): D1Result<never> | null => {
    if (store.failure === "throw") throw store.failureError;
    if (store.failure === "failed") return { results: [], success: false };
    return null;
  };

  function prepare(sql: string) {
    statements.push({ sql, values: [] });
    const entry = statements[statements.length - 1];
    const statement = {
      bind(...values: unknown[]) {
        entry.values = values;
        return statement;
      },
      first: async () => null,
      all: async <T>(): Promise<D1Result<T>> => {
        // Pin the consuming statement: the tests must fail if production stops
        // deleting-and-returning or drops a binding predicate, instead of the
        // fake silently reproducing the semantics from bound values alone.
        if (!sql.includes("DELETE FROM identity_handoffs") || !sql.includes("RETURNING")) {
          throw new Error(`fake handoff db: unsupported statement: ${sql}`);
        }
        for (const predicate of ["code_hash = ?", "state_hash = ?", "source_host = ?", "expires_at > ?"]) {
          if (!sql.includes(predicate)) {
            throw new Error(`fake handoff db: missing predicate ${predicate}: ${sql}`);
          }
        }
        const failure = fail();
        if (failure) return failure as D1Result<T>;
        const [codeHash, stateHash, sourceHost, now] = entry.values as [
          string, string, string, number,
        ];
        const index = rows.findIndex((row) =>
          row.code_hash === codeHash &&
          row.state_hash === stateHash &&
          row.source_host === sourceHost &&
          row.expires_at > now
        );
        if (index === -1) return { results: [], success: true };
        const [row] = rows.splice(index, 1);
        return {
          results: [{
            source_host: row.source_host,
            target_path: row.target_path,
            sub: row.sub,
            email: row.email,
            auth_at: row.auth_at,
          } as T],
          success: true,
        };
      },
      run: async () => {
        const failure = fail();
        if (failure) return { success: false, meta: { changes: 0 } };
        if (sql.includes("INSERT INTO identity_handoffs")) {
          const [codeHash, stateHash, sourceHost, targetPath, sub, email, authAt, expiresAt] =
            entry.values as [string, string, string, string, string, string, number, number];
          if (rows.some((row) => row.code_hash === codeHash)) {
            throw new Error("UNIQUE constraint failed: identity_handoffs.code_hash");
          }
          rows.push({
            code_hash: codeHash,
            state_hash: stateHash,
            source_host: sourceHost,
            target_path: targetPath,
            sub,
            email,
            auth_at: authAt,
            expires_at: expiresAt,
          });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes("DELETE FROM identity_handoffs") && sql.includes("expires_at <= ?")) {
          const now = Number(entry.values[0]);
          const remaining = rows.filter((row) => row.expires_at > now);
          const changes = rows.length - remaining.length;
          rows.splice(0, rows.length, ...remaining);
          return { success: true, meta: { changes } };
        }
        throw new Error(`fake handoff db: unsupported statement: ${sql}`);
      },
    };
    return statement;
  }

  store.db = { prepare } as unknown as D1Database;
  store.rows = rows;
  store.statements = statements;
  store.failure = null;
  store.failureError = new Error("D1_ERROR: database unavailable");
  store.expireAll = () => {
    for (const row of store.rows) row.expires_at = 0;
  };
  return store;
}
