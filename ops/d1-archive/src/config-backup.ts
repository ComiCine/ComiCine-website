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
 * Disaster-recovery snapshot: write D1's schema (all DDL) and small configuration/bookkeeping tables to R2 `backup/`.
 *
 * Why this is needed (a real gap identified on 2026-10-11): this D1 database had only two automated paths:
 * `analytics/YYYY_MM_DD/` (this Worker archives four analytics tables daily) and retention cleanup
 * (`ops/status-worker`'s retention.ts). Neither includes configuration tables. After an accidental full-database deletion,
 * there would be no second copy of `blocked_ips` (the authoritative blocklist), `apple_accounts`, `auth_credentials`,
 * `schema_version` (migration bookkeeping), or any table definitions. The last manual `wrangler d1 export`
 * was on 2026-09-26; it had not been run since, making the manual path effectively nonexistent.
 *
 * Relationship to `analytics/` (the paths have different meanings and retention periods, so their prefixes must remain separate):
 *   analytics/YYYY_MM_DD/  Archives details by the UTC day the data belongs to; keeps four analytics tables,
 *                          so expired details can still be investigated.
 *   backup/YYYY_MM_DD/     Captures current state by the UTC day the snapshot was created; includes DDL and all small tables,
 *                          so the database can be rebuilt. The separate prefixes ensure rolling cleanup
 *                          (which deletes only dated prefixes under backup/) cannot touch analytics/.
 *
 * Read cost (AGENTS.md's D1 read budget requires only a few hundred rows per day):
 * Measured on 2026-10-11: 422 rows/day across the full path (107 from sqlite_master + 315 from nine small tables).
 * See README and `d1_rows_read` in manifest.json for details. This reads only allowlisted tables;
 * large tables (heartbeats / events / ray_log_v2 / visitor_rollups / visitors_v2 /
 * visitors / visitors_daily / probe_uptime_daily, etc.) are never touched; see EXCLUDED_TABLES.
 *
 * Type fidelity: rows are serialized as JSONL (one object per line) and then gzipped. Field names and values
 * come directly from D1's response objects, without string conversion or defaults, preserving distinctions among 0/1, epoch integers, NULL, and empty strings.
 */

import { gzipJsonl } from "./jsonl";
import { logRun } from "./log";
import { insertRun, runStartedAt, updateRun } from "../../sync-worker/src/runlog";

/**
 * D1 shape declarations matching the same-named structures in index.ts.
 *
 * `meta.rows_read` is this module's cost evidence: D1's all() returns the number of rows read by the statement.
 * The snapshot records it in the manifest and worker_runs, providing a measured daily value instead of an estimate
 * for determining whether the budget was exceeded.
 */
export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta?: { rows_read?: number; rows_written?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  /**
   * The snapshot itself is read-only (all queries use all()), but run records (runlog.updateRun) require run().
   * This declaration must match the D1PreparedStatement shape in ops/workers.d.ts; otherwise
   * `D1Database` cannot be assigned to runlog's `RunDatabase` (tsc reports an incompatible prepare() return type).
   */
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
}

/** One page of an R2 listing; `delimitedPrefixes` contains directory-like prefixes when a delimiter is used. */
export interface R2ListPage {
  objects?: { key: string; size?: number }[];
  delimitedPrefixes?: string[];
  truncated?: boolean;
  cursor?: string;
}

export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream<Uint8Array> | string,
    options?: { httpMetadata?: { contentType?: string; contentEncoding?: string } },
  ): Promise<unknown>;
  /** Only rolling cleanup uses list/delete; both are present on the actual binding. */
  list(options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
  }): Promise<R2ListPage>;
  delete(keys: string[]): Promise<void>;
}

export interface ArchiveEnv {
  DB: D1Database;
  ARCHIVE: R2Bucket;
}

/** Snapshot-only prefix, kept separate from analytics/ with no overlap. */
export const BACKUP_PREFIX = "backup/";
/** Job name in run records; must match the job column values in ops/migrations/018_worker_runs.sql. */
export const CONFIG_JOB = "config_backup";
/** Rolling retention count: keep only the most recent N backup/YYYY_MM_DD/ prefixes. */
export const KEEP_SNAPSHOTS = 14;

