/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * GET /login → Cloudflare Access identity handoff (tasks/17 §11.6 / §11.10)
 *
 * Access sits in front of `visitor.limooo.cn` and `account.limooo.cn/apple`.
 * Authenticated users arrive with a `Cf-Access-Jwt-Assertion` request header. This endpoint:
 *
 *   1. verifies the Access JWT (**verification is mandatory**; otherwise a forged header could impersonate an admin);
 *   2. uses AUD to distinguish admin from viewer;
 *   3. writes to D1 `auth_sessions` and issues a cross-subdomain session cookie;
 *   4. redirects to `next` with 302.
 *
 * The session layer follows tasks/09: requireAuth checks both the signed cookie and the revocation table.
 * Sensitive endpoints return 503 when the table is unavailable; the cookie alone never grants access.
 */

import {
  accessAssertion,
  accessConfigError,
  verifyAccessJwt,
} from "./_lib/access";
import {
  configErrorResponse,
  createAuthSession,
  createSessionCookie,
  randomToken,
  runtimeConfigError,
} from "./_lib/session";
import type { Env } from "./_lib/env";
import { logEvent } from "./_lib/logging";
import { safeNextUrl } from "./_lib/routing";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const configError = runtimeConfigError(env) || accessConfigError(env);
  if (configError) return configErrorResponse(configError);

  const next = safeNextUrl(new URL(request.url).searchParams.get("next"));
  const identity = await verifyAccessJwt(env, accessAssertion(request));
  if (!identity) {
    await logEvent(env, "login_attempt", request, {
      outcome: "failed",
      status: 401,
      message: "access_jwt_invalid",
    });
    // Reaching this point means Access did not take effect (the hostname is not protected or the JWT was modified).
    // Return 401 instead of creating a local login page; Access is the sole identity provider.
    return new Response("Unauthorized: no valid Cloudflare Access token\n", {
      status: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const session = {
    sid: randomToken(24),
    sub: identity.sub,
    user: { email: identity.email, name: identity.email },
    role: identity.role,
    authAt: now,
  };
  if (!(await createAuthSession(env, session))) {
    await logEvent(env, "login_attempt", request, {
      outcome: "failed",
      status: 503,
      message: "auth_sessions_unavailable",
    });
    return configErrorResponse("auth_sessions_unavailable");
  }

  await logEvent(env, "login_attempt", request, {
    outcome: "ok",
    status: 302,
    message: `role=${session.role}`,
  });

  // Resolve a relative next against the **current request host** so login returns to the subdomain where Access was used.
  // Resolving against the main-site BASE_URL would send `account.limooo.cn/apple` to
  // `limooo.cn/apple` (which has no route and returns 404). Use allowlisted absolute URLs as-is.
  const target = next.startsWith("/") ? new URL(next, request.url).toString() : next;
  const resp = new Response(null, { status: 302, headers: { Location: target } });
  resp.headers.append("Set-Cookie", await createSessionCookie(env, session));
  return resp;
};
