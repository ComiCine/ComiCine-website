/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** GET /api/auth/status (issues a CSRF double-submit token for authenticated users). */

import { createCsrfToken, csrfCookieHeader, isValidCsrfToken } from "../../_lib/csrf";
import { CSRF_COOKIE } from "../../_lib/config";
import { getCookie } from "../../_lib/routing";
import { authUnavailableResponse, requireAuth } from "../../_lib/session";
import type { Env } from "../../_lib/env";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  let session: Awaited<ReturnType<typeof requireAuth>>;
  try {
    session = await requireAuth(context.env, context.request);
  } catch {
    return authUnavailableResponse();
  }
  if (!session) {
    return Response.json(
      { authed: false, user: null, role: "viewer" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  let token = getCookie(CSRF_COOKIE, context.request.headers.get("Cookie")) ?? "";
  try {
    if (!token || !(await isValidCsrfToken(context.env, token, session.sid))) {
      ({ token } = await createCsrfToken(context.env, session.sid));
    }
  } catch {
    return Response.json(
      { error: "csrf_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.set("X-CSRF-Token", token);
  headers.set(
    "Set-Cookie",
    csrfCookieHeader(token, new URL(context.request.url).protocol === "https:"),
  );
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(
    JSON.stringify({
      authed: true,
      user: session.user,
      role: session.role,
      csrf_token: token,
    }),
    { headers },
  );
};
