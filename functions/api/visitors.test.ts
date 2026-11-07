/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Tests /api/visitors aggregation, split caching, conditional requests, and status-code compatibility; D1 and authentication are mocked. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  markerParams,
  markerSql,
  onRequestGet,
  statsParams,
  statsSql,
  visitorWindow,
  visitorsIncludeLegacy,
} from "./visitors";
import { queryAll } from "../_lib/d1";
import { requireAuth } from "../_lib/session";
import { CONTRACT } from "../_lib/config";
import type { Env } from "../_lib/env";

vi.mock("../_lib/d1", () => ({ queryAll: vi.fn() }));
vi.mock("../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  // The helper reuses production's denial responses, so it needs the real module, not a copy.
  const actual = await vi.importActual<typeof import("../_lib/session")>("../_lib/session");
  const { createSessionModuleMock } = await import("../../tests/helpers/admin-session");
  return createSessionModuleMock(actual);
});

const env = {} as Env;

function context(request: Request) {
  return {
    request,
    env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-27T00:00:00Z"));
  vi.mocked(requireAuth).mockResolvedValue({ role: "admin" } as never);
});

afterEach(() => {
  vi.useRealTimers();
  // Restore the global stub here rather than at the end of a test: if an assertion fails first,
  // the fake `caches.default` would leak into later test files in the same process. It has been
  // observed to make the page cache in functions/_middleware.test.ts return a fake 403
  // (`expected 403 to be 200`) even though that file passes on its own. This is the anti-pattern identified in audit W5-14.
  vi.unstubAllGlobals();
});

/** In-process Cache API stub: implements only match/put and records put calls; keys use request URLs as in production. */
function cacheUrlOf(request: RequestInfo): string {
  if (typeof request === "string") return request;
  return request instanceof URL ? request.toString() : request.url;
}

function fakeCache() {
  const store = new Map<string, Response>();
  const puts: string[] = [];
  return {
    store,
    puts,
    cache: {
      match: async (request: RequestInfo) => store.get(cacheUrlOf(request))?.clone(),
      put: async (request: RequestInfo, response: Response) => {
        puts.push(cacheUrlOf(request));
        store.set(cacheUrlOf(request), response.clone());
      },
    },
  };
}

const singleRowStats = [{ ips: 1, requests: 2, countries: 1, status_series: "200:2" }];
const singleRowMarkers = [
  { ip_hash: "cached01", country: "US", status: 200, n: 2, last_ts: 1767225600 },
];

describe("visitor window", () => {
  // The marker query keeps the rolling 30x24h cutoff, while the statistics read whole UTC days from
  // visitors_daily and therefore start at the midnight of the day that cutoff falls in.
  it("keeps the rolling marker cutoff and aligns the daily aggregate to UTC midnights", () => {
    const window = visitorWindow(Date.parse("2026-08-27T12:34:56Z"));
    expect(window.todayStart).toBe(Date.parse("2026-08-27T00:00:00Z") / 1000);
    expect(window.cutoff).toBe(Date.parse("2026-08-27T12:34:56Z") / 1000 - 30 * 24 * 60 * 60);
    // The oldest whole day is 30 days before today, which is up to 24 hours older than the cutoff.
    expect(window.dayStart).toBe("2026-07-28");
    expect(window.dayEnd).toBe("2026-08-27");
    expect(Date.parse(`${window.dayStart}T00:00:00Z`) / 1000).toBeLessThan(window.cutoff);
  });
});