/**
 * Recognize only date prefixes shaped like `backup/YYYY_MM_DD/`.
 *
 * Cleanup is the only code that deletes objects, so it acts only on this allowlisted shape. Other objects manually placed in `backup/`
 * (such as `backup/notes.txt` or `backup/manual/`) never participate in rotation. Keep them rather than risk collateral deletion by prefix.
 */
const DAY_PREFIX = /^backup\/\d{4}_\d{2}_\d{2}\/$/;

/**
 * Engine/platform internal objects from sqlite_master appear losslessly in schema.jsonl.gz,
 * but are omitted from replayable ddl.sql. `sqlite_sequence` is a reserved name (manual CREATE reports
 * "object name reserved for internal use"), while `_cf_KV` is managed by Cloudflare
 * (D1 rejects reads and writes with SQLITE_AUTH / code 7500).
 */
const INTERNAL_OBJECT = /^(sqlite_|_cf_)/;

/**
 * Snapshot .jsonl.gz files use application/gzip and intentionally omit contentEncoding.
 *
 * Verified on 2026-10-11 by downloading one of each object type:
 *   - Objects like analytics/ with `contentEncoding: "gzip"` are returned decompressed by the R2 REST API and
 *     `wrangler r2 object get` (a 624-byte object becomes 1290 bytes on disk), but retain the .jsonl.gz filename,
 *     causing gunzip to report that the input is not in gzip format.
 *   - For objects without contentEncoding, downloaded and uploaded bytes have matching MD5 hashes.
 * Disaster-recovery objects are meant to be downloaded and restored, so their names must match their bytes.
 * Declare the gzip content type without letting the transport layer decompress them. analytics/ metadata remains unchanged.
 */
const GZIP_METADATA = {
  httpMetadata: { contentType: "application/gzip" },
} as const;
const SQL_METADATA = { httpMetadata: { contentType: "text/plain; charset=utf-8" } } as const;
const JSON_METADATA = { httpMetadata: { contentType: "application/json" } } as const;

export interface ConfigTableSpec {
  name: string;
  /** Row order within a snapshot; always use the primary key so reruns on the same day produce identical bytes. */
  orderBy: string;
  /** Why this table must be included; written to the manifest so the backup explains itself. */
  why: string;
}

/**
 * Tables included in the snapshot: an append-only allowlist. Recalculate the read budget whenever a table is added.
 *
 * These are small tables that cannot be recreated manually after a rebuild: authoritative blocklist data, accounts/credentials,
 * probe and retention configuration, migration bookkeeping, and run/audit history. Each has on the order of 10² rows; see the measured table in README.
 */
export const CONFIG_TABLES: readonly ConfigTableSpec[] = [
  {
    name: "schema_version",
    orderBy: "version",
    why: "Migration bookkeeping; migrate_d1.sh skips an already-applied file by these rows, so a restore that loses them re-runs migrations.",
  },
  {
    name: "blocked_ips",
    orderBy: "cidr",
    why: "The authoritative block list (AGENTS.md). data/blocklist.txt is only an auditable snapshot of it.",
  },
  {
    name: "apple_accounts",
    orderBy: "id",
    why: "Admin account records, already encrypted at rest; copied verbatim, never decrypted here.",
  },
  {
    name: "auth_credentials",
    orderBy: "email",
    why: "Local credential rows (pbkdf2 hashes + lockouts). Copied verbatim, never decrypted here.",
  },
  {
    name: "probes",
    orderBy: "id",
    why: "Probe definitions (targets, groups, intervals); the status page has nothing to show without them.",
  },
  {
    name: "probe_state",
    orderBy: "probe_id",
    why: "Per-probe alert state (down_since, last_alert_at); losing it re-fires alerts for existing outages.",
  },
  {
    name: "retention_state",
    orderBy: "name",
    why: "Retention bookkeeping (last_run_at / last_success_at / last_error) per bucket.",
  },
  {
    name: "blocklist_audit",
    orderBy: "id",
    why: "Every block/unblock with its previous values: the rollback basis AGENTS.md promises.",
  },
  {
    name: "worker_runs",
    orderBy: "id",
    why: "Cron run history for all jobs; the only record of whether the sync/archive actually ran.",
  },
  {
    name: "probe_uptime_daily",
    orderBy: "day",
    why: "Daily uptime rollup (probe_id, day, total, up). It is the one table that CANNOT be rebuilt: heartbeats keep only 30 days and the rollup keeps 90, so past availability is unrecoverable once the worker misses it. Measured cost when added: 75 rows (bounds: 90 days x probe count, so ~270 once the window fills), taking the daily snapshot read from 428 to ~503 rows - 0.01% of the 5,000,000/day limit.",
  },
];

