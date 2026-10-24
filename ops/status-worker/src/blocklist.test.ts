/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Daily check, step 2: Cloudflare IP List == D1 `blocked_ips` (active=1).
 *
 * This invariant previously had only a manual entry point (`ops/check_blocklist_sync.py`,
 * observed to have zero automated callers): a partial sync failure or a manual List edit
 * in the Dashboard could stop edge blocking while D1 still looked healthy. These tests
 * pin down the automated behavior:
 *   - Matching lists do not alert; a daily "everything is fine" message is noise.
 *   - Any non-zero `to_add` or `to_remove` count alerts with counts and differing items.
 *   - Missing credentials, D1 read failures, and API failures fail open: log only, with no
 *     alert or thrown error.
 *   - Read D1 once per day and make only two bounded read-only API calls (spy-counted).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { checkBlocklistRuns, runDailyChecks, type Env } from "./index";
import { LIST_NAME, MAX_ITEM_PAGES, diffBlocklist, normalizeListItem } from "./blocklist";

const NOW = 1_800_000_000;

interface Call {
  sql: string;
  values: unknown[];
}

/** D1 stub that answers only for `blocked_ips`; records SQL to assert one read per day. */
function fakeDb(options: { active?: string[]; failOn?: (sql: string) => boolean } = {}) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      calls.push({ sql, values: [] });
      if (options.failOn?.(sql)) throw new Error("D1_ERROR: no such table: blocked_ips");
      const finish = () => ({
        all: async () =>
          /FROM blocked_ips/i.test(sql)
            ? { results: (options.active ?? []).map((cidr) => ({ cidr })) }
            : { results: [] },
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
  return { db: db as unknown as D1Database, calls };
}

/** Cloudflare read-only API stub: dispatches by URL; `"fail"` represents a 500 response. */
function cfFetch(routes: { lists: unknown; items?: unknown }) {
  const urls: string[] = [];
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (/\/rules\/lists(\?|$)/.test(url)) {
      if (routes.lists === "fail") return new Response("nope", { status: 500 });
      return Response.json(routes.lists);
    }
    if (/\/items/.test(url)) {
      if (routes.items === "fail") return new Response("nope", { status: 500 });
      return Response.json(routes.items ?? { result: [], result_info: {} });
    }
    return new Response("unexpected", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return { urls, fn };
}

const listsWith = (items: string[]) => ({
  result: [{ id: "list-1", name: LIST_NAME }],
  result_info: {},
});
const itemsWith = (ips: string[]) => ({
  result: ips.map((ip, i) => ({ ip, id: `item-${i}` })),
  result_info: {},
});

function checkEnv(db: D1Database, extra: Partial<Env> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const env = {
    DB: db,
    ALERT_TO: "ops@example.com",
    ALERT_LANG: "zh-cn",
    EMAIL: { send: async (m: unknown) => void sent.push(m as Record<string, unknown>) },
    CLOUDFLARE_API_TOKEN: "cf-token",
    CLOUDFLARE_ACCOUNT_ID: "acct-id",
    ...extra,
  } as unknown as Env;
  return { env, sent };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("blocklist invariant (daily check step 2)", () => {
  it("stays quiet when both sides agree", async () => {
    const { db, calls } = fakeDb({ active: ["58.222.33.0/24"] });
    cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24"]) });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step).toEqual({ ok: true, issues: 0, alerted: false });
    expect(sent).toHaveLength(0);
    // Matching lists still read D1 only once, with no extra validation query.
    expect(calls.filter((c) => /blocked_ips/i.test(c.sql))).toHaveLength(1);
  });

  it("treats an IPv4 /32 and its bare form as the same entry", async () => {
    // Cloudflare normalizes /32 to a bare IP (write 203.0.113.7/32, read back 203.0.113.7).
    // Without normalization, the same item would appear in both add and remove diffs,
    // causing a false alert every day.
    const { db } = fakeDb({ active: ["58.222.33.0/24", "203.0.113.7/32"] });
    cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24", "203.0.113.7"]) });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step.issues).toBe(0);
    expect(sent).toHaveLength(0);
    expect(diffBlocklist(["203.0.113.7/32"], ["203.0.113.7"])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it("alerts with numbers when D1 has an entry the IP List is missing (to_add)", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24", "203.0.113.7"] });
    cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24"]) });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step).toEqual({ ok: true, issues: 1, alerted: true });
    expect(sent).toHaveLength(1);
    const text = String(sent[0].text);
    expect(text).toContain("desired=2 actual=1 to_add=1 to_remove=0");
    expect(text).toContain("203.0.113.7");
    // The subject is fixed as `Blocklist drift · Limooo` (user decision on 2026-10-11);
    // diff counts appear only in the body.
    expect(String(sent[0].subject)).toBe("Blocklist drift · Limooo");
    expect(String(sent[0].text)).toContain("to_add=1 to_remove=0");
  });

  it("alerts when the IP List has an entry D1 no longer has (to_remove)", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    cfFetch({
      lists: listsWith([]),
      items: itemsWith(["58.222.33.0/24", "198.51.100.0/24"]),
    });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step).toEqual({ ok: true, issues: 1, alerted: true });
    const text = String(sent[0].text);
    expect(text).toContain("desired=1 actual=2 to_add=0 to_remove=1");
    expect(text).toContain("198.51.100.0/24");
  });

  it("reports a missing List as drift instead of silently passing", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    const { urls } = cfFetch({ lists: { result: [], result_info: {} } });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step.issues).toBe(1);
    expect(String(sent[0].text)).toContain(`list ${LIST_NAME} not found`);
    // If the List is missing, do not read its items; even a read-only check must not create it.
    expect(urls.filter((u) => /items/.test(u))).toHaveLength(0);
  });

  it("fails open when the Cloudflare API errors", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    cfFetch({ lists: "fail" });
    const { env, sent } = checkEnv(db);
    vi.spyOn(console, "log").mockImplementation(() => {});

    const step = await checkBlocklistRuns(env);

    expect(step.ok).toBe(false);
    expect(step.alerted).toBe(false);
    expect(step.reason).toContain("cf_error");
    expect(sent).toHaveLength(0);
  });

  it("fails open when the items page errors", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    cfFetch({ lists: listsWith([]), items: "fail" });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("fails open when the D1 read errors", async () => {
    const { db } = fakeDb({ failOn: (sql) => /blocked_ips/i.test(sql) });
    const { urls } = cfFetch({ lists: listsWith([]), items: itemsWith([]) });
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step.ok).toBe(false);
    expect(step.reason).toContain("d1_error");
    expect(sent).toHaveLength(0);
    // After a D1 read failure, do not query Cloudflare; avoid a needless API call and a
    // partial comparison.
    expect(urls).toHaveLength(0);
  });

  it("fails open without touching D1 or the API when credentials are not configured", async () => {
    const { db, calls } = fakeDb({ active: ["58.222.33.0/24"] });
    const { fn } = cfFetch({ lists: listsWith([]) });
    const { env, sent } = checkEnv(db, {
      CLOUDFLARE_API_TOKEN: undefined,
      CLOUDFLARE_ACCOUNT_ID: undefined,
    });

    const step = await checkBlocklistRuns(env);

    // A missing secret means "not checked," not failure, and must not alert; cloned repos
    // should not generate false alarms.
    expect(step).toEqual({ ok: false, issues: 0, alerted: false, reason: "missing_credentials" });
    expect(calls).toHaveLength(0);
    expect(fn).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("reads D1 once and makes at most two read-only API calls per day", async () => {
    const { db, calls } = fakeDb({ active: ["58.222.33.0/24"] });
    const { urls } = cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24"]) });
    const { env } = checkEnv(db);

    await checkBlocklistRuns(env);

    const d1 = calls.filter((c) => /blocked_ips/i.test(c.sql));
    expect(d1).toHaveLength(1);
    // The only allowed query shape reads active rows through idx_blocked_ips_active.
    expect(d1[0].sql).toBe("SELECT cidr FROM blocked_ips WHERE active = 1");
    // Two read-only API calls: find the List by name to get its ID, then read one page of
    // items. The List ID is not hard-coded.
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/rules/lists?per_page=100");
    expect(urls[1]).toContain("/items?per_page=500");
    // Do not touch the sync Worker's write path.
    expect(urls.some((u) => /bulk_operations|POST/.test(u))).toBe(false);
  });

  it("stops paging instead of looping forever when the cursor does not advance", async () => {
    const { db } = fakeDb({ active: [] });
    let page = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (/\/rules\/lists(\?|$)/.test(url)) return Response.json(listsWith([]));
        page += 1;
        return Response.json({
          result: [{ ip: `10.0.0.${page}`, id: `i${page}` }],
          result_info: { cursor: "same" },
        });
      }),
    );
    const { env, sent } = checkEnv(db);

    const step = await checkBlocklistRuns(env);

    expect(step.ok).toBe(false);
    expect(step.reason).toContain("cursor did not advance");
    expect(sent).toHaveLength(0);
    expect(page).toBeLessThanOrEqual(MAX_ITEM_PAGES);
  });
});

