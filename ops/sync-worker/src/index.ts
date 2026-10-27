/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Incrementally sync active blocked_ips rows from D1 to the Cloudflare IP List daily at 03:30.
 * This ports sync_cloudflare from the former auto_block.py; ipset/iptables support was dropped
 * during the migration.
 *
 * Failure visibility (added 2026-10-11): scheduled() previously used only
 * `ctx.waitUntil(sync(env))`. waitUntil silently swallowed promise rejections, so the cron panel
 * showed "ran" even when nothing was written, with no record of the failure. Now:
 *   1. Write one row per run to D1 worker_runs (successes and failures; failures include error).
 *   2. scheduled() explicitly awaits with try/catch and logs failures as structured single-line JSON.
 *   3. GET /?health=1 reports health without triggering a sync and returns { ok, job, lastRun }.
 * None of these add reads to the hot path: run records are write-only there; only the health endpoint reads them.
 */

import { insertRun, lastRun, runStartedAt, updateRun, type RunRow } from "./runlog";

/**
 * Structured single-line JSON run log, matching the style of logEvent in
 * functions/_lib/logging.ts: one complete JSON object per line with grep-friendly field names.
 *
 * Failures use console.error; other outcomes use console.log. Cloudflare Logs and `wrangler tail`
 * can filter by level, making `outcome:"failed"` searchable. This is the core fix: waitUntil
 * previously swallowed rejections without leaving any log line.
 */
function logRun(fields: Record<string, unknown> & { outcome?: string }): void {
  const payload: { event: string; ts: number; job: string; outcome?: string } & Record<
    string,
    unknown
  > = {
    event: JOB,
    ts: runStartedAt(),
    job: JOB,
    ...fields,
  };
  const line = JSON.stringify(payload);
  if (payload.outcome === "failed") console.error(line);
  else console.log(line);
}

