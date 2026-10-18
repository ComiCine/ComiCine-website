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

/** Validate and consume the one-time callback for a registered Limooo site. */

import {
  configErrorResponse,
  createAuthSession,
  createSessionCookie,
  randomToken,
  runtimeConfigError,
} from "../_lib/session";
import { IDENTITY_HOSTNAME } from "../_lib/config";
import {
  identityRoleForHost,
  safeIdentityTarget,
} from "../_lib/identity";
import { timingSafeEqual } from "../_lib/crypto";
import type { Env } from "../_lib/env";
import { getCookie } from "../_lib/routing";
import { logEvent } from "../_lib/logging";

const IDENTITY_STATE_COOKIE = "limooo_identity_state";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function clearStateCookie(): string {
  return `${IDENTITY_STATE_COOKIE}=; Path=/identity/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function response(status: number, body: string): Response {
  return new Response(`${body}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": clearStateCookie(),
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const sourceHost = url.hostname.toLowerCase();
  const expectedRole = identityRoleForHost(sourceHost);
  if (!expectedRole || sourceHost === IDENTITY_HOSTNAME) return response(404, "Not Found");

  const codes = url.searchParams.getAll("code");
  const states = url.searchParams.getAll("state");
  const targets = url.searchParams.getAll("next");
  if (
    codes.length !== 1 ||
    states.length !== 1 ||
    targets.length !== 1 ||
    [...url.searchParams.keys()].length !== 3 ||
    !TOKEN_PATTERN.test(codes[0]) ||
    !TOKEN_PATTERN.test(states[0]) ||
    !timingSafeEqual(states[0], getCookie(IDENTITY_STATE_COOKIE, request.headers.get("Cookie")) ?? "")
  ) return response(401, "Invalid identity callback");

  const targetPath = safeIdentityTarget(targets[0]);
  if (targetPath === null) return response(400, "Invalid return path");
  const configError = runtimeConfigError(env);
  if (configError) return configErrorResponse(configError);

  let exchange: Response;
  try {
    exchange = await fetch(`https://${IDENTITY_HOSTNAME}/api/identity/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: codes[0], sourceHost, state: states[0] }),
    });
  } catch {
    return response(503, "Identity service unavailable");
  }
  if (!exchange.ok) {
    return response(exchange.status >= 500 ? 503 : 401, "Identity handoff rejected");
  }

  let handoff: {
    sourceHost?: unknown;
    targetPath?: unknown;
    sub?: unknown;
    email?: unknown;
    authAt?: unknown;
  };
  try {
    handoff = await exchange.json() as typeof handoff;
  } catch {
    return response(503, "Invalid identity response");
  }
  if (
    handoff.sourceHost !== sourceHost ||
    handoff.targetPath !== targetPath ||
    typeof handoff.sub !== "string" || !handoff.sub || handoff.sub.length > 512 ||
    typeof handoff.email !== "string" || !handoff.email || handoff.email.length > 254 ||
    typeof handoff.authAt !== "number" || !Number.isSafeInteger(handoff.authAt) || handoff.authAt < 0
  ) return response(401, "Invalid identity response");

  const session = {
    sid: randomToken(24),
    sub: handoff.sub,
    user: { email: handoff.email, name: handoff.email },
    role: expectedRole,
    authAt: handoff.authAt,
  } as const;
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

  const headers = new Headers({
    Location: new URL(targetPath, url.origin).toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": clearStateCookie(),
  });
  headers.append("Set-Cookie", await createSessionCookie(env, session));
  return new Response(null, { status: 302, headers });
};
