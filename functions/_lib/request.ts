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

const DECIMAL_DIGITS = /^\d+$/;

/** A well-formed `Content-Length`, or null when the header is missing or unusable. */
function declaredLength(request: Request): number | null {
  const raw = (request.headers.get("Content-Length") ?? "").trim();
  if (!DECIMAL_DIGITS.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

/**
 * Read the body as UTF-8 text without ever buffering more than `maxBytes`.
 *
 * The cap is checked before a chunk is kept, so the retained chunks stay within the limit even
 * when the sender declares a smaller length or omits the header.
 */
async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  const body = request.body;
  // A bodyless request still goes through JSON parsing, which rejects the empty string.
  if (!body) return { ok: true, text: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // A stream that already failed cannot be cancelled; the body is rejected either way.
        }
        return { ok: false, tooLarge: true };
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    // Invalid UTF-8 is a malformed body, not an oversized one.
    return { ok: false, tooLarge: false };
  }
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

  const declared = declaredLength(request);
  if (declared !== null && declared > maxBytes) {
    return { ok: false, status: 413, error: "payload_too_large" };
  }

  const body = await readBoundedText(request, maxBytes);
  if (!body.ok) {
    if (body.tooLarge) return { ok: false, status: 413, error: "payload_too_large" };
    return { ok: false, status: 400, error: "invalid_json" };
  }
  try {
    return { ok: true, value: JSON.parse(body.text) as unknown };
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
