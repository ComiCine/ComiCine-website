/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.

/**
 * Pure-function route tests for comicine-image-watermark (tasks/14, A2 normalization proxy).
 * Run with: `node --test ops/image-watermark/src/index.test.js`.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import worker, {
  landingRedirect,
  logicalPath,
  routeFor,
  shouldWatermark,
  wmTarget,
} from "./index.js";

const ORIGIN = "https://comicine.com";

test("logicalPath strips the /static prefix (images.comicine.com style paths)", () => {
  assert.equal(logicalPath("/portfolio/a.webp"), "/portfolio/a.webp");
  assert.equal(logicalPath("/static/portfolio/a.webp"), "/portfolio/a.webp");
  assert.equal(logicalPath("/static/qr-codes/a.png"), "/qr-codes/a.png");
});

test("bare domain redirects to the main site; asset paths do not", () => {
  assert.equal(
    landingRedirect(new URL("https://image.comicine.com/")),
    "https://comicine.com/",
  );
  assert.equal(
    landingRedirect(new URL("https://image.comicine.com/portfolio/a.webp")),
    "",
  );
});

test("worker returns a permanent redirect for bare-domain requests", async () => {
  const response = await worker.fetch(
    new Request("https://image.comicine.com/"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 301);
  assert.equal(response.headers.get("location"), "https://comicine.com/");
});

test("only top-level portfolio png/jpg/jpeg/webp get watermarked; thumbs do not", () => {
  assert.equal(shouldWatermark("/portfolio/a.webp"), true);
  assert.equal(shouldWatermark("/portfolio/a.jpg"), true);
  assert.equal(shouldWatermark("/portfolio/a.png"), true);
  assert.equal(shouldWatermark("/portfolio/thumbs/a.webp"), false);
  assert.equal(shouldWatermark("/qr-codes/a.png"), false);
  assert.equal(shouldWatermark("/icons/a.png"), false);
});

test("portfolio root images always return the watermarked variant", () => {
  const url = new URL("https://image.comicine.com/portfolio/a.webp");
  const route = routeFor(url, { headers: new Headers() }, ORIGIN);
  assert.equal(route.watermarked, true);
  assert.ok(route.target.startsWith(`${ORIGIN}/static/wm/portfolio/a.webp`));
  assert.ok(route.target.includes("__wmver="));
});

test("thumbs / qr-codes / icons are served clean, unwatermarked", () => {
  const thumb = routeFor(new URL("https://image.comicine.com/portfolio/thumbs/a.webp"), { headers: new Headers() }, ORIGIN);
  assert.equal(thumb.watermarked, false);
  assert.equal(thumb.target, `${ORIGIN}/static/portfolio/thumbs/a.webp`);

  const qr = routeFor(new URL("https://image.comicine.com/qr-codes/a.png"), { headers: new Headers() }, ORIGIN);
  assert.equal(qr.watermarked, false);
  assert.equal(qr.target, `${ORIGIN}/static/qr-codes/a.png`);

  const icon = routeFor(new URL("https://image.comicine.com/icons/comicine.svg"), { headers: new Headers() }, ORIGIN);
  assert.equal(icon.watermarked, false);
  assert.equal(icon.target, `${ORIGIN}/static/icons/comicine-xtext.svg?v=3`);

  const canonicalWordmark = routeFor(new URL("https://image.comicine.com/icons/comicine-xtext.svg"), { headers: new Headers() }, ORIGIN);
  assert.equal(canonicalWordmark.target, `${ORIGIN}/static/icons/comicine-xtext.svg?v=3`);

  const canonicalFavicon = routeFor(new URL("https://image.comicine.com/icons/comicine-favicon.svg"), { headers: new Headers() }, ORIGIN);
  assert.equal(canonicalFavicon.target, `${ORIGIN}/static/icons/comicine-favicon.svg?v=6`);

  const favicon = routeFor(new URL("https://image.comicine.com/icons/favicon.svg"), { headers: new Headers() }, ORIGIN);
  assert.equal(favicon.watermarked, false);
  assert.equal(favicon.target, `${ORIGIN}/static/icons/comicine-favicon.svg?v=6`);
});

test("portfolio exposes only generated thumbs and watermarked top-level originals", () => {
  const thumb = routeFor(new URL("https://image.comicine.com/portfolio/thumbs/a.avif"), { headers: new Headers() }, ORIGIN);
  assert.equal(thumb.target, `${ORIGIN}/static/portfolio/thumbs/a.avif`);
  assert.equal(thumb.watermarked, false);

  for (const path of [
    "/portfolio/album/a.webp",
    "/portfolio/a.svg",
    "/portfolio/a.avif",
    "/portfolio/thumbs/album/a.webp",
  ]) {
    const route = routeFor(new URL(`https://image.comicine.com${path}`), { headers: new Headers() }, ORIGIN);
    assert.equal(route.target, "", `${path} must not be served as a clean original`);
  }
});

test("/static prefix is compatible: /static/portfolio/a.webp still watermarked", () => {
  const route = routeFor(new URL("https://images.comicine.com/static/portfolio/a.webp"), { headers: new Headers() }, ORIGIN);
  assert.equal(route.watermarked, true);
  assert.ok(route.target.startsWith(`${ORIGIN}/static/wm/portfolio/a.webp`));
});

test("never proxies /api/* or unknown paths", () => {
  const api = routeFor(new URL("https://image.comicine.com/api/secret?q=1"), { headers: new Headers() }, ORIGIN);
  assert.equal(api.target, "");
  assert.equal(api.image, false);

  const apiRoot = routeFor(new URL("https://image.comicine.com/api"), { headers: new Headers() }, ORIGIN);
  assert.equal(apiRoot.target, "");

  const unknown = routeFor(new URL("https://image.comicine.com/random/thing"), { headers: new Headers() }, ORIGIN);
  assert.equal(unknown.target, "");
});

test("rejects non-GET/HEAD methods without contacting the origin", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected origin request");
  };
  try {
    for (const path of ["/api/private", "/portfolio/a.webp"]) {
      const response = await worker.fetch(
        new Request(`https://image.comicine.com${path}`, { method: "POST" }),
        {},
        { waitUntil() {} },
      );
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("Allow"), "GET, HEAD");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetchCalls, 0);
});

test("watermark origin URL hits /static/wm/ with a version param", () => {
  const target = wmTarget(ORIGIN, "/portfolio/a.webp", "?v=1");
  assert.equal(new URL(target).pathname, "/static/wm/portfolio/a.webp");
  assert.ok(target.includes("__wmver=6"));
});

test("brand aliases use current SVG versions and preserve non-version query params", () => {
  const route = routeFor(
    new URL("https://image.comicine.com/icons/ComiCine-xtext.svg?lang=zh-cn&v=1"),
    { headers: new Headers() },
    ORIGIN,
  );
  const target = new URL(route.target);
  assert.equal(target.pathname, "/static/icons/comicine-xtext.svg");
  assert.equal(target.searchParams.get("lang"), "zh-cn");
  assert.equal(target.searchParams.get("v"), "3");
});
