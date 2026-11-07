/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** blocked_ips lookup: process-local full-list cache with the per-prefix query fallback. */

import { queryAll } from "../d1";
import { contains, networkAddress, normalizeIp } from "../cidr";
import { logEvent } from "../logging";
import { shouldLogDiagnostic } from "../sampling";
import { requestUrl } from "../routing";

interface BlockedRow {
  cidr: string;
  network: string;
  prefix: number;
}

/* Automatic gate-failure threshold blocking was removed; manual bans go through /api/blocklist. */

/**
 * Process-local cache duration for the complete blocked_ips list, in milliseconds.
 *
 * Sixty seconds balances a maximum one-minute delay for admin changes against
 * at most one full-table read per isolate per minute. The cache affects reads
 * only; write paths (/api/blocklist and automatic blocking) do not use it.
 */
export const BLOCKED_LIST_TTL_MS = 60_000;

/**
 * Cache by the **env.DB binding object itself** in a WeakMap, not by a closure singleton.
 *
 * One isolate may use different DB bindings in different environments or test
 * stubs. Keying by the binding ensures that environment A's blocklist is never
 * used to classify requests in environment B.
 */
interface BlockedListCacheEntry {
/** Last **successfully** read full list, or `null` if none; a read failure does not clear it. */
  rows: BlockedRow[] | null;
/** Time of the last read attempt; determines when the cooldown ends. */
  at: number;
}

const blockedListCache = new WeakMap<object, BlockedListCacheEntry>();

/** Full-list query; `active = 1` matches the per-prefix filter. */
const BLOCKED_LIST_SQL = "SELECT cidr, network, prefix FROM blocked_ips WHERE active = 1";

/**
 * Reproduce per-prefix query matching in memory.
 *
 * Equivalence relies on `blocked_ips.network` always being a **normalized
 * network address**. The write paths in `_lib/cidr.ts` and `src/cidr.py` mask
 * and normalize before storing. Thus `contains(network, prefix, ip) === true`
 * is equivalent to the SQL predicate `networkAddress(ip, prefix) = network`.
 * Both paths reject prefixes wider than the address. Select the maximum prefix
 * as the query path does, and use the `cidr` primary key to avoid ambiguity.
 */
function matchBlockedRow(
  rows: BlockedRow[],
  normalized: string,
  maxPrefix: number,
): BlockedRow | null {
  let matched: BlockedRow | null = null;
  let matchedPrefix = -1;
  for (const row of rows) {
    const prefix = Number(row.prefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) continue;
    if (typeof row.network !== "string") continue;
    if (!contains(row.network, prefix, normalized)) continue;
    if (prefix > matchedPrefix) {
      matchedPrefix = prefix;
      matched = row;
    }
  }
  return matched;
}

/**
 * Read the full blocklist once and cache **this attempt** (the list on success, null on failure).
 *
 * Cache failures too: during a D1 disruption, do not make every request repeat
 * a full-list read that is certain to fail before falling back. That would
 * double the requests during one outage (the same cooldown principle as
 * `logging.ensureEventSchema`). During cooldown, use the original per-prefix
 * query path with unchanged semantics.
 */
async function readBlockedList(
  db: import("../env").Env["DB"] & object,
  now: number,
): Promise<BlockedRow[] | null> {
  let rows: BlockedRow[] | null = null;
  try {
    const stmt = db.prepare(BLOCKED_LIST_SQL);
    const result = await stmt.all<BlockedRow>();
// If a driver or test stub does not explicitly report success: true, fall back
// to per-prefix queries. An extra query is safer than allowing based on a
// potentially unreliable empty list.
    if (result?.success === true) rows = result.results ?? [];
  } catch {
    rows = null;
  }
// On read failure, **keep the last successful list** instead of replacing it
// with null. Otherwise the cooldown forces per-prefix queries, which could
// also fail and make all application blocking fail open during a D1 outage.
// Using a list read seconds earlier avoids allowing repeat offenders or
// blocking normal visitors. Literal fail-closed behavior would send every
// non-allowlisted visitor to a gate page that also reads D1, turning a brief
// disruption into a site-wide outage.
  const previous = blockedListCache.get(db)?.rows ?? null;
  const serving = rows ?? previous;
  blockedListCache.set(db, { rows: serving, at: now });
// Return the list **actually used for the decision**. If a read failed but an
// older list exists, return it so the caller can keep checking. Return null
// only before any successful read; the caller then falls back to per-prefix queries.
  return serving;
}

