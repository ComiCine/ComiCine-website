/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Unit tests for disaster-recovery snapshots (backup/) and rolling cleanup.
 *
 * Four hard requirements, each covered by a test group:
 *   1. DDL and small tables are written to backup/YYYY_MM_DD/ with correct key paths and type fidelity.
 *   2. Large tables are never read (the stub throws on any FROM outside the allowlist, serving as a spy assertion).
 *   3. Retention deletes only backup/ prefixes and leaves analytics/ untouched, including when a broken binding
 *      returns analytics keys.
 *   4. An archive completes if the snapshot throws, and config_backup records a failed run.
 */

import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { JOB } from "./index";
import {
  BACKUP_PREFIX,
  CONFIG_JOB,
  CONFIG_TABLES,
  KEEP_SNAPSHOTS,
  buildDdl,
  isBackupKey,
  orderSchema,
  pruneBackups,
  runConfigBackup,
  snapshotPrefix,
  utcDayStamp,
  type SchemaRow,
} from "./config-backup";

const scheduled = worker.scheduled;

const DAY = new Date("2026-10-11T00:00:00Z");

/** Four analytics archive tables; they may appear only under the analytics/ path. */
const ANALYTICS_TABLES = ["visitor_rollups", "visitors_v2", "ray_log_v2", "events"] as const;

/**
 * Any table name not in the snapshot allowlist. The stub throws when it sees one, turning
 * "did we accidentally scan a large table?" from a code-review question into a failing test.
 */
const FORBIDDEN_TABLES = [
  "visitors",
  "visitors_daily",
  "visitor_rollups",
  "visitors_v2",
  "ray_log",
  "ray_log_v2",
  "events",
  "heartbeats",
  "gate_failures",
  "auth_sessions",
  "identity_handoffs",
  "_cf_KV",
] as const;

const SCHEMA_ROWS: SchemaRow[] = [
  // Deliberately unordered, with an index before its table: DDL must sort them correctly.
  { type: "index", name: "idx_blocked_ips_active", tbl_name: "blocked_ips", sql: "CREATE INDEX idx_blocked_ips_active\n    ON blocked_ips (active, updated_at)" },
  { type: "table", name: "blocked_ips", tbl_name: "blocked_ips", sql: 'CREATE TABLE "blocked_ips" (\n    cidr TEXT PRIMARY KEY)' },
  { type: "table", name: "schema_version", tbl_name: "schema_version", sql: "CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))" },
  { type: "table", name: "sqlite_sequence", tbl_name: "sqlite_sequence", sql: "CREATE TABLE sqlite_sequence(name,seq)" },
  { type: "table", name: "_cf_KV", tbl_name: "_cf_KV", sql: "CREATE TABLE _cf_KV (\n        key TEXT PRIMARY KEY,\n        value BLOB\n      ) WITHOUT ROWID" },
];

/** Fake rows for each allowlisted table; type-fidelity tests rely on 0/1, NULL, and empty strings here. */
const TABLE_ROWS: Record<string, Record<string, unknown>[]> = {
  schema_version: [{ version: 19001, applied_at: "2026-10-11 00:03:01" }],
  blocked_ips: [
    { cidr: "203.0.113.0/24", network: "203.0.113.0", prefix: 24, reason: "", source: "manual", created_at: "2026-09-27 10:00:00", updated_at: "2026-10-01 11:22:33", updated_by: "admin", active: 1 },
    { cidr: "198.51.100.7/32", network: "198.51.100.7", prefix: 32, reason: "gate flood", source: "auto_block", created_at: "2026-10-02 01:02:03", updated_at: "2026-10-05 04:05:06", updated_by: "", active: 0 },
  ],
  apple_accounts: [{ id: 5, email: "a@example.test", password: "enc:v1:AAAA", notes: null, sort_order: 0, created_at: "2026-08-15 11:33:43", updated_at: "2026-08-15 11:33:43" }],
  auth_credentials: [{ email: "admin@example.test", sub: "sub-1", role: "admin", password_hash: "pbkdf2$1$aa$bb", failed_attempts: 0, locked_until: null, created_at: 1786000000, updated_at: 1786000000 }],
  probes: [{ id: 1, name: "main", type: "http", target: "https://limooo.cn", group_key: "public", interval_s: 60, active: 1, created_at: 1786000000, label_key: null }],
  probe_state: [{ probe_id: 1, last_status: 1, consecutive_fail: 0, down_since: null, checked_at: 1791700000, last_alert_at: null }],
  retention_state: [{ name: "ray_log_v2", last_run_at: 1791700000, last_success_at: 1791700000, last_error: "" }],
  blocklist_audit: [{ id: 192, cidr: "198.51.100.7/32", network: "198.51.100.7", prefix: 32, action: "unblock", actor: "admin", reason: "", source: "manual", previous_reason: "gate flood", previous_source: "auto_block", previous_updated_at: "2026-10-02 01:02:03", created_at: "2026-10-05 04:05:06" }],
  worker_runs: [{ id: 4, job: "d1_archive", started_at: 1791700000, finished_at: 1791700001, outcome: "ok", added: 4, removed: null, error: null, dry_run: 0 }],
};

