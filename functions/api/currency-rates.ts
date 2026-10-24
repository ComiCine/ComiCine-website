/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

import type { Env } from "../_lib/env";

const FRANKFURTER_URL = "https://api.frankfurter.dev/v2/rates?base=CNY";
const CACHE_SECONDS = 6 * 60 * 60;
const CACHE_CONTROL = "public, max-age=21600, stale-while-revalidate=86400";

interface FrankfurterRate {
  base: string;
  quote: string;
  rate: number;
  date: string;
}

interface RateCacheLike {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
}

function cacheForRequest(): RateCacheLike | undefined {
  return typeof caches !== "undefined"
    ? (caches as unknown as { default?: RateCacheLike }).default
    : undefined;
}

function validRateRows(value: unknown): value is FrankfurterRate[] {
  return Array.isArray(value) && value.some((row) =>
    !!row &&
    row.base === "CNY" &&
    typeof row.quote === "string" &&
    /^[A-Z]{3}$/.test(row.quote) &&
    Number.isFinite(row.rate) &&
    row.rate > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.date),
  );
}

export const onRequestGet: PagesFunction<Env> = async ({ request }) => {
  const cacheKeyUrl = new URL(request.url);
  cacheKeyUrl.search = "";
  cacheKeyUrl.searchParams.set("__cache", String(CACHE_SECONDS));
  const cacheKey = new Request(cacheKeyUrl);
  const cache = cacheForRequest();

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    } catch {
      // Cache failures must not prevent the rate request.
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(FRANKFURTER_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Frankfurter HTTP ${response.status}`);

    const body: unknown = await response.json();
    if (!validRateRows(body)) throw new Error("Invalid Frankfurter rates response");

    const seen = new Set<string>();
    const rates = body.filter((row) => {
      if (
        !row ||
        row.base !== "CNY" ||
        !/^[A-Z]{3}$/.test(row.quote) ||
        !Number.isFinite(row.rate) ||
        row.rate <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        row.quote === "CNY" ||
        seen.has(row.quote)
      ) return false;
      seen.add(row.quote);
      return true;
    });
    if (!rates.length) throw new Error("No valid CNY rates returned");

    const result = Response.json(rates, {
      headers: { "Cache-Control": CACHE_CONTROL },
    });
    if (cache) {
      try {
        await cache.put(cacheKey, result.clone());
      } catch {
        // Cache failures must not affect the public reference rates.
      }
    }
    return result;
  } catch {
    return Response.json(
      { error: "reference_rates_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timeout);
  }
};
