/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** CIDR exact-match tests for isBlocked (tasks/10). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKED_LIST_TTL_MS,
  GATE_RENEW_AFTER_SECONDS,
  allCookieValues,
  gateCookieHeaders,
  handleGateDiag,
  handleGateEntry,
  handleVerify,
  isBlocked,
  mintGateCookie,
  readGateCookie,
  renderGatePage,
  resolveGateTrust,
  verifyTurnstile,
} from "./gate";
import type { RequestContext } from "./routing";
import { queryAll } from "./d1";
import { logEvent } from "./logging";
import { BASE_URL, LANG_COOKIE } from "./config";

vi.mock("./d1", () => ({ queryAll: vi.fn() }));
vi.mock("./logging", () => ({ logEvent: vi.fn() }));

const env = { DB: {} } as never;
const request = new Request("https://limooo.cn/");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isBlocked", () => {
  it("ignores spoofed X-ComiCine-Client-* headers and shows the connecting IP", async () => {
    const req = new Request("https://auth.limooo.cn/__gate/diag", {
      headers: {
        "CF-Connecting-IP": "43.108.57.161",
        "X-ComiCine-Client-IP": "203.0.113.9",
        "X-ComiCine-Client-Country": "jp",
      },
    });
    const diag = handleGateDiag({ request: req } as RequestContext);
    expect(await diag.json()).toMatchObject({ ip: "43.108.57.161", country: "—" });
  });

  it("falls back to the connecting IP when no forwarded header is present", async () => {
    const req = new Request("https://auth.limooo.cn/__gate/diag", {
      headers: { "CF-Connecting-IP": "43.108.57.161", "X-ComiCine-Client-IP": "not-an-ip" },
    });
    const diag = handleGateDiag({ request: req } as RequestContext);
    expect(await diag.json()).toMatchObject({ ip: "43.108.57.161", country: "—" });
  });

  it("matches IPv4 /24 with normalized network/prefix", async () => {
    vi.mocked(queryAll).mockResolvedValue([
      { cidr: "1.2.3.0/24", network: "1.2.3.0", prefix: 24 },
    ]);
    expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
    expect(vi.mocked(logEvent)).toHaveBeenCalled();
    const sql = vi.mocked(queryAll).mock.calls[0][1];
    expect(sql).toContain("network = ? AND prefix = ?");
  });

  it("matches IPv6 /64 and exact /32 semantics", async () => {
    vi.mocked(queryAll).mockResolvedValue([
      { cidr: "2001:db8::/64", network: "2001:db8::", prefix: 64 },
    ]);
    expect(await isBlocked(env, request, "2001:db8::1")).toBe(true);
  });

  it("returns false when no row matches and logs nothing", async () => {
    vi.mocked(queryAll).mockResolvedValue([]);
    expect(await isBlocked(env, request, "8.8.8.8")).toBe(false);
    expect(vi.mocked(logEvent)).not.toHaveBeenCalled();
  });
});