export interface ExcludedTable {
  name: string;
  why: string;
}

/**
 * Explicitly excluded tables and reasons. Included in the manifest so the backup itself explains why each table is absent,
 * without requiring a repository lookup.
 */
export const EXCLUDED_TABLES: readonly ExcludedTable[] = [
  {
    name: "visitors",
    why: "Legacy VPS-era table (~13.9k rows, plaintext ip TEXT). No code reads it since the 2026-09-17 edge migration, and copying it would put plaintext IPs into a second store.",
  },
  {
    name: "visitors_daily",
    why: "Derived aggregate (~11.3k rows) rebuilt from visitors_v2 + visitor_rollups by ops/prune_d1.py --mode aggregate. Only its schema is in this snapshot.",
  },
  {
    name: "visitor_rollups",
    why: "Already archived every day to analytics/YYYY_MM_DD/ (90-day window) by this Worker; separate prefix and separate retention on purpose.",
  },
  {
    name: "visitors_v2",
    why: "Already archived every day to analytics/YYYY_MM_DD/ (30-day window); read daily by the analytics path, not here.",
  },
  {
    name: "ray_log_v2",
    why: "Already archived every day to analytics/YYYY_MM_DD/ (7-day window); the biggest detail table.",
  },
  {
    name: "events",
    why: "Already archived every day to analytics/YYYY_MM_DD/ (90-day window).",
  },
  {
    name: "heartbeats",
    why: "Probe liveness detail at ~3 rows/minute, pruned after 30 days. Bulk telemetry, not configuration.",
  },
  {
    name: "ray_log",
    why: "Legacy table superseded by ray_log_v2, which the analytics/ archive already covers.",
  },
  {
    name: "gate_failures",
    why: "Short-window brute-force counters keyed by ip_hash; self-healing state with no restore value.",
  },
  {
    name: "auth_sessions",
    why: "Revocable Cloudflare Access sessions; logging in again is the recovery path and the table self-prunes by exp.",
  },
  {
    name: "_cf_KV",
    why: "Cloudflare-managed internal table; D1 rejects reads and writes with SQLITE_AUTH (code 7500), so no row copy is possible.",
  },
];

export interface SchemaRow {
  type: string;
  name: string;
  tbl_name: string;
  sql: string;
}

/** Table definitions must precede indexes; sqlite_master does not guarantee an order. */
const TYPE_RANK: Record<string, number> = { table: 0, index: 1, trigger: 2, view: 3 };

export const SCHEMA_SQL = `SELECT type, name, tbl_name, sql
       FROM sqlite_master
      WHERE sql IS NOT NULL
      ORDER BY type, name`;

export function orderSchema(rows: SchemaRow[]): SchemaRow[] {
  return [...rows].sort((a, b) => {
    const rankA = TYPE_RANK[a.type] ?? 9;
    const rankB = TYPE_RANK[b.type] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    if (a.name === b.name) return 0;
    return a.name < b.name ? -1 : 1;
  });
}

/** UTC day assigned to the snapshot prefix: the run day, not the data day used by analytics/. */
export function utcDayStamp(now = new Date()): string {
  return now.toISOString().slice(0, 10).replaceAll("-", "_");
}

