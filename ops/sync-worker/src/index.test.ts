/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Basic sync-worker diff calculation and dry-run tests (tasks/10). */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker, {
  authorized,
  diffSync,
  fetchWithTimeout,
  health,
  normalizeListItem,
  runSync,
  sync,
  waitOperation,
} from "./index";
import type { RunRow } from "./runlog";

// scheduled is a method on the default export; extracting it makes the test read more like a cron invocation.
const scheduled = worker.scheduled;

const envWith = (token: string) => ({ SYNC_TOKEN: token }) as never;
const reqWith = (auth?: string) =>
  new Request("https://comicine-blocklist-sync.comicine.workers.dev/", {
    headers: auth ? { Authorization: auth } : {},
  });

describe("sync-worker", () => {
  it("computes add/remove diff", () => {
    const result = diffSync(
      new Set(["1.2.3.0/24", "2001:db8::/64"]),
      new Map([
        ["1.2.3.0/24", "item-1"],
        ["4.5.6.0/24", "item-2"],
      ]),
    );
    expect(result.toAdd).toContain("2001:db8::/64");
    expect(result.toRemove).toContain("4.5.6.0/24");
    expect(result.toAdd).not.toContain("1.2.3.0/24");
  });

  it("skips without credentials", async () => {
    const env = {
      DB: { prepare: () => ({ all: async () => ({ results: [], success: true }) }) },
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
    } as never;
    const result = await sync(env);
    expect(result).toEqual({ toAdd: [], toRemove: [] });
  });
});

/**
 * Regression (verified 2026-09-21): Cloudflare IP List normalizes /32 entries to bare IPs
 * (write 1.2.3.4/32, read back 1.2.3.4). Comparing the raw strings puts the same record
 * in both toAdd and toRemove, causing it to be repeatedly deleted and re-added on every sync.
 */
