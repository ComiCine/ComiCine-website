/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Shared Access login entry and source-site handoff (tasks/17 §11.6 / §11.10). */

import {
  accessAssertion,
  accessConfigError,
  verifyAccessJwt,
} from "./_lib/access";
import {
  configErrorResponse,
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
import { IDENTITY_HOSTS } from "./_lib/config";
import { buildIdentityLoginStart } from "./_lib/identity-login";
import { logEvent } from "./_lib/logging";

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
  const start = await buildIdentityLoginStart(env, request, url, targetPath);
  if (!start) return errorResponse(400, "Invalid return path");
  return noStoreRedirect(start.identityUrl, start.cookies);
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
  if (IDENTITY_HOSTS.has(url.hostname)) {
    const accessError = accessConfigError(env);
    if (accessError) return configErrorResponse(accessError);
    return completeIdentityLogin(env, request, url);
  }
  return startIdentityLogin(env, request, url);
};
