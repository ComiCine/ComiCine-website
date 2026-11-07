/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Integration tests for the `/login` and `/logout` rate limiter as wired into
 * the middleware. Kept in a dedicated file (like `_lib/routing.default-lang.test.ts`)
 * because `_middleware.test.ts` is a large shared file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOnRequest, onRequest } from "./_middleware";
import { mintGateCookie } from "./_lib/gate";
import { resetRateLimitMemory } from "./_lib/rate-limit";
import { recordRay, recordVisit, shouldTrackRay, shouldTrackVisit } from "./_lib/tracking";
import type { Env } from "./_lib/env";
import type { RequestContext } from "./_lib/routing";

vi.mock("./_lib/tracking", () => ({
  isTrustedCrawler: vi.fn(() => false),
  recordRay: vi.fn(async () => undefined),
  recordVisit: vi.fn(async () => undefined),
  shouldTrackRay: vi.fn(() => false),
  shouldTrackVisit: vi.fn(() => false),
}));

const keys = {
  TURNSTILE_SECRET: "turnstile-secret",
  GATE_HMAC_KEY: "a".repeat(64),
  SESSION_HMAC_KEY: "b".repeat(64),
};

function context(request: Request, env: Partial<Env> = {}): RequestContext {
  return {
    request,
    env: { ...keys, ...env } as Env,
    next: async () => new Response("next", { status: 200 }),
    waitUntil: async () => undefined,
  };
}

const UNTRUSTED_IP = "203.0.113.7";

async function gateCookie(): Promise<string> {
  return (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];
}

function authRequest(path: string, ip: string, cookie: string, accept = "text/html"): Request {
  return new Request(`https://comicine.com${path}`, {
    headers: { "CF-Connecting-IP": ip, Accept: accept, Cookie: cookie },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T12:00:00Z"));
  resetRateLimitMemory();
  vi.mocked(recordRay).mockClear();
  vi.mocked(recordVisit).mockClear();
  vi.mocked(shouldTrackRay).mockReturnValue(false);
  vi.mocked(shouldTrackVisit).mockReturnValue(false);
});

afterEach(() => {
  vi.useRealTimers();
  resetRateLimitMemory();
});

describe("authentication rate limiting", () => {
  it("allows ten /login requests per minute and answers the eleventh with 429", async () => {
    const cookie = await gateCookie();
    for (let attempt = 1; attempt <= 10; attempt++) {
      const response = await handleOnRequest(context(authRequest("/login", UNTRUSTED_IP, cookie)));
      expect(response.status, `attempt ${attempt}`).not.toBe(429);
    }

    const limited = await handleOnRequest(context(authRequest("/login", UNTRUSTED_IP, cookie)));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
    expect(limited.headers.get("Location")).toBeNull();
    await expect(limited.text()).resolves.toContain("Too Many Requests");
  });

  it("negotiates a JSON body on the 429", async () => {
    const cookie = await gateCookie();
    for (let attempt = 1; attempt <= 10; attempt++) {
      await handleOnRequest(context(authRequest("/login", UNTRUSTED_IP, cookie)));
    }
    const limited = await handleOnRequest(
      context(authRequest("/login", UNTRUSTED_IP, cookie, "application/json")),
    );
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toEqual({ error: "rate_limited", retry_after: 60 });
  });

  it("does not throttle allowlisted source addresses", async () => {
    const cookie = await gateCookie();
    for (let attempt = 1; attempt <= 15; attempt++) {
      const response = await handleOnRequest(context(authRequest("/login", "97.64.18.11", cookie)));
      expect(response.status, `attempt ${attempt}`).not.toBe(429);
    }
  });

  it("throttles only the exact paths, never the Access callbacks", async () => {
    const cookie = await gateCookie();
    for (let attempt = 1; attempt <= 15; attempt++) {
      const response = await handleOnRequest(context(authRequest("/login/entra", UNTRUSTED_IP, cookie)));
      expect(response.status, `attempt ${attempt}`).not.toBe(429);
    }
  });

  it("skips visitor and ray tracking for a 429", async () => {
    const cookie = await gateCookie();
    vi.mocked(shouldTrackVisit).mockReturnValue(true);
    vi.mocked(shouldTrackRay).mockReturnValue(true);
    for (let attempt = 1; attempt <= 10; attempt++) {
      await onRequest(context(authRequest("/login", UNTRUSTED_IP, cookie)));
    }
    vi.mocked(recordVisit).mockClear();
    vi.mocked(recordRay).mockClear();

    const limited = await onRequest(context(authRequest("/login", UNTRUSTED_IP, cookie)));
    expect(limited.status).toBe(429);
    expect(recordVisit).not.toHaveBeenCalled();
    expect(recordRay).not.toHaveBeenCalled();
  });
});