export function snapshotPrefix(day: string): string {
  return `${BACKUP_PREFIX}${day}/`;
}

/** Final guard before deletion: the key must be within backup/. */
export function isBackupKey(key: string): boolean {
  return key.startsWith(BACKUP_PREFIX) && key.length > BACKUP_PREFIX.length;
}

/**
 * Render sqlite_master rows as replayable ddl.sql.
 *
 * Preserve the SQL text stored in D1 verbatim (remove trailing semicolons and add one back to avoid `;;`), because
 * this is the rebuild schema. Any formatting or reordering would make comparison with production definitions unreliable.
 * Internal objects are omitted but listed in the header comment so readers know they were intentionally excluded.
 */
export function buildDdl(rows: SchemaRow[], generatedAt: number): { sql: string; skipped: string[] } {
  const ordered = orderSchema(rows);
  const skipped: string[] = [];
  const statements: string[] = [];
  for (const row of ordered) {
    if (INTERNAL_OBJECT.test(row.name)) {
      skipped.push(row.name);
      continue;
    }
    statements.push(`${row.sql.trim().replace(/;+$/, "")};\n`);
  }
  const iso = new Date(generatedAt * 1000).toISOString();
  const header = [
    "-- Limooo D1 configuration & schema snapshot",
    `-- generated_at: ${iso}  (unix ${generatedAt})`,
    "-- source: ops/d1-archive, scheduled job config_backup",
    "--         SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL",
    "-- scope: DDL only. This file recreates the empty skeleton, never the rows.",
    "--        Rows live beside it: <table>.jsonl.gz, schema.jsonl.gz, manifest.json.",
    "-- order: tables first, then indexes (sqlite_master has no guaranteed order).",
    "-- restore into a FRESH database:",
    "--   wrangler d1 execute <database> --remote --file ddl.sql",
    "--   python3 ops/d1-archive/restore.py --dir <downloaded dir> --out data.sql",
    "--   wrangler d1 execute <database> --remote --file data.sql",
    "-- deliberately absent (engine/platform objects, kept verbatim in schema.jsonl.gz):",
    ...(skipped.length ? skipped.map((name) => `--   ${name}`) : ["--   -"]),
    "",
    "",
  ].join("\n");
  return { sql: header + statements.join("\n"), skipped };
}

export interface TableReport {
  name: string;
  rows: number;
  bytes: number;
  error: string | null;
}

export interface SnapshotResult {
  day: string;
  prefix: string;
  generatedAt: number;
  /** Measured D1 rows read (sum of each statement's meta.rows_read); cost evidence for this path. */
  rowsRead: number;
  objects: string[];
  tables: TableReport[];
  skippedObjects: string[];
  errors: string[];
}

/**
 * Write one day's snapshot. R2 permission errors or sqlite_master read failures are thrown because a snapshot without a schema is unusable.
 * A single-table failure is recorded in manifest and the returned errors, not thrown, and is reflected in the failed run record.
 */
