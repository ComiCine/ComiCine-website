/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Cross-host 404 contract audit.
 *
 * A user-facing HTML 404 keeps status 404 and no Location, is uncacheable, and
 * renders the same branded not-found page on every host of the main Pages project.
 * A bare Refresh stub used to move subsite 404s to https://comicine.com/404; it read
 * like an authentication stop and was removed. API or asset 404s keep their native
 * format. These cases live in their own file so the orchestration tests can change
 * independently.
 */

import { describe, expect, it, vi } from "vitest";
import { handleOnRequest } from "./_middleware";
import type { Env } from "./_lib/env";
import type { RequestContext } from "./_lib/routing";

// Keep tracking inert: these cases assert response shape, not analytics.
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

const TRUSTED_IP = "97.64.18.11";
const NOT_FOUND_PAGE =
  '<!doctype html><html lang="en"><body><h1 id="not-found-heading">Page not found</h1></body></html>';

function context(request: Request, env: Partial<Env> = {}): RequestContext {
  return {
    request,
    env: { ...keys, ...env } as Env,
    // Every case reaches the branded 404 through the same missing-page path.
    next: async () => new Response("missing", { status: 404 }),
    waitUntil: async () => undefined,
  };
}

function notFoundAssets(body = NOT_FOUND_PAGE) {
  return {
    ASSETS: {
      fetch: async () =>
        new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  };
}

function htmlRequest(url: string, accept = "text/html"): Request {
  return new Request(url, {
    headers: { Accept: accept, "CF-Connecting-IP": TRUSTED_IP },
  });
}

describe("cross-host 404 contract", () => {
  it("renders the localized main-site 404 in place at /404", async () => {
    // A trusted IP reaches the page-asset branch. /404 must not redirect and must
    // not be cacheable: the response is a real error page, not a page asset hit.
    const response = await handleOnRequest(context(htmlRequest("https://comicine.com/404"), notFoundAssets()));

    expect(response.status).toBe(404);
    expect(response.headers.get("Refresh")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain('id="not-found-heading"');
  });

  it.each(["TEXT/HTML;q=0.9", "text/html;level=1"])(
    "treats Accept %s as HTML navigation on a subsite",
    async (accept) => {
      // Media types are case-insensitive and parameters must not stop the match.
      const response = await handleOnRequest(
        context(htmlRequest("https://services.comicine.com/__missing_page__", accept), notFoundAssets()),
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("Location")).toBeNull();
      expect(response.headers.get("Refresh")).toBeNull();
      await expect(response.text()).resolves.toContain('id="not-found-heading"');
    },
  );

  it("keeps a HEAD 404 on a subsite bodyless while still announcing the target", async () => {
    const request = new Request("https://services.comicine.com/__missing_page__", {
      method: "HEAD",
      headers: { Accept: "text/html", "CF-Connecting-IP": TRUSTED_IP },
    });
    const response = await handleOnRequest(context(request, notFoundAssets()));

    expect(response.status).toBe(404);
    expect(response.headers.get("Refresh")).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });

  it("keeps an /api/* 404 in its native format even when Accept asks for HTML", async () => {
    // The branded shell must never wrap API errors: clients parse their native body.
    const response = await handleOnRequest(
      context(htmlRequest("https://comicine.com/api/__missing__")),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Refresh")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
    await expect(response.text()).resolves.toBe("missing");
  });

  it("renders the branded 404 on the image host without a redirect stub", async () => {
    const response = await handleOnRequest(
      context(htmlRequest("https://image.comicine.com/__missing_page__"), notFoundAssets()),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Refresh")).toBeNull();
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain('id="not-found-heading"');
  });
});