/** rows_read per table (simulated D1 metadata), used to assert the cost calculation. */
const TABLE_ROWS_READ: Record<string, number> = {
  schema_version: 19,
  blocked_ips: 83,
  apple_accounts: 5,
  auth_credentials: 1,
  probes: 3,
  probe_state: 3,
  retention_state: 5,
  blocklist_audit: 192,
  worker_runs: 4,
};
const SCHEMA_ROWS_READ = 107;

interface SqlCall {
  sql: string;
  values: unknown[];
}

/**
 * D1 stub shared by snapshots and archives.
 *
 * Key design: parse table names from SQL, throwing and recording a `violations` entry for anything outside the allowlist.
 * Thus, "large tables were untouched" is not inferred from a count; any out-of-bounds read fails the test.
 */
function d1Stub(options: { failSql?: RegExp; failSchema?: boolean; noMeta?: boolean } = {}) {
  const calls: SqlCall[] = [];
  const violations: string[] = [];
  const allowed = new Set<string>([...CONFIG_TABLES.map((t) => t.name), ...ANALYTICS_TABLES]);
  let latestRun: Record<string, unknown> | undefined;
  let nextRunId = 1;

  const tableOf = (sql: string): string => {
    if (/FROM sqlite_master/.test(sql)) return "sqlite_master";
    const match = /FROM\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(sql);
    return match ? match[1] : "?";
  };

  const answer = (sql: string) => {
    if (options.failSql?.test(sql)) throw new Error("D1 read failed (simulated)");
    if (/FROM worker_runs/.test(sql)) return { results: latestRun ? [{ ...latestRun }] : [] };
    const table = tableOf(sql);
    if (table === "sqlite_master") {
      if (options.failSchema) throw new Error("no such table: sqlite_master (simulated)");
      return { results: SCHEMA_ROWS.map((row) => ({ ...row })) };
    }
    if (!allowed.has(table)) {
      violations.push(table);
      throw new Error(`unexpected table read: ${table}`);
    }
    return { results: (TABLE_ROWS[table] ?? []).map((row) => ({ ...row })) };
  };

  const metaFor = (sql: string) => {
    if (options.noMeta) return undefined;
    const table = tableOf(sql);
    const rowsRead = table === "sqlite_master" ? SCHEMA_ROWS_READ : TABLE_ROWS_READ[table];
    return rowsRead === undefined ? undefined : { rows_read: rowsRead };
  };

  const prepare = (sql: string) => {
    const call: SqlCall = { sql, values: [] };
    calls.push(call);
    return {
      all: async () => {
        if (/INSERT INTO worker_runs/.test(sql)) return { results: [{ id: nextRunId++ }], success: true };
        return { results: answer(sql).results, success: true, meta: metaFor(sql) };
      },
      bind(...values: unknown[]) {
        call.values = values;
        return {
          all: async () => {
            if (/INSERT INTO worker_runs/.test(sql)) return { results: [{ id: nextRunId++ }], success: true };
            return { results: answer(sql).results, success: true, meta: metaFor(sql) };
          },
          run: async () => {
            if (/UPDATE worker_runs/.test(sql)) {
              const [finished_at, outcome, added, removed, error, dry_run, id] = call.values;
              latestRun = { id, job: CONFIG_JOB, finished_at, outcome, added, removed, error, dry_run };
            }
            return { success: true };
          },
        };
      },
    };
  };

  return { db: { prepare }, calls, violations, get latestRun() { return latestRun; } };
}