describe("normalizeListItem", () => {
  it("normalises IPv4 /32 and IPv6 /128 to a bare IP", () => {
    expect(normalizeListItem("1.2.3.4/32")).toBe("1.2.3.4");
    expect(normalizeListItem("2001:db8::1/128")).toBe("2001:db8::1");
  });

  it("keeps real network prefixes; bare IPs pass through", () => {
    expect(normalizeListItem("1.2.3.0/24")).toBe("1.2.3.0/24");
    expect(normalizeListItem("2001:db8::/64")).toBe("2001:db8::/64");
    expect(normalizeListItem("1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("diffSync and /32 normalisation", () => {
  it("does not re-add an existing /32", () => {
    // D1 stores /32 while Cloudflare stores a bare IP; before the fix, this appeared in both toAdd and toRemove.
    const result = diffSync(
      new Set(["1.2.3.4/32", "5.6.7.0/24"]),
      new Map([
        ["1.2.3.4", "id1"],
        ["9.9.9.9", "id2"],
      ]),
    );
    expect(result.toAdd).toEqual(["5.6.7.0/24"]);
    expect(result.toRemove).toEqual(["9.9.9.9"]);
  });

  it("no-op when both sides agree (idempotent)", () => {
    const result = diffSync(new Set(["1.2.3.4/32"]), new Map([["1.2.3.4", "id1"]]));
    expect(result.toAdd).toEqual([]);
    expect(result.toRemove).toEqual([]);
  });

  it("a record never appears in both toAdd and toRemove", () => {
    const result = diffSync(new Set(["1.2.3.4/32"]), new Map([["1.2.3.4", "id1"]]));
    const overlap = result.toAdd.filter((ip) => result.toRemove.includes(ip));
    expect(overlap).toEqual([]);
  });
});

/**
 * Authentication for the manual trigger endpoint (workers.dev cannot use zone-level mTLS, so a shared secret is used).
 * Key behavior: fail closed when SYNC_TOKEN is unset.
 */
describe("authorized", () => {
  it("allows a correct token", () => {
    expect(authorized(reqWith("Bearer s3cret-token"), envWith("s3cret-token"))).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    expect(authorized(reqWith(), envWith("s3cret-token"))).toBe(false);
  });

  it("rejects a wrong or wrong-length token", () => {
    expect(authorized(reqWith("Bearer wrong"), envWith("s3cret-token"))).toBe(false);
    expect(authorized(reqWith("Bearer s3cret-toke"), envWith("s3cret-token"))).toBe(false);
    expect(authorized(reqWith("Bearer s3cret-tokenX"), envWith("s3cret-token"))).toBe(false);
  });

  it("rejects a missing Bearer prefix", () => {
    expect(authorized(reqWith("s3cret-token"), envWith("s3cret-token"))).toBe(false);
  });

  it("fails closed when SYNC_TOKEN is unset", () => {
    expect(authorized(reqWith("Bearer anything"), envWith(""))).toBe(false);
    expect(authorized(reqWith("Bearer "), envWith(""))).toBe(false);
    expect(authorized(reqWith("Bearer undefined"), { SYNC_TOKEN: undefined } as never)).toBe(false);
  });
});

/**
 * tasks/22 W7-6 / W7-7: bulk operation failures must throw, and pagination must use a cursor with a limit.
 *
 * These tests stub fetch and never access Cloudflare; they verify only sync() control flow.
 */
const LIST_ID = "list-1";
const API = "https://api.cloudflare.com/client/v4";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const syncEnv = (cidrs: string[]) =>
  ({
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "account",
    DB: {
      prepare: () => ({
        all: async () => ({ results: cidrs.map((cidr) => ({ cidr })), success: true }),
      }),
    },
  }) as never;

interface StubCall {
  method: string;
  url: string;
}

/** Record each request; the handler determines the response. Return a Response to control the status. */
function stubFetch(
  handler: (call: StubCall) => unknown,
): StubCall[] {
  const calls: StubCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = { method: (init?.method ?? "GET").toUpperCase(), url: String(input) };
      calls.push(call);
      const result = handler(call);
      return result instanceof Response ? result : json(result);
    }),
  );
  return calls;
}

/**
 * fetch that never settles until its AbortSignal fires, for timeout tests.
 * Return the accessor for the number of attempts so a test can prove GET retried only once.
 */
function stubHungFetch(): () => number {
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      attempts += 1;
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    }),
  );
  return () => attempts;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("waitOperation failures (W7-6)", () => {
  it("rejects when the bulk operation reports failed", async () => {
    stubFetch(({ url }) => {
      if (url.includes("/rules/lists?per_page=")) return { result: [{ name: "comicine_blocklist", id: LIST_ID }] };
      if (url.includes("/items?") && url.includes("cursor=") === false)
        return { result: [], result_info: {} };
      if (url.includes("/items")) return { result: { operation_id: "op-add" } };
      if (url.includes("/bulk_operations/op-add")) return { result: { status: "failed" } };
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/op-add.*failed|failed/);
  });

  it("returns normally when the bulk operation completes", async () => {
    const calls = stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) return { result: [{ name: "comicine_blocklist", id: LIST_ID }] };
      if (url.includes("/items") && method === "GET") return { result: [], result_info: {} };
      if (url.includes("/items") && method === "POST") return { result: { operation_id: "op-add" } };
      if (url.includes("/bulk_operations/op-add")) return { result: { status: "completed" } };
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).resolves.toEqual({
      toAdd: ["1.2.3.0/24"],
      toRemove: [],
    });
    expect(calls.some((c) => c.url.includes("/bulk_operations/op-add"))).toBe(true);
  });

  it("rejects when the bulk operation never finishes", async () => {
    vi.useFakeTimers();
    stubFetch(({ url }) => {
      if (url.includes("/rules/lists?per_page=")) return { result: [{ name: "comicine_blocklist", id: LIST_ID }] };
      if (url.includes("/items") && url.includes("operation") === false && url.endsWith("per_page=500"))
        return { result: [], result_info: {} };
      if (url.endsWith("/items")) return { result: { operation_id: "op-slow" } };
      if (url.includes("/bulk_operations/op-slow")) return { result: { status: "pending" } };
      throw new Error(`unexpected request: ${url}`);
    });

    const pending = expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/did not finish/);
    await vi.advanceTimersByTimeAsync(120_000);
    await pending;
  });
});