export async function snapshotConfig(env: ArchiveEnv, now = new Date()): Promise<SnapshotResult> {
  const day = utcDayStamp(now);
  const prefix = snapshotPrefix(day);
  const generatedAt = runStartedAt(now.getTime());
  let rowsRead = 0;
  const objects: string[] = [];
  const tables: TableReport[] = [];
  const errors: string[] = [];

  const schemaQuery = await env.DB.prepare(SCHEMA_SQL).all<SchemaRow>();
  rowsRead += schemaQuery.meta?.rows_read ?? 0;
  const schemaRows = schemaQuery.results ?? [];

  // Lossless copy of sqlite_master; ddl.sql is its replayable subset, and both together provide the full picture.
  const schemaPayload = await gzipJsonl(orderSchema(schemaRows));
  await env.ARCHIVE.put(`${prefix}schema.jsonl.gz`, schemaPayload, GZIP_METADATA);
  objects.push("schema.jsonl.gz");

  const ddl = buildDdl(schemaRows, generatedAt);
  await env.ARCHIVE.put(`${prefix}ddl.sql`, ddl.sql, SQL_METADATA);
  objects.push("ddl.sql");
  const ddlWritten = true;

  for (const spec of CONFIG_TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${spec.name} ORDER BY ${spec.orderBy}`).all();
      rowsRead += result.meta?.rows_read ?? 0;
      const rows = result.results ?? [];
      const payload = await gzipJsonl(rows);
      await env.ARCHIVE.put(`${prefix}${spec.name}.jsonl.gz`, payload, GZIP_METADATA);
      objects.push(`${spec.name}.jsonl.gz`);
      tables.push({ name: spec.name, rows: rows.length, bytes: payload.byteLength, error: null });
    } catch (error) {
      // A failure to read one table must not discard the other eight; record the gap and continue writing the rest.
      errors.push(`${spec.name}: ${String(error)}`);
      tables.push({ name: spec.name, rows: 0, bytes: 0, error: String(error) });
      logRun(CONFIG_JOB, {
        outcome: "failed",
        stage: "table",
        table: spec.name,
        error: String(error),
      });
    }
  }

  const manifest = {
    job: CONFIG_JOB,
    day,
    prefix,
    generated_at: generatedAt,
    generated_at_iso: new Date(generatedAt * 1000).toISOString(),
    keep_snapshots: KEEP_SNAPSHOTS,
    d1_rows_read: rowsRead,
    ddl_written: ddlWritten,
    objects: [...objects, "manifest.json"],
    schema_objects: orderSchema(schemaRows).length,
    skipped_internal_objects: ddl.skipped,
    tables,
    excluded_tables: EXCLUDED_TABLES,
    restore: {
      ddl: "wrangler d1 execute <database> --remote --file ddl.sql",
      data: "python3 ops/d1-archive/restore.py --dir <dir> --out data.sql",
      apply: "wrangler d1 execute <database> --remote --file data.sql",
    },
  };
  await env.ARCHIVE.put(`${prefix}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, JSON_METADATA);
  objects.push("manifest.json");

  return {
    day,
    prefix,
    generatedAt,
    rowsRead,
    objects,
    tables,
    skippedObjects: ddl.skipped,
    errors,
  };
}

export interface PruneResult {
  kept: string[];
  /** Valid date prefixes found in this run, in ascending order, for reporting and assertions. */
  scanning: string[];
  deletedKeys: string[];
}

/** Traverse the full directory level by delimiter so a 1,000-item page does not truncate the prefixes. */
async function listDayPrefixes(bucket: R2Bucket): Promise<string[]> {
  const found: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix: BACKUP_PREFIX, delimiter: "/", cursor });
    for (const prefix of page.delimitedPrefixes ?? []) found.push(prefix);
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
  return found;
}

/**
 * Rolling cleanup: keep only the most recent `keep` `backup/YYYY_MM_DD/` prefixes and delete older snapshots in full.
 *
 * Why delete by prefix instead of object age: a day's snapshot is a group of objects (ddl.sql + nine tables +
 * schema + manifest) that must be kept or deleted together. Per-object deletion could leave ddl.sql without its tables,
 * a state worse than having no backup.
 *
 * Two independent safeguards ensure analytics/ is structurally out of reach:
 *   1. List only with `prefix: "backup/"`, so R2 cannot return prefixes outside backup/.
 *   2. Check each key with isBackupKey() again before deletion; delete concrete keys returned by list,
 *      rather than paths assembled locally.
 * Only DAY_PREFIX-shaped keys are eligible; manually added objects are not rotated.
 */