interface PutCall {
  key: string;
  value: ArrayBuffer | ReadableStream<Uint8Array> | string;
  options?: { httpMetadata?: { contentType?: string; contentEncoding?: string } };
}

/**
 * In-memory R2 implementation: supports put / list (including delimiter behavior) / delete and records every call.
 *
 * `leakKeys` simulates a broken binding that returns extra keys outside the requested prefix
 * (such as objects under analytics/), exercising the isBackupKey() guard.
 */
function r2Stub(initial: Record<string, string> = {}, leakKeys: string[] = []) {
  const objects = new Map<string, string>(Object.entries(initial));
  const puts: PutCall[] = [];
  const deletes: string[][] = [];
  const lists: { prefix?: string; delimiter?: string; cursor?: string }[] = [];

  const bucket = {
    async put(key: string, value: PutCall["value"], options?: PutCall["options"]) {
      puts.push({ key, value, options });
      objects.set(key, "[written]");
      return { key };
    },
    async list(opts: { prefix?: string; delimiter?: string; cursor?: string } = {}) {
      lists.push({ ...opts });
      const prefix = opts.prefix ?? "";
      const matching = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      if (opts.delimiter) {
        const dirs = new Set<string>();
        const direct: { key: string; size: number }[] = [];
        for (const key of matching) {
          const rest = key.slice(prefix.length);
          const cut = rest.indexOf(opts.delimiter);
          if (cut === -1) direct.push({ key, size: (objects.get(key) ?? "").length });
          else dirs.add(prefix + rest.slice(0, cut + opts.delimiter.length));
        }
        return { objects: direct, delimitedPrefixes: [...dirs].sort(), truncated: false };
      }
      // Return these as-is to simulate a broken binding. Do not filter them just because the keys exist in the bucket,
      // or the isBackupKey() guard would never be exercised (a reverse audit caught this gap).
      const leaked = leakKeys;
      return {
        objects: [
          ...matching.map((key) => ({ key, size: (objects.get(key) ?? "").length })),
          ...leaked.map((key) => ({ key, size: 1 })),
        ],
        truncated: false,
      };
    },
    async delete(keys: string[]) {
      deletes.push([...keys]);
      for (const key of keys) objects.delete(key);
    },
  };

  return { bucket, objects, puts, deletes, lists };
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  return { logs, errors };
}

const asText = (value: PutCall["value"]): string => {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value)).toString("utf8");
  throw new Error("unexpected stream payload in test");
};

const asGunzipped = (value: PutCall["value"]): string => {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return gunzipSync(Buffer.from(new Uint8Array(value))).toString("utf8");
  throw new Error("unexpected stream payload in test");
};

const putFor = (puts: PutCall[], key: string): PutCall => {
  const found = puts.find((call) => call.key === key);
  expect(found, `missing R2 object ${key}`).toBeDefined();
  return found!;
};

