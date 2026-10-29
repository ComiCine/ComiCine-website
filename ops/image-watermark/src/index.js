/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.

/**
 * comicine-image-watermark — image.comicine.com image watermark Worker (A2 normalization proxy).
 *
 * After A2 (portfolio originals are no longer published), the public bundle contains:
 *   - /static/wm/portfolio/*  Watermarked full-size images (already stored here; old cache entries are harmless).
 *   - /static/portfolio/thumbs/*  Clean thumbnails used only by home page cards.
 *   - /static/qr-codes/* and /static/icons/*  Clean assets.
 * Portfolio originals are no longer public (`/static/portfolio/<image>` returns 404).
 *
 * The Worker normalizes each request to a logical path and always fetches the corresponding
 * public static asset, watermarked or clean. It does not check Referer because no public URL
 * serves the originals. Rules:
 *   1. `/portfolio/<image>` (png/jpg/jpeg/webp, outside `thumbs/`) always returns the
 *      watermarked variant at `/static/wm/portfolio/<image>`, regardless of the request source.
 *   2. Other images and assets (`thumbs`, `qr-codes`, `icons`) return the clean file at `/static/<path>`.
 *   3. Never proxy `/api/*`; return 404 for non-images outside known asset directories.
 *   4. Accept `images.comicine.com`-style `/static/portfolio/...` paths by removing the `/static` prefix.
 *
 * Cache API uses the origin URL as the key; watermarked and clean variants have different URLs
 * and cannot pollute each other's cache. All clients receive the same response under A2, so the
 * response no longer includes `Vary: Referer`.
 */

const ORIGIN = "https://comicine.com";
// image.comicine.com normalizes asset paths; its root redirects to the main site.
const LANDING_PAGE = "https://comicine.com/";

// Image extensions actually used by the site, matching content exposed under public/static.
const IMAGE_PATH_RE = /\.(png|jpe?g|webp|avif|gif|bmp|ico|svg)$/i;

// Watermarked variants cover only png/jpg/jpeg/webp files in the portfolio root, not its thumbs directory.
const PORTFOLIO_ROOT_IMG_RE = /^\/portfolio\/[^/]+\.(png|jpe?g|webp)$/i;
const PORTFOLIO_THUMB_RE = /^\/portfolio\/thumbs\/[^/]+\.(webp|avif)$/i;
const PORTFOLIO_PATH_RE = /^\/portfolio(?:\/|$)/;

// Allow non-image assets only from known directories; block /api/* and all other arbitrary paths.
const KNOWN_DIR_RE = /^\/(?:qr-codes|icons)(?:\/|$)/;

// Browser cache for one day; under A2, all request sources receive the same response.
const CLIENT_CACHE =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=86400";

// Increment after changing watermark appearance or build.py parameters so the Worker fetches a
// new origin URL and bypasses old watermark images in CDN and local caches.
const WM_VERSION = "6";

// Historical icon URLs stay live but always resolve to the current ComiCine artwork.
const BRAND_ICON_ALIASES = new Map([
  ["/icons/comicine.svg", "/static/icons/comicine.svg"],
  ["/icons/comicine-xtext.svg", "/static/icons/comicine-xtext.svg"],
  ["/icons/comicine-favicon.svg", "/static/icons/comicine-favicon.svg"],
  ["/icons/ComiCine.svg", "/static/icons/comicine.svg"],
  ["/icons/ComiCine-xtext.svg", "/static/icons/comicine-xtext.svg"],
  ["/icons/favicon.svg", "/static/icons/comicine-favicon.svg"],
]);

/** Remove the `images.comicine.com`-style `/static` prefix to get the logical path. */
export function logicalPath(pathname) {
  return pathname.startsWith("/static/")
    ? pathname.slice("/static".length)
    : pathname;
}

/** Redirect the bare `image.comicine.com` domain to the main site. */
export function landingRedirect(url) {
  return url.pathname === "/" ? LANDING_PAGE : "";
}

/** Build the origin URL for a watermarked variant, including its cache-busting version. */
export function wmTarget(origin, pathname, search = "") {
  const u = new URL(origin + "/static/wm" + pathname + search);
  u.searchParams.set("__wmver", WM_VERSION);
  return u.toString();
}

/** Check whether an image in the portfolio root should use the watermarked variant. */
export function shouldWatermark(logical) {
  return PORTFOLIO_ROOT_IMG_RE.test(logical);
}

/**
 * Resolve the origin target for a request.
 * Returns `{ target, originalUrl?, watermarked, image }`.
 * Under A2, watermarked responses do not vary by Referer, so `refererAllowed` is no longer needed.
 */
