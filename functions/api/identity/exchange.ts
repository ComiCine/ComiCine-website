/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Consume a short-lived identity handoff code from a registered source host. */

import { consumeIdentityHandoff } from "../../_lib/identity";
import type { Env } from "../../_lib/env";
import { IDENTITY_HOSTS } from "../../_lib/config";

const MAX_BODY_BYTES = 2048;

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

async function readLimitedBody(request: Request): Promise<string | null> {
  if ((request.headers.get("Content-Length") ?? "").trim() !== "") {
    const length = Number(request.headers.get("Content-Length"));
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_BODY_BYTES) return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return null;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!IDENTITY_HOSTS.has(new URL(request.url).hostname)) return response(404, "Not Found");
  if ((request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return response(415, "Unsupported Media Type");
  }

  const text = await readLimitedBody(request);
  if (text === null) return response(400, "Invalid request");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return response(400, "Invalid request");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return response(400, "Invalid request");
  }
  const input = parsed as { code?: unknown; sourceHost?: unknown; state?: unknown };
  if (
    typeof input.code !== "string" ||
    typeof input.sourceHost !== "string" ||
    typeof input.state !== "string"
  ) return response(400, "Invalid request");

  const handoff = await consumeIdentityHandoff(
    env,
    input.code,
    input.sourceHost.toLowerCase(),
    input.state,
  );
  if (!handoff) return response(401, "Invalid or expired identity handoff");
  return response(200, handoff);
};