describe("cursor pagination (W7-7)", () => {
  const listResp = { result: [{ name: "comicine_blocklist", id: LIST_ID }] };

  it("follows result_info.cursor and never sends page=", async () => {
    const calls = stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) return listResp;
      if (method === "GET" && url.includes("/items?per_page=500") && !url.includes("cursor=")) {
        return { result: [{ ip: "1.2.3.0/24", id: "i1" }], result_info: { cursor: "cursor-2" } };
      }
      if (method === "GET" && url.includes("cursor=cursor-2")) {
        return { result: [{ ip: "4.5.6.0/24", id: "i2" }], result_info: {} };
      }
      if (method === "POST" && url.endsWith("/items")) return { result: { operation_id: "op-add" } };
      if (method === "DELETE" && url.endsWith("/items")) return { result: { operation_id: "op-del" } };
      if (url.includes("/bulk_operations/")) return { result: { status: "completed" } };
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    const result = await sync(syncEnv(["1.2.3.0/24", "9.9.9.9"]), {});

    // The 4.5.6.0/24 entry on page two must be seen; otherwise it would be added again and not removed.
    expect(result.toAdd).toEqual(["9.9.9.9"]);
    expect(result.toRemove).toEqual(["4.5.6.0/24"]);
    expect(calls.some((c) => c.url.includes("cursor=cursor-2"))).toBe(true);
    // Do not confuse `per_page=` with `page=`; this asserts that the page parameter is truly absent.
    expect(calls.some((c) => /[?&]page=/.test(c.url))).toBe(false);
  });

  it("refuses to loop forever when the upstream keeps handing out cursors", async () => {
    let page = 0;
    const calls = stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) return listResp;
      if (method === "GET" && url.includes("/items")) {
        page += 1;
        return { result: [{ ip: `10.0.0.${page}/32`, id: `i${page}` }], result_info: { cursor: `c${page}` } };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/refusing to loop forever/);
    expect(calls.filter((c) => c.url.includes("/items")).length).toBeLessThanOrEqual(21);
  });

  it("throws when the upstream echoes the same cursor back", async () => {
    stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) return listResp;
      if (method === "GET" && url.includes("/items")) {
        return { result: [{ ip: "1.2.3.0/24", id: "i1" }], result_info: { cursor: "same" } };
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/cursor did not advance/);
  });
});

/**
 * Failure visibility (2026-10-11): replace manually searching Workers logs for sync failures with
 * 1. a worker_runs row, 2. structured single-line JSON from scheduled, and 3. a `?health=1` lookup.
 *
 * These tests stub fetch and DB; they do not access Cloudflare or a real D1 database.
 */
interface RunCall {
  sql: string;
  values: unknown[];
}

