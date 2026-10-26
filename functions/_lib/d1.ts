/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Minimal D1 types and wrappers, avoiding the @cloudflare/workers-types package. */

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}

export interface D1BatchResult {
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch?(statements: D1PreparedStatement[]): Promise<D1BatchResult[]>;
}

export async function queryAll<T>(
  db: D1Database | undefined,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  if (!db) return [];
  const stmt = db.prepare(sql);
  const res = values.length ? stmt.bind(...values).all<T>() : stmt.all<T>();
  return (await res).results ?? [];
}

/**
 * Execute a write statement and report whether it actually changed any rows.
 *
 * Do not rely on `success` alone: D1 `run()` reports `success: true` when an
 * UPDATE or DELETE affects zero rows. This previously let a password update
 * for a missing account return 200 without changing anything and let
 * `revokeAuthSession` report success for a missing session. Treat an explicit
 * `meta.changes` value of zero as failure. For compatibility, drivers and
 * stubs without `meta` remain successful because the change count is unknown.
 */
export async function execute(
  db: D1Database | undefined,
  sql: string,
  ...values: unknown[]
): Promise<boolean> {
  if (!db) return false;
  const stmt = db.prepare(sql);
  const res = values.length ? stmt.bind(...values).run() : stmt.run();
  const result = await res;
  if (result.success !== true) return false;
  const changes = result.meta?.changes;
  if (typeof changes === "number") return changes > 0;
  return true;
}

/** Execute multiple statements in one D1 transaction; any failure fails the batch. */
export async function executeBatch(
  db: D1Database | undefined,
  statements: D1PreparedStatement[],
): Promise<boolean> {
  if (!db?.batch || statements.length === 0) return false;
  try {
    const results = await db.batch(statements);
    return results.length === statements.length && results.every((r) => r.success);
  } catch {
    return false;
  }
}