export async function pruneBackups(bucket: R2Bucket, keep = KEEP_SNAPSHOTS): Promise<PruneResult> {
  const wanted = Math.max(1, Math.trunc(keep));
  const dayPrefixes = [...new Set(await listDayPrefixes(bucket))]
    .filter((prefix) => DAY_PREFIX.test(prefix))
    .sort();
  const stale = dayPrefixes.slice(0, Math.max(0, dayPrefixes.length - wanted));
  const deletedKeys: string[] = [];

  for (const prefix of stale) {
    // Recheck after list and before delete; the allowlist is the sole basis for each deletion.
    if (!DAY_PREFIX.test(prefix)) continue;
    const keys: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await bucket.list({ prefix, cursor });
      for (const object of page.objects ?? []) {
        if (isBackupKey(object.key)) keys.push(object.key);
      }
      if (!page.truncated || !page.cursor) break;
      cursor = page.cursor;
    }
    if (!keys.length) continue;
    await bucket.delete(keys);
    deletedKeys.push(...keys);
  }

  return { kept: dayPrefixes.slice(-wanted), scanning: dayPrefixes, deletedKeys };
}

export interface ConfigBackupResult {
  runId: number | null;
  day: string;
  rowsRead: number;
  exportedRows: number;
  objects: number;
  deleted: number;
  errors: string[];
  outcome: "ok" | "failed";
}

/**
 * Second stage of scheduled(): write a snapshot, run rolling cleanup, and insert a worker_runs row.
 *
 * Follows the same insert → work → update pattern as runArchive, but uses its own job value,
 * `config_backup`. The worker_runs `?health=1` endpoint returns the latest row per job.
 * Reusing d1_archive would make the stages alternate in one sequence, obscuring whether the archive or
 * snapshot failed, defeating the purpose of this table.
 *
 * Column meanings (documented in README):
 *   added   = measured D1 rows read this run (sum of meta.rows_read), representing cost;
 *   removed = number of R2 objects deleted by rolling cleanup;
 *   error   = comma-separated reasons for table or cleanup failures; empty means success.
 */
export async function runConfigBackup(
  env: ArchiveEnv,
  now = new Date(),
  keep = KEEP_SNAPSHOTS,
): Promise<ConfigBackupResult> {
  const startedAt = runStartedAt();
  const runId = await insertRun(env.DB, CONFIG_JOB, startedAt);
  logRun(CONFIG_JOB, { outcome: "started" });

  let snapshot: SnapshotResult;
  try {
    snapshot = await snapshotConfig(env, now);
  } catch (error) {
    await updateRun(env.DB, runId, {
      finishedAt: runStartedAt(),
      outcome: "failed",
      error: String(error),
    });
    logRun(CONFIG_JOB, {
      outcome: "failed",
      stage: "snapshot",
      error: String(error),
      duration_ms: runStartedAt() - startedAt,
    });
    throw error;
  }

  const errors = [...snapshot.errors];
  let deleted = 0;
  try {
    // Rotate only after ddl.sql is written. If nothing was written today, do not delete the oldest snapshot because of one failure.
    // Rotation advances by time, not by whether today's snapshot is complete (see README): a bad day must not cause
    // unbounded bucket growth. The manifest and failed worker_runs record accurately report completeness.
    const pruned = await pruneBackups(env.ARCHIVE, keep);
    deleted = pruned.deletedKeys.length;
  } catch (error) {
    errors.push(`retention: ${String(error)}`);
    logRun(CONFIG_JOB, { outcome: "failed", stage: "retention", error: String(error) });
  }

  const exportedRows = snapshot.tables.reduce((sum, table) => sum + table.rows, 0);
  const outcome = errors.length ? "failed" : "ok";
  await updateRun(env.DB, runId, {
    finishedAt: runStartedAt(),
    outcome,
    added: snapshot.rowsRead,
    removed: deleted,
    error: errors.length ? errors.join("; ") : null,
    dryRun: false,
  });
  logRun(CONFIG_JOB, {
    outcome,
    day: snapshot.day,
    rows_read: snapshot.rowsRead,
    exported_rows: exportedRows,
    objects: snapshot.objects.length,
    deleted,
    errors,
    duration_ms: runStartedAt() - startedAt,
  });

  return {
    runId,
    day: snapshot.day,
    rowsRead: snapshot.rowsRead,
    exportedRows,
    objects: snapshot.objects.length,
    deleted,
    errors,
    outcome,
  };
}