describe("handleVerify", () => {
  function verifyContext(request: Request) {
    return {
      request,
      env: {
        TURNSTILE_SECRET: "turnstile-secret",
        GATE_HMAC_KEY: "a".repeat(64),
      },
      next: async () => new Response("next"),
    } as never;
  }

  function verifyRequest(accept: string, token = "token"): Request {
    const form = new FormData();
    form.set("cf-turnstile-response", token);
    form.set("host", "limooo.cn");
    form.set("next", "/services");
    return new Request("https://limooo.cn/__gate/verify", {
      method: "POST",
      headers: { Accept: accept },
      body: form,
    });
  }

  it("issues the gate cookie to fetch clients without a redirect", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, hostname: "limooo.cn" })));

    const resp = await handleVerify(verifyContext(verifyRequest("application/json")));

    expect(resp.status).toBe(204);
    expect(resp.headers.get("Location")).toBeNull();
    expect(resp.headers.get("Set-Cookie")).toContain("__gate=");
    vi.unstubAllGlobals();
  });

  it("keeps verification errors on the current page for fetch clients", async () => {
    const resp = await handleVerify(verifyContext(verifyRequest("application/json", "")));

    expect(resp.status).toBe(403);
    await expect(resp.json()).resolves.toEqual({ ok: false, error: "failed" });
  });

  it("sends non-JavaScript form posts directly back to the requested host", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, hostname: "limooo.cn" })));

    const resp = await handleVerify(verifyContext(verifyRequest("text/html")));

    expect(resp.status).toBe(303);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/services");
    vi.unstubAllGlobals();
  });

  it("fails closed when GATE_HMAC_KEY is missing instead of signing with an empty key", async () => {
// handleVerify previously checked only TURNSTILE_SECRET and would issue a
// __gate cookie signed with an empty key when GATE_HMAC_KEY was missing. The
// middleware runtimeConfigError currently catches this, but the fallback
// entry point must enforce the check itself in case middleware routing is absent.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true, hostname: "limooo.cn" })));
    const resp = await handleVerify({
      request: verifyRequest("application/json"),
      env: { TURNSTILE_SECRET: "turnstile-secret" },
      next: async () => new Response("next"),
    } as never);

    expect(resp.status).toBe(503);
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("passes CF-Connecting-IP to siteverify, ignoring spoofed forwarded headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, hostname: "limooo.cn" }));
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.set("cf-turnstile-response", "token");
    form.set("host", "limooo.cn");
    form.set("next", "/services");
    const request = new Request("https://limooo.cn/__gate/verify", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "CF-Connecting-IP": "43.108.57.161",
        "X-ComiCine-Client-IP": "1.2.3.4",
        "X-ComiCine-Client-Country": "CN",
      },
      body: form,
    });

    await handleVerify(verifyContext(request));

    const body = new URLSearchParams(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.get("remoteip")).toBe("43.108.57.161");
    expect(body.get("remoteip")).not.toBe("1.2.3.4");
    vi.unstubAllGlobals();
  });

  /**
    * W9-16: validate the hostname and action returned by siteverify as defense in depth.
   *
    * If the same sitekey is used on another domain or widget, tokens solved
    * there can also pass our siteverify call. Checking only success would let
    * Cloudflare and the sitekey configuration define who counts as a visitor
    * to this site. Restrict the result to managed hosts here.
   */
  it("rejects a token solved on a host we do not manage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ success: true, hostname: "evil.example", action: "gate" }),
      ),
    );
    const resp = await handleVerify(verifyContext(verifyRequest("application/json")));
    expect(resp.status).toBe(403);
    expect(resp.headers.get("Set-Cookie")).toBeNull();
    expect(await resp.json()).toMatchObject({ ok: false, error: "failed" });
    vi.unstubAllGlobals();
  });

  it("accepts every host the contract manages", async () => {
    for (const hostname of ["limooo.cn", "services.limooo.cn", "visitor.limooo.cn"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json({ success: true, hostname, action: "gate" })),
      );
      const resp = await handleVerify(verifyContext(verifyRequest("application/json")));
      expect(resp.status, hostname).toBe(204);
      vi.unstubAllGlobals();
    }
  });

  it("rejects a token solved for a different widget action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ success: true, hostname: "limooo.cn", action: "newsletter" }),
      ),
    );
    const resp = await handleVerify(verifyContext(verifyRequest("application/json")));
    expect(resp.status).toBe(403);
    vi.unstubAllGlobals();
  });

  it("rejects a siteverify response with no hostname at all", async () => {
// Reject a missing hostname; accepting it would make this defense optional.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })));
    const resp = await handleVerify(verifyContext(verifyRequest("application/json")));
    expect(resp.status).toBe(403);
    vi.unstubAllGlobals();
  });
});

