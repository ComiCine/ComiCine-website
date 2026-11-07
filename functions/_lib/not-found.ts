/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Public `/files/<path>` serving, branded 404 responses, and the 401 identity navigation document. */

import { BASE_URL, IDENTITY_SITE_ROLES, ROOT_DOMAIN, WWW_HOSTNAME } from "./config";
import { buildIdentityLoginStart } from "./identity-login";
import { detectLang, escapeHtml, isApiPath, PUBLIC_FILES_PREFIX, requestUrl, type RequestContext } from "./routing";
import { requireAuth } from "./session";

/**
 * Map `/files/<path>` to the generated `/public/files/<path>` asset and serve it publicly.
 *
 * Reject hidden, empty, and traversal path segments before looking up the asset.
 */
export async function servePublicFile(
  context: RequestContext,
  pathname: string,
): Promise<Response> {
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(PUBLIC_FILES_PREFIX.length));
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const segments = relativePath.split("/");
  if (
    !relativePath ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.startsWith(".") ||
        segment.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(segment),
    )
  ) {
    return new Response("Not Found", { status: 404 });
  }
  if (!context.env.ASSETS) return new Response("Not Found", { status: 404 });

  const asset = await context.env.ASSETS.fetch(
    new URL(
      `/public/files/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`,
      BASE_URL,
    ),
  );
  if (!asset.ok) return new Response("Not Found", { status: 404 });

  return new Response(asset.body, {
    status: 200,
    headers: {
      "Content-Type":
        asset.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
      ...(asset.headers.get("ETag") ? { ETag: asset.headers.get("ETag")! } : {}),
    },
  });
}

export function withNotFoundStatus(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: 404,
    headers,
  });
}

export async function brandedNotFoundResponse(
  context: RequestContext,
  response: Response,
): Promise<Response> {
  const { request, env } = context;
  if (
    response.status !== 404 ||
    !isHtmlNavigation(request) ||
    isApiPath(new URL(request.url).pathname)
  ) return response;

  const hostname = new URL(request.url).hostname.toLowerCase();
  if (hostname !== ROOT_DOMAIN && hostname !== WWW_HOSTNAME) {
    const target = `${BASE_URL}/404`;
    const headers = new Headers({
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Refresh": `0; url=${target}`,
      "X-Robots-Tag": "noindex, nofollow",
    });
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0; url=${target}"><title>Page not found</title></head><body><a href="${target}">Continue to ComiCine</a></body></html>`;
    return new Response(request.method === "HEAD" ? null : body, {
      status: 404,
      headers,
    });
  }
  if (!env.ASSETS) return response;

  const lang = detectLang(request);
  let page = await env.ASSETS.fetch(new URL(`/${lang}/not-found.html`, BASE_URL));
  if (!page.ok) page = await env.ASSETS.fetch(new URL("/404.html", BASE_URL));
  if (!page.ok) return response;

  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(request.method === "HEAD" ? null : page.body, {
    status: 404,
    headers,
  });
}

export function isHtmlNavigation(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (
    request.headers.get("Sec-Fetch-Dest") === "document" ||
    request.headers.get("Sec-Fetch-Mode") === "navigate"
  ) {
    return true;
  }
  return (request.headers.get("Accept") ?? "")
    .split(",")
    .some((value) => {
      const [mediaType = ""] = value.trim().split(";", 1);
      return mediaType.toLowerCase() === "text/html";
    });
}

export function identityRequiredResponse(
  request: Request,
  identityUrl: string,
  cookies: string[],
): Response {
  const target = escapeHtml(identityUrl);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Sign in required</title></head><body><p>Authentication required.</p><a href="${target}">Continue to sign in</a><script src="/static/js/auth-redirect.js?v=1" data-target="${target}" defer></script></body></html>`;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 401,
    headers,
  });
}

/**
 * Send unauthenticated browser page navigations to the shared identity host
 * through a 401 document; non-navigation requests retain the local /login route.
 */
export async function adminAuthRedirect(
  env: RequestContext["env"],
  request: Request,
  hostname: string,
  url?: URL,
): Promise<Response | null> {
  if (!Object.prototype.hasOwnProperty.call(IDENTITY_SITE_ROLES, hostname)) return null;
  try {
    if (await requireAuth(env, request)) return null;
    const current = url ?? requestUrl(request);
    const next = `${current.pathname}${current.search}`;
    if (isHtmlNavigation(request)) {
      const start = await buildIdentityLoginStart(env, request, current, next, 401);
      if (!start) {
        return new Response("Invalid identity return path\n", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return identityRequiredResponse(request, start.identityUrl, start.cookies);
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/login?next=${encodeURIComponent(next)}`,
      },
    });
  } catch {
    return Response.json(
      { error: "auth_sessions_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
