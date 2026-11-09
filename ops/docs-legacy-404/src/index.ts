/*
 * ComiCine - Cloudflare Pages legacy-path 404 Worker
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

const MAIN_404_URL = "https://comicine.com/404";

function isHtmlNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    request.headers.get("Sec-Fetch-Dest") === "document" ||
    request.headers.get("Sec-Fetch-Mode") === "navigate"
  ) {
    return true;
  }
  return (request.headers.get("Accept") ?? "")
    .split(",")
    .some((value) => value.trim().split(";", 1)[0].toLowerCase() === "text/html");
}

function notFoundResponse(request: Request): Response {
  const isAsset = new URL(request.url).pathname.startsWith("/assets/");
  const isPageNavigation = !isAsset && isHtmlNavigation(request);
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": isPageNavigation
      ? "text/html; charset=utf-8"
      : "text/plain; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow",
  });

  let body = "Not Found\n";
  if (isPageNavigation) {
    headers.set("Refresh", `0; url=${MAIN_404_URL}`);
    body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0;url=${MAIN_404_URL}"><title>404</title></head><body><p>404</p><a href="${MAIN_404_URL}">ComiCine</a></body></html>`;
  }

  return new Response(request.method === "HEAD" ? null : body, {
    status: 404,
    headers,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    return notFoundResponse(request);
  },
};
