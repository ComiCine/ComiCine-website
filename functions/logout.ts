/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * GET /logout → revoke the D1 session, clear cookies, and redirect to the Access logout endpoint (tasks/17 §11.6).
 *
 * Both steps are required:
 * - Revoke the D1 `auth_sessions` row so the application session immediately becomes invalid (requireAuth fails closed).
 * - Redirect through Access logout to clear Cloudflare's `CF_Authorization`; otherwise Access may automatically
 *   authenticate the next request with the remaining session, making logout appear ineffective.
 */

import { accessLogoutUrl, accessTeamDomain } from "./_lib/access";
import {
  clearPendingCookie,
  clearLegacySharedSessionCookie,
  clearSessionCookie,
  configErrorResponse,
  readSession,
  revokeAuthSession,
  runtimeConfigError,
} from "./_lib/session";
import type { Env } from "./_lib/env";
import { logEvent } from "./_lib/logging";
import { safeNextUrl } from "./_lib/routing";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const url = new URL(request.url);
  const configError = runtimeConfigError(env);
  if (configError) return configErrorResponse(configError);

  // `next` goes directly into Location, so apply the same validation as /login: allow only site-relative
  // paths or HTTPS URLs on allowlisted hosts. Otherwise, when ACCESS_TEAM_DOMAIN is empty (which occurred
  // in production; see tasks/17 §11.10), the `target = next` branch becomes an open redirect. CR/LF in an
  // invalid value can also make workerd throw while constructing response headers, returning 500 (tasks/22 W9-3).
  const next = safeNextUrl(url.searchParams.get("next"));
  const session = await readSession(env, request.headers.get("Cookie"));
  if (session?.sid) {
    const revoked = await revokeAuthSession(env, session.sid);
    if (!revoked) {
      await logEvent(env, "logout", request, {
        outcome: "failed",
        status: 503,
        message: "revoke_unavailable",
      });
      return configErrorResponse("auth_sessions_unavailable");
    }
  }

  await logEvent(env, "logout", request, {
    outcome: "ok",
    status: 302,
    message: session ? `sid=${session.sid.slice(0, 8)}` : "no_session",
  });

  // If Access is not configured, fall back to redirecting only to next; the local session has already been revoked.
  const target = accessTeamDomain(env) ? accessLogoutUrl(env, next) : next;
  const resp = new Response(null, { status: 302, headers: { Location: target } });
  resp.headers.append("Set-Cookie", clearSessionCookie());
  resp.headers.append("Set-Cookie", clearLegacySharedSessionCookie());
  resp.headers.append("Set-Cookie", clearPendingCookie());
  return resp;
};
