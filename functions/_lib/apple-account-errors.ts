/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Classify D1 write errors for Apple Account records (tasks/22 W9-6).
 *
 * Previously, `catch { return 409 email already exists }` reported **every**
 * D1 failure as a duplicate email. Exhausted write limits, invalid bindings,
 * and network failures all appeared as the same harmless business error,
 * hiding the real failure and leaving no audit row. Return 409 only for a real
 * UNIQUE conflict; all other failures require 500 and an audit entry.
 */

/** D1 / SQLite unique-constraint messages, including column names to identify the table and index. */
const UNIQUE_CONFLICT_RE = /unique constraint|constraint failed: .*\.email|sqlite_constraint/i;

/**
 * Determine whether a write error is a unique-constraint conflict.
 *
 * Inspect the error message rather than its type: D1 throws `Error` without a
 * stable error-code field (`D1_ERROR` is used for quota, syntax, and binding
 * errors alike).
 */
export function isUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return UNIQUE_CONFLICT_RE.test(message);
}

/** Flatten and truncate an error before auditing it, so the full D1 response is not stored in events. */
export function describeWriteError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return message.replace(/\s+/g, " ").slice(0, 200);
}
