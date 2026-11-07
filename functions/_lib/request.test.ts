/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Bounded JSON body reading and the standard admin rejection response. */

import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_JSON_BODY_BYTES, jsonBodyRejection, readJsonBody } from "./request";

const ENDPOINT = "https://example.test/api";

/** POST request with a string body and an optional declared Content-Length. */
function jsonRequest(body: string, contentLength?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (contentLength !== undefined) headers["Content-Length"] = contentLength;
  return new Request(ENDPOINT, { method: "POST", body, headers });
}

/**
 * POST request whose body is a stream. Node requires `duplex: "half"` for a stream body, and
 * test files are excluded from `tsc`, so the cast keeps the runtime-only option out of the types.
 */
function streamRequest(body: ReadableStream<Uint8Array>, contentLength?: string): Request {
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers["Content-Length"] = contentLength;
  return new Request(ENDPOINT, { method: "POST", body, headers, duplex: "half" } as RequestInit);
}

/** JSON body of the form {"x":"aaa..."} plus the exact number of UTF-8 bytes it serializes to. */
function sizedJson(filler: number): { text: string; bytes: number } {
  const text = JSON.stringify({ x: "a".repeat(filler) });
  return { text, bytes: new TextEncoder().encode(text).byteLength };
}

/**
 * Stream that produces fixed-size chunks on demand up to `maxChunks` and records how much it
 * produced and whether the consumer cancelled it.
 *
 * `highWaterMark: 0` matters: with the default queue the Request constructor itself pulls one
 * chunk, so the counter would no longer measure only what `readJsonBody` asked for.
 */
