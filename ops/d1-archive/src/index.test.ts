/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { archivePreviousDay, runArchive } from "./index";

const scheduled = worker.scheduled;

/** Record every SQL statement and its bound values so tests can verify that run records are written for the expected job. */
interface SqlCall {
  sql: string;
  values: unknown[];
}

/**
 * D1 stub for archiving: analytics tables return one row, and worker_runs INSERT/UPDATE/SELECT operations use in-memory data.
 *
 * Statements matching `failSql` throw directly to simulate real failures such as an unreadable archive table.
 * guard() throws synchronously in the constructor, so async call sites receive a rejection.
 */
function d1Stub(options: { failSql?: RegExp } = {}) {
  const calls: SqlCall[] = [];
  let nextId = 1;
  let latest: Record<string, unknown> | undefined;
  const prepare = (sql: string) => {
    const call: SqlCall = { sql, values: [] };
    calls.push(call);
    const guard = () => {
      if (options.failSql?.test(sql)) throw new Error("D1 read failed (simulated)");
    };
    const rows = async () => {
      guard();
      if (/FROM worker_runs/.test(sql)) return { results: latest ? [{ ...latest }] : [], success: true };
      return { results: [{ id: 1, status: 302 }], success: true };
    };
    return {
      all: rows,
      bind(...values: unknown[]) {
        call.values = values;
        return {
          all: async () => {
            guard();
            if (/INSERT INTO worker_runs/.test(sql)) return { results: [{ id: nextId++ }], success: true };
            if (/FROM worker_runs/.test(sql)) return { results: latest ? [{ ...latest }] : [], success: true };
            return { results: [{ id: 1, status: 302 }], success: true };
          },
          run: async () => {
            guard();
            if (/UPDATE worker_runs/.test(sql)) {
              const [finished_at, outcome, added, removed, error, dry_run, id] = call.values;
              latest = { id, job: "d1_archive", finished_at, outcome, added, removed, error, dry_run };
            }
            return { success: true };
          },
        };
      },
    };
  };
  return { db: { prepare }, calls };
}

