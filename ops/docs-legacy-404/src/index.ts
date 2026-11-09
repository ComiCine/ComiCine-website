/*
 * ComiCine - Cloudflare Pages legacy-path 404 Worker
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

const htmlNotFound = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>404</title>
  </head>
  <body>
    <main>
      <h1>404</h1>
      <p>This page was moved or is no longer available.</p>
      <a href="https://comicine.com/">Take me home</a>
    </main>
  </body>
</html>`;

export default {
  async fetch(request: Request): Promise<Response> {
    const isAsset = new URL(request.url).pathname.startsWith("/assets/");
    const body = isAsset ? "Not Found\n" : htmlNotFound;
    const contentType = isAsset ? "text/plain; charset=utf-8" : "text/html; charset=utf-8";

    return new Response(body, {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  },
};
