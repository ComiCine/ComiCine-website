/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Key blocking invariant: **the Cloudflare IP List entries must equal the set of CIDRs in
 * D1 `blocked_ips` where `active = 1`** (tasks/22; see the blocklist conventions in AGENTS.md).
 *
 * Previously, `ops/check_blocklist_sync.py` was the only reader of this invariant, and it was
 * a manual-only entry point (it had no automated callers). A partial sync failure or a List
 * edited in the Dashboard would go unnoticed until someone remembered to run the script:
 * D1 would look healthy while edge blocking had stopped. This check now runs in the
 * status-worker daily job (cron `47 3 * * *`) and reports through the existing alert channel.
 * The Python script remains available for manual investigation, including `--record` and more
 * detailed pagination output. Both checks compare the same two sets.
 *
 * Why this worker carries a **minimal local implementation** instead of importing code across
 * Workers as `ops/sync-worker/src/runlog.ts` does: status-worker and sync-worker are separate
 * deployment units, and this code only compares data; it does not sync it. A cross-directory
 * import would pull the entire sync-worker into status-worker's bundle, adding structural
 * coupling for a read-only check. Sharing `sync-worker/src/runlog.ts` with `ops/d1-archive` is
 * justified because they share write conventions; this check does not. The tradeoff is that
 * `LIST_NAME`, API paths, and `normalizeListItem` rules are duplicated here. Comments in both
 * places point to the other: keep this file in sync when changing normalization or paths in
 * `ops/sync-worker/src/index.ts`, and vice versa. `blocklist.test.ts` locks down this behavior.
 *
 * Cost limits (see the D1 read budget in AGENTS.md):
 *   - Runs once per day, only in the daily job.
 *   - Reads D1 with one query: `SELECT cidr FROM blocked_ips WHERE active = 1` (uses
 *     `idx_blocked_ips_active`; measured as `rows_read=1` in production).
 *   - Makes two read-only Cloudflare API calls: find the List by name to get its ID, then read
 *     one page of items (`per_page=500`; production returned one item and no cursor). The List
 *     ID is not hard-coded because it is opaque and changes when the List is recreated.
 *   - Missing credentials, D1 read failures, and API failures all fail open: log only, with no
 *     alert, so clones without secrets do not generate false alarms.
 */

/** Must match `LIST_NAME` in `ops/sync-worker/src/index.ts`; each worker keeps its own copy. */
export const LIST_NAME = "limooo_blocklist";
/** Cloudflare API base URL; must match `ops/sync-worker/src/index.ts`. */
export const CF_API = "https://api.cloudflare.com/client/v4";
/** The items endpoint allows at most 500 per page; 1000 returns HTTP 400. */
export const PAGE_SIZE = 500;
/** Cursor pagination has no explicit last-page marker; cap iterations to prevent an infinite loop. */
export const MAX_ITEM_PAGES = 20;

/**
 * Must match `normalizeListItem` in `ops/sync-worker/src/index.ts` (**changes must be made in both places**).
 *
 * Cloudflare normalizes IPv4 /32 values to bare IPs (write `1.2.3.4/32`, read back
 * `1.2.3.4`), and does the same for IPv6 /128 values. Without normalization, the same item
 * appears in both the add and remove sets, making every comparison report drift.
 */
export function normalizeListItem(value: string): string {
  const raw = (value ?? "").trim();
  const slash = raw.lastIndexOf("/");
  if (slash < 0) return raw;
  const prefix = Number(raw.slice(slash + 1));
  const addr = raw.slice(0, slash);
  if (prefix === 32 && !addr.includes(":")) return addr;
  if (prefix === 128 && addr.includes(":")) return addr;
  return raw;
}

export interface BlocklistDiff {
  toAdd: string[];
  toRemove: string[];
}

/** Read-only counterpart of `diffSync` in `ops/sync-worker/src/index.ts`; update both copies together. */
export function diffBlocklist(desired: Iterable<string>, existing: Iterable<string>): BlocklistDiff {
  const desiredNorm = new Set([...desired].map(normalizeListItem));
  const existingNorm = new Set([...existing].map(normalizeListItem));
  return {
    toAdd: [...desiredNorm].filter((cidr) => !existingNorm.has(cidr)).sort(),
    toRemove: [...existingNorm].filter((cidr) => !desiredNorm.has(cidr)).sort(),
  };
}

export interface BlocklistSnapshot {
  desired: string[];
  actual: string[];
  diff: BlocklistDiff;
  /** No List with the configured name was found. Treat actual as empty so desired entries appear in `toAdd`. */
  listMissing: boolean;
}

export interface BlocklistCheckResult {
  /** Both sides were read successfully and can be compared. */
  ok: boolean;
  /** Reason for `ok=false` (missing credentials, D1, or API failure), not a drift result. */
  reason?: string;
  snapshot?: BlocklistSnapshot;
}

interface CfList {
  id?: string;
  name?: string;
}

async function cfGet(token: string, url: string): Promise<any> {
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`CF API ${resp.status} ${url}`);
  return resp.json();
}

/** Read every page by cursor; throw if the cursor stalls or the page limit is exceeded. */
async function readListItems(
  token: string,
  accountId: string,
  listId: string,
): Promise<string[]> {
  const ips: string[] = [];
  let cursor = "";
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const query = cursor
      ? `?per_page=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      : `?per_page=${PAGE_SIZE}`;
    const resp = await cfGet(
      token,
      `${CF_API}/accounts/${accountId}/rules/lists/${listId}/items${query}`,
    );
    const result: Array<{ ip?: string }> = resp?.result ?? [];
    for (const item of result) if (item.ip) ips.push(item.ip);
    const next = resp?.result_info?.cursor ?? "";
    if (!next || !result.length) return ips;
    if (next === cursor) {
      throw new Error(`list ${listId}: cursor did not advance (${next})`);
    }
    cursor = next;
  }
  throw new Error(`list ${listId}: more than ${MAX_ITEM_PAGES} pages of items`);
}

export interface BlocklistEnv {
  DB: D1Database;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

/**
 * Read and compare both sides. **Never throws**: missing credentials, D1 failures, and API
 * failures return `{ok:false, reason}` for the caller to log.
 */
export async function checkBlocklistInvariant(env: BlocklistEnv): Promise<BlocklistCheckResult> {
  const token = (env.CLOUDFLARE_API_TOKEN ?? "").trim();
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (!token || !accountId) {
    // Missing secrets means "not checked," not "check failed"; do not alert.
    return { ok: false, reason: "missing_credentials" };
  }

  let desired: string[];
  try {
    const rows = await env.DB.prepare("SELECT cidr FROM blocked_ips WHERE active = 1").all<{
      cidr: string;
    }>();
    desired = (rows.results ?? []).map((r) => r.cidr);
  } catch (err) {
    return { ok: false, reason: `d1_error: ${String(err).slice(0, 140)}` };
  }

  try {
    const lists = await cfGet(token, `${CF_API}/accounts/${accountId}/rules/lists?per_page=100`);
    const list: CfList | undefined = (lists?.result ?? []).find(
      (l: CfList) => l.name === LIST_NAME,
    );
    // This read-only check never creates a List; that is sync-worker's responsibility. Treat a
    // missing List as empty so any desired entries appear in `toAdd`.
    const actual = list?.id ? await readListItems(token, accountId, list.id) : [];
    return {
      ok: true,
      snapshot: {
        desired,
        actual,
        diff: diffBlocklist(desired, actual),
        listMissing: !list?.id,
      },
    };
  } catch (err) {
    return { ok: false, reason: `cf_error: ${String(err).slice(0, 140)}` };
  }
}
