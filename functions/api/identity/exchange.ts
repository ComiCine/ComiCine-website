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

/** Consume a short-lived identity handoff code from a registered source host. */

import { consumeIdentityHandoff } from "../../_lib/identity";
import type { Env } from "../../_lib/env";
import { IDENTITY_HOSTNAME } from "../../_lib/config";

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
  if (new URL(request.url).hostname !== IDENTITY_HOSTNAME) return response(404, "Not Found");
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
