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

import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequestGet } from "./currency-rates";
import type { Env } from "../_lib/env";

function context(url = "https://services.limooo.cn/api/currency-rates") {
  return {
    request: new Request(url),
    env: {} as Env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  } as Parameters<typeof onRequestGet>[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/currency-rates", () => {
  it("returns validated CNY rates with their original data dates and caches them", async () => {
    const cache = { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("caches", { default: cache });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([
      { date: "2026-10-15", base: "CNY", quote: "USD", rate: 0.14954 },
      { date: "2026-10-14", base: "CNY", quote: "ANG", rate: 0.26769 },
      { date: "2026-10-15", base: "USD", quote: "EUR", rate: 0.89 },
      { date: "2026-10-15", base: "CNY", quote: "BAD", rate: -1 },
    ])));

    const response = await onRequestGet(context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { date: "2026-10-15", base: "CNY", quote: "USD", rate: 0.14954 },
      { date: "2026-10-14", base: "CNY", quote: "ANG", rate: 0.26769 },
    ]);
    expect(response.headers.get("Cache-Control")).toContain("max-age=21600");
    expect(cache.put).toHaveBeenCalledOnce();
  });

  it("returns a non-cacheable 503 when the upstream rates are unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));

    const response = await onRequestGet(context());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "reference_rates_unavailable" });
  });
});
