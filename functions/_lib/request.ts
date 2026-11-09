/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Bounded JSON request-body reader shared by the write endpoints.
 *
 * `request.json()` buffers the whole body before a single field is validated, so one oversized
 * request can consume memory and CPU before it is rejected. Every write endpoint reads its body
 * through `readJsonBody` instead.
 *
 * `Content-Length` is only a cheap early-rejection hint because the client controls it. The
 * streamed byte count is what decides, so a small declared length with a large body is still
 * rejected as soon as the accumulated bytes pass the cap, without reading the rest of the stream.
 */

/** Default cap for admin JSON endpoints. */
export const DEFAULT_MAX_JSON_BODY_BYTES = 8 * 1024;

export type JsonBodyError = "invalid_json" | "payload_too_large";

export interface JsonBodyAccepted {
  ok: true;
  value: unknown;
}

export interface JsonBodyRejected {
  ok: false;
  status: 400 | 413;
  error: JsonBodyError;
}

export type JsonBodyResult = JsonBodyAccepted | JsonBodyRejected;

export type BoundedBodyError = "payload_too_large" | "invalid_body";

export type BoundedBodyResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; error: BoundedBodyError };

const DECIMAL_DIGITS = /^\d+$/;

/** A well-formed `Content-Length`, or null when the header is missing or unusable. */
function declaredLength(request: Request): number | null {
  const raw = (request.headers.get("Content-Length") ?? "").trim();
  if (!DECIMAL_DIGITS.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

/**
 * Read the body without ever buffering more than `maxBytes`.
 *
 * The streamed byte count is authoritative even when Content-Length is missing or inaccurate.
 * The cap is checked before a chunk is retained, and a failed cancellation never replaces the
 * intended 413 result.
 */
export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyResult> {
  const cap = Number.isSafeInteger(maxBytes) && maxBytes > 0
    ? maxBytes
    : DEFAULT_MAX_JSON_BODY_BYTES;
  const declared = declaredLength(request);
  if (declared !== null && declared > cap) {
    return { ok: false, error: "payload_too_large" };
  }

  const body = request.body;
  if (!body) return { ok: true, bytes: new Uint8Array() };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > cap) {
        try {
          await reader.cancel();
        } catch {
          // The stream may already have failed; the size limit still decides the response.
        }
        return { ok: false, error: "payload_too_large" };
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "invalid_body" };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing an errored stream reader can itself fail; the body is already rejected.
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function readJsonBody(
  request: Request,
  options: { maxBytes?: number } = {},
): Promise<JsonBodyResult> {
  const requested = options.maxBytes ?? DEFAULT_MAX_JSON_BODY_BYTES;
  // A non-positive or non-integer cap would silently disable the limit (NaN comparisons are
  // always false), so fall back to the default instead of trusting the caller.
  const maxBytes =
    Number.isSafeInteger(requested) && requested > 0 ? requested : DEFAULT_MAX_JSON_BODY_BYTES;

  const body = await readBoundedBytes(request, maxBytes);
  if (!body.ok) {
    if (body.error === "payload_too_large") {
      return { ok: false, status: 413, error: "payload_too_large" };
    }
    return { ok: false, status: 400, error: "invalid_json" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

/**
 * Standard admin API rejection for a rejected body: JSON, English, never cached.
 *
 * The copy matches the endpoints that use it ("Invalid request" for 400), so callers do not
 * duplicate the mapping. `blocklist.ts` and `identity/exchange.ts` keep their own copy because
 * their existing responses use a different style.
 */
export function jsonBodyRejection(result: JsonBodyRejected): Response {
  return Response.json(
    { error: result.status === 413 ? "Request body too large" : "Invalid request" },
    { status: result.status, headers: { "Cache-Control": "no-store" } },
  );
}