const mockRunDb = () => {
  const calls: RunCall[] = [];
  let nextId = 1;
  let latest: Record<string, unknown> | undefined;
  const db = {
    prepare(sql: string) {
      const call: RunCall = { sql, values: [] };
      calls.push(call);
      // sync() uses `prepare(sql).all()` (without bind), while runlog uses `prepare(sql).bind(...).all()`
      // and `.run()`; both shapes are required or the stub will reject valid call signatures.
      return {
        all: async () => {
          if (/INSERT INTO worker_runs/.test(sql)) return { results: [{ id: nextId++ }], success: true };
          if (/FROM worker_runs/.test(sql)) return { results: latest ? [{ ...latest }] : [], success: true };
          if (/FROM blocked_ips/.test(sql)) return { results: [{ cidr: "1.2.3.0/24" }], success: true };
          return { results: [], success: true };
        },
        bind(...values: unknown[]) {
          call.values = values;
          return {
            all: async () => {
              if (/INSERT INTO worker_runs/.test(sql)) return { results: [{ id: nextId++ }], success: true };
              if (/FROM worker_runs/.test(sql)) return { results: latest ? [{ ...latest }] : [], success: true };
              if (/FROM blocked_ips/.test(sql)) return { results: [{ cidr: "1.2.3.0/24" }], success: true };
              return { results: [], success: true };
            },
            run: async () => {
              if (/UPDATE worker_runs/.test(sql)) {
                const [finished_at, outcome, added, removed, error, dry_run, id] = call.values;
                latest = { id, job: "blocklist_sync", finished_at, outcome, added, removed, error, dry_run };
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { db, calls };
};

const captureConsole = () => {
  const logs: string[] = [];
  const errors: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  return { logs, errors };
};

/** CF calls succeed in order and throw starting at failAfter; return the list of URLs accessed. */
function stubCfFailAfter(failAfter: number): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (urls.length > failAfter) throw new Error("CF API 500 (simulated upstream failure)");
      if (String(input).includes("/rules/lists?per_page=")) {
        return json({ result: [{ name: "comicine_blocklist", id: LIST_ID }] });
      }
      return json({ result: [], result_info: {} });
    }),
  );
  return urls;
}

const fetchEnv = (parts: ReturnType<typeof mockRunDb>, syncToken = "s3cret-token") =>
  ({
    DB: parts.db,
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "account",
    SYNC_TOKEN: syncToken,
  }) as never;

/**
 * Timeout, retry and sync-deadline behavior.
 *
 * A hung Cloudflare API request must fail the run instead of leaving worker_runs at 'running'.
 * Retries are allowed only for GETs; POST/DELETE must run exactly once (they are not idempotent).
 */
describe("fetch timeout and retry budget", () => {
  it("aborts a hung fetch at exactly 10s and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      }),
    );

    let error: unknown;
    const pending = fetchWithTimeout(
      "https://api.cloudflare.com/client/v4/test",
      { method: "GET" },
    ).catch((reason) => {
      error = reason;
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(error).toBeUndefined();
    expect(signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /^CF API timeout after 10000ms: GET https:\/\/api\.cloudflare\.com\/client\/v4\/test$/,
    );
    // clearTimeout in finally: a leftover timer would keep the Worker isolate alive.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records outcome=failed with a timeout error when a GET hangs until abort", async () => {
    vi.useFakeTimers();
    const parts = mockRunDb();
    const { errors } = captureConsole();
    const attempts = stubHungFetch();

    const pending = expect(runSync(fetchEnv(parts))).rejects.toThrow(/timeout/);
    // First attempt times out at 10s, the retry starts at 10.5s and times out at 20.5s.
    await vi.advanceTimersByTimeAsync(21_000);
    await pending;

    expect(attempts()).toBe(2);
    const update = parts.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.values[1]).toBe("failed");
    expect(String(update!.values[4])).toMatch(/timeout/);
    const failedLine = errors.find((l) => l.includes('"outcome":"failed"'));
    expect(failedLine).toBeDefined();
    expect(JSON.parse(failedLine!)).toMatchObject({ outcome: "failed" });
  });

  it("retries a GET once after 503 and then succeeds", async () => {
    vi.useFakeTimers();
    let listAttempts = 0;
    const calls = stubFetch(({ url }) => {
      if (url.includes("/rules/lists?per_page=")) {
        listAttempts += 1;
        if (listAttempts === 1) return new Response("unavailable", { status: 503 });
        return { result: [] };
      }
      throw new Error(`unexpected request: ${url}`);
    });

    // Dry run stops after the list lookup, so this GET is the only request in the test:
    // exactly one transient 503 plus one successful retry.
    const pending = expect(sync(syncEnv(["1.2.3.0/24"]), { dryRun: true })).resolves.toEqual({
      toAdd: ["1.2.3.0/24"],
      toRemove: [],
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;

    expect(listAttempts).toBe(2);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a GET that returns 404", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.includes("/rules/lists?per_page=")) return new Response("not found", { status: 404 });
      throw new Error(`unexpected request: ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/CF API 404/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry the POST that creates the list", async () => {
    const calls = stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) return { result: [] };
      if (method === "POST" && url.endsWith("/rules/lists")) {
        return new Response("upstream error", { status: 500 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/CF API 500/);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("does not retry a DELETE that returns 500", async () => {
    const calls = stubFetch(({ method, url }) => {
      if (url.includes("/rules/lists?per_page=")) {
        return { result: [{ name: "comicine_blocklist", id: LIST_ID }] };
      }
      if (method === "GET" && url.includes("/items")) {
        return { result: [{ ip: "4.5.6.0/24", id: "i1" }], result_info: {} };
      }
      if (method === "POST" && url.endsWith("/items")) return { result: { operation_id: "op-add" } };
      if (url.includes("/bulk_operations/op-add")) return { result: { status: "completed" } };
      if (method === "DELETE" && url.endsWith("/items")) {
        return new Response("upstream error", { status: 500 });
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    });

    await expect(sync(syncEnv(["1.2.3.0/24"]), {})).rejects.toThrow(/CF API 500/);
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/items"))).toHaveLength(1);
  });

  it("waitOperation throws on a near-future deadline after exactly one poll", async () => {
    vi.useFakeTimers();
    const calls = stubFetch(({ url }) => {
      if (url.includes("/bulk_operations/op-slow")) return { result: { status: "pending" } };
      throw new Error(`unexpected request: ${url}`);
    });

    const pending = expect(
      waitOperation("token", "account", "op-slow", Date.now() + 1),
    ).rejects.toThrow(/deadline/);
    await vi.advanceTimersByTimeAsync(100);
    await pending;

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/bulk_operations/op-slow");
  });
});

describe("run history records every run", () => {
  it("writes outcome=failed with the error text when the sync throws", async () => {
    const parts = mockRunDb();
    const { errors } = captureConsole();
    stubCfFailAfter(1);

    await expect(runSync(fetchEnv(parts))).rejects.toThrow(/simulated upstream failure/);

    const update = parts.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update).toBeDefined();
    expect(update!.values[1]).toBe("failed");
    expect(String(update!.values[4])).toMatch(/simulated upstream failure/);
    // The failure must also appear in Workers logs as searchable single-line JSON.
    const failedLine = errors.find((l) => l.includes('"outcome":"failed"'));
    expect(failedLine).toBeDefined();
    const parsed = JSON.parse(failedLine!);
    expect(parsed.event).toBe("blocklist_sync");
    expect(parsed.error).toMatch(/simulated upstream failure/);
  });

  it("writes outcome=ok with the added/removed counts on success", async () => {
    const parts = mockRunDb();
    captureConsole();
    stubCfFailAfter(99);

    const result = await runSync(fetchEnv(parts));

    expect(result.toAdd).toEqual(["1.2.3.0/24"]);
    const insert = parts.calls.find((c) => /INSERT INTO worker_runs/.test(c.sql));
    expect(insert).toBeDefined();
    expect(insert!.values[0]).toBe("blocklist_sync");
    const update = parts.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update!.values[1]).toBe("ok");
    expect(update!.values[2]).toBe(1);
    expect(update!.values[3]).toBe(0);
  });

  it("fails open when the run record cannot be written", async () => {
    const { errors } = captureConsole();
    stubCfFailAfter(99);
    const brokenDb = {
      prepare(sql: string) {
        const rows = async () =>
          /worker_runs/.test(sql)
            ? Promise.reject(new Error("no such table: worker_runs"))
            : { results: [{ cidr: "1.2.3.0/24" }], success: true };
        return {
          all: rows,
          bind: () => ({
            all: rows,
            run: async () => {
              throw new Error("no such table: worker_runs");
            },
          }),
        };
      },
    };
    const env = {
      DB: brokenDb,
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account",
      SYNC_TOKEN: "s3cret-token",
    } as never;

    // A bookkeeping failure must not break the sync itself.
    await expect(runSync(env)).resolves.toMatchObject({ runId: null });
    expect(errors.some((l) => l.includes("worker_run_store_error"))).toBe(true);
  });

  it("marks a dry run as dry_run=1 so it cannot be mistaken for a real sync", async () => {
    const parts = mockRunDb();
    captureConsole();
    stubCfFailAfter(99);

    await runSync(fetchEnv(parts), { dryRun: true });

    const update = parts.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update!.values[1]).toBe("ok");
    expect(update!.values[5]).toBe(1);
  });

  it("records dry_run=0 for a real sync", async () => {
    const parts = mockRunDb();
    captureConsole();
    stubCfFailAfter(99);

    await runSync(fetchEnv(parts), {});

    const update = parts.calls.find((c) => /UPDATE worker_runs/.test(c.sql));
    expect(update!.values[1]).toBe("ok");
    expect(update!.values[5]).toBe(0);
  });

  it("the scheduled handler records and logs a failure instead of swallowing it", async () => {
    const parts = mockRunDb();
    const { errors } = captureConsole();
    stubCfFailAfter(1);
    const waited: Promise<unknown>[] = [];

    await scheduled({}, fetchEnv(parts), { waitUntil: (p) => waited.push(p) });

    expect(parts.calls.some((c) => /UPDATE worker_runs/.test(c.sql) && c.values[1] === "failed")).toBe(true);
    expect(errors.some((l) => l.includes('"outcome":"failed"'))).toBe(true);
    expect(waited).toHaveLength(1);
    // scheduled's final log row must include stage="scheduled". Otherwise, reverting the catch to
    // silently swallowing errors would leave the runSync log intact and this test would miss the regression.
    const scheduledLine = errors
      .map((l) => JSON.parse(l))
      .find((line) => line.stage === "scheduled");
    expect(scheduledLine).toMatchObject({ event: "blocklist_sync", outcome: "failed" });
    expect(scheduledLine.error).toMatch(/simulated upstream failure/);
  });
});

describe("health endpoint", () => {
  it("requires SYNC_TOKEN (401 without it, even for the health shape)", async () => {
    const parts = mockRunDb();
    const unauth = await worker.fetch(new Request("https://sync.example.com/?health=1"), fetchEnv(parts));
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ ok: false, error: "unauthorized" });
    // Fail closed: do not allow even the health endpoint when SYNC_TOKEN is unset.
    const noSecret = await worker.fetch(new Request("https://sync.example.com/?health=1"), fetchEnv(parts, ""));
    expect(noSecret.status).toBe(401);
  });

  it("returns ok + lastRun for an authorized caller and does not sync", async () => {
    const parts = mockRunDb();
    captureConsole();
    const urls = stubCfFailAfter(99);
    await runSync(fetchEnv(parts));
    urls.length = 0;

    const resp = await worker.fetch(
      new Request("https://sync.example.com/?health=1", { headers: { Authorization: "Bearer s3cret-token" } }),
      fetchEnv(parts),
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.job).toBe("blocklist_sync");
    expect(body.lastRun).toMatchObject({ job: "blocklist_sync", outcome: "ok", added: 1, removed: 0 });
    // The health endpoint only reports status and must never trigger a sync or call the Cloudflare API.
    expect(urls).toEqual([]);
  });

  it("keeps the manual trigger shape (ok + toAdd/toRemove) and adds runId", async () => {
    const parts = mockRunDb();
    captureConsole();
    stubCfFailAfter(99);

    const resp = await worker.fetch(
      new Request("https://sync.example.com/", { headers: { Authorization: "Bearer s3cret-token" } }),
      fetchEnv(parts),
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.toAdd).toEqual(["1.2.3.0/24"]);
    expect(body.toRemove).toEqual([]);
    expect(body.lastRun).toMatchObject({ outcome: "ok" });
  });

  it("reports a skipped run instead of synced:true when credentials are missing", async () => {
    const parts = mockRunDb();
    captureConsole();
    const env = {
      DB: parts.db,
      CLOUDFLARE_API_TOKEN: "",
      CLOUDFLARE_ACCOUNT_ID: "",
      SYNC_TOKEN: "s3cret-token",
    } as never;

    const resp = await worker.fetch(
      new Request("https://sync.example.com/", { headers: { Authorization: "Bearer s3cret-token" } }),
      env,
    );

    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("skipped");
    expect(body.synced).toBe(false);
  });

  it("reports a failed manual trigger as 502 with the error and the recorded run", async () => {
    const parts = mockRunDb();
    captureConsole();
    stubCfFailAfter(1);

    const resp = await worker.fetch(
      new Request("https://sync.example.com/", { headers: { Authorization: "Bearer s3cret-token" } }),
      fetchEnv(parts),
    );

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/simulated upstream failure/);
    expect(body.lastRun).toMatchObject({ outcome: "failed" });
  });
});

/**
 * Health's last-success metrics (task 16): a later failure must not erase the last good timestamp,
 * and a ?dry-run=1 run (outcome='ok' but no Cloudflare writes) must not reset the lag metric.
 *
 * The stub answers differently for the two health queries: the latest run and the latest ok,
 * non-dry-run run, so the tests prove the query filters rather than just the response mapping.
 */
function stubHealthDb(runs: RunRow[], options: { fail?: boolean } = {}) {
  const queries: string[] = [];
  const db = {
    prepare(sql: string) {
      queries.push(sql);
      return {
        bind: () => ({
          all: async () => {
            if (options.fail) throw new Error("no such table: worker_runs");
            if (/outcome = 'ok'/.test(sql) && /dry_run = 0/.test(sql)) {
              const row = [...runs]
                .filter((run) => run.outcome === "ok" && run.dry_run === 0)
                .sort((a, b) => b.started_at - a.started_at)[0];
              return {
                results: row ? [{ started_at: row.started_at, finished_at: row.finished_at }] : [],
                success: true,
              };
            }
            if (/FROM worker_runs/.test(sql)) {
              const latest = [...runs].sort(
                (a, b) => b.started_at - a.started_at || b.id - a.id,
              )[0];
              return { results: latest ? [latest] : [], success: true };
            }
            return { results: [], success: true };
          },
          run: async () => ({ success: true }),
        }),
      };
    },
  };
  return { db, queries };
}

const healthRow = (overrides: Partial<RunRow>): RunRow => ({
  id: 1,
  job: "blocklist_sync",
  started_at: 1_699_999_000,
  finished_at: 1_699_999_700,
  outcome: "ok",
  added: 0,
  removed: 0,
  error: null,
  dry_run: 0,
  ...overrides,
});

describe("health last-success metrics", () => {
  it("computes last_success_at and lag_seconds from the latest ok run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { db } = stubHealthDb([healthRow({})]);

    const body = await health({ DB: db } as never);

    expect(body.ok).toBe(true);
    expect(body.job).toBe("blocklist_sync");
    expect(body.lastRun).toMatchObject({ id: 1, outcome: "ok" });
    expect(body.last_success_at).toBe(1_699_999_700);
    expect(body.lag_seconds).toBe(300);
  });

  it("keeps the last ok timestamp when the latest run failed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { db } = stubHealthDb([
      healthRow({ id: 1, started_at: 1_699_999_000, finished_at: 1_699_999_700 }),
      healthRow({
        id: 2,
        outcome: "failed",
        error: "boom",
        started_at: 1_699_999_800,
        finished_at: 1_699_999_900,
      }),
    ]);

    const body = await health({ DB: db } as never);

    expect(body.lastRun).toMatchObject({ id: 2, outcome: "failed", error: "boom" });
    expect(body.last_success_at).toBe(1_699_999_700);
    expect(body.lag_seconds).toBe(300);
  });

  it("falls back to started_at when the successful run has no finished_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const { db } = stubHealthDb([
      healthRow({ id: 1, started_at: 1_699_999_800, finished_at: null }),
    ]);

    const body = await health({ DB: db } as never);

    expect(body.last_success_at).toBe(1_699_999_800);
    expect(body.lag_seconds).toBe(200);
  });

  it("returns null metrics when no run succeeded and when no record exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const failedOnly = stubHealthDb([
      healthRow({ id: 1, outcome: "failed", started_at: 1_699_999_000, finished_at: 1_699_999_700 }),
    ]);
    const failedBody = await health({ DB: failedOnly.db } as never);
    expect(failedBody.lastRun).toMatchObject({ outcome: "failed" });
    expect(failedBody.last_success_at).toBeNull();
    expect(failedBody.lag_seconds).toBeNull();

    const empty = stubHealthDb([]);
    const emptyBody = await health({ DB: empty.db } as never);
    expect(emptyBody).toMatchObject({
      ok: true,
      job: "blocklist_sync",
      lastRun: null,
      last_success_at: null,
      lag_seconds: null,
    });
  });

  it("ignores an ok dry_run=1 run when computing the lag", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const stub = stubHealthDb([
      healthRow({ id: 3, dry_run: 1, started_at: 1_699_999_900, finished_at: 1_699_999_950 }),
    ]);

    const body = await health({ DB: stub.db } as never);

    expect(body.lastRun).toMatchObject({ outcome: "ok", dry_run: 1 });
    expect(body.last_success_at).toBeNull();
    expect(body.lag_seconds).toBeNull();
    // A dry run must not reset the metric, so the read has to filter it out explicitly.
    expect(stub.queries.some((sql) => /outcome = 'ok'/.test(sql) && /dry_run = 0/.test(sql))).toBe(true);
  });

  it("fails open with null metrics when the run table cannot be read", async () => {
    const stub = stubHealthDb([], { fail: true });

    const body = await health({ DB: stub.db } as never);

    expect(body).toMatchObject({
      ok: true,
      job: "blocklist_sync",
      lastRun: null,
      last_success_at: null,
      lag_seconds: null,
    });
    expect(body.error).toMatch(/no such table/);
  });
});