describe("__gate cookie: signature, expiry and renewal", () => {
  const KEY = "k".repeat(64);

  async function mintAt(nowSeconds: number): Promise<string> {
    vi.useFakeTimers();
    vi.setSystemTime(nowSeconds * 1000);
    const header = await mintGateCookie(KEY);
    vi.useRealTimers();
    return header.split(";")[0].split("=").slice(1).join("=");
  }

  it("signs issued+expiry so a valid cookie cannot be extended by rewriting it", async () => {
    const value = await mintAt(1_700_000_000);
    const [issued, expiry, signature] = value.split(".");
// Extending the expiry changes the signed payload and invalidates the cookie.
    const forged = `${issued}.${Number(expiry) + 86400}.${signature}`;
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_100 * 1000);
    await expect(readGateCookie(forged, KEY)).resolves.toMatchObject({ valid: false });
    await expect(readGateCookie(value, KEY)).resolves.toMatchObject({ valid: true });
    vi.useRealTimers();
  });

  it("rejects the legacy two-field cookie format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    await expect(readGateCookie("1700003600.deadbeef", KEY)).resolves.toMatchObject({
      valid: false,
    });
    vi.useRealTimers();
  });

  it("expires exactly one hour after it was issued", async () => {
    const value = await mintAt(1_700_000_000);
    vi.useFakeTimers();
    vi.setSystemTime((1_700_000_000 + 3600 - 5) * 1000);
    await expect(readGateCookie(value, KEY)).resolves.toMatchObject({ valid: true });
    vi.setSystemTime((1_700_000_000 + 3600 + 1) * 1000);
    await expect(readGateCookie(value, KEY)).resolves.toMatchObject({ valid: false });
    vi.useRealTimers();
  });

  it("only asks for renewal once the cookie is 3/4 through its TTL", async () => {
    const value = await mintAt(1_700_000_000);
    vi.useFakeTimers();
// A newly issued cookie is not renewed, avoiding a sliding expiry window.
    vi.setSystemTime((1_700_000_000 + 60) * 1000);
    await expect(readGateCookie(value, KEY)).resolves.toMatchObject({
      valid: true,
      shouldRenew: false,
    });
// Start renewal after three quarters of the TTL have elapsed.
    vi.setSystemTime((1_700_000_000 + GATE_RENEW_AFTER_SECONDS + 1) * 1000);
    await expect(readGateCookie(value, KEY)).resolves.toMatchObject({
      valid: true,
      shouldRenew: true,
    });
    vi.useRealTimers();
  });
});

describe("duplicate __gate names and issue-time cleanup", () => {
  const KEY = "k".repeat(64);

  it("collects every same-named __gate, not just the first", () => {
    const stale = `__gate=1790000000.1790003600.${"a".repeat(64)}`;
    const values = allCookieValues("__gate", `${stale}; __gate=fresh; other=1`);
    expect(values).toEqual([`1790000000.1790003600.${"a".repeat(64)}`, "fresh"]);
  });

  it("clears the legacy host-only scope before writing the domain cookie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const headers = await gateCookieHeaders(KEY);
    vi.useRealTimers();

    expect(headers).toHaveLength(2);
// First, delete the host-only variant. Do not include Domain or it will not be removed.
    expect(headers[0]).toContain("__gate=;");
    expect(headers[0]).toContain("Max-Age=0");
    expect(headers[0]).not.toContain("Domain=");
// Then write the regular one-hour domain cookie.
    expect(headers[1]).toContain("Domain=.limooo.cn");
    expect(headers[1]).toContain("Max-Age=3600");
  });

  it("validation returns a categorised failure reason for diagnostics", async () => {
    const key = "k".repeat(64);
    await expect(readGateCookie(undefined, key)).resolves.toMatchObject({
      valid: false,
      present: false,
      reason: "absent",
    });
    await expect(readGateCookie("only-two.fields", key)).resolves.toMatchObject({
      valid: false,
      reason: "malformed",
    });
    await expect(
      readGateCookie(`1700000000.1700003600.${"b".repeat(64)}`, key),
    ).resolves.toMatchObject({ valid: false, reason: "bad_signature" });
  });
});

/**
 * Process-local blocked_ips cache (tasks/22 increment 1).
 *
 * These cases cover cache hits, reload after TTL expiry, fallback after read
 * failures without amplifying them, isolation between different env.DB
 * bindings, and parity between cached and per-prefix matching. Earlier tests
 * use `env.DB = {}` without prepare(), so the full-list read fails and follows
 * the fallback path; their behavior remains unchanged.
 */
