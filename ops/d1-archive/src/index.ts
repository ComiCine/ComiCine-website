/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * At 00:00 UTC each day, write the previous day's analytics data to private R2.
 *
 * This archives only reconstructable analytics details. It does not delete D1 or copy Apple IDs, sessions, or blocklist tables.
 * Object keys are fixed by date, so reruns idempotently overwrite that day's archive.
 *
 * Failure visibility (added 2026-10-11, matching ops/sync-worker): previously scheduled() only called
 * `ctx.waitUntil(archivePreviousDay(env))`. waitUntil silently swallowed the promise rejection,
 * so repeated archive failures appeared as successful cron runs, while fetch always returned 404 and offered no health endpoint.
 * Now:
 *   1. Each run writes a row to D1 worker_runs (job='d1_archive'), including the error on failure.
 *   2. scheduled() explicitly awaits the work in try/catch and writes a structured single-line JSON record to Workers logs on failure.
 *   3. GET /?health=1 reports health without running the archive and returns { ok, job, lastRun }.
 * The archive logic itself (TABLES, R2 keys, gzip content, and day calculation) is unchanged.
 *
 * The second stage (disaster-recovery snapshot, added 2026-10-11) captures configuration and schema
 * in the same cron (R2 `backup/YYYY_MM_DD/`, job='config_backup', implemented in ./config-backup.ts).
 * The stages are independent: the archive runs first, then the snapshot, each in its own try/catch.
 * A snapshot failure must not fail the archive, and vice versa.
 */

import {
  insertRun,
  lastRun,
  runStartedAt,
  updateRun,
  type RunRow,
} from "../../sync-worker/src/runlog";
import {
  CONFIG_JOB,
  runConfigBackup,
  type D1Database,
  type R2Bucket,
} from "./config-backup";
import { gzipJsonl } from "./jsonl";
import { logRun } from "./log";

interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  /** Shared health-endpoint secret used with limooo-blocklist-sync; HTTP fails closed when unset. */
  SYNC_TOKEN?: string;
}

type TableSpec = {
  name: string;
  sql: string;
};

const TABLES: TableSpec[] = [
  {
    name: "visitor_rollups",
    sql: `SELECT bucket_hour, ip_hash, country, status, page_slug, requests, last_ts
          FROM visitor_rollups
          WHERE bucket_hour >= ? AND bucket_hour < ?
          ORDER BY bucket_hour, ip_hash, country, status, page_slug`,
  },
  {
    name: "visitors_v2",
    sql: `SELECT id, ip_hash, country, status, ts, page_slug
          FROM visitors_v2
          WHERE ts >= ? AND ts < ?
          ORDER BY ts, id`,
  },
  {
    name: "ray_log_v2",
    sql: `SELECT ray, ts, host, normalized_path, method, status, duration_ms,
                 ip_hash, country, ua_family
          FROM ray_log_v2
          WHERE ts >= ? AND ts < ?
          ORDER BY ts, ray`,
  },
  {
    name: "events",
    sql: `SELECT id, event, ts, request_id, host, path, method, status, outcome,
                 ip_hash, country, duration_ms, message, account_id, actor_sub
          FROM events
          WHERE ts >= ? AND ts < ?
          ORDER BY ts, id`,
  },
];

/** Job name in run records; must match the job column values in ops/migrations/018_worker_runs.sql. */
export const JOB = "d1_archive";

function utcDateParts(epochSeconds: number): { day: string; start: number; end: number } {
  const date = new Date(epochSeconds * 1000);
  const day = date.toISOString().slice(0, 10).replaceAll("-", "_");
  const next = new Date(date.getTime() + 86400 * 1000);
  return { day, start: epochSeconds, end: Math.floor(next.getTime() / 1000) };
}

function previousUtcDay(now = new Date()): { day: string; start: number; end: number } {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  return utcDateParts(todayStart - 86400);
}

async function archiveTable(env: Env, table: TableSpec, day: { day: string; start: number; end: number }): Promise<number> {
  // visitor_rollups uses bucket_hour; the other analytics tables use ts. Both are UTC epoch seconds.
  const rows = await env.DB.prepare(table.sql).bind(day.start, day.end).all();
  // Shared with the configuration snapshot (see ./jsonl.ts): both paths must use the exact same byte format.
  const payload = await gzipJsonl(rows.results ?? []);
  await env.ARCHIVE.put(`analytics/${day.day}/${table.name}.jsonl.gz`, payload, {
    httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
  });
  return rows.results?.length ?? 0;
}

export async function archivePreviousDay(env: Env, now = new Date()): Promise<Record<string, number>> {
  const day = previousUtcDay(now);
  const counts: Record<string, number> = {};
  for (const table of TABLES) counts[table.name] = await archiveTable(env, table, day);
  console.log(JSON.stringify({ event: "d1_archive", day: day.day, counts }));
  return counts;
}

