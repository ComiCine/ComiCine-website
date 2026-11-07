/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onRequestPost,
  resetCspReportLogThrottle,
  resetCspReportRateLimit,
} from "./csp-report";
import type { Env } from "../_lib/env";

const ENDPOINT = "https://comicine.com/api/csp-report";

function context(request: Request, env: Partial<Env> = {}) {
  return {
    request,
    env: { OBSERVABILITY_HMAC_KEY: "test-observability-key", ...env } as Env,
    params: {},
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  } as Parameters<typeof onRequestPost>[0];
}

function post(body: string, contentType = "application/csp-report", ip = "97.64.18.11"): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": contentType, "CF-Connecting-IP": ip, "CF-Ray": "8c1f-abc" },
    body,
  });
}

function legacyReport(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    "csp-report": {
      "document-uri": "https://comicine.com/services",
      "effective-directive": "script-src-elem",
      "violated-directive": "script-src-elem",
      "blocked-uri": "https://example.com/tracker.js",
      "disposition": "report",
      ...overrides,
    },
  });
}

function loggedLines(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
  return spy.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetCspReportRateLimit();
  resetCspReportLogThrottle();
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleSpy.mockRestore();
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("accepts a legacy application/csp-report violation with 204 and one structured log line", async () => {
    const response = await onRequestPost(context(post(legacyReport())));

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const lines = loggedLines(consoleSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "csp_report",
      path: "/api/csp-report",
      host: "comicine.com",
      request_id: "8c1f-abc",
      effective_directive: "script-src-elem",
      blocked_uri: "https://example.com/tracker.js",
      document_uri: "https://comicine.com/services",
      disposition: "report",
    });
    expect(lines[0].ip_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("accepts a Reporting API batch, logs only csp-violation entries and caps the batch size", async () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      type: "csp-violation",
      url: `https://comicine.com/page-${index}`,
      body: {
        effectiveDirective: "connect-src",
        blockedURL: `https://blocked.example/${index}`,
        documentURL: `https://comicine.com/page-${index}`,
        disposition: "report",
      },
    }));
    entries.push({ type: "deprecation", body: {} } as (typeof entries)[number]);

    const response = await onRequestPost(
      context(post(JSON.stringify(entries), "application/reports+json")),
    );

    expect(response.status).toBe(204);
    const lines = loggedLines(consoleSpy);
    expect(lines).toHaveLength(10);
    expect(lines.every((line) => line.effective_directive === "connect-src")).toBe(true);
    expect(lines.map((line) => line.blocked_uri)).not.toContain("https://blocked.example/10");
  });

  it("rejects an unsupported media type with 415", async () => {
    const response = await onRequestPost(context(post(legacyReport(), "application/json")));

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("returns 413 when the declared body exceeds 16 KB", async () => {
    const response = await onRequestPost(
      context(post(JSON.stringify({ "csp-report": { padding: "x".repeat(20 * 1024) } }))),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });

  it("returns 413 when a streamed body without Content-Length exceeds 16 KB", async () => {
    const chunk = new Uint8Array(20 * 1024);
    const request = new Request(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/csp-report", "CF-Connecting-IP": "97.64.18.11" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    expect(request.headers.get("Content-Length")).toBeNull();
    const response = await onRequestPost(context(request));

    expect(response.status).toBe(413);
  });

  it("returns 400 for an empty or unparseable body", async () => {
    const empty = await onRequestPost(
      context(
        new Request(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/csp-report", "CF-Connecting-IP": "97.64.18.11" },
        }),
      ),
    );
    expect(empty.status).toBe(400);

    const notJson = await onRequestPost(context(post("not json")));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: "invalid_report" });
  });

  it("returns 429 after 30 requests from one source and recovers for other sources", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await onRequestPost(context(post(legacyReport())));
      expect(response.status).toBe(204);
    }

    const limited = await onRequestPost(context(post(legacyReport())));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);

    const otherSource = await onRequestPost(context(post(legacyReport(), "application/csp-report", "198.51.100.7")));
    expect(otherSource.status).toBe(204);

    resetCspReportRateLimit();
    const afterReset = await onRequestPost(context(post(legacyReport())));
    expect(afterReset.status).toBe(204);
  });

  it("deduplicates identical violations within the window but still answers 204", async () => {
    const first = await onRequestPost(context(post(legacyReport())));
    const second = await onRequestPost(context(post(legacyReport())));

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    const distinct = await onRequestPost(
      context(post(legacyReport({ "blocked-uri": "https://example.com/other.js" }))),
    );
    expect(distinct.status).toBe(204);
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it("redacts query strings and credentials before logging the document URI", async () => {
    await onRequestPost(
      context(
        post(
          legacyReport({
            "document-uri": "https://comicine.com/services?token=super-secret-value",
            "blocked-uri": "https://example.com/a.js?key=another-secret",
          }),
        ),
      ),
    );

    const serialized = JSON.stringify(loggedLines(consoleSpy));
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("another-secret");
    expect(serialized).toContain("[redacted]");
  });

  it("never reads D1", async () => {
    const env: Partial<Env> = { OBSERVABILITY_HMAC_KEY: "test-observability-key" };
    Object.defineProperty(env, "DB", {
      get() {
        throw new Error("the CSP report collector must not touch D1");
      },
    });

    const response = await onRequestPost(context(post(legacyReport()), env));

    expect(response.status).toBe(204);
  });
});