describe("isBlocked blocked_ips cache", () => {
  type Row = { cidr: string; network: string; prefix: number; active?: number };

/** Stub both blocked_ips query shapes, including active filtering, ordering, and limits. */
  function fakeDb(rows: Row[], options: { listReadFails?: boolean } = {}) {
    const counters = { prepare: 0, blocked: 0, listReads: 0 };
    const visible = () => rows.filter((row) => (row.active ?? 1) === 1);
    const db = {
      counters,
      prepare(sql: string) {
        counters.prepare += 1;
        const isList = !sql.includes("(network = ? AND prefix = ?)");
        if (sql.includes("blocked_ips")) counters.blocked += 1;
        const all = async (values: unknown[]) => {
          if (isList) {
            counters.listReads += 1;
            if (options.listReadFails) return { success: false, results: [] };
            return { success: true, results: visible() };
          }
          const out: Row[] = [];
          for (let i = 0; i < values.length; i += 2) {
            const network = String(values[i]);
            const prefix = Number(values[i + 1]);
            for (const row of visible()) {
              if (row.network === network && Number(row.prefix) === prefix) out.push(row);
            }
          }
          return { success: true, results: out.sort((a, b) => b.prefix - a.prefix).slice(0, 1) };
        };
        const stmt = {
          bind: (...values: unknown[]) => ({
            all: () => all(values),
            run: async () => ({ success: true, meta: { changes: 1 } }),
            first: async () => null,
          }),
          all: () => all([]),
          run: async () => ({ success: true, meta: { changes: 1 } }),
          first: async () => null,
        };
        return stmt;
      },
    };
    return db;
  }

/** Route the mocked queryAll through the real stub to cover fallback behavior and preserve bound parameters. */
  function wireQueryAll(db: ReturnType<typeof fakeDb>) {
    vi.mocked(queryAll).mockImplementation(
      async (_db: unknown, sql: string, ...values: unknown[]) => {
        const stmt = db.prepare(sql) as {
          bind(...args: unknown[]): { all(): Promise<{ results: Row[] }> };
        };
        return (await stmt.bind(...values).all()).results;
      },
    );
  }

  const blocking = [{ cidr: "1.2.3.0/24", network: "1.2.3.0", prefix: 24 }];

  it("reads blocked_ips once and answers the next request from memory", async () => {
    const db = fakeDb(blocking);
    wireQueryAll(db);
    const env = { DB: db } as never;

    expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
    expect(await isBlocked(env, request, "1.2.3.10")).toBe(true);

    expect(db.counters.listReads).toBe(1);
// Only the single full-list read ran; no per-prefix query was issued.
    expect(db.counters.blocked).toBe(1);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  it("re-reads after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
      const db = fakeDb(blocking);
      wireQueryAll(db);
      const env = { DB: db } as never;

      expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
      expect(db.counters.listReads).toBe(1);

// Within the TTL, reuse the same read.
      vi.setSystemTime(1_700_000_000_000 + BLOCKED_LIST_TTL_MS - 1);
      expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
      expect(db.counters.listReads).toBe(1);

// After the TTL expires, read again.
      vi.setSystemTime(1_700_000_000_000 + BLOCKED_LIST_TTL_MS);
      expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
      expect(db.counters.listReads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the per-prefix query when the list read fails, and still blocks", async () => {
    const db = fakeDb(blocking, { listReadFails: true });
    wireQueryAll(db);
    const env = { DB: db } as never;

    expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
    expect(vi.mocked(queryAll)).toHaveBeenCalled();
    expect(vi.mocked(logEvent)).toHaveBeenCalled();

// Cache failures too: do not retry the full-list read during the cooldown, or every request will add another failing D1 call.
    expect(await isBlocked(env, request, "1.2.3.9")).toBe(true);
    expect(db.counters.listReads).toBe(1);
  });

  it("does not treat a failed list read as an empty blocklist", async () => {
// Never treat an empty list as authoritative when the driver returns success=false; fall back and keep enforcing blocks.
    const db = fakeDb(blocking, { listReadFails: true });
    wireQueryAll(db);
    expect(await isBlocked({ DB: db } as never, request, "1.2.3.9")).toBe(true);
  });

  it("keeps enforcing the last known list when a re-read fails", async () => {
// This behavior changed on 2026-10-11 to minimize the exposure of fail-open behavior.
    //
// Old behavior: a failed refresh after TTL expiry stored `{ rows: null }`,
// forcing per-prefix queries that could also fail and open the gate. A D1
// disruption therefore disabled all application-level blocking.
// New behavior: **keep the last successfully read list** and continue using it
// when a refresh fails.
    //
// The test must **advance past the TTL** to reach the refresh path. The first
// version did not advance time, so the second call reused the cache and the
// test passed even with the old implementation. Fake timers now advance 61s to
// ensure a refresh actually occurs.
    //
// Do not fail closed literally: every **non-allowlisted visitor** would hit
// the gate during a D1 disruption, and gate verification also reads D1. That
// would turn one transient failure into a site-wide outage. There were eight
// D1-related failures in the last 90 days, so this distinction is practical.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000_000);
// options is mutable; the stub reads it on each all() call.
      const options: { listReadFails?: boolean } = {};
      const db = fakeDb(blocking, options);
      wireQueryAll(db);

// 1) Read successfully once to populate the cache.
      await expect(isBlocked({ DB: db } as never, request, "1.2.3.9")).resolves.toBe(true);
      expect(db.counters.listReads).toBe(1);

// 2) Advance past the TTL and fail both the full-list read and per-prefix fallback.
      vi.setSystemTime(1_700_000_000_000 + BLOCKED_LIST_TTL_MS + 1_000);
      options.listReadFails = true;
      vi.mocked(queryAll).mockRejectedValue(new Error("D1_ERROR: blocked_ips unavailable"));

// 3) Blocking still works from the retained list instead of failing open.
      await expect(isBlocked({ DB: db } as never, request, "1.2.3.9")).resolves.toBe(true);
// Confirm that a refresh really happened; otherwise this case would not cover that path.
      expect(db.counters.listReads).toBe(2);
      expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
// Control: an address outside the list is still allowed; the test did not block everyone.
      await expect(isBlocked({ DB: db } as never, request, "9.9.9.9")).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns false (fail-open) when both the list read and the fallback query throw", async () => {
// Pin the **current behavior**: when D1 throws, isBlocked() returns false
// (allow) rather than 403. This follows gate.ts's documented fail-open
// contract and the empty catch at the end of isBlocked(); application blocking
// yields when the database is unavailable.
    //
// This records current semantics; it does **not** endorse them. Changing to
// fail-closed would fail this test and change production behavior, potentially
// returning 403 site-wide during a D1 disruption. That requires a separate
// decision; see the risk item in tasks/22.
    const db = {
      prepare() {
        throw new Error("D1_ERROR: blocked_ips unavailable");
      },
    };
// Both the full-list read (prepare throws) and per-prefix fallback (queryAll rejects) fail.
    vi.mocked(queryAll).mockRejectedValue(new Error("D1_ERROR: blocked_ips unavailable"));

    await expect(isBlocked({ DB: db } as never, request, "1.2.3.9")).resolves.toBe(false);
// This is an allow decision, not a block match; do not record block_match.
    expect(vi.mocked(logEvent)).not.toHaveBeenCalled();
  });

  it("keeps one cache per DB binding so two environments cannot leak into each other", async () => {
    const blockingDb = fakeDb(blocking);
    const cleanDb = fakeDb([]);
    wireQueryAll(blockingDb);

    expect(await isBlocked({ DB: blockingDb } as never, request, "1.2.3.9")).toBe(true);
// The same IP with a different DB binding must use that binding's empty list, not the previous environment's cache.
    expect(await isBlocked({ DB: cleanDb } as never, request, "1.2.3.9")).toBe(false);
    expect(cleanDb.counters.listReads).toBe(1);
  });

  it("agrees with the per-prefix query path on IPv4/IPv6/boundary and active=0 rows", async () => {
    const table: Row[] = [
      { cidr: "203.0.113.0/24", network: "203.0.113.0", prefix: 24 },
      { cidr: "203.0.113.9/32", network: "203.0.113.9", prefix: 32 },
      { cidr: "198.51.100.0/25", network: "198.51.100.0", prefix: 25 },
      { cidr: "10.0.0.0/8", network: "10.0.0.0", prefix: 8 },
      { cidr: "2001:db8::/32", network: "2001:db8::", prefix: 32 },
      { cidr: "2001:db8:dead:beef::/64", network: "2001:db8:dead:beef::", prefix: 64 },
      { cidr: "2001:db8:dead:beef::1/128", network: "2001:db8:dead:beef::1", prefix: 128 },
// Both query paths must ignore active=0 rows, preserving soft-delete unblocking semantics.
      { cidr: "172.16.0.0/12", network: "172.16.0.0", prefix: 12, active: 0 },
      { cidr: "192.0.2.77/32", network: "192.0.2.77", prefix: 32, active: 0 },
      { cidr: "2001:db9:2::/48", network: "2001:db9:2::", prefix: 48, active: 0 },
    ];
    const ips = [
      "203.0.113.9",
      "203.0.113.10",
      "198.51.100.0",
      "198.51.100.127",
      "198.51.100.128",
      "10.1.2.3",
      "11.0.0.1",
      "172.16.5.5",
      "192.0.2.77",
      "2001:db8::1",
      "2001:db8:dead:beef::1",
      "2001:db8:dead:beef::2",
      "2001:db8:2::1",
      "2001:db9:2::1",
      "2001:db9::1",
      "::1",
      "::ffff:203.0.113.9",
      "not-an-ip",
      "",
    ];

    const verdictsFor = async (listReadFails: boolean) => {
      const db = fakeDb(table, { listReadFails });
      wireQueryAll(db);
      const env = { DB: db } as never;
      const out: Array<[string, boolean, string]> = [];
      for (const ip of ips) {
        vi.mocked(logEvent).mockClear();
        const blocked = await isBlocked(env, request, ip);
        const message = vi.mocked(logEvent).mock.calls[0]?.[3]?.message ?? "";
        out.push([ip, blocked, message]);
      }
      return out;
    };

// Compare the cache path (successful full-list read) with the query path (failed full-list read and legacy fallback).
    const cached = await verdictsFor(false);
    const queried = await verdictsFor(true);

    expect(cached).toEqual(queried);
// Include both matching and allowed addresses so the comparison is meaningful.
    expect(cached.filter(([, blocked]) => blocked).length).toBeGreaterThan(5);
    expect(cached.filter(([, blocked]) => !blocked).length).toBeGreaterThan(3);
// A /32 must take precedence over a matching /24, as in the query path.
    expect(cached.find(([ip]) => ip === "203.0.113.9")?.[2]).toBe("cidr=203.0.113.9/32");
// An active=0 row must never match.
    expect(cached.find(([ip]) => ip === "172.16.5.5")?.[1]).toBe(false);
    expect(cached.find(([ip]) => ip === "192.0.2.77")?.[1]).toBe(false);
    expect(cached.find(([ip]) => ip === "2001:db9:2::1")?.[1]).toBe(false);
// Control: a matching address in an active /32 still matches, proving the entire network was not skipped.
    expect(cached.find(([ip]) => ip === "2001:db8:2::1")?.[1]).toBe(true);
  });

  it("treats a /0 row as a match for its own address family only", async () => {
// Prefix zero exercises the address-family boundary: the cache path uses
// contains and the query path uses networkAddress. Both must match only the
// same address family; earlier cases covered only /8, /24, and /128.
    const rows: Row[] = [
      { cidr: "0.0.0.0/0", network: "0.0.0.0", prefix: 0 },
      { cidr: "::/0", network: "::", prefix: 0 },
    ];
    const matrix: Array<[string, boolean]> = [
      ["8.8.8.8", true],
      ["::1", true],
      ["2001:db8::1", true],
      ["::ffff:8.8.8.8", true],
      ["not-an-ip", false],
      ["", false],
    ];

    const verdictsFor = async (listReadFails: boolean) => {
      const db = fakeDb(rows, { listReadFails });
      wireQueryAll(db);
      const env = { DB: db } as never;
      const out: Array<[string, boolean]> = [];
      for (const ip of matrix.map(([value]) => value)) {
        out.push([ip, await isBlocked(env, request, ip)]);
      }
      return out;
    };

    const cached = await verdictsFor(false);
    expect(cached).toEqual(matrix);
    expect(await verdictsFor(true)).toEqual(cached);
  });
});

/** Gate-page template text cache (tasks/22 increment 3). */
describe("renderGatePage template cache", () => {
  const TEMPLATE = "<html><body>{{host}}|{{next}}|{{error}}</body></html>";

  function assetsEnv() {
    const calls: string[] = [];
    return {
      calls,
      env: {
        ASSETS: {
          fetch: async (input: RequestInfo | URL) => {
            calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
            return new Response(TEMPLATE, { headers: { "Content-Type": "text/html" } });
          },
        },
      } as never,
    };
  }

  function render(env: never, url = "https://limooo.cn/services", cookie?: string) {
    return renderGatePage(
      {
        request: new Request(url, cookie ? { headers: { Cookie: cookie } } : undefined),
        env,
        next: async () => new Response("next"),
      } as never,
      { host: "limooo.cn", next: "/services" },
    );
  }

  it("fetches the template once for repeated renders of the same language", async () => {
    const { env, calls } = assetsEnv();
    const first = await render(env);
    const second = await render(env);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${BASE_URL}/en-us/auth.html`);
    const [a, b] = [await first.text(), await second.text()];
    expect(a).toBe(b);
    expect(a).toContain("limooo.cn|/services|");
  });

  it("keeps one entry per language", async () => {
    const { env, calls } = assetsEnv();
    await render(env, "https://limooo.cn/services", `${LANG_COOKIE}=zh-cn`);
    await render(env, "https://limooo.cn/services", `${LANG_COOKIE}=ja-jp`);

    expect(calls).toEqual([`${BASE_URL}/zh-cn/auth.html`, `${BASE_URL}/ja-jp/auth.html`]);
  });

  it("does not cache a failed template fetch", async () => {
    let calls = 0;
    const env = {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    } as never;

    expect((await render(env)).status).toBe(503);
    expect((await render(env)).status).toBe(503);
    expect(calls).toBe(2);
  });
});

/**
 * Crawler user-agent allowlist (2026-10-12): a match bypasses human
 * verification but **does not receive** a __gate cookie.
 *
 * This is the key requirement: user agents are self-reported. If /gate issued a
 * one-hour signed cookie, claiming to be GPTBot would provide a reusable pass
 * and make the gate ineffective.
 */
describe("resolveGateTrust / handleGateEntry with crawler User-Agents", () => {
  const CRAWLER_UA =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot";
  const BROWSER_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

  function context(request: Request): RequestContext {
    return {
      request,
      env: { GATE_HMAC_KEY: "a".repeat(64) } as never,
      next: async () => new Response("next"),
    };
  }

  it("flags a declared crawler without marking the source trusted", async () => {
    const trust = await resolveGateTrust(
      context(new Request("https://limooo.cn/", { headers: { "User-Agent": CRAWLER_UA } })),
    );

    expect(trust.declaredCrawler).toBe(true);
    expect(trust.crawlerToken).toBe("gptbot");
// Keep trusted false so middleware continues checking blocked_ips (see _middleware.ts).
    expect(trust.trusted).toBe(false);
    expect(trust.cookieValid).toBe(false);
  });

  it("leaves an ordinary browser behind the gate", async () => {
    const trust = await resolveGateTrust(
      context(new Request("https://limooo.cn/", { headers: { "User-Agent": BROWSER_UA } })),
    );

    expect(trust.declaredCrawler).toBe(false);
    expect(trust.crawlerToken).toBe("");
  });

  it("skips the UA list for a whitelisted IP (trusted wins, no crawler token)", async () => {
    const trust = await resolveGateTrust(
      context(
        new Request("https://limooo.cn/", {
          headers: { "CF-Connecting-IP": "97.64.18.11", "User-Agent": CRAWLER_UA },
        }),
      ),
    );

    expect(trust.trusted).toBe(true);
    expect(trust.declaredCrawler).toBe(false);
    expect(trust.crawlerToken).toBe("");
  });

  it("302s a crawler back to its target and mints no cookie", async () => {
    const resp = await handleGateEntry(
      context(
        new Request("https://limooo.cn/gate?host=services.limooo.cn&next=%2F", {
          headers: { "User-Agent": CRAWLER_UA },
        }),
      ),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://services.limooo.cn/");
// Only the language cookie is present; a self-reported user agent cannot obtain a signed session.
    expect(resp.headers.get("Set-Cookie") ?? "").not.toContain("__gate=");
  });

  it("still mints the cookie for a whitelisted IP (unchanged behaviour)", async () => {
    const resp = await handleGateEntry(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2F", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
      ),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Set-Cookie")).toContain("__gate=");
  });
});