describe("visitors SQL builders", () => {
  // tasks/2026-11-07 book 18 (suggestion 20): the legacy visitors_v2 table can be switched off with
  // `visitors_include_legacy`. Both statements must drop it, not just the markers query.
  it("drops visitors_v2 from both statements when the legacy table is disabled", () => {
    expect(statsSql(true)).toContain("visitors_v2");
    expect(statsSql(false)).not.toContain("visitors_v2");
    expect(markerSql(true, "")).toContain("visitors_v2");
    expect(markerSql(false, "")).not.toContain("visitors_v2");
    expect(markerSql(true, " AND status = ?")).toContain("visitors_v2");
    expect(markerSql(false, " AND status = ?")).not.toContain("visitors_v2");
    // Statistics always come from the permanent daily aggregate, never from detail rows.
    expect(statsSql(true)).toContain("visitors_daily");
    expect(statsSql(false)).toContain("visitors_daily");
    // visitors_v2 rows are single requests and have no requests column; the tail must count them as 1.
    const legacyTail = statsSql(true).slice(0, statsSql(true).indexOf("FROM visitors_v2"));
    expect(legacyTail.trimEnd().endsWith("1 AS requests")).toBe(true);
  });

  it("binds window bounds in statement order with and without the legacy table", () => {
    const window = visitorWindow(Date.parse("2026-08-27T00:00:00Z"));
    expect(statsParams(window, true)).toEqual([
      window.todayStart,
      window.todayStart,
      window.dayStart,
      window.dayEnd,
    ]);
    expect(statsParams(window, false)).toEqual([
      window.todayStart,
      window.dayStart,
      window.dayEnd,
    ]);
    // The status value follows each window bound, exactly like the interpolated `AND status = ?`.
    expect(markerParams(window, null, true)).toEqual([window.cutoff, window.cutoff]);
    expect(markerParams(window, null, false)).toEqual([window.cutoff]);
    expect(markerParams(window, 404, true)).toEqual([window.cutoff, 404, window.cutoff, 404]);
    expect(markerParams(window, 404, false)).toEqual([window.cutoff, 404]);
  });

  it("keeps the marker query shape that production was measured against", () => {
    const sqlCode = markerSql(true, "").replace(/--[^\n]*/g, "");
    expect(sqlCode).toContain("LIMIT 500");
    expect(sqlCode).toContain("ORDER BY MAX(v.ts) DESC, v.status");
    expect(sqlCode).not.toContain("MAX(v.country)");
    expect(sqlCode).not.toMatch(/SELECT\s+s2\.country/);
    expect(sqlCode).not.toContain("NOT EXISTS");
    expect(sqlCode).not.toContain("ROW_NUMBER()");
  });
});

/**
 * The generated CONTRACT is `as const`, so TypeScript types the flag as a literal. The object itself
 * is not frozen at runtime, which lets a test exercise both states of the switch.
 */
function setIncludeLegacy(value: boolean): boolean {
  const contract = CONTRACT as unknown as Record<string, unknown>;
  const previous = contract.visitors_include_legacy;
  contract.visitors_include_legacy = value;
  return previous as boolean;
}

