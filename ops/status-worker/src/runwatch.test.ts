/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Daily check, step 1: whether the latest `worker_runs` entry succeeded (runwatch.ts + index.ts).
 *
 * Migration 018 made two cron Workers write failures to this table, but there were
 * **no readers**. These tests ensure there is now a reader that does not bring down the
 * daily task:
 *   - Failed or stuck `running` jobs must alert and identify the job.
 *   - `ok`, `skipped`, and newly started `running` jobs must not alert (to avoid daily noise).
 *   - If the table is missing or a query throws, log only and **do not throw**; daily
 *     retention cleanup must continue.
 *   - Read this table **once per day** (spy-counted), using one indexed seek per job
 *     rather than scanning the entire index with GROUP BY (cost evidence is in runwatch.ts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker, {
  ALERT_I18N,
  ALERT_LANG_FORCED,
  ALERT_KINDS,
  buildCheckAlertEmail,
  checkWorkerRuns,
  esc,
  runDailyChecks,
  type Env,
} from "./index";
import { STALE_RUNNING_S, WATCHED_JOBS, errorSummary, formatUtc, runIssues } from "./runwatch";

const NOW = 1_800_000_000; // Fixed clock: 2027-01-15 08:00:00 UTC

interface Call {
  sql: string;
  values: unknown[];
}

/** Same shape as LatestRun; use a type rather than an interface for assignment to Record<string, unknown>. */
type LatestRunRow = {
  job: string;
  outcome: string;
  started_at: number;
  error: string | null;
};

/**
 * D1 stub that records every prepare call, including bound values.
 *
 * `failOn` simulates migration 018 not being applied: SQLite reports `no such table`
 * during prepare (as real D1 does), exercising readLatestRuns' try/catch.
 */
function fakeDb(
  options: { latest?: LatestRunRow[]; failOn?: (sql: string) => boolean } = {},
) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      calls.push({ sql, values: [] });
      if (options.failOn?.(sql)) {
        throw new Error("D1_ERROR: no such table: worker_runs");
      }
      const finish = () => ({
        all: async () =>
          /FROM worker_runs/i.test(sql) ? { results: options.latest ?? [] } : { results: [] },
        first: async () => null,
        run: async () => ({ meta: { changes: 0 } }),
      });
      return {
        bind: (...values: unknown[]) => {
          calls[calls.length - 1] = { sql, values };
          return finish();
        },
        ...finish(),
      };
    },
    batch: async () => [],
  };
  const workerRunsQueries = () =>
    calls.filter((c) => /worker_runs/i.test(c.sql)).length;
  return { db: db as unknown as D1Database, calls, workerRunsQueries };
}

/** Alert channel with an Email binding and recipient; captures sent messages without network access. */
function alertEnv(db: D1Database, extra: Partial<Env> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const env = {
    DB: db,
    ALERT_TO: "ops@example.com",
    ALERT_LANG: "zh-cn",
    EMAIL: { send: async (m: unknown) => void sent.push(m as Record<string, unknown>) },
    ...extra,
  } as unknown as Env;
  return { env, sent };
}