/**
 * Entry point shared by scheduled and fetch: archive the previous day and write this run to worker_runs.
 *
 * If the archive throws, first record outcome='failed' with the error, then rethrow it; failure and recording must stay coupled.
 * If writing the run record fails, only console.error; never let it affect the archive itself.
 */
export async function runArchive(
  env: Env,
  now = new Date(),
): Promise<{ counts: Record<string, number>; runId: number | null }> {
  const startedAt = runStartedAt();
  const runId = await insertRun(env.DB, JOB, startedAt);
  logRun(JOB, { outcome: "started" });
  try {
    const counts = await archivePreviousDay(env, now);
    await updateRun(env.DB, runId, {
      finishedAt: runStartedAt(),
      outcome: "ok",
      // added/removed are synchronization-specific columns and are unused here; log total, with details in the success row's counts.
      added: Object.values(counts).reduce((sum, n) => sum + n, 0),
      // Archiving has no dry-run mode: writes are real.
      dryRun: false,
    });
    logRun(JOB, { outcome: "ok", counts, duration_ms: runStartedAt() - startedAt });
    return { counts, runId };
  } catch (error) {
    await updateRun(env.DB, runId, {
      finishedAt: runStartedAt(),
      outcome: "failed",
      error: String(error),
    });
    logRun(JOB, { outcome: "failed", error: String(error), duration_ms: runStartedAt() - startedAt });
    throw error;
  }
}

/**
 * Health endpoint authentication: compare Authorization: Bearer <SYNC_TOKEN>.
 *
 * This Worker is only on *.workers.dev. Because workers.dev is not in this account, zone-level
 * mTLS/Client Certificate protection is unavailable, so it reuses limooo-blocklist-sync's shared secret.
 * If the secret is unset, fail closed and reject all HTTP calls. An unset secret must never mean open access.
 * Cron uses an internal call and does not pass through this check.
 */
export function authorized(request: Request, env: Env): boolean {
  const expected = (env.SYNC_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length).trim();
  if (!provided || provided.length !== expected.length) return false;
  // Compare each character after confirming equal lengths to avoid an early return that leaks prefix information.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Report health only, without running an archive: the latest run for each job and any reason the table is unavailable.
 *
 * Report both jobs: the snapshot is the second stage of the same cron. Reporting only the archive
 * could hide a snapshot that has been failing for a week, which is exactly why this endpoint exists.
 * This reads one extra row per request via idx_worker_runs_job_started and is triggered only by HTTP, not a hot path.
 */
export async function health(env: Env): Promise<{
  ok: boolean;
  job: string;
  lastRun: RunRow | null;
  backup: { job: string; lastRun: RunRow | null };
  error?: string;
}> {
  try {
    const archiveRun = await lastRun(env.DB, JOB);
    const backupRun = await lastRun(env.DB, CONFIG_JOB);
    return {
      ok: true,
      job: JOB,
      lastRun: archiveRun,
      backup: { job: CONFIG_JOB, lastRun: backupRun },
    };
  } catch (error) {
    // A failed run-record read does not mean the archive failed. Keep ok true and include the read error reason.
    return { ok: true, job: JOB, lastRun: null, backup: { job: CONFIG_JOB, lastRun: null }, error: String(error) };
  }
}

export default {
  async scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ): Promise<void> {
    // Explicitly await inside try/catch: `ctx.waitUntil(archivePreviousDay(env))`
    // swallows rejections, making repeated archive failures appear successful in the cron panel.
    const work = (async () => {
      // Stage 1: archive analytics details (analytics/YYYY_MM_DD/, keyed by the UTC day the data belongs to).
      try {
        const { counts } = await runArchive(env);
        logRun(JOB, {
          outcome: "scheduled_ok",
          archived: Object.values(counts).reduce((sum, n) => sum + n, 0),
        });
      } catch (error) {
        logRun(JOB, { outcome: "failed", stage: "scheduled", error: String(error) });
      }
      // Stage 2: snapshot configuration and schema (backup/YYYY_MM_DD/, keyed by the UTC day the snapshot was created).
      // Keep a separate try/catch: a stage 1 failure does not affect stage 2, and a stage 2 failure must not
      // turn an archive already written to R2 into a failed run. Each job gets its own run record.
      try {
        await runConfigBackup(env);
      } catch (error) {
        logRun(CONFIG_JOB, { outcome: "failed", stage: "scheduled", error: String(error) });
      }
    })();
    /**
     * Pass this to both waitUntil and local await: the former keeps the isolate working after the response,
     * while the latter explicitly observes the promise, preventing silently swallowed rejections.
     */
    ctx.waitUntil(work);
    await work;
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    // Only Cloudflare Cron may trigger archiving, preventing repeated public URL calls from consuming D1 reads.
    // The HTTP surface exposes only the read-only health endpoint, which requires authentication.
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    if (!authorized(request, env)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    if (url.searchParams.get("health") === "1") {
      return Response.json(await health(env));
    }
    // Expose no other HTTP behavior; return 404 instead of triggering an archive.
    return new Response("Not Found", { status: 404 });
  },
};