function countingStream(chunkSize: number, maxChunks: number) {
  const stats = { pulledBytes: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (stats.pulledBytes >= chunkSize * maxChunks) {
          controller.close();
          return;
        }
        stats.pulledBytes += chunkSize;
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() {
        stats.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, stats };
}

describe("readJsonBody", () => {
  it("accepts a normal JSON payload", async () => {
    const result = await readJsonBody(jsonRequest(JSON.stringify({ message: "hello", count: 3 })));

    expect(result).toMatchObject({ ok: true, value: { message: "hello", count: 3 } });
  });

  it("rejects a declared Content-Length above the cap without pulling the body", async () => {
    const { stream, stats } = countingStream(4096, 1);

    const result = await readJsonBody(streamRequest(stream, "999999"));

    expect(result).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
    // The header alone decided the rejection, so the body stream was never read.
    expect(stats.pulledBytes).toBe(0);
  });

  it("rejects a body that is actually larger than the cap", async () => {
    const payload = sizedJson(8992);
    expect(payload.bytes).toBe(9000);

    const result = await readJsonBody(jsonRequest(payload.text));

    expect(result).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
  });

  it("does not trust a small declared Content-Length", async () => {
    const payload = sizedJson(8992);

    const result = await readJsonBody(jsonRequest(payload.text, "1"));

    expect(result).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
  });

  it("ignores a malformed Content-Length", async () => {
    const accepted = await readJsonBody(jsonRequest(JSON.stringify({ hello: "world" }), "12x"));
    expect(accepted).toMatchObject({ ok: true, value: { hello: "world" } });

    const oversized = sizedJson(8992);
    const rejected = await readJsonBody(jsonRequest(oversized.text, "12x"));
    expect(rejected).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
  });

  it("accepts a full-size payload under the cap", async () => {
    const payload = sizedJson(7992);
    expect(payload.bytes).toBe(8000);

    const result = await readJsonBody(jsonRequest(payload.text));

    expect(result).toMatchObject({ ok: true, value: { x: "a".repeat(7992) } });
  });

  it("rejects invalid JSON", async () => {
    const result = await readJsonBody(jsonRequest('{"broken":'));

    expect(result).toMatchObject({ ok: false, status: 400, error: "invalid_json" });
  });

  it("rejects an empty body and Content-Length: 0 as invalid JSON", async () => {
    const bodyless = new Request(ENDPOINT, { method: "POST" });
    expect(bodyless.body).toBeNull();
    expect(await readJsonBody(bodyless)).toMatchObject({
      ok: false,
      status: 400,
      error: "invalid_json",
    });

    const declaredZero = new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Length": "0" },
    });
    expect(await readJsonBody(declaredZero)).toMatchObject({
      ok: false,
      status: 400,
      error: "invalid_json",
    });
  });

  it("accepts a body of exactly maxBytes and rejects one byte more", async () => {
    const payload = sizedJson(64);

    const atCap = await readJsonBody(jsonRequest(payload.text), { maxBytes: payload.bytes });
    expect(atCap).toMatchObject({ ok: true, value: { x: "a".repeat(64) } });

    const oneMore = await readJsonBody(jsonRequest(payload.text), { maxBytes: payload.bytes - 1 });
    expect(oneMore).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
  });

  it("cancels the stream once the cap is exceeded and keeps reading bounded", async () => {
    const chunkBytes = 4096;
    // 256 chunks is 1 MiB, so even a reader that never cancels terminates.
    const { stream, stats } = countingStream(chunkBytes, 256);

    const result = await readJsonBody(streamRequest(stream), { maxBytes: chunkBytes });

    expect(result).toMatchObject({ ok: false, status: 413, error: "payload_too_large" });
    expect(stats.cancelled).toBe(true);
    // At most the accepted chunks plus the one chunk that tripped the cap was ever produced.
    expect(stats.pulledBytes).toBeLessThanOrEqual(2 * chunkBytes);
  });

  it("rejects invalid UTF-8 as invalid JSON", async () => {
    const request = new Request(ENDPOINT, { method: "POST", body: new Uint8Array([0xff, 0xfe]) });

    expect(await readJsonBody(request)).toMatchObject({
      ok: false,
      status: 400,
      error: "invalid_json",
    });
  });

  it("applies the default cap when maxBytes is omitted", async () => {
    expect(DEFAULT_MAX_JSON_BODY_BYTES).toBe(8192);

    const payload = sizedJson(DEFAULT_MAX_JSON_BODY_BYTES);
    expect(payload.bytes).toBeGreaterThan(DEFAULT_MAX_JSON_BODY_BYTES);

    expect(await readJsonBody(jsonRequest(payload.text))).toMatchObject({
      ok: false,
      status: 413,
      error: "payload_too_large",
    });
  });

  it("enforces a custom maxBytes", async () => {
    const payload = sizedJson(2992);
    expect(payload.bytes).toBe(3000);

    expect(await readJsonBody(jsonRequest(payload.text), { maxBytes: 2048 })).toMatchObject({
      ok: false,
      status: 413,
      error: "payload_too_large",
    });
    // The same body is accepted under its own size, so the cap caused the rejection.
    expect(await readJsonBody(jsonRequest(payload.text), { maxBytes: 3000 })).toMatchObject({
      ok: true,
      value: { x: "a".repeat(2992) },
    });
  });

  it("falls back to the default cap for a non-positive or non-integer maxBytes", async () => {
    for (const maxBytes of [0, -1, Number.NaN]) {
      const accepted = await readJsonBody(jsonRequest(JSON.stringify({ ok: true })), { maxBytes });
      expect(accepted, `maxBytes=${maxBytes}`).toMatchObject({ ok: true, value: { ok: true } });
    }

    // The fallback keeps the 8192-byte cap instead of dropping the limit.
    const oversized = sizedJson(DEFAULT_MAX_JSON_BODY_BYTES);
    expect(await readJsonBody(jsonRequest(oversized.text), { maxBytes: 0 })).toMatchObject({
      ok: false,
      status: 413,
      error: "payload_too_large",
    });
  });
});

describe("jsonBodyRejection", () => {
  it("renders a payload_too_large rejection as a no-store JSON response", async () => {
    const response = jsonBodyRejection({ ok: false, status: 413, error: "payload_too_large" });

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ error: "Request body too large" });
  });

  it("renders an invalid_json rejection as a no-store JSON response", async () => {
    const response = jsonBodyRejection({ ok: false, status: 400, error: "invalid_json" });

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ error: "Invalid request" });
  });
});
