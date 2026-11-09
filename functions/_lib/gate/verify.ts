/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** POST /__gate/verify: Turnstile validation and __gate cookie issuance. */

import { logEvent } from "../logging";
import { shouldLogDiagnostic } from "../sampling";
import { readBoundedBytes } from "../request";
import {
  clientIpForLogs,
  defer,
  requestUrl,
  safeNextPath,
  sanitizeHost,
  type RequestContext,
} from "../routing";
import { gateCookieHeaders } from "./cookie";
import { renderGatePage } from "./page";
import { verifyTurnstile } from "./turnstile";

/** Turnstile's documented cdata limit; anything longer cannot have been echoed by the widget. */
const TURNSTILE_CDATA_MAX_LENGTH = 255;
const MAX_VERIFY_BODY_BYTES = 8 * 1024;

function wantsJson(request: Request): boolean {
  return request.headers.get("Accept")?.includes("application/json") ?? false;
}

function gateTarget(host: string, path: string): string {
  return `https://${host}${path}`;
}

function invalidFormResponse(context: RequestContext, startedAt: number): Promise<Response> {
  const { request, env } = context;
  if (shouldLogDiagnostic("gate_verify_invalid_form", clientIpForLogs(request))) {
    defer(
      context,
      logEvent(env, "gate_verify", request, {
        outcome: "failed",
        status: 400,
        durationMs: Date.now() - startedAt,
        message: "invalid_form",
      }),
    );
  }
  return renderGatePage(context, { errorKey: "invalid" });
}

/** POST /__gate/verify: validate Turnstile and issue a cookie on success.
 *
 * The gate page calls this endpoint with fetch. The response sets only a
 * cookie and does not pass through the redirect subdomain. Without JavaScript,
 * the page still returns to the original site as an accessibility fallback.
 */
export async function handleVerify(context: RequestContext): Promise<Response> {
  const { request, env } = context;
  const startedAt = Date.now();
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", "Cache-Control": "no-store" },
    });
  }

  const boundedBody = await readBoundedBytes(request, MAX_VERIFY_BODY_BYTES);
  if (!boundedBody.ok) return invalidFormResponse(context, startedAt);

  let form: FormData;
  try {
    const headers = new Headers(request.headers);
    headers.delete("Content-Length");
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers,
      body: boundedBody.bytes,
    });
    form = await boundedRequest.formData();
  } catch {
    // Malformed form data is attacker-controlled (a JSON body makes formData() throw),
    // so it must not produce one D1 row per POST.
    return invalidFormResponse(context, startedAt);
  }

  // Turnstile tokens are ~2 KB; cap the field before it reaches siteverify or the logs.
  const submittedToken = form.get("cf-turnstile-response")?.toString() ?? "";
  const token = submittedToken.length <= 2048 ? submittedToken : "";
// The gate front-end (src/static/js/auth.js) does not send cdata today, so this
// check is inactive until a widget supplies the field; never treat it as required.
  const cdata = (form.get("cdata")?.toString() ?? "").slice(0, TURNSTILE_CDATA_MAX_LENGTH);
  const next = safeNextPath(form.get("next")?.toString() ?? null);
  const host = sanitizeHost(form.get("host")?.toString() ?? null);
// Turnstile compares remoteip with the challenge source. Pass only the
// connection IP identified by Cloudflare; never trust visitor-supplied
// forwarding headers, which would let visitors choose the verification input.
  const remoteip = clientIpForLogs(request);

  let success = false;
  let unavailable = false;
  const verifyDiagnostics: { reason?: string } = {};
// Both secrets are required: TURNSTILE_SECRET verifies challenges and
// GATE_HMAC_KEY signs cookies. Previously only the first was checked, so an
// empty GATE_HMAC_KEY could reach gateCookieHeaders("") and issue a __gate
// cookie with an **empty key**. Middleware runtimeConfigError currently catches
// this, but this handler is the fallback when middleware routing is missing
// and must enforce the check itself (tasks/22 W9-11).
  if (!env.TURNSTILE_SECRET || !env.GATE_HMAC_KEY) {
    unavailable = true;
  } else {
    try {
      success = token !== "" && (await verifyTurnstile(
        token,
        remoteip,
        env.TURNSTILE_SECRET,
        verifyDiagnostics,
        cdata || undefined,
      ));
    } catch {
      unavailable = true;
    }
  }

  if (!success) {
    if (shouldLogDiagnostic("gate_verify", remoteip)) {
      defer(
        context,
        logEvent(env, "gate_verify", request, {
          outcome: unavailable ? "unavailable" : "failed",
          status: unavailable ? 503 : 403,
          durationMs: Date.now() - startedAt,
          message: unavailable
            ? env.GATE_HMAC_KEY
              ? env.TURNSTILE_SECRET
                ? verifyDiagnostics.reason ?? "turnstile_unavailable"
                : "turnstile_secret_missing"
              : "gate_hmac_key_missing"
            : token
              ? verifyDiagnostics.reason ?? "turnstile_rejected"
              : "missing_token",
        }),
      );
    }
    const errorKey = unavailable ? "unavailable" : "failed";
    if (wantsJson(request)) {
      return Response.json(
        { ok: false, error: errorKey },
        { status: unavailable ? 503 : 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    return renderGatePage(context, {
      host,
      next,
      unavailable,
      errorKey,
    });
  }

// Clear the old host-only scope before writing the new domain cookie.
  //
// Deliberately send two Set-Cookie headers: the old same-name host-only cookie
// coexists with the new domain cookie and remains first in the request header.
// Writing only the new cookie would not remove the old one. preserveSetCookie
// prevents the headers from being merged, avoiding Safari's first-header issue.
  const cookies = await gateCookieHeaders(env.GATE_HMAC_KEY, requestUrl(request).hostname);
  defer(
    context,
    logEvent(env, "gate_verify", request, {
      outcome: "success",
      status: 204,
      durationMs: Date.now() - startedAt,
      message: "cookie_issued",
    }),
  );

  if (wantsJson(request)) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 204, headers });
  }

  const headers = new Headers({
    Location: gateTarget(host, next),
    "Cache-Control": "no-store",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}