function env(stub = d1Stub()) {
  const put = vi.fn().mockResolvedValue({ key: "ok" });
  return {
    env: {
      DB: stub.db,
      ARCHIVE: { put },
      SYNC_TOKEN: "s3cret-token",
    },
    put,
    stub,
  };
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("d1 archive", () => {
  it("archives the previous UTC day to one gzip object per table", async () => {
    const f = env();
    const counts = await archivePreviousDay(f.env as never, new Date("2026-09-09T00:00:00Z"));
    expect(counts).toEqual({
      visitor_rollups: 1,
      visitors_v2: 1,
      ray_log_v2: 1,
      events: 1,
    });
    expect(f.put).toHaveBeenCalledTimes(4);
    expect(f.put.mock.calls[0][0]).toBe("analytics/2026_09_08/visitor_rollups.jsonl.gz");
    expect(f.put.mock.calls[0][2]).toEqual({
      httpMetadata: { contentType: "application/x-ndjson", contentEncoding: "gzip" },
    });
  });

  it("writes one worker_runs row with job=d1_archive and outcome=ok", async () => {
    const f = env();
    captureConsole();

    const { counts, runId } = await runArchive(f.env as never, new Date("2026-09-09T00:00:00Z"));

    expect(counts.events).toBe(1);
    expect(runId).toBe(1);
    const insert = f.stub.calls.find((c) => /INSERT INTO worker_runs/.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.values).toEqual(["d1_archive", expect.any(Number)]);
    const update = f.stub.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update!.values[1]).toBe("ok");
    expect(update!.values[2]).toBe(4);
    // Archiving has no dry-run mode; dry_run must be 0.
    expect(update!.values[5]).toBe(0);
  });

  it("records a failed run and keeps the error text when archiving throws", async () => {
    // Simulate ray_log_v2 being unreadable; this fails mid-archive, closely matching production behavior.
    const f = env(d1Stub({ failSql: /FROM ray_log_v2/ }));
    const { errors } = captureConsole();

    await expect(runArchive(f.env as never, new Date("2026-09-09T00:00:00Z"))).rejects.toThrow(
      /simulated/,
    );

    const update = f.stub.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.values[1]).toBe("failed");
    expect(String(update!.values[4])).toMatch(/simulated/);
    // The failure must also appear in Workers logs as searchable single-line JSON.
    const failedLine = errors.find((l) => l.includes('"outcome":"failed"'));
    expect(failedLine).toBeDefined();
    const parsed = JSON.parse(failedLine!);
    expect(parsed.event).toBe("d1_archive");
    expect(parsed.job).toBe("d1_archive");
    expect(parsed.error).toMatch(/simulated/);
  });

  it("fails open when the run record cannot be written", async () => {
    const { errors } = captureConsole();
    const brokenDb = {
      prepare(sql: string) {
        const boom = async () => {
          if (/worker_runs/.test(sql)) throw new Error("no such table: worker_runs");
          return { results: [{ id: 1, status: 302 }], success: true };
        };
        return {
          all: boom,
          bind: () => ({
            all: boom,
            run: async () => {
              throw new Error("no such table: worker_runs");
            },
          }),
        };
      },
    };
    const put = vi.fn().mockResolvedValue({ key: "ok" });
    const brokenEnv = { DB: brokenDb, ARCHIVE: { put }, SYNC_TOKEN: "s3cret-token" };

    // A bookkeeping failure must not break the archive; all four objects should still be written to R2.
    const { counts, runId } = await runArchive(brokenEnv as never, new Date("2026-09-09T00:00:00Z"));
    expect(runId).toBeNull();
    expect(counts).toEqual({ visitor_rollups: 1, visitors_v2: 1, ray_log_v2: 1, events: 1 });
    expect(put).toHaveBeenCalledTimes(4);
    expect(errors.some((l) => l.includes("worker_run_store_error"))).toBe(true);
  });

  it("the scheduled handler records and logs a failure instead of swallowing it", async () => {
    const f = env(d1Stub({ failSql: /FROM events/ }));
    const { errors } = captureConsole();
    const waited: Promise<unknown>[] = [];

    await scheduled({}, f.env as never, { waitUntil: (p) => waited.push(p) });

    expect(
      f.stub.calls.some((c) => /UPDATE worker_runs/.test(c.sql) && c.values[1] === "failed"),
    ).toBe(true);
    expect(errors.some((l) => l.includes('"outcome":"failed"'))).toBe(true);
    expect(waited).toHaveLength(1);
    // scheduled's final log row must include stage="scheduled". Otherwise, reverting the catch to
    // silently swallowing errors would leave the runArchive log intact and this test would miss the regression.
    const scheduledLine = errors
      .map((l) => JSON.parse(l))
      .find((line) => line.stage === "scheduled");
    expect(scheduledLine).toMatchObject({ event: "d1_archive", job: "d1_archive", outcome: "failed" });
    expect(scheduledLine.error).toMatch(/simulated/);
  });
});

describe("d1 archive health endpoint", () => {
  const healthReq = (auth?: string) =>
    new Request("https://limooo-d1-archive.limooo.workers.dev/?health=1", {
      headers: auth ? { Authorization: auth } : {},
    });

  it("rejects unauthenticated callers with 401", async () => {
    const f = env();
    const resp = await worker.fetch(healthReq(), f.env as never);
    expect(resp.status).toBe(401);
    expect(await resp.json()).toEqual({ ok: false, error: "unauthorized" });
  });

  it("fails closed when SYNC_TOKEN is not configured", async () => {
    const f = env();
    const noSecret = { ...f.env, SYNC_TOKEN: "" };
    const resp = await worker.fetch(healthReq("Bearer anything"), noSecret as never);
    expect(resp.status).toBe(401);
  });

  it("returns ok + lastRun for an authorized caller without archiving", async () => {
    const f = env();
    captureConsole();
    await runArchive(f.env as never, new Date("2026-09-09T00:00:00Z"));
    f.put.mockClear();

    const resp = await worker.fetch(healthReq("Bearer s3cret-token"), f.env as never);

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.job).toBe("d1_archive");
    expect(body.lastRun).toMatchObject({ job: "d1_archive", outcome: "ok" });
    // The health endpoint only reports status and must never trigger an archive or write to R2.
    expect(f.put).not.toHaveBeenCalled();
  });
});