/** Create N days of historical snapshot prefixes, with two objects per day and an analytics object that must survive. */
function seedBucket(days: string[], analytics: boolean) {
  const initial: Record<string, string> = {};
  if (analytics) {
    initial["analytics/2026_09_08/events.jsonl.gz"] = "x".repeat(4096);
    initial["analytics/2026_09_08/visitor_rollups.jsonl.gz"] = "y".repeat(128);
    initial["analytics/2026_09_10/events.jsonl.gz"] = "z".repeat(64);
  }
  for (const day of days) {
    initial[`backup/${day}/ddl.sql`] = "-- ddl";
    initial[`backup/${day}/blocked_ips.jsonl.gz`] = "gz";
  }
  return initial;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("config backup keys and dates", () => {
  it("stamps the prefix with the run day, not the data day", () => {
    // Local 10-11 06:00 (+08) is still 10-10 22:00 UTC; snapshots use the UTC date.
    expect(utcDayStamp(new Date("2026-10-10T22:00:00Z"))).toBe("2026_10_10");
    expect(utcDayStamp(DAY)).toBe("2026_10_11");
    expect(snapshotPrefix("2026_10_11")).toBe("backup/2026_10_11/");
    expect(BACKUP_PREFIX).toBe("backup/");
  });

  it("treats only keys inside backup/ as deletable", () => {
    expect(isBackupKey("backup/2026_10_11/ddl.sql")).toBe(true);
    expect(isBackupKey("backup/")).toBe(false);
    expect(isBackupKey("analytics/2026_10_11/events.jsonl.gz")).toBe(false);
    expect(isBackupKey("backupish/x")).toBe(false);
  });

  it("orders DDL tables before the indexes that depend on them", () => {
    const ordered = orderSchema(SCHEMA_ROWS).map((row) => row.name);
    expect(ordered.indexOf("blocked_ips")).toBeLessThan(ordered.indexOf("idx_blocked_ips_active"));
    // Tables precede indexes; sort by name within each kind (`_` sorts before lowercase letters, so _cf_KV comes first).
    expect(ordered).toEqual([
      "_cf_KV",
      "blocked_ips",
      "schema_version",
      "sqlite_sequence",
      "idx_blocked_ips_active",
    ]);
  });
});

describe("config backup snapshot", () => {
  it("writes ddl.sql plus every whitelisted table under backup/YYYY_MM_DD/", async () => {
    const d1 = d1Stub();
    const r2 = r2Stub();
    const result = await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    const prefix = "backup/2026_10_11/";
    const expected = [
      `${prefix}ddl.sql`,
      `${prefix}schema.jsonl.gz`,
      `${prefix}manifest.json`,
      ...CONFIG_TABLES.map((table) => `${prefix}${table.name}.jsonl.gz`),
    ];
    expect(r2.puts.map((call) => call.key).sort()).toEqual([...expected].sort());
    // A day contains 13 objects: ddl + schema + 10 tables + manifest.
    expect(r2.puts).toHaveLength(13);
    expect(result.objects).toBe(13);
    expect(result.day).toBe("2026_10_11");

    // Keys must be under backup/, and no analytics/ object may be written.
    for (const call of r2.puts) {
      expect(call.key.startsWith(prefix)).toBe(true);
      expect(call.key.startsWith("analytics/")).toBe(false);
    }
    expect(putFor(r2.puts, `${prefix}ddl.sql`).options).toEqual({
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
    // Intentionally omit contentEncoding:gzip; otherwise each download is silently decompressed and the .gz extension becomes misleading.
    expect(putFor(r2.puts, `${prefix}blocked_ips.jsonl.gz`).options).toEqual({
      httpMetadata: { contentType: "application/gzip" },
    });
  });

  it("keeps the whole DDL skeleton and explains the internal objects it skips", () => {
    const { sql, skipped } = buildDdl(SCHEMA_ROWS, 1791700000);
    expect(sql).toContain('CREATE TABLE "blocked_ips" (');
    expect(sql).toContain("CREATE INDEX idx_blocked_ips_active");
    expect(sql).toContain("CREATE TABLE schema_version");
    // Internal objects are omitted from replayable SQL (sqlite_sequence is reserved, and _cf_KV is platform-managed)...
    expect(sql).not.toContain("CREATE TABLE sqlite_sequence");
    expect(sql).not.toContain("CREATE TABLE _cf_KV");
    // ...but must be listed in the header comment so readers know they were intentionally excluded.
    expect(sql).toContain("--   sqlite_sequence");
    expect(sql).toContain("--   _cf_KV");
    expect(skipped).toEqual(["_cf_KV", "sqlite_sequence"]);
    // Every statement ends with a semicolon and can be passed directly to wrangler d1 execute --file.
    expect(sql.endsWith(";\n")).toBe(true);
    expect(sql).not.toContain(";;");
  });

  it("preserves row types exactly: 0/1 flags, epoch integers, NULL vs empty string", async () => {
    const d1 = d1Stub();
    const r2 = r2Stub();
    await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    const blocked = asGunzipped(putFor(r2.puts, "backup/2026_10_11/blocked_ips.jsonl.gz").value)
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(blocked).toHaveLength(2);
    // active is an integer 0/1, not a boolean or string; empty strings must remain distinct from NULL.
    expect(blocked[0]).toMatchObject({ active: 1, prefix: 24, reason: "", updated_by: "admin" });
    expect(blocked[1]).toMatchObject({ active: 0, updated_by: "" });
    expect(typeof blocked[1].active).toBe("number");

    const apple = JSON.parse(
      asGunzipped(putFor(r2.puts, "backup/2026_10_11/apple_accounts.jsonl.gz").value).trim(),
    );
    // Copy ciphertext verbatim without attempting to decrypt it; preserve NULL as null.
    expect(apple.password).toBe("enc:v1:AAAA");
    expect(apple.notes).toBeNull();

    const creds = JSON.parse(
      asGunzipped(putFor(r2.puts, "backup/2026_10_11/auth_credentials.jsonl.gz").value).trim(),
    );
    expect(creds.created_at).toBe(1786000000);
    expect(typeof creds.created_at).toBe("number");
    expect(creds.locked_until).toBeNull();
  });

  it("keeps the raw sqlite_master dump lossless, internal objects included", async () => {
    const d1 = d1Stub();
    const r2 = r2Stub();
    await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    const schema = asGunzipped(putFor(r2.puts, "backup/2026_10_11/schema.jsonl.gz").value)
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(schema).toHaveLength(SCHEMA_ROWS.length);
    expect(schema.map((row: SchemaRow) => row.name)).toContain("_cf_KV");
    expect(schema.map((row: SchemaRow) => row.name)).toContain("sqlite_sequence");
  });

  it("records the measured D1 read cost and the excluded tables in manifest.json", async () => {
    const d1 = d1Stub();
    const r2 = r2Stub();
    const result = await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    const manifest = JSON.parse(asText(putFor(r2.puts, "backup/2026_10_11/manifest.json").value));
    const expectedRead =
      SCHEMA_ROWS_READ + Object.values(TABLE_ROWS_READ).reduce((sum, n) => sum + n, 0);
    expect(manifest.d1_rows_read).toBe(expectedRead);
    expect(result.rowsRead).toBe(expectedRead);
    expect(manifest.keep_snapshots).toBe(KEEP_SNAPSHOTS);
    expect(manifest.tables).toHaveLength(CONFIG_TABLES.length);
    expect(manifest.tables.every((table: { error: string | null }) => table.error === null)).toBe(true);
    // Include the exclusion list in the backup so readers do not need to consult repository documentation.
    const excluded = manifest.excluded_tables.map((table: { name: string }) => table.name);
    expect(excluded).toContain("visitors");
    expect(excluded).toContain("visitors_daily");
    expect(excluded).toContain("identity_handoffs");
    // probe_uptime_daily moved from the exclusion list to the allowlist on 2026-10-11. It is the only table that cannot be rebuilt:
    // heartbeats are retained for 30 days while this table keeps 90, so a missed worker run permanently loses that day's uptime.
    // It has only 75 measured rows, about 270 at the upper bound, raising the budget from 428 to roughly 503 rows/day.
    // Assert both sides to prevent it from being moved back to the exclusion list.
  expect(excluded).not.toContain("probe_uptime_daily");
  expect(manifest.tables.map((table: { name: string }) => table.name)).toContain(
    "probe_uptime_daily",
  );
    expect(manifest.restore.ddl).toContain("wrangler d1 execute");
  });

  it("never reads a table outside the whitelist (no big-table scan)", async () => {
    const d1 = d1Stub();
    const r2 = r2Stub();
    await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    // The stub throws and records any FROM outside the allowlist; an empty list means none were touched.
    expect(d1.violations).toEqual([]);

    const reads = d1.calls
      .map((call) => call.sql)
      .filter((sql) => /^SELECT \* FROM/.test(sql.trim()) || /sqlite_master/.test(sql));
    for (const table of FORBIDDEN_TABLES) {
      const pattern = new RegExp(`FROM\\s+"?${table}"?\\b`);
      expect(reads.some((sql) => pattern.test(sql)), `snapshot read ${table}`).toBe(false);
    }
    // Positive case: all nine small tables are present, each ordered by its primary key for reproducible bytes.
    for (const table of CONFIG_TABLES) {
      expect(reads).toContain(`SELECT * FROM ${table.name} ORDER BY ${table.orderBy}`);
    }
    // The four analytics tables are queried with a time window only under analytics/; snapshots must not issue bare SELECTs for them.
    for (const table of ANALYTICS_TABLES) {
      expect(reads).not.toContain(`SELECT * FROM ${table} ORDER BY ts`);
    }
  });

  it("still writes the other tables when one of them fails, and reports it", async () => {
    const d1 = d1Stub({ failSql: /FROM blocklist_audit/ });
    const r2 = r2Stub();
    const { errors: logErrors } = captureConsole();

    const result = await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    expect(result.outcome).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/blocklist_audit/);
    expect(r2.puts.map((call) => call.key)).not.toContain(
      "backup/2026_10_11/blocklist_audit.jsonl.gz",
    );
    expect(r2.puts).toHaveLength(12);
    const manifest = JSON.parse(asText(putFor(r2.puts, "backup/2026_10_11/manifest.json").value));
    const report = manifest.tables.find((table: { name: string }) => table.name === "blocklist_audit");
    expect(report.error).toMatch(/simulated/);
    expect(logErrors.some((line) => line.includes('"job":"config_backup"'))).toBe(true);
  });
});

describe("config backup retention", () => {
  it("keeps the newest 14 day-prefixes and deletes the older ones as whole snapshots", async () => {
    // With 20 historical days, delete the six oldest; delete both objects per day so no partial snapshot remains.
    const days = Array.from({ length: 20 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 8, 1 + index));
      return day.toISOString().slice(0, 10).replaceAll("-", "_");
    });
    const r2 = r2Stub(seedBucket(days, false));

    const pruned = await pruneBackups(r2.bucket as never, KEEP_SNAPSHOTS);

    expect(pruned.scanning).toHaveLength(20);
    expect(pruned.kept).toEqual(days.slice(-14).map((day) => `backup/${day}/`));
    expect(pruned.deletedKeys).toHaveLength(12);
    for (const day of days.slice(0, 6)) {
      expect(pruned.deletedKeys).toContain(`backup/${day}/ddl.sql`);
      expect(pruned.deletedKeys).toContain(`backup/${day}/blocked_ips.jsonl.gz`);
      expect(r2.objects.has(`backup/${day}/ddl.sql`)).toBe(false);
    }
    for (const day of days.slice(-14)) {
      expect(r2.objects.has(`backup/${day}/ddl.sql`)).toBe(true);
    }
    // List only the backup/ prefix, and list each prefix due for deletion exactly once.
    expect(r2.lists[0]).toMatchObject({ prefix: "backup/", delimiter: "/" });
    expect(r2.lists.some((call) => call.prefix === `backup/${days[0]}/`)).toBe(true);
  });

  it("never deletes anything under analytics/", async () => {
    const days = Array.from({ length: 16 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 1 + index));
      return day.toISOString().slice(0, 10).replaceAll("-", "_");
    });
    const r2 = r2Stub(seedBucket(days, true));
    const analyticsBefore = [...r2.objects.keys()].filter((key) => key.startsWith("analytics/"));

    const pruned = await pruneBackups(r2.bucket as never, KEEP_SNAPSHOTS);

    expect(analyticsBefore).toHaveLength(3);
    for (const key of pruned.deletedKeys) {
      expect(key.startsWith("backup/")).toBe(true);
      expect(key.startsWith("analytics/")).toBe(false);
    }
    // Every delete call must contain only backup/ keys.
    for (const batch of r2.deletes) {
      expect(batch.length).toBeGreaterThan(0);
      for (const key of batch) expect(isBackupKey(key)).toBe(true);
    }
    const analyticsAfter = [...r2.objects.keys()].filter((key) => key.startsWith("analytics/"));
    expect(analyticsAfter).toEqual(analyticsBefore);
  });

  it("drops an analytics/ key even when a broken binding hands one back", async () => {
    // Broken binding: listing a backup/<day>/ prefix returns two extra analytics/ keys.
    // Without the isBackupKey() guard, delete() would remove them.
    const days = Array.from({ length: 16 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 1 + index));
      return day.toISOString().slice(0, 10).replaceAll("-", "_");
    });
    const leak = ["analytics/2026_09_08/events.jsonl.gz", "analytics/2026_09_10/events.jsonl.gz"];
    const r2 = r2Stub(seedBucket(days, true), leak);

    const pruned = await pruneBackups(r2.bucket as never, KEEP_SNAPSHOTS);

    expect(pruned.deletedKeys.some((key) => key.startsWith("analytics/"))).toBe(false);
    for (const key of leak) {
      expect(r2.deletes.flat()).not.toContain(key);
      expect(r2.objects.has(key)).toBe(true);
    }
  });

  it("leaves hand-placed objects under backup/ alone and never deletes below one copy", async () => {
    const initial: Record<string, string> = {
      "backup/notes.txt": "keep me",
      "backup/manual/dump.sql": "keep me too",
      "backup/2026_09_01/ddl.sql": "a",
      "backup/2026_09_02/ddl.sql": "b",
    };
    const r2 = r2Stub(initial);

    const pruned = await pruneBackups(r2.bucket as never, 0);

    // Clamp keep<=0 to 1; the newest day must survive.
    expect(pruned.kept).toEqual(["backup/2026_09_02/"]);
    expect(pruned.deletedKeys).toEqual(["backup/2026_09_01/ddl.sql"]);
    // Malformed prefixes do not participate in rotation; keep them rather than deleting by a loose prefix match.
    expect(r2.objects.has("backup/notes.txt")).toBe(true);
    expect(r2.objects.has("backup/manual/dump.sql")).toBe(true);
  });
});

