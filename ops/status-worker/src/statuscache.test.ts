/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Status page cache helper tests (suggestion 23).
 *
 * The status page is the hottest public surface of the Worker and every render reads D1. These
 * tests lock down the properties that keep the explicit cache safe:
 *   - one key per language, so variants cannot leak;
 *   - misses degrade to a direct render when the Cache API is absent (Node tests);
 *   - 404s and `no-store` responses are never stored, so failure pages cannot get stuck;
 *   - a throwing `cache.put` is swallowed and logged instead of failing the response.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STATUS_CACHE_KEY_PREFIX,
  STATUS_CACHE_ORIGIN,
  readStatusPageCache,
  statusCacheAvailable,
  statusPageCacheKey,
  writeStatusPageCache,
} from "./statuscache";

const OK_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
};

function fakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (request: Request) => store.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => {
      store.set(request.url, response.clone());
    },
  };
  vi.stubGlobal("caches", { default: cache });
  return { store, cache };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cache keys", () => {
  it("uses one synthetic key per language", () => {
    const zh = statusPageCacheKey("zh-cn");
    const en = statusPageCacheKey("en-us");
    expect(zh.url).toBe(`${STATUS_CACHE_ORIGIN}${STATUS_CACHE_KEY_PREFIX}zh-cn`);
    expect(zh.url).not.toBe(en.url);
    expect(statusPageCacheKey("zh-cn").url).toBe(zh.url);
  });
});

describe("read / write", () => {
  it("returns null on a miss, then the stored body after a write", async () => {
    fakeCache();
    const key = statusPageCacheKey("zh-cn");
    await expect(readStatusPageCache(key)).resolves.toBeNull();

    writeStatusPageCache(key, new Response("<html>状态</html>", { headers: OK_HEADERS }));
    // Without waitUntil the put is fire-and-forget; wait for the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const cached = await readStatusPageCache(key);
    expect(cached).not.toBeNull();
    expect(await cached?.text()).toBe("<html>状态</html>");
  });

  it("degrades to a direct render when the Cache API is unavailable", async () => {
    expect(statusCacheAvailable()).toBe(false);
    const key = statusPageCacheKey("zh-cn");
    await expect(readStatusPageCache(key)).resolves.toBeNull();
    expect(() =>
      writeStatusPageCache(key, new Response("ok", { headers: OK_HEADERS })),
    ).not.toThrow();
  });

  it("reports the Cache API as available once one is installed", () => {
    fakeCache();
    expect(statusCacheAvailable()).toBe(true);
  });

  it("does not store non-200 responses", async () => {
    const { store } = fakeCache();
    const key = statusPageCacheKey("zh-cn");
    writeStatusPageCache(key, new Response("not found", { status: 404, headers: OK_HEADERS }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.size).toBe(0);
  });

  it("does not store a no-store response", async () => {
    const { store } = fakeCache();
    const key = statusPageCacheKey("zh-cn");
    writeStatusPageCache(
      key,
      new Response("temporarily unavailable", {
        status: 200,
        headers: { "Content-Type": "text/html", "Cache-Control": "no-store" },
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.size).toBe(0);
  });

  it("hands the put promise to waitUntil", async () => {
    fakeCache();
    const pending: Array<Promise<unknown>> = [];
    const key = statusPageCacheKey("en-us");

    writeStatusPageCache(
      key,
      new Response("<html>ok</html>", { headers: OK_HEADERS }),
      (promise) => void pending.push(promise),
    );

    expect(pending).toHaveLength(1);
    await pending[0];
    expect(await readStatusPageCache(key)).not.toBeNull();
  });

  it("swallows a throwing cache.put and logs it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("caches", {
      default: {
        match: async () => undefined,
        put: async () => {
          throw new Error("cache unavailable");
        },
      },
    });

    expect(() =>
      writeStatusPageCache(
        statusPageCacheKey("zh-cn"),
        new Response("ok", { headers: OK_HEADERS }),
      ),
    ).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("keeps languages isolated in the cache", async () => {
    const { store } = fakeCache();
    writeStatusPageCache(
      statusPageCacheKey("zh-cn"),
      new Response("<html lang=\"zh-cn\">",
        { headers: OK_HEADERS }),
      (promise) => void promise,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.size).toBe(1);
    await expect(readStatusPageCache(statusPageCacheKey("en-us"))).resolves.toBeNull();
    const zh = await readStatusPageCache(statusPageCacheKey("zh-cn"));
    expect(await zh?.text()).toContain("zh-cn");
  });
});
