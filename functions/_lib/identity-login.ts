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

/** Build the host-bound start of a shared Cloudflare Access identity handoff. */

import { IDENTITY_HOSTNAME } from "./config";
import type { Env } from "./env";
import { isIdentitySite, safeIdentityTarget } from "./identity";
import { logEvent } from "./logging";
import { clearLegacySharedSessionCookie, randomToken } from "./session";

const IDENTITY_STATE_COOKIE_PREFIX = "limooo_identity_state_";
const IDENTITY_STATE_MAX_AGE_SECONDS = 600;

export interface IdentityLoginStart {
  identityUrl: string;
  cookies: string[];
}

export async function buildIdentityLoginStart(
  env: Env,
  request: Request,
  source: URL,
  targetPath: string,
  responseStatus: 302 | 401 = 302,
): Promise<IdentityLoginStart | null> {
  const safeTargetPath = safeIdentityTarget(targetPath);
  if (
    source.protocol !== "https:" ||
    source.port !== "" ||
    source.origin !== `https://${source.hostname}` ||
    !isIdentitySite(source.hostname) ||
    safeTargetPath !== targetPath
  ) return null;

  const state = randomToken(32);
  const callback = new URL("/identity/callback", source.origin);
  callback.searchParams.set("state", state);
  callback.searchParams.set("next", safeTargetPath);

  const identityLogin = new URL("/login", `https://${IDENTITY_HOSTNAME}`);
  identityLogin.searchParams.set("next", callback.toString());

  await logEvent(env, "login_attempt", request, {
    outcome: "pending",
    status: responseStatus,
    message: "identity_start",
  });

  const stateCookie = `${IDENTITY_STATE_COOKIE_PREFIX}${state}=${state}; Path=/identity/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${IDENTITY_STATE_MAX_AGE_SECONDS}`;
  return {
    identityUrl: identityLogin.toString(),
    cookies: [stateCookie, clearLegacySharedSessionCookie()],
  };
}