/** Original per-prefix query path, used unchanged when the cache is unavailable (one IPv4 or three IPv6 round trips). */
async function queryBlockedRows(
  db: import("../env").Env["DB"],
  normalized: string,
  maxPrefix: number,
): Promise<BlockedRow | null> {
  const candidates: Array<[string, number]> = [];
  for (let prefix = 0; prefix <= maxPrefix; prefix++) {
    const network = networkAddress(normalized, prefix);
    if (network) candidates.push([network, prefix]);
  }
  let matched: BlockedRow | null = null;
// Each network/prefix pair uses two bind parameters. Forty-nine pairs stay
// within D1's 100-parameter statement limit, so IPv4 needs one query and IPv6
// drops from seven to three.
  for (let start = 0; start < candidates.length; start += 49) {
    const chunk = candidates.slice(start, start + 49);
    const conditions = chunk.map(() => "(network = ? AND prefix = ?)").join(" OR ");
    const rows = await queryAll<BlockedRow>(
      db,
      `SELECT cidr, network, prefix
       FROM blocked_ips
       WHERE active = 1 AND (${conditions})
       ORDER BY prefix DESC
       LIMIT 1`,
      ...chunk.flatMap(([network, prefix]) => [network, prefix]),
    );
    for (const row of rows) {
      if (!matched || row.prefix > matched.prefix) matched = row;
    }
  }
  return matched;
}

/**
 * Check a request IP against blocked_ips after normalization (allow on database errors).
 *
 * On a process-cache hit (TTL is BLOCKED_LIST_TTL_MS), match the full list in
 * JavaScript without a database read. When cold or after a failed read, use the
 * original per-prefix query path with unchanged fail-open behavior. A
 * `block_match` event must have the same fields and decision as the query path,
 * including its `cidr` value.
 */
export async function isBlocked(
  env: { DB?: import("../env").Env["DB"] },
  request: Request,
  ip: string,
): Promise<boolean> {
  if (!env.DB || !ip) return false;
  const url = requestUrl(request);
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const maxPrefix = normalized.includes(":") ? 128 : 32;
  try {
    const now = Date.now();
    const cached = blockedListCache.get(env.DB);
    const fresh = cached && now - cached.at < BLOCKED_LIST_TTL_MS ? cached : null;
// Use the cached list during cooldown; otherwise refresh it. On read failure,
// readBlockedList returns null but **preserves the previous successful list**,
// so rows may still contain data read seconds ago.
    const rows = fresh ? fresh.rows : await readBlockedList(env.DB, now);

// Fallback order, from most authoritative:
//   1. Use the in-memory list (newly read or the last successful result); no query.
//   2. If there is no list, use the original per-prefix query, which distinguishes driver errors from misses.
//   3. If that query also fails, the outer catch is the remaining fail-open path.
    //
// Using the retained list in step 1 instead of failing open is the key change.
// Previously, a failed read replaced the cache with `rows: null`, forcing step
// 2; if that failed too, all application-level blocking silently failed open
// during D1 disruptions. A list read seconds earlier blocks repeat offenders
// while still allowing normal visitors. Literal fail-closed behavior would
// send every non-allowlisted visitor to a gate page that also reads D1,
// turning a transient issue into a site-wide outage.
    const matched = rows
      ? matchBlockedRow(rows, normalized, maxPrefix)
      : await queryBlockedRows(env.DB, normalized, maxPrefix);
    if (matched) {
      // Keep the first match per source per minute; a blocked scanner would otherwise write
      // one events row per request and can exhaust the daily D1 write budget.
      if (shouldLogDiagnostic("block_match", normalized)) {
        await logEvent(env as never, "block_match", request, {
          ip: normalized,
          path: url.pathname,
          outcome: "blocked",
          status: 403,
          message: `cidr=${matched.cidr}`,
        });
      }
      return true;
    }
  } catch {
// Fail open: skip application-level blocking when the database is unavailable.
  }
  return false;
}