describe("visitors API", () => {
  it("returns aggregates, status counts and markers in two D1 queries", async () => {
    const window = visitorWindow(Date.now());
    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        { ips: 2, requests: 4, countries: 1, status_series: "200:3,404:1" },
      ])
      .mockResolvedValueOnce([
        {
          ip_hash: "abc123",
          country: "US",
          status: 200,
          n: 3,
          last_ts: 1767225600,
        },
        {
          ip_hash: "abc123",
          country: "US",
          status: 404,
          n: 1,
          last_ts: 1767312000,
        },
      ]);

    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors")) as never,
    );
    const data = await resp.json();

    expect(resp.status).toBe(200);
    expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queryAll).mock.calls[0][1]).toContain("GROUP_CONCAT");
    expect(vi.mocked(queryAll).mock.calls[0][2]).toBe(window.todayStart);
    expect(vi.mocked(queryAll).mock.calls[0][3]).toBe(window.todayStart);
    expect(vi.mocked(queryAll).mock.calls[0][4]).toBe(window.dayStart);
    expect(vi.mocked(queryAll).mock.calls[0][5]).toBe(window.dayEnd);
    expect(vi.mocked(queryAll).mock.calls[1][1]).toContain("LIMIT 500");
    expect(vi.mocked(queryAll).mock.calls[1][2]).toBe(window.cutoff);
    expect(vi.mocked(queryAll).mock.calls[1][3]).toBe(window.cutoff);

    expect(data.stats.total_requests).toBe(4);
    expect(data.stats.total_ips).toBe(2);
    expect(data.status_counts["200"]).toBe(3);
    expect(data.status_counts["404"]).toBe(1);
    expect(data.markers[0].ip_hash).toBe("abc123");
    expect(data.markers[0].ip).toBeNull();
    expect(data.markers[0].count).toBe(4);
    expect(data.markers[0].last_time).toBe("2026-01-02T00:00:00.000Z");
    expect(data.markers[0].statuses).toEqual({ "200": 3, "404": 1 });
    expect(data.range_days).toBe(30);
    expect(data.max_markers).toBe(500);
  });

  // Regression: the country must come from the most recent visit. The previous MAX(country) implementation
  // selected by alphabetical order ('CN' > 'CH'), regardless of time, so visitors with both values always showed CN.
  //
  // Assert behavior and feed the same two rows in **reverse order** as well. The implementation once depended
  // on mock row order, so a forward-only case would let an incorrect "take the first row" implementation pass.
  //
  it("accumulates markers independently of row order", async () => {
    const rows = [
      // Same visitor: the latest visit is a 404 from CH, and the earlier visit is a 200 from CN.
      { ip_hash: "cnch0001", country: "CH", status: 404, n: 1, last_ts: 1767312000 },
      { ip_hash: "cnch0001", country: "CN", status: 200, n: 2, last_ts: 1767225600 },
    ];
    const markers: Array<Record<string, unknown>> = [];
    for (const order of [rows, [...rows].reverse()]) {
      vi.mocked(queryAll).mockReset();
      vi.mocked(queryAll)
        .mockResolvedValueOnce([
          { ips: 1, requests: 3, countries: 2, status_series: "200:2,404:1" },
        ])
        .mockResolvedValueOnce(order);
      const resp = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      const data = await resp.json();
      markers.push(data.markers[0]);
    }

      // These values do not depend on row order: request count, latest time, and status distribution.
    expect(markers[0].count).toBe(3);
    expect(markers[1].count).toBe(3);
    expect(markers[0].last_time).toBe("2026-01-02T00:00:00.000Z");
    expect(markers[1].last_time).toBe("2026-01-02T00:00:00.000Z");
    expect(markers[0].statuses).toEqual({ "404": 1, "200": 2 });
    expect(markers[1].statuses).toEqual({ "404": 1, "200": 2 });
      // The country from the latest row must be CH in both forward and reverse order.
      // The displayed country must not depend on D1 row order.
    expect(markers[0].country).toBe("CH");
    expect(markers[1].country).toBe("CH");

    const markerSqlText = (
      vi.mocked(queryAll).mock.calls.map((call) => String(call[1]))
    ).find((sql) => sql.includes("LIMIT 500"));
    expect(markerSqlText).toBeTruthy();
  // The SQL comments mention the prohibited alternatives below, so strip comments before asserting;
  // otherwise the test would inspect explanatory text rather than the SQL itself.
    const sqlCode = String(markerSqlText).replace(/--[^\n]*/g, "");
    expect(sqlCode).not.toContain("MAX(v.country)");
  // Disallow more expensive alternatives (measured against production D1; each reads far more than the 131,000-row baseline):
  // correlated subquery: 13.7 million rows; NOT EXISTS: 7.53 million rows; ROW_NUMBER over all partitions: 175,000 rows.
    expect(sqlCode).not.toMatch(/SELECT\s+s2\.country/);
    expect(sqlCode).not.toContain("NOT EXISTS");
    expect(sqlCode).not.toContain("ROW_NUMBER()");
  });

  /**
   * The query historically read about 131,000 rows while legacy details were still in the
   * 30-day window. At a 600-second poll interval, 144 uncached queries at that cost would exceed
   * the 5,000,000-row daily limit. Cache by URL in caches.default for 300 seconds to suppress
   * duplicate requests within a window; the scheduled polls can still miss after the cache expires.
   */
  describe("edge cache", () => {
    it("serves a repeated poll from cache without touching D1 again", async () => {
      const { cache, puts, store } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);

      const first = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      expect(first.status).toBe(200);
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(first.headers.get("Cache-Control")).toBe("private, no-store");
      expect(first.headers.get("ETag")).toMatch(/^W\/"[0-9a-f]{32}"$/);
      // Statistics and markers are independent parts, so a miss writes two entries, one per key.
      expect(puts).toHaveLength(2);
      expect(puts.some((key) => key.includes("__stats=660v2"))).toBe(true);
      expect(puts.some((key) => key.includes("__markers=660v2"))).toBe(true);
      for (const cached of store.values()) {
        expect(cached.headers.get("Cache-Control")).toBe("public, max-age=660");
      }
      // The part tag is internal cache metadata, never a client-visible response header.
      expect(first.headers.get("x-comicine-part-tag")).toBeNull();

      const second = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      const data = await second.json();
      expect(second.headers.get("Cache-Control")).toBe("private, no-store");
      // A cache hit must not query D1 again.
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(data.markers[0].ip_hash).toBe("cached01");
      expect(second.headers.get("ETag")).toBe(first.headers.get("ETag"));
      vi.unstubAllGlobals();
    });

    it("ignores unknown query parameters in the cache key", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);

      await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors?x=1")) as never,
      );
      await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors?x=2")) as never,
      );
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(puts).toHaveLength(2);
      vi.unstubAllGlobals();
    });

    // Suggestion 22: `status` only filters markers. The statistics part must survive a status change,
    // otherwise every deep link to a new status re-runs the 30-day statistics query.
    it("reuses the statistics part for a new status filter", async () => {
      const window = visitorWindow(Date.now());
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers)
        .mockResolvedValueOnce(singleRowMarkers);

      await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors?status=404")) as never,
      );
      await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors?status=200")) as never,
      );

      // One statistics query plus one marker query for each status; the statistics are cached.
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(3);
      const calls = vi.mocked(queryAll).mock.calls;
      expect(String(calls[0][1])).toContain("visitors_daily");
      expect(String(calls[1][1])).toContain("LIMIT 500");
      expect(String(calls[2][1])).toContain("LIMIT 500");
      expect(calls[1][3]).toBe(404);
      expect(calls[2][3]).toBe(200);
      expect(calls[1][2]).toBe(window.cutoff);
      expect(calls[2][2]).toBe(window.cutoff);

      const statsPuts = puts.filter((key) => key.includes("__stats"));
      const markerPuts = puts.filter((key) => key.includes("__markers"));
      expect(statsPuts).toHaveLength(1);
      expect(statsPuts[0]).not.toContain("status=");
      expect(markerPuts).toHaveLength(2);
      expect(markerPuts[0]).not.toBe(markerPuts[1]);
      expect(markerPuts.some((key) => key.includes("status=404"))).toBe(true);
      expect(markerPuts.some((key) => key.includes("status=200"))).toBe(true);
      vi.unstubAllGlobals();
    });

    it("answers 304 without a body when If-None-Match matches", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);

      const first = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      const etag = first.headers.get("ETag");
      expect(etag).toBeTruthy();
      expect(puts).toHaveLength(2);

      const second = await onRequestGet(
        context(
          new Request("https://visitor.comicine.com/api/visitors", {
            headers: { "If-None-Match": etag as string },
          }),
        ) as never,
      );

      expect(second.status).toBe(304);
      expect(await second.text()).toBe("");
      expect(second.headers.get("ETag")).toBe(etag);
      expect(second.headers.get("Cache-Control")).toBe("private, no-store");
      // A 304 is never stored in caches.default and never reads D1 when both parts are cached.
      expect(puts).toHaveLength(2);
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      vi.unstubAllGlobals();
    });

    it("returns a full body when If-None-Match does not match", async () => {
      const { cache } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);

      const resp = await onRequestGet(
        context(
          new Request("https://visitor.comicine.com/api/visitors", {
            headers: { "If-None-Match": 'W/"00000000000000000000000000000000"' },
          }),
        ) as never,
      );
      expect(resp.status).toBe(200);
      expect((await resp.json()).markers[0].ip_hash).toBe("cached01");
      vi.unstubAllGlobals();
    });

    it("does not cache an unauthorized response", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(requireAuth).mockResolvedValue(null as never);
      const resp = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      expect(resp.status).toBe(401);
      expect(puts).toHaveLength(0);
      vi.unstubAllGlobals();
    });

    it("still works when the Cache API is unavailable", async () => {
      vi.stubGlobal("caches", undefined);
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);
      const resp = await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors")) as never,
      );
      expect(resp.status).toBe(200);
      vi.unstubAllGlobals();
    });

    it("falls back to D1 when cache reads and writes fail", async () => {
      const cache = {
        match: vi.fn(async () => {
          throw new Error("cache read failed");
        }),
        put: vi.fn(async () => {
          throw new Error("cache write failed");
        }),
      };
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);
      const requestContext = context(new Request("https://visitor.comicine.com/api/visitors"));

      const response = await onRequestGet(requestContext as never);
      const cacheWrite = requestContext.waitUntil.mock.calls[0]?.[0] as Promise<void>;

      expect(response.status).toBe(200);
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(cache.match).toHaveBeenCalledTimes(2);
      expect(cache.put).toHaveBeenCalledTimes(2);
      await expect(cacheWrite).resolves.toBeUndefined();
    });
  });

  it("keeps the status filter compatible and applies the same 30-day window", async () => {
    const window = visitorWindow(Date.now());
    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        { ips: 1, requests: 1, countries: 0, status_series: "404:1" },
      ])
      .mockResolvedValueOnce([
        {
          ip_hash: "def456",
          country: "",
          status: 404,
          n: 1,
          last_ts: 1767225600,
        },
      ]);

    await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors?status=404")) as never,
    );

    const markerSqlText = vi.mocked(queryAll).mock.calls[1][1] as string;
    expect(markerSqlText).toContain("status = ?");
    expect(vi.mocked(queryAll).mock.calls[1][2]).toBe(window.cutoff);
    expect(vi.mocked(queryAll).mock.calls[1][3]).toBe(404);
    expect(vi.mocked(queryAll).mock.calls[1][4]).toBe(window.cutoff);
    expect(vi.mocked(queryAll).mock.calls[1][5]).toBe(404);
  });

  // tasks/2026-11-07 book 18 (suggestion 20): once the legacy table is empty, a deployment flips
  // `visitors_include_legacy` off. Both statements must stop touching visitors_v2 and drop its bind values.
  it("stops reading visitors_v2 when the contract disables the legacy table", async () => {
    const original = setIncludeLegacy(false);
    try {
      const window = visitorWindow(Date.now());
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);
      await onRequestGet(
        context(new Request("https://visitor.comicine.com/api/visitors?status=200")) as never,
      );

      const calls = vi.mocked(queryAll).mock.calls;
      expect(String(calls[0][1])).not.toContain("visitors_v2");
      expect(String(calls[1][1])).not.toContain("visitors_v2");
      expect(calls[0].slice(2)).toEqual([window.todayStart, window.dayStart, window.dayEnd]);
      expect(calls[1].slice(2)).toEqual([window.cutoff, 200]);
    } finally {
      setIncludeLegacy(original);
    }
  });

  // Same fixture, legacy on and off: the flag only changes which rows are scanned, never the payload.
  it("returns an identical payload with the legacy table on or off", async () => {
    const statsRow = { ips: 2, requests: 4, countries: 1, status_series: "200:3,404:1" };
    const markerRows = [
      { ip_hash: "abc123", country: "US", status: 200, n: 3, last_ts: 1767225600 },
      { ip_hash: "abc123", country: "US", status: 404, n: 1, last_ts: 1767312000 },
    ];
    const bodies: unknown[] = [];
    const original = visitorsIncludeLegacy();
    try {
      for (const includeLegacy of [true, false]) {
        setIncludeLegacy(includeLegacy);
        vi.mocked(queryAll).mockReset();
        vi.mocked(queryAll)
          .mockResolvedValueOnce([statsRow])
          .mockResolvedValueOnce(markerRows);
        const resp = await onRequestGet(
          context(new Request("https://visitor.comicine.com/api/visitors")) as never,
        );
        bodies.push(await resp.json());
      }
    } finally {
      setIncludeLegacy(original);
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("returns 400 for an invalid status param without querying D1", async () => {
    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors?status=all")) as never,
    );
    expect(resp.status).toBe(400);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  it("returns empty aggregates when there are no recent rows", async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([{ ips: 0, requests: 0, countries: 0, status_series: null }])
      .mockResolvedValueOnce([]);

    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors")) as never,
    );
    const data = await resp.json();

    expect(data.stats).toEqual({ total_ips: 0, total_requests: 0, countries: 0 });
    expect(data.status_counts).toEqual({});
    expect(data.markers).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors")) as never,
    );
    expect(resp.status).toBe(401);
  });

  it("returns 403 for non-admin sessions", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "viewer" } as never);
    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors")) as never,
    );
    expect(resp.status).toBe(403);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  // W5-15: fail closed when the revocation table is unavailable; a cookie alone must not grant access.
  it("returns 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestGet(
      context(new Request("https://visitor.comicine.com/api/visitors")) as never,
    );
    expect(resp.status).toBe(503);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });
});
