/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Consume a short-lived identity handoff code from a registered source host. */

import {
  consumeIdentityHandoff,
  IdentityStoreUnavailable,
} from "../../_lib/identity";
import type { ConsumedIdentityHandoff } from "../../_lib/identity";
import { logEvent } from "../../_lib/logging";
import { readJsonBody } from "../../_lib/request";
import type { Env } from "../../_lib/env";
import { IDENTITY_HOSTS } from "../../_lib/config";

const MAX_BODY_BYTES = 2048;

/**
 * Build a locatable log message without leaking either credential.
 *
 * The driver error is kept because it is what an operator needs to tell a
 * missing table from a quota outage, but the handoff code and state are
 * scrubbed in case a driver or test double echoes bound values.
 */
function storeFailureLogMessage(error: IdentityStoreUnavailable, secrets: string[]): string {
  const cause = error.cause instanceof Error
    ? `${error.cause.name}: ${error.cause.message}`
    : "";
  let message = cause ? `${error.message} ${cause}` : error.message;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[redacted]");
  }
  return message;
}

function response(status: number, body: string | object): Response {
  const isText = typeof body === "string";
  return new Response(isText ? `${body}\n` : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!IDENTITY_HOSTS.has(new URL(request.url).hostname)) return response(404, "Not Found");
  if ((request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response(415, "Unsupported Media Type");
  }

  const body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
  if (!body.ok) {
    // An oversized body is 413; anything that is not JSON stays 400 as before.
    return body.status === 413
      ? response(413, "Payload Too Large")
      : response(400, "Invalid request");
  }
  const parsed = body.value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return response(400, "Invalid request");
  }
  const input = parsed as { code?: unknown; sourceHost?: unknown; state?: unknown };
  if (
    typeof input.code !== "string" ||
    typeof input.sourceHost !== "string" ||
    typeof input.state !== "string"
  ) return response(400, "Invalid request");

  const sourceHost = input.sourceHost.toLowerCase();
  let handoff: ConsumedIdentityHandoff | null;
  try {
    handoff = await consumeIdentityHandoff(env, input.code, sourceHost, input.state);
  } catch (error) {
    if (!(error instanceof IdentityStoreUnavailable)) throw error;
    await logEvent(env, "login_attempt", request, {
      outcome: "failed",
      status: 503,
      message: storeFailureLogMessage(error, [input.code, input.state]),
    });
    // The body stays generic so an outage does not disclose storage details.
    return response(503, { error: "identity_store_unavailable" });
  }
  if (!handoff) return response(401, "Invalid or expired identity handoff");
  return response(200, handoff);
};