describe("blocklist helpers", () => {
  it("normalises /32 and /128 only", () => {
    expect(normalizeListItem("1.2.3.4/32")).toBe("1.2.3.4");
    expect(normalizeListItem("2001:db8::1/128")).toBe("2001:db8::1");
    expect(normalizeListItem(" 1.2.3.0/24 ")).toBe("1.2.3.0/24");
    expect(normalizeListItem("vpn.example.com")).toBe("vpn.example.com");
    expect(normalizeListItem("")).toBe("");
  });
});

describe("daily cron wiring for the blocklist check", () => {
  const scheduled = (cron: string, env: Env) =>
    worker.scheduled({ cron } as ScheduledController, env);

  it("runs it on the daily cron", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    const { urls } = cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24"]) });
    const { env, sent } = checkEnv(db);

    await scheduled("47 3 * * *", env);

    expect(urls.length).toBe(2);
    expect(sent).toHaveLength(0);
  });

  it("never runs it on the every-minute probe cron", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    const { fn } = cfFetch({ lists: listsWith([]), items: itemsWith([]) });
    const { env } = checkEnv(db);

    await scheduled("* * * * *", env);

    expect(fn).not.toHaveBeenCalled();
  });

  it("is part of runDailyChecks together with the worker_runs step", async () => {
    const { db } = fakeDb({ active: ["58.222.33.0/24"] });
    cfFetch({ lists: listsWith([]), items: itemsWith(["58.222.33.0/24"]) });
    const { env, sent } = checkEnv(db);

    const result = await runDailyChecks(env, NOW);

    expect(result.blocklist).toEqual({ ok: true, issues: 0, alerted: false });
    expect(result.runs.ok).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
