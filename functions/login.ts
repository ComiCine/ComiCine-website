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

/** Shared Access login entry and source-site handoff (tasks/17 §11.6 / §11.10). */

import {
  accessAssertion,
  accessConfigError,
  verifyAccessJwt,
} from "./_lib/access";
import {
  configErrorResponse,
  clearLegacySharedSessionCookie,
  randomToken,
  runtimeConfigError,
} from "./_lib/session";
import {
  createIdentityHandoff,
  isIdentitySite,
  parseIdentityCallback,
  safeIdentityTarget,
} from "./_lib/identity";
import type { Env } from "./_lib/env";
import { IDENTITY_HOSTNAME } from "./_lib/config";
import { logEvent } from "./_lib/logging";

const IDENTITY_STATE_COOKIE = "limooo_identity_state";
const IDENTITY_STATE_MAX_AGE_SECONDS = 600;

function noStoreRedirect(target: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: target,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function errorResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function sourceTargetPath(raw: string | null, source: URL): string | null {
  if (!raw) return "/";
  if (raw.startsWith("/")) return safeIdentityTarget(raw);
  try {
    const value = new URL(raw);
    if (
      value.protocol !== "https:" ||
      value.origin !== source.origin ||
      value.username !== "" ||
      value.password !== "" ||
      value.port !== ""
    ) return null;
    return safeIdentityTarget(`${value.pathname}${value.search}${value.hash}`);
  } catch {
    return null;
  }
}

async function startIdentityLogin(env: Env, request: Request, url: URL): Promise<Response> {
  if (!isIdentitySite(url.hostname)) return errorResponse(404, "Not Found");
  const targetPath = sourceTargetPath(url.searchParams.get("next"), url);
  if (targetPath === null) return errorResponse(400, "Invalid return path");

  const state = randomToken(32);
  const callback = new URL("/identity/callback", url.origin);
  callback.searchParams.set("state", state);
  callback.searchParams.set("next", targetPath);

  const identityLogin = new URL("/login", `https://${IDENTITY_HOSTNAME}`);
  identityLogin.searchParams.set("next", callback.toString());

  await logEvent(env, "login_attempt", request, {
    outcome: "pending",
    status: 302,
    message: "identity_start",
  });

  const stateCookie = `${IDENTITY_STATE_COOKIE}=${state}; Path=/identity/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${IDENTITY_STATE_MAX_AGE_SECONDS}`;
  return noStoreRedirect(identityLogin.toString(), [
    stateCookie,
    clearLegacySharedSessionCookie(),
  ]);
}

async function completeIdentityLogin(env: Env, request: Request, url: URL): Promise<Response> {
  const callback = parseIdentityCallback(url.searchParams.get("next"));
  if (!callback) return errorResponse(400, "Invalid identity callback");

  const identity = await verifyAccessJwt(env, accessAssertion(request));
  if (!identity) {
    await logEvent(env, "login_attempt", request, {
      outcome: "failed",
      status: 401,
      message: "access_jwt_invalid",
    });
    return errorResponse(401, "Unauthorized: no valid Cloudflare Access token");
  }

  const code = randomToken(32);
  if (!(await createIdentityHandoff(env, code, identity, callback))) {
    await logEvent(env, "login_attempt", request, {
      outcome: "failed",
      status: 503,
      message: "identity_handoff_unavailable",
    });
    return configErrorResponse("identity_handoff_unavailable");
  }

  const target = new URL("/identity/callback", `https://${callback.sourceHost}`);
  target.searchParams.set("state", callback.state);
  target.searchParams.set("next", callback.targetPath);
  target.searchParams.set("code", code);

  await logEvent(env, "login_attempt", request, {
    outcome: "ok",
    status: 302,
    message: "identity_handoff",
  });

  return noStoreRedirect(target.toString());
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const configError = runtimeConfigError(env);
  if (configError) return configErrorResponse(configError);

  const url = new URL(request.url);
  if (url.hostname === IDENTITY_HOSTNAME) {
    const accessError = accessConfigError(env);
    if (accessError) return configErrorResponse(accessError);
    return completeIdentityLogin(env, request, url);
  }
  return startIdentityLogin(env, request, url);
};
