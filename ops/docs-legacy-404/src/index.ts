/*
 * ComiCine - Cloudflare Pages legacy-path 404 Worker
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

async function docsNotFound(request: Request): Promise<Response> {
  const originalUrl = new URL(request.url);
  const notFoundUrl = new URL("/__codex_missing_page__", originalUrl);
  const headers = new Headers({ Accept: "text/html" });
  const acceptLanguage = request.headers.get("Accept-Language");
  if (acceptLanguage) headers.set("Accept-Language", acceptLanguage);

  // This unassigned same-zone path reaches the Pages origin without re-entering this Worker.
  const page = await fetch(new Request(notFoundUrl, { method: "GET", headers }));
  const contentType = page.headers.get("Content-Type") ?? "";
  if (
    page.status !== 404 ||
    !contentType.toLowerCase().startsWith("text/html")
  ) {
    throw new Error("The docs Pages origin did not return its custom HTML 404");
  }
  if (!(await page.clone().text()).includes('<meta name="generator" content="VitePress v')) {
    throw new Error("The docs Pages origin returned an unexpected HTML 404 page");
  }

  const responseHeaders = new Headers(page.headers);
  for (const name of [
    "Content-Encoding",
    "Content-Length",
    "Location",
    "Refresh",
    "Transfer-Encoding",
  ]) {
    responseHeaders.delete(name);
  }
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Robots-Tag", "noindex, nofollow");

  return new Response(request.method === "HEAD" ? null : page.body, {
    status: 404,
    statusText: page.statusText,
    headers: responseHeaders,
  });
}

function textNotFound(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const isAsset = new URL(request.url).pathname.startsWith("/assets/");
    if (isAsset) return textNotFound();

    try {
      return await docsNotFound(request);
    } catch (error) {
      console.error("Failed to load the docs custom 404 page", error);
      return textNotFound();
    }
  },
};
