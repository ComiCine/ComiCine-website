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

/** Tests /api/visitors aggregation and status-code compatibility; D1 and authentication are mocked. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./visitors";
import { queryAll } from "../_lib/d1";
import { requireAuth } from "../_lib/session";
import type { Env } from "../_lib/env";

vi.mock("../_lib/d1", () => ({ queryAll: vi.fn() }));
vi.mock("../_lib/session", async () => {
  // Shared stubs (tasks/22 W5-15); see tests/helpers/admin-session.ts for their purpose and placement.
  const { createSessionModuleMock } = await import("../../tests/helpers/admin-session");
  return createSessionModuleMock();
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

describe("visitors API", () => {
  it("returns aggregates, status counts and markers in two D1 queries", async () => {
    const expectedCutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
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
      context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
    );
    const data = await resp.json();

    expect(resp.status).toBe(200);
    expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queryAll).mock.calls[0][1]).toContain("GROUP_CONCAT");
    expect(vi.mocked(queryAll).mock.calls[0][2]).toBe(expectedCutoff);
    expect(vi.mocked(queryAll).mock.calls[0][3]).toBe(expectedCutoff);
    expect(vi.mocked(queryAll).mock.calls[1][1]).toContain("LIMIT 500");
    expect(vi.mocked(queryAll).mock.calls[1][2]).toBe(expectedCutoff);
    expect(vi.mocked(queryAll).mock.calls[1][3]).toBe(expectedCutoff);

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
  // Known unresolved issue (observed 2026-10-11; see the open item W5-5 in the tasks/22 execution log):
  // buildMarkers takes the country from the **first row for an ip_hash** instead of updating it alongside
  // `row.last_ts > acc.last_time`. When a visitor has multiple statuses with different last_ts values,
  // reversed input can therefore select the older country (this case returns CN in reverse order).
  // Fix it by also setting `acc.country = row.country` in the accumulator in functions/api/visitors.ts
  // (owned by the W9 agent). After the fix, upgrade the assertions so both orders produce CH.
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
        context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
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
  // The old implementation took the country only when it first saw an ip_hash (the first row returned by D1),
  // which yielded CN in reverse order. The displayed country must not depend on D1 row order.
    expect(markers[0].country).toBe("CH");
    expect(markers[1].country).toBe("CH");

    const markerSql = (
      vi.mocked(queryAll).mock.calls.map((call) => String(call[1]))
    ).find((sql) => sql.includes("LIMIT 500"));
    expect(markerSql).toBeTruthy();
  // The SQL comments mention the prohibited alternatives below, so strip comments before asserting;
  // otherwise the test would inspect explanatory text rather than the SQL itself.
    const sqlCode = String(markerSql).replace(/--[^\n]*/g, "");
    expect(sqlCode).not.toContain("MAX(v.country)");
  // Disallow more expensive alternatives (measured against production D1; each reads far more than the 131,000-row baseline):
  // correlated subquery: 13.7 million rows; NOT EXISTS: 7.53 million rows; ROW_NUMBER over all partitions: 175,000 rows.
    expect(sqlCode).not.toMatch(/SELECT\s+s2\.country/);
    expect(sqlCode).not.toContain("NOT EXISTS");
    expect(sqlCode).not.toContain("ROW_NUMBER()");
  });

  /**
   * W9-13: /api/visitors recomputes a 30-day window on every poll (the file notes a measured
   * read of 131,000 rows). Leaving the admin page open all day means about 144 polls × 131,000 rows,
   * approaching the 5,000,000-row daily limit. Cache by URL in caches.default for 300 seconds.
   */
  describe("edge cache", () => {
    it("serves a repeated poll from cache without touching D1 again", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValueOnce(singleRowStats)
        .mockResolvedValueOnce(singleRowMarkers);

      const first = await onRequestGet(
        context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
      );
      expect(first.status).toBe(200);
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(first.headers.get("Cache-Control")).toContain("max-age=300");
      expect(puts).toHaveLength(1);

      const second = await onRequestGet(
        context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
      );
      const data = await second.json();
  // A cache hit must not query D1 again.
      expect(vi.mocked(queryAll)).toHaveBeenCalledTimes(2);
      expect(data.markers[0].ip_hash).toBe("cached01");
      vi.unstubAllGlobals();
    });

    it("keeps the status filter in the cache key", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(queryAll)
        .mockResolvedValue(singleRowStats)
        .mockResolvedValue(singleRowMarkers);

      await onRequestGet(
        context(new Request("https://visitor.limooo.cn/api/visitors?status=200")) as never,
      );
      await onRequestGet(
        context(new Request("https://visitor.limooo.cn/api/visitors?status=404")) as never,
      );
      expect(puts).toHaveLength(2);
      expect(puts[0]).not.toBe(puts[1]);
      vi.unstubAllGlobals();
    });

    it("does not cache an unauthorized response", async () => {
      const { cache, puts } = fakeCache();
      vi.stubGlobal("caches", { default: cache });
      vi.mocked(requireAuth).mockResolvedValue(null as never);
      const resp = await onRequestGet(
        context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
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
        context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
      );
      expect(resp.status).toBe(200);
      vi.unstubAllGlobals();
    });
  });

  it("keeps the status filter compatible and applies the same 30-day window", async () => {
    const expectedCutoff = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
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
      context(new Request("https://visitor.limooo.cn/api/visitors?status=404")) as never,
    );

    const markerSql = vi.mocked(queryAll).mock.calls[1][1] as string;
    expect(markerSql).toContain("status = ?");
    expect(vi.mocked(queryAll).mock.calls[1][2]).toBe(expectedCutoff);
    expect(vi.mocked(queryAll).mock.calls[1][3]).toBe(404);
    expect(vi.mocked(queryAll).mock.calls[1][4]).toBe(expectedCutoff);
    expect(vi.mocked(queryAll).mock.calls[1][5]).toBe(404);
  });

  it("returns 400 for an invalid status param without querying D1", async () => {
    const resp = await onRequestGet(
      context(new Request("https://visitor.limooo.cn/api/visitors?status=all")) as never,
    );
    expect(resp.status).toBe(400);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  it("returns empty aggregates when there are no recent rows", async () => {
    vi.mocked(queryAll)
      .mockResolvedValueOnce([{ ips: 0, requests: 0, countries: 0, status_series: null }])
      .mockResolvedValueOnce([]);

    const resp = await onRequestGet(
      context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
    );
    const data = await resp.json();

    expect(data.stats).toEqual({ total_ips: 0, total_requests: 0, countries: 0 });
    expect(data.status_counts).toEqual({});
    expect(data.markers).toEqual([]);
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(null);
    const resp = await onRequestGet(
      context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
    );
    expect(resp.status).toBe(401);
  });

  it("returns 403 for non-admin sessions", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ role: "viewer" } as never);
    const resp = await onRequestGet(
      context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
    );
    expect(resp.status).toBe(403);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });

  // W5-15: fail closed when the revocation table is unavailable; a cookie alone must not grant access.
  it("returns 503 when the session store is unavailable", async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new Error("auth_sessions_unavailable"));
    const resp = await onRequestGet(
      context(new Request("https://visitor.limooo.cn/api/visitors")) as never,
    );
    expect(resp.status).toBe(503);
    expect(vi.mocked(queryAll)).not.toHaveBeenCalled();
  });
});