function run(
  job: string,
  outcome: string,
  startedAt: number,
  error: string | null = null,
): LatestRunRow {
  return { job, outcome, started_at: startedAt, error };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker_runs → alert (daily check step 1)", () => {
  it("alerts on outcome=failed and names the job in the copy", async () => {
    const { db, workerRunsQueries } = fakeDb({
      latest: [
        run("blocklist_sync", "failed", NOW - 600, "CF API 500 https://api.cloudflare.com/..."),
        run("d1_archive", "ok", NOW - 3600),
      ],
    });
    const { env, sent } = alertEnv(db);

    const step = await checkWorkerRuns(env, NOW);

    expect(step).toEqual({ ok: true, issues: 1, alerted: true });
    expect(sent).toHaveLength(1);
    expect(String(sent[0].subject)).toBe("Cron job failure · ComiCine");
    // The job name appears in the **body** (the subject only reports what happened, per
    // the user's 2026-10-11 decision).
    expect(String(sent[0].text)).toContain("blocklist_sync");
    expect(String(sent[0].text)).toContain("outcome=failed");
    expect(String(sent[0].text)).toContain("CF API 500");
    // The body must include the job, timestamp, outcome, and error summary.
    expect(String(sent[0].text)).toContain(formatUtc(NOW - 600));
    // Read this table only once during the daily check.
    expect(workerRunsQueries()).toBe(1);
  });

  it("stays quiet when every job is ok or skipped", async () => {
    const { db } = fakeDb({
      latest: [
        run("blocklist_sync", "ok", NOW - 600),
        run("d1_archive", "skipped", NOW - 3600, "missing credentials"),
      ],
    });
    const { env, sent } = alertEnv(db);

    const step = await checkWorkerRuns(env, NOW);

    expect(step).toEqual({ ok: true, issues: 0, alerted: false });
    expect(sent).toHaveLength(0);
  });

  it("alerts on a run stuck in 'running' past the threshold, but not on a fresh one", async () => {
    const staleDb = fakeDb({ latest: [run("d1_archive", "running", NOW - STALE_RUNNING_S - 60)] });
    const freshDb = fakeDb({ latest: [run("d1_archive", "running", NOW - 30)] });
    const stale = alertEnv(staleDb.db);
    const fresh = alertEnv(freshDb.db);

    const staleStep = await checkWorkerRuns(stale.env, NOW);
    const freshStep = await checkWorkerRuns(fresh.env, NOW);

    expect(staleStep).toEqual({ ok: true, issues: 1, alerted: true });
    expect(freshStep).toEqual({ ok: true, issues: 0, alerted: false });
    expect(stale.sent).toHaveLength(1);
    expect(String(stale.sent[0].text)).toContain("running");
    expect(fresh.sent).toHaveLength(0);
  });

  it("does not alert when a watched job has no row at all (never ran ≠ failed)", async () => {
    const { db } = fakeDb({ latest: [run("blocklist_sync", "ok", NOW - 600)] });
    const { env, sent } = alertEnv(db);

    const step = await checkWorkerRuns(env, NOW);

    expect(step.issues).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("fails open (no alert, no throw) when the table does not exist", async () => {
    const { db } = fakeDb({ failOn: (sql) => /worker_runs/i.test(sql) });
    const { env, sent } = alertEnv(db);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const step = await checkWorkerRuns(env, NOW);

    expect(step.ok).toBe(false);
    expect(step.issues).toBe(0);
    expect(step.alerted).toBe(false);
    expect(step.reason).toContain("no such table");
    expect(sent).toHaveLength(0);
    expect(errors).toHaveBeenCalled();
  });

  it("sends one aggregated alert when several jobs are broken", async () => {
    const { db } = fakeDb({
      latest: [
        run("blocklist_sync", "failed", NOW - 600, "boom"),
        run("d1_archive", "failed", NOW - 3600, "kaboom"),
      ],
    });
    const { env, sent } = alertEnv(db);

    const step = await checkWorkerRuns(env, NOW);

    expect(step.issues).toBe(2);
    expect(sent).toHaveLength(1);
    const text = String(sent[0].text);
    expect(text).toContain("blocklist_sync");
    expect(text).toContain("d1_archive");
  });

  it("sends nothing when no alert channel is configured (still logs the failure)", async () => {
    const { db } = fakeDb({ latest: [run("d1_archive", "failed", NOW - 60, "boom")] });
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const step = await checkWorkerRuns({ DB: db } as Env, NOW);

    // No alert channel does not mean no issues were found; report issues for log/API
    // troubleshooting.
    expect(step).toEqual({ ok: true, issues: 1, alerted: false });
    expect(logs.mock.calls.flat().join(" ")).toContain("worker_runs_alert_skipped");
  });
});

describe("runwatch SQL shape (cost discipline)", () => {
  it("reads the latest row per job with an index-friendly seek, never a GROUP BY scan", async () => {
    const { db, calls } = fakeDb({ latest: [] });
    await checkWorkerRuns(alertEnv(db).env, NOW);

    const queries = calls.filter((c) => /worker_runs/i.test(c.sql));
    expect(queries).toHaveLength(1);
    const sql = queries[0].sql;
    // Use one `WHERE job = ? ORDER BY started_at DESC LIMIT 1` per job (via
    // idx_worker_runs_job_started), combined into one statement and one round trip.
    expect(sql.match(/ORDER BY started_at DESC LIMIT 1/g)).toHaveLength(WATCHED_JOBS.length);
    expect(sql).not.toMatch(/GROUP BY/i);
    expect(sql).not.toMatch(/COUNT\s*\(/i);
    expect(sql).not.toMatch(/JOIN/i);
    // Select only required columns, not SELECT *, so future columns cannot accidentally
    // cause large fields to be read.
    expect(sql).toContain("SELECT job, outcome, started_at, error");
    // Read only this table; do not include other tables.
    expect(sql.match(/FROM worker_runs/g)).toHaveLength(WATCHED_JOBS.length);
  });

  it("binds every watched job as a parameter, in order", async () => {
    const { db, calls } = fakeDb({ latest: [] });
    await checkWorkerRuns(alertEnv(db).env, NOW);
    const [query] = calls.filter((c) => /worker_runs/i.test(c.sql));
    expect(query.values).toEqual([...WATCHED_JOBS]);
  });
});

describe("runwatch pure helpers", () => {
  it("classifies outcomes", () => {
    expect(runIssues([run("a", "ok", 0)], NOW)).toHaveLength(0);
    expect(runIssues([run("a", "skipped", 0)], NOW)).toHaveLength(0);
    expect(runIssues([run("a", "failed", NOW)], NOW)).toHaveLength(1);
    // Alert on unknown outcomes too; new values must not silently go unnoticed.
    expect(runIssues([run("a", "cancelled", NOW)], NOW)).toHaveLength(1);
    // Boundary for `running`: exactly two hours is stale; one second less is not.
    expect(runIssues([run("a", "running", NOW - STALE_RUNNING_S)], NOW)).toHaveLength(1);
    expect(runIssues([run("a", "running", NOW - STALE_RUNNING_S + 1)], NOW)).toHaveLength(0);
  });

  it("summarises errors instead of dumping stacks", () => {
    expect(errorSummary(null)).toBe("-");
    expect(errorSummary("a\n  b\tc")).toBe("a b c");
    const long = errorSummary("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(201);
    expect(long.endsWith("…")).toBe(true);
  });

  it("formats timestamps as UTC and keeps '-' for junk", () => {
    // User-specified on 2026-10-11: `YYYY-MM-DD HH:MM` in UTC, without seconds (alerts
    // and `ALERT_COOLDOWN_S` have minute-level granularity). Preserve leading zeroes so
    // lexicographic order matches chronological order.
    expect(formatUtc(1_700_000_000)).toBe("2023-11-14 22:13");
    // Preserve leading zeroes or sorting will be wrong (September must precede October).
    expect(formatUtc(Date.UTC(2026, 8, 9, 3, 4) / 1000)).toBe("2026-09-09 03:04");
    expect(formatUtc(0)).toBe("-");
    expect(formatUtc(Number.NaN)).toBe("-");
  });
});

describe("alert copy for the daily checks", () => {
  it("ships exactly one language, English, complete for every kind", () => {
    // On 2026-10-11 the user required English-only alerts: `ALERT_I18N` retains only
    // `en-us`; Chinese, Japanese, and Korean entries were removed.
    // This locks down three things: (1) do not add other languages back and expand
    // maintenance; (2) `en-us` must be complete for every kind or a missing key renders
    // as a blank line; (3) **do not restore `title_*`** because the body title duplicates
    // the subject. All three alert types use the user-requested two-line structure:
    // subject reports the event, and intro gives details.
    expect(Object.keys(ALERT_I18N)).toEqual(["en-us"]);
    const table = ALERT_I18N["en-us"];
    for (const kind of ALERT_KINDS) {
      for (const key of [`subject_${kind}`, `intro_${kind}`]) {
        expect(table[key], key).toBeTruthy();
      }
      expect(table[`title_${kind}`], `title_${kind} must not exist`).toBeUndefined();
    }
    expect(table.view).toBeTruthy();
    expect(table.hint).toBeTruthy();
  });

  it("renders one row per finding and escapes it", () => {
    const mail = buildCheckAlertEmail(
      "en-us",
      "runs",
      [{ name: "blocklist_sync", detail: "<script>alert(1)</script>" }],
      NOW,
    );
    expect(mail.text).toContain("blocklist_sync");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain(esc("blocklist_sync"));
    expect(mail.text).toContain(formatUtc(NOW));
  });

  it("stays English no matter what ALERT_LANG is set to", () => {
    // This is a **behavioral** assertion for English-only alerts (the previous test checks
    // only the data shape). The user requires both reader groups (Feishu and email) to
    // receive English, so `env.ALERT_LANG` must not affect output; reverting that behavior
    // makes this test fail.
    for (const configured of ["zh-cn", "ja-jp", "ko-kr", "en-us", "", "de-de"]) {
      const mail = buildCheckAlertEmail("en-us", "runs", [{ name: "j", detail: "d" }], NOW);
      const probe = buildCheckAlertEmail(configured, "runs", [{ name: "j", detail: "d" }], NOW);
      expect(probe.subject, configured).toBe(mail.subject);
      expect(probe.text, configured).toBe(mail.text);
    }
    // The output must actually be English copy, not merely "happen to match."
    const mail = buildCheckAlertEmail("en-us", "runs", [{ name: "j", detail: "d" }], NOW);
    expect(mail.subject).toBe("Cron job failure · ComiCine");
    expect(mail.text).toContain("did not succeed");
    expect(mail.text).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("falls back to English for an unknown language instead of rendering blanks", () => {
    const mail = buildCheckAlertEmail("de-de", "blocklist", [{ name: "L", detail: "d" }], NOW);

    expect(mail.subject).toContain(ALERT_I18N[ALERT_LANG_FORCED].subject_blocklist);
    // A fallback failure most commonly produces blank fields; assert that this does not happen.
    expect(mail.subject.trim()).not.toBe("");
    expect(mail.html).toContain("L");
  });

  it("keeps the subject short even with a huge error summary", () => {
    const mail = buildCheckAlertEmail(
      "zh-cn",
      "runs",
      [{ name: "j".repeat(500), detail: "d" }],
      NOW,
    );
    expect(mail.subject.length).toBeLessThanOrEqual(120);
  });
});

describe("daily cron wiring", () => {
  const scheduled = (cron: string, env: Env) =>
    worker.scheduled({ cron } as ScheduledController, env);

  it("runs retention first and then the checks on 47 3 * * *", async () => {
    const { db, calls } = fakeDb({ latest: [run("blocklist_sync", "failed", NOW - 60, "boom")] });
    const { env, sent } = alertEnv(db);

    await scheduled("47 3 * * *", env);

    const sqls = calls.map((c) => c.sql);
    expect(sqls.some((s) => /DELETE FROM heartbeats/i.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM worker_runs/i.test(s))).toBe(true);
    // Retention cleanup runs first; if its order changes, DELETE should still appear first.
    expect(sqls.findIndex((s) => /DELETE FROM/i.test(s))).toBeLessThan(
      sqls.findIndex((s) => /FROM worker_runs/i.test(s)),
    );
    expect(sent).toHaveLength(1);
  });

  it("keeps running retention when worker_runs is unreadable (fail-open)", async () => {
    const { db, calls } = fakeDb({ failOn: (sql) => /worker_runs/i.test(sql) });
    const { env, sent } = alertEnv(db);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(scheduled("47 3 * * *", env)).resolves.toBeUndefined();

    expect(calls.some((c) => /DELETE FROM heartbeats/i.test(c.sql))).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("does not touch worker_runs on the every-minute probe cron", async () => {
    const { db, calls } = fakeDb({ latest: [run("blocklist_sync", "failed", NOW - 60, "boom")] });
    const { env, sent } = alertEnv(db);

    await scheduled("* * * * *", env);

    expect(calls.some((c) => /worker_runs/i.test(c.sql))).toBe(false);
    expect(calls.some((c) => /DELETE FROM/i.test(c.sql))).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("exposes the daily checks through an ops endpoint, behind the token", async () => {
    const { db, calls } = fakeDb({ latest: [run("d1_archive", "ok", NOW - 60)] });
    const { env } = alertEnv(db, { STATUS_TOKEN: "tok-0123456789" } as Partial<Env>);

    const unauth = await worker.fetch(
      new Request("https://status.limooo.cn/daily-checks", { method: "POST" }),
      env,
    );
    expect(unauth.status).toBe(401);
    expect(calls).toHaveLength(0);

    const ok = await worker.fetch(
      new Request("https://status.limooo.cn/daily-checks", {
        method: "POST",
        headers: { Authorization: "Bearer tok-0123456789" },
      }),
      env,
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { runs: { ok: boolean }; blocklist: { ok: boolean } };
    expect(body.runs).toEqual({ ok: true, issues: 0, alerted: false });
    // Without Cloudflare credentials, this step fails open (log only, no alert).
    expect(body.blocklist.ok).toBe(false);
  });

  it("runs both checks from runDailyChecks and reports each step separately", async () => {
    const { db } = fakeDb({ latest: [run("blocklist_sync", "ok", NOW - 60)] });
    const { env } = alertEnv(db);

    const result = await runDailyChecks(env, NOW);

    expect(result.runs.ok).toBe(true);
    expect(result.blocklist.ok).toBe(false);
    expect(result.blocklist.reason).toBe("missing_credentials");
  });
});
