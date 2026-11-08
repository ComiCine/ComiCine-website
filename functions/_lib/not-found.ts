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
import { detectLang, isApiPath, PUBLIC_FILES_PREFIX, requestUrl, type RequestContext } from "./routing";
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

  if (!env.ASSETS) return response;

  // Every host in this Pages project serves the same localized not-found page, including the
  // subsites. A bare "Continue to ComiCine" redirect stub used to sit here; with no styling it
  // read like an authentication stop, so a missing URL looked broken instead of simply absent.
  const hostname = new URL(request.url).hostname.toLowerCase();
  const subsite = hostname !== ROOT_DOMAIN && hostname !== WWW_HOSTNAME;
  const lang = detectLang(request);
  let page = await env.ASSETS.fetch(new URL(`/${lang}/not-found.html`, BASE_URL));
  if (!page.ok) page = await env.ASSETS.fetch(new URL("/404.html", BASE_URL));
  if (!page.ok) return response;

  const headers = new Headers(page.headers);
  headers.set("Cache-Control", "no-store");
  if (subsite) headers.set("X-Robots-Tag", "noindex, nofollow");
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

/**
 * Redirect straight to the shared identity host without an intermediate page.
 *
 * A 401 document with a script used to sit in this path, and any browser that did not run the
 * script (or ran it late) showed a visible "Authentication required" stop that needed a click.
 * A 302 has no body to paint and needs no JavaScript, and the state cookie is honored on it.
 */
export function identityRedirectResponse(identityUrl: string, cookies: string[]): Response {
  const headers = new Headers({
    Location: identityUrl,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/**
 * Send unauthenticated browser page navigations to the shared identity host; non-navigation
 * requests retain the local /login route.
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
      const start = await buildIdentityLoginStart(env, request, current, next);
      if (!start) {
        return new Response("Invalid identity return path\n", {
          status: 400,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      return identityRedirectResponse(start.identityUrl, start.cookies);
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