interface D1Result<T> {
  results: T[];
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface Env {
  DB: D1Database;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  SYNC_TOKEN: string;
}

const LIST_NAME = "comicine_blocklist";
const API = "https://api.cloudflare.com/client/v4";
const BATCH = 200;
// The list-item API caps per_page at 500. Passing 1000 returns HTTP 400
// (code 10027 "invalid or expired cursor") and fails the entire sync.
const PAGE_SIZE = 500;
// The items API paginates by cursor and has no "last page" flag. Cap iterations to avoid an
// infinite loop if upstream behavior changes, such as ignoring the cursor or never terminating.
const MAX_ITEM_PAGES = 20;
// Poll bulk_operations 40 times at 2 seconds each (~80 seconds); treat timeout as failure.
const OPERATION_POLLS = 40;
const OPERATION_POLL_MS = 2000;

/** Job name for run records; must match the job values in ops/migrations/018_worker_runs.sql. */
export const JOB = "blocklist_sync";

export interface SyncResult {
  toAdd: string[];
  toRemove: string[];
}

/**
 * Cloudflare's IP List normalizes IPv4 /32 entries to bare IPs (write 1.2.3.4/32, read back
 * 1.2.3.4), and does the same for IPv6 /128. Comparing raw strings would mark one entry for both
 * adding and removing, repeatedly deleting and re-adding it on every sync. Normalize both forms here.
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

export function diffSync(
  desired: Set<string>,
  existing: Map<string, string>,
): SyncResult {
  // Normalize both sides before comparing to avoid mismatches between /32 and bare IPs.
  const desiredNorm = new Set([...desired].map(normalizeListItem));
  const existingNorm = new Set([...existing.keys()].map(normalizeListItem));
  const toAdd = [...desiredNorm].filter((cidr) => !existingNorm.has(cidr));
  const toRemove = [...existingNorm].filter((cidr) => !desiredNorm.has(cidr));
  return { toAdd, toRemove };
}

async function cf(token: string, method: string, url: string, body?: unknown): Promise<any> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`CF API ${resp.status} ${url}`);
  return resp.json();
}

/**
 * Wait for one bulk operation to finish.
 *
 * Key requirement (tasks/22 W7-6): both `failed` and polling timeouts must throw. Previously,
 * both returned normally, so callers printed `synced: +N -M` and made a failed write look successful.
 */
async function waitOperation(token: string, accountId: string, operationId?: string): Promise<void> {
  if (!operationId) return;
  for (let i = 0; i < OPERATION_POLLS; i++) {
    const resp = await cf(
      token,
      "GET",
      `${API}/accounts/${accountId}/rules/lists/bulk_operations/${operationId}`,
    );
    const status = resp?.result?.status;
    if (status === "completed") return;
    if (status === "failed") {
      const detail = resp?.result?.error ?? resp?.errors ?? resp?.result;
      throw new Error(
        `CF list bulk operation ${operationId} failed: ${JSON.stringify(detail).slice(0, 200)}`,
      );
    }
    await new Promise((r) => setTimeout(r, OPERATION_POLL_MS));
  }
  throw new Error(
    `CF list bulk operation ${operationId} did not finish within ` +
      `${OPERATION_POLLS} polls (${(OPERATION_POLLS * OPERATION_POLL_MS) / 1000}s)`,
  );
}

/**
 * Read every entry in the IP List.
 *
 * Paginate with `result_info.cursor` (Cloudflare no longer supports `page=`; passing it returns
 * the same page and could make the old implementation loop forever). Throw if the cursor does not
 * advance or MAX_ITEM_PAGES is exceeded; never silently sync only the first page.
 */
async function listItems(token: string, accountId: string, listId: string): Promise<Map<string, string>> {
  const items = new Map<string, string>();
  let cursor = "";
  for (let page = 0; page < MAX_ITEM_PAGES; page++) {
    const query = cursor
      ? `?per_page=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
      : `?per_page=${PAGE_SIZE}`;
    const resp = await cf(
      token,
      "GET",
      `${API}/accounts/${accountId}/rules/lists/${listId}/items${query}`,
    );
    const result: Array<{ ip: string; id: string }> = resp?.result ?? [];
    for (const item of result) items.set(item.ip, item.id);
    const next = resp?.result_info?.cursor ?? "";
    if (!next || !result.length) return items;
    if (next === cursor) {
      throw new Error(
        `list ${listId}: cursor did not advance (${next}); refusing to re-read the same page`,
      );
    }
    cursor = next;
  }
  throw new Error(
    `list ${listId}: more than ${MAX_ITEM_PAGES} pages of items; refusing to loop forever`,
  );
}

export async function sync(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<SyncResult> {
  const token = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    console.log("[cf] missing credentials, skipping");
    return { toAdd: [], toRemove: [] };
  }

  // Sync only active rows; soft-deleted admin/unblock tombstones must not return to the CF List.
  const rows = await env.DB.prepare(
    "SELECT cidr FROM blocked_ips WHERE active = 1",
  ).all<{ cidr: string }>();
  const desired = new Set((rows.results ?? []).map((r) => r.cidr));

  const lists = await cf(token, "GET", `${API}/accounts/${accountId}/rules/lists?per_page=100`);
  let list = (lists?.result ?? []).find((l: { name: string }) => l.name === LIST_NAME);
  if (!list) {
    const created = await cf(token, "POST", `${API}/accounts/${accountId}/rules/lists`, {
      name: LIST_NAME,
      kind: "ip",
      description: "auto-blocked networks from nginx logs",
    });
    list = created?.result;
  }
  if (!list?.id) throw new Error("list not found/created");

  const existing = await listItems(token, accountId, list.id);
  const { toAdd, toRemove } = diffSync(desired, existing);
  if (options.dryRun) {
    console.log(`[cf] dry-run: +${toAdd.length} -${toRemove.length}`);
    return { toAdd, toRemove };
  }

  for (let i = 0; i < toAdd.length; i += BATCH) {
    const chunk = toAdd.slice(i, i + BATCH).map((ip) => ({ ip }));
    const resp = await cf(token, "POST", `${API}/accounts/${accountId}/rules/lists/${list.id}/items`, chunk);
    await waitOperation(token, accountId, resp?.result?.operation_id);
  }
  // toRemove contains normalized values, so do not pass them directly to existing.get(). A /32
  // may differ from its bare-IP form and fail to find the list-item ID, silently skipping deletion.
  const idByNormalized = new Map<string, string>();
  for (const [rawIp, id] of existing) idByNormalized.set(normalizeListItem(rawIp), id);
  for (let i = 0; i < toRemove.length; i += BATCH) {
    const chunk = toRemove
      .slice(i, i + BATCH)
      .map((ip) => ({ id: idByNormalized.get(ip) }))
      .filter((x): x is { id: string } => Boolean(x.id));
    if (!chunk.length) continue;
    const resp = await cf(token, "DELETE", `${API}/accounts/${accountId}/rules/lists/${list.id}/items`, {
      items: chunk,
    });
    await waitOperation(token, accountId, resp?.result?.operation_id);
  }
  console.log(`[cf] synced: +${toAdd.length} -${toRemove.length}`);
  return { toAdd, toRemove };
}

/**
 * Shared entry point for scheduled and fetch: run one sync and write one worker_runs row.
 *
 * The key difference from sync() is who records failures. sync() still performs the sync and throws;
 * this outer layer records the result so throwing and recording cannot get out of sync:
 *   - On error, write outcome='failed' and the error text, then rethrow so logs remain searchable.
 *   - On success, write outcome='ok' and the current delta.
 *   - If credentials are missing, write outcome='skipped' because no sync was attempted.
 *
 * A run-record write failure only uses console.error and never affects the sync (fail-open, like
 * write failures in functions/_lib/logging.ts). The caller handles record-read failures similarly.
 */
export async function runSync(
  env: Env,
  options: { dryRun?: boolean } = {},
): Promise<SyncResult & { runId: number | null }> {
  const startedAt = runStartedAt();
  const runId = await insertRun(env.DB, JOB, startedAt);
  const missingCredentials = !env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID;
  logRun({ outcome: "started", dry_run: options.dryRun === true });
  try {
    const result = await sync(env, options);
    const outcome = missingCredentials ? "skipped" : "ok";
    await updateRun(env.DB, runId, {
      finishedAt: runStartedAt(),
      outcome,
      added: result.toAdd.length,
      removed: result.toRemove.length,
      dryRun: options.dryRun === true,
    });
    logRun({
      outcome,
      added: result.toAdd.length,
      removed: result.toRemove.length,
      dry_run: options.dryRun === true,
      duration_ms: runStartedAt() - startedAt,
    });
    return { ...result, runId };
  } catch (error) {
    await updateRun(env.DB, runId, {
      finishedAt: runStartedAt(),
      outcome: "failed",
      error: String(error),
    });
    logRun({ outcome: "failed", error: String(error), duration_ms: runStartedAt() - startedAt });
    throw error;
  }
}

/**
 * Authenticate the manual trigger endpoint by checking Authorization: Bearer <SYNC_TOKEN>.
 *
 * This Worker is reachable on workers.dev, which is not a custom-domain zone where the
 * zone-level mTLS/Client Certificate rules apply. Use a shared secret instead. Scheduled tasks
 * call internally and do not pass through this check.
 *
 * Fail closed when SYNC_TOKEN is not configured, rejecting all HTTP calls so a missing secret
 * cannot leave the endpoint open.
 */
export function authorized(request: Request, env: Env): boolean {
  const expected = (env.SYNC_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length).trim();
  if (!provided || provided.length !== expected.length) return false;
  // Compare every character after confirming equal lengths; do not return early and leak prefix information.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/** Report health only, without syncing: include the latest run and any reason the table is unavailable. */
export async function health(env: Env): Promise<{ ok: boolean; job: string; lastRun: RunRow | null; error?: string }> {
  try {
    return { ok: true, job: JOB, lastRun: await lastRun(env.DB, JOB) };
  } catch (error) {
    // An unreadable run record does not mean the sync failed. Keep ok=true and include the read error.
    return { ok: true, job: JOB, lastRun: null, error: String(error) };
  }
}

export default {
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(p: Promise<unknown>): void },
  ): Promise<void> {
    // Explicitly await inside try/catch: `ctx.waitUntil(sync(env))` swallows rejections while the
    // cron panel still reports success. This hid 20 consecutive days of sync failures (2026-10-11).
    const work = (async () => {
      try {
        const result = await runSync(env);
        // runSync already logged a structured outcome='ok' line. Add this cron completion line so
        // logs make it clear whether the cron invocation finished.
        logRun({
          outcome: "scheduled_ok",
          added: result.toAdd.length,
          removed: result.toRemove.length,
        });
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "blocklist_sync",
            ts: runStartedAt(),
            job: JOB,
            outcome: "failed",
            stage: "scheduled",
            error: String(error),
          }),
        );
      }
    })();
    /**
     * Pass the promise to both waitUntil and local await. The former lets the isolate finish the
     * work after the response; the latter explicitly observes the promise and prevents silent rejection.
     */
    ctx.waitUntil(work);
    await work;
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    // Authenticate before any branch; even the health endpoint requires SYNC_TOKEN.
    if (!authorized(request, env)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    if (url.searchParams.get("health") === "1") {
      return Response.json(await health(env));
    }
    const dryRun = url.searchParams.get("dry-run") === "1";
    try {
      const result = await runSync(env, { dryRun });
      // Preserve the existing `ok:true + toAdd/toRemove` shape used by .zshrc's _limooo_sync_cf
      // and other callers; add new fields only.
      return Response.json({
        ok: true,
        status: "synced",
        synced: true,
        dryRun,
        toAdd: result.toAdd,
        toRemove: result.toRemove,
        runId: result.runId,
        lastRun: await lastRun(env.DB, JOB),
      });
    } catch (error) {
      // Return the error and newly recorded failure row instead of only { ok:false }, so callers
      // can see why the update did not reach Cloudflare without searching logs.
      return Response.json(
        {
          ok: false,
          status: "error",
          synced: false,
          dryRun,
          error: String(error),
          lastRun: await lastRun(env.DB, JOB),
        },
        { status: 502 },
      );
    }
  },
};