export function routeFor(url, request, origin) {
  const base = origin || ORIGIN;
  const path = logicalPath(url.pathname);

  const brandIconTarget = BRAND_ICON_ALIASES.get(path);
  if (brandIconTarget) {
    const targetUrl = new URL(base + brandIconTarget);
    url.searchParams.forEach((value, key) => {
      if (key !== "v") targetUrl.searchParams.append(key, value);
    });
    const assetVersion = path.toLowerCase().includes("xtext")
      ? "2"
      : path.toLowerCase().includes("favicon")
        ? "3"
        : "5";
    targetUrl.searchParams.set("v", assetVersion);
    const target = targetUrl.toString();
    return { target, originalUrl: target, watermarked: false, image: true };
  }

  // Never allow /api/* through.
  if (path === "/api" || path.startsWith("/api/")) {
    return { target: "", watermarked: false, image: false };
  }

  // Always return a watermarked variant for portfolio root images. If it is missing, return
  // 404 instead of falling back to the original, which is no longer public and may remain in an old cache.
  if (PORTFOLIO_ROOT_IMG_RE.test(path)) {
    return {
      target: wmTarget(base, path, url.search),
      originalUrl: base + "/static/portfolio" + path + url.search,
      watermarked: true,
      image: true,
    };
  }

  // Portfolio is private source material. Only generated thumbs are clean public assets;
  // never let the general image rule expose originals, nested files, or unsupported formats.
  if (PORTFOLIO_PATH_RE.test(path)) {
    if (PORTFOLIO_THUMB_RE.test(path)) {
      const clean = base + "/static" + path + url.search;
      return { target: clean, originalUrl: clean, watermarked: false, image: true };
    }
    return { target: "", watermarked: false, image: false };
  }

  // Other images and assets (qr-codes, icons, and non-portfolio /static images) use the clean static file.
  if (IMAGE_PATH_RE.test(path)) {
    const clean = base + "/static" + path + url.search;
    return { target: clean, originalUrl: clean, watermarked: false, image: true };
  }

  // Non-image files in known asset directories are not expected, but fall back to the clean static file.
  if (KNOWN_DIR_RE.test(path)) {
    return {
      target: base + "/static" + path + url.search,
      watermarked: false,
      image: false,
    };
  }

  return { target: "", watermarked: false, image: false };
}

/** Build the client response. Under A2, responses do not vary by Referer, so omit `Vary: Referer`. */
function clientResponse(store, watermarked) {
  const headers = new Headers({
    "Content-Type": store.headers.get("Content-Type") || "application/octet-stream",
    "Cache-Control": CLIENT_CACHE,
    "Access-Control-Allow-Origin": "*",
    "X-ComiCine-Watermark": watermarked ? "1" : "0",
  });
  const etag = store.headers.get("ETag");
  if (etag) headers.set("ETag", etag);
  return new Response(store.body, { status: store.status, headers });
}

/** HEAD requests use the same routing decision as GET and return headers only. */
async function headResponse(request, origin) {
  const url = new URL(request.url);
  const route = routeFor(url, request, origin);
  if (!route.target) {
    return new Response(null, {
      status: 404,
      headers: { "X-ComiCine-Watermark": "0" },
    });
  }
  const resp = await fetch(route.target, { method: "HEAD" });
  const headers = new Headers({
    "Content-Type": resp.headers.get("Content-Type") || "application/octet-stream",
    "Cache-Control": CLIENT_CACHE,
    "X-ComiCine-Watermark": route.watermarked ? "1" : "0",
  });
  return new Response(null, { status: resp.status, headers });
}

/**
 * Fetch from origin and cache by origin URL; watermarked and clean variants have separate URLs.
 */
async function proxyAndCache(originUrl, ctx, watermarked) {
  const cacheRequest = new Request(originUrl, { method: "GET" });
  const cached = await caches.default.match(cacheRequest);
  if (cached) return clientResponse(cached, watermarked);

  const originResp = await fetch(originUrl, {
    headers: { Accept: "*/*" },
  });
  if (!originResp.ok) {
    return new Response(originResp.body, originResp);
  }

  const buf = await originResp.arrayBuffer();
  const store = new Response(buf, {
    status: originResp.status,
    headers: {
      "Content-Type": originResp.headers.get("Content-Type") || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "ETag": originResp.headers.get("ETag") || "",
      "Last-Modified": originResp.headers.get("Last-Modified") || "",
    },
  });
  ctx.waitUntil(caches.default.put(cacheRequest, store.clone()));
  return clientResponse(store, watermarked);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = env.ORIGIN || ORIGIN;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: {
          Allow: "GET, HEAD",
          "Cache-Control": "no-store",
        },
      });
    }

    const landing = landingRedirect(url);
    if (landing) return Response.redirect(landing, 301);

    // HEAD uses the same routing decision as GET and returns headers only.
    if (request.method === "HEAD") {
      return headResponse(request, origin);
    }
    const route = routeFor(url, request, origin);
    if (!route.target) return new Response("Not Found", { status: 404 });
    if (!route.image) return fetch(route.target);

    const resp = await proxyAndCache(route.target, ctx, route.watermarked);
    // If the watermark variant is missing (not rebuilt yet), return 404 without falling back to the clean original.
    if (route.watermarked && resp.status === 404) return resp;
    return resp;
  },
};
