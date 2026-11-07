/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * CSP violation collector at POST /api/csp-report.
 *
 * The `Content-Security-Policy-Report-Only` header in `_lib/security.ts` sends
 * both `report-to csp` and `report-uri /api/csp-report` here, so the endpoint
 * accepts the Reporting API media type and the legacy CSP one. Reports are
 * diagnostic: the handler writes structured console lines and never touches
 * D1, so a scanner cannot turn the report channel into a write amplifier.
 *
 * The rate limiter and the log dedupe are process-local maps. A restarted
 * isolate only forgets its counters; that is acceptable for a diagnostic
 * channel and keeps the endpoint free of database reads, because
 * `/api/*` already runs the blocklist check in the middleware.
 */

import type { Env } from "../_lib/env";
import { ipHash, requestId, sanitizeLogMessage } from "../_lib/logging";
import { clientIpForLogs, requestUrl } from "../_lib/routing";

/** Browsers send a few hundred bytes per report; 16 KB leaves room for batches. */
const MAX_BODY_BYTES = 16 * 1024;
/** Bound per-request CPU: one request may carry a batch of reports. */
const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD_LENGTH = 200;
/** Per-source request budget, small enough that a scanner cannot flood the log. */
const RATE_LIMIT_MAX = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_ENTRIES = 512;
/** Keep the first identical violation per window so repeated hits do not flood the log. */
const LOG_WINDOW_MS = 60_000;
const MAX_LOG_ENTRIES = 256;

const ACCEPTED_CONTENT_TYPES = new Set([
  "application/csp-report",
  "application/reports+json",
]);

interface CspReport {
  effectiveDirective: string;
  blockedUri: string;
  documentUri: string;
  disposition: string;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

const rateWindows = new Map<string, RateWindow>();
const logWindows = new Map<string, number>();

/** Test hook: clear the per-source request budgets so a suite can replay a source. */
export function resetCspReportRateLimit(): void {
  rateWindows.clear();
}

/** Test hook: clear the log dedupe windows so a suite can replay a violation. */
export function resetCspReportLogThrottle(): void {
  logWindows.clear();
}

function errorResponse(
  status: number,
  error: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function acceptedResponse(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

function sweepRateWindows(now: number): void {
  if (rateWindows.size < MAX_RATE_ENTRIES) return;
  for (const [key, window] of rateWindows) {
    if (now >= window.resetAt) rateWindows.delete(key);
  }
  while (rateWindows.size >= MAX_RATE_ENTRIES) {
    const oldest = rateWindows.keys().next().value;
    if (oldest === undefined) break;
    rateWindows.delete(oldest);
  }
}

/** Fixed-window budget per source. Returns the wait time when the budget is spent. */
function consumeRateLimit(
  key: string,
  now = Date.now(),
): { allowed: boolean; retryAfter: number } {
  const window = rateWindows.get(key);
  if (!window || now >= window.resetAt) {
    sweepRateWindows(now);
    rateWindows.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (window.count >= RATE_LIMIT_MAX) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }
  window.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Keep the first occurrence of a violation per window, bounded by entry count. */
function shouldLogReport(key: string, now = Date.now()): boolean {
  const firstAt = logWindows.get(key);
  if (firstAt !== undefined && now - firstAt < LOG_WINDOW_MS) return false;
  if (logWindows.size >= MAX_LOG_ENTRIES) {
    for (const [entry, at] of logWindows) {
      if (now - at >= LOG_WINDOW_MS) logWindows.delete(entry);
    }
    if (logWindows.size >= MAX_LOG_ENTRIES) logWindows.clear();
  }
  logWindows.set(key, now);
  return true;
}

type BodyResult = { ok: true; text: string } | { ok: false; tooLarge: boolean };

/** Read the body with a hard byte cap, following the 2048-byte pattern in identity/exchange.ts. */
async function readLimitedBody(request: Request): Promise<BodyResult> {
  const declared = (request.headers.get("Content-Length") ?? "").trim();
  if (declared !== "") {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) return { ok: false, tooLarge: false };
    if (length > MAX_BODY_BYTES) return { ok: false, tooLarge: true };
  }
  if (!request.body) return { ok: false, tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(output) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function field(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Redact credentials and query strings, then cap the length kept in the log line. */
function logField(value: unknown): string {
  return sanitizeLogMessage(field(value)).slice(0, MAX_FIELD_LENGTH);
}

/** Legacy `application/csp-report` body: `{"csp-report": {...}}` or the bare report object. */
function normalizeLegacy(payload: unknown): CspReport[] {
  const wrapped = payload !== null && typeof payload === "object" && "csp-report" in payload
    ? (payload as Record<string, unknown>)["csp-report"]
    : payload;
  if (wrapped === null || typeof wrapped !== "object") return [];
  const report = wrapped as Record<string, unknown>;
  const normalized: CspReport = {
    effectiveDirective: field(report["effective-directive"]) || field(report["violated-directive"]),
    blockedUri: logField(report["blocked-uri"]),
    documentUri: logField(report["document-uri"]),
    disposition: field(report.disposition) || "report",
  };
  if (!normalized.effectiveDirective && !normalized.blockedUri) return [];
  return [normalized];
}

/** Reporting API body: a JSON array of `{type: "csp-violation", body: {...}}`. */
function normalizeReported(payload: unknown): CspReport[] {
  const entries = Array.isArray(payload) ? payload : [payload];
  const reports: CspReport[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.type !== "csp-violation") continue;
    const body = record.body;
    if (body === null || typeof body !== "object") continue;
    const details = body as Record<string, unknown>;
    const normalized: CspReport = {
      effectiveDirective: field(details.effectiveDirective) || field(details.violatedDirective),
      blockedUri: logField(details.blockedURL),
      documentUri: logField(details.documentURL) || logField(record.url),
      disposition: field(details.disposition) || "report",
    };
    if (!normalized.effectiveDirective && !normalized.blockedUri) continue;
    reports.push(normalized);
  }
  return reports;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const mediaType = (request.headers.get("Content-Type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!ACCEPTED_CONTENT_TYPES.has(mediaType)) {
    return errorResponse(415, "unsupported_media_type");
  }

  const ip = clientIpForLogs(request);
  const budget = consumeRateLimit(ip || "anon");
  if (!budget.allowed) {
    return errorResponse(429, "rate_limited", { "Retry-After": String(budget.retryAfter) });
  }

  const body = await readLimitedBody(request);
  if (!body.ok) {
    return body.tooLarge ? errorResponse(413, "payload_too_large") : errorResponse(400, "invalid_report");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return errorResponse(400, "invalid_report");
  }

  const reports = (
    mediaType === "application/csp-report" ? normalizeLegacy(payload) : normalizeReported(payload)
  ).slice(0, MAX_REPORTS_PER_REQUEST);
  if (reports.length === 0) return errorResponse(400, "invalid_report");

  const url = requestUrl(request);
  const requestIdentifier = requestId(request);
  const hashedIp = await ipHash(ip, env);
  const ts = Math.floor(Date.now() / 1000);

  for (const report of reports) {
    if (!shouldLogReport(`${report.effectiveDirective}|${report.blockedUri}`)) continue;
    console.log(JSON.stringify({
      event: "csp_report",
      ts,
      request_id: requestIdentifier,
      host: url.hostname,
      path: url.pathname,
      effective_directive: report.effectiveDirective,
      blocked_uri: report.blockedUri,
      document_uri: report.documentUri,
      disposition: report.disposition,
      ip_hash: hashedIp,
    }));
  }

  return acceptedResponse();
};