describe("config backup runs inside the archive Worker", () => {
  it("rotates only after writing the snapshot, and records removed objects", async () => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 8, 20 + index));
      return day.toISOString().slice(0, 10).replaceAll("-", "_");
    });
    const r2 = r2Stub(seedBucket(days, false));
    const d1 = d1Stub();
    captureConsole();

    const result = await runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY);

    // Fifteen prefixes (14 old ones plus today) exceed 14, so delete only the oldest.
    expect(result.deleted).toBe(2);
    expect(r2.objects.has(`backup/${days[0]}/ddl.sql`)).toBe(false);
    expect(r2.objects.has("backup/2026_10_11/ddl.sql")).toBe(true);
    const update = d1.calls.find((call) => /UPDATE worker_runs/.test(call.sql));
    expect(update!.values[1]).toBe("ok");
    expect(update!.values[2]).toBe(result.rowsRead);
    expect(update!.values[3]).toBe(2);
  });

  it("skips rotation when nothing was written, so a bad night cannot cost the oldest copy", async () => {
    const days = Array.from({ length: 16 }, (_, index) => {
      const day = new Date(Date.UTC(2026, 7, 1 + index));
      return day.toISOString().slice(0, 10).replaceAll("-", "_");
    });
    const r2 = r2Stub(seedBucket(days, false));
    const d1 = d1Stub({ failSchema: true });
    captureConsole();

    await expect(runConfigBackup({ DB: d1.db, ARCHIVE: r2.bucket } as never, DAY)).rejects.toThrow(
      /simulated/,
    );

    expect(r2.deletes).toEqual([]);
    expect(r2.objects.size).toBe(days.length * 2);
    const update = d1.calls.find((call) => /UPDATE worker_runs/.test(call.sql));
    expect(update!.values[1]).toBe("failed");
    expect(String(update!.values[4])).toMatch(/simulated/);
  });

  it("records a failed config_backup run while the analytics archive still completes", async () => {
    // An unreadable sqlite_master is fatal to the snapshot; the analytics archive must still write all four objects.
    const d1 = d1Stub({ failSchema: true });
    const r2 = r2Stub();
    const { errors } = captureConsole();
    const waited: Promise<unknown>[] = [];

    await scheduled({}, { DB: d1.db, ARCHIVE: r2.bucket, SYNC_TOKEN: "t" } as never, {
      waitUntil: (promise) => waited.push(promise),
    });

    expect(waited).toHaveLength(1);
    // The archive completed: one object for each of the four analytics tables.
    const analyticsKeys = r2.puts
      .map((call) => call.key)
      .filter((key) => key.startsWith("analytics/"));
    expect(analyticsKeys).toHaveLength(4);
    // This is the semantic distinction: analytics/ uses the data's day (yesterday), while backup/ uses the run day.
    const now = new Date();
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dataDay = new Date(todayStart - 86400 * 1000).toISOString().slice(0, 10).replaceAll("-", "_");
    const runDay = utcDayStamp(now);
    expect(dataDay).not.toBe(runDay);
    expect(analyticsKeys).toContain(`analytics/${dataDay}/events.jsonl.gz`);

    const inserts = d1.calls.filter((call) => /INSERT INTO worker_runs/.test(call.sql));
    expect(inserts.map((call) => call.values[0])).toEqual([JOB, CONFIG_JOB]);
    const failures = d1.calls.filter(
      (call) => /UPDATE worker_runs/.test(call.sql) && call.values[1] === "failed",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0].values[4]).toMatch(/simulated/);

    // The failure must also appear in the searchable single-line JSON log (the stage=scheduled summary row).
    const lines = errors.map((line) => JSON.parse(line));
    const scheduledFailure = lines.find((line) => line.stage === "scheduled");
    expect(scheduledFailure).toMatchObject({ job: CONFIG_JOB, outcome: "failed" });
    // The archive stage succeeded; only the configuration snapshot failed.
    expect(lines.some((line) => line.job === JOB && line.outcome === "failed")).toBe(false);
  });

  it("reports the config_backup run on the same health endpoint as the archive", async () => {
    // The health endpoint reports one row per job, making it obvious if the archive is healthy while snapshots keep failing.
    const rows: Record<string, Record<string, unknown>> = {
      d1_archive: { id: 1, job: "d1_archive", outcome: "ok", started_at: 1791671264, finished_at: 1791671266, added: 576, removed: null, error: null, dry_run: 0 },
      config_backup: { id: 2, job: CONFIG_JOB, outcome: "failed", started_at: 1791671266, finished_at: 1791671270, added: 428, removed: 0, error: "blocklist_audit: boom", dry_run: 0 },
    };
    // Serves only lastRun(db, job): return the latest row for the supplied job.
    const db = {
      prepare: (sql: string) => {
        expect(sql).toMatch(/FROM worker_runs/);
        return {
          bind: (job: string) => ({
            all: async () => ({ results: rows[job] ? [{ ...rows[job] }] : [], success: true }),
          }),
          all: async () => ({ results: [], success: true }),
          run: async () => ({ success: true }),
        };
      },
    };
    captureConsole();

    const resp = await worker.fetch(
      new Request("https://limooo-d1-archive.limooo.workers.dev/?health=1", {
        headers: { Authorization: "Bearer s3cret-token" },
      }),
      { DB: db, ARCHIVE: r2Stub().bucket, SYNC_TOKEN: "s3cret-token" } as never,
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.job).toBe(JOB);
    expect(body.lastRun).toMatchObject({ job: JOB, outcome: "ok" });
    expect(body.backup.job).toBe(CONFIG_JOB);
    expect(body.backup.lastRun).toMatchObject({ outcome: "failed", removed: 0 });
    expect(body.backup.lastRun.error).toMatch(/blocklist_audit/);
  });

  it("keeps archiving even when the snapshot stage explodes mid-flight", async () => {
    // R2 throws while writing schema.jsonl.gz (the snapshot's first write); the archive remains unaffected.
    const d1 = d1Stub();
    const r2 = r2Stub();
    const boom = vi.fn(async (key: string) => {
      if (String(key).startsWith(BACKUP_PREFIX)) throw new Error("R2 unavailable (simulated)");
      return { key };
    });
    const { errors } = captureConsole();
    const waited: Promise<unknown>[] = [];

    await scheduled({}, { DB: d1.db, ARCHIVE: { ...r2.bucket, put: boom }, SYNC_TOKEN: "t" } as never, {
      waitUntil: (promise) => waited.push(promise),
    });

    expect(waited).toHaveLength(1);
    const analyticsPuts = boom.mock.calls.filter((call) => String(call[0]).startsWith("analytics/"));
    expect(analyticsPuts).toHaveLength(4);
    expect(errors.some((line) => line.includes("R2 unavailable"))).toBe(true);
  });
});
