/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Shared structured event logging for Pages Functions.
 *
 * Emit one complete JSON object per event and try to write it to D1 events for row-level
 * queries and health-check aggregation. Logging failures do not affect requests.
 */

import { execute, executeBatch } from "./d1";
import type { Env } from "./env";
import { clientCountryForLogs, clientIpForLogs, requestUrl } from "./routing";
import { hmacSha256Hex } from "./crypto";

let eventSchemaReady = false;
/**
 * Time of the last table-creation attempt, in milliseconds.
 *
 * Recording only successful attempts is insufficient. During quota exhaustion
 * or a broken binding, every DDL statement fails, and the old code sent a
 * failing batch for **every** request, amplifying one outage into N failures
 * (tasks/22 W9-19). Now remember attempts and retry at most once per minute
 * per isolate.
 */
let eventSchemaAttemptAt = 0;
const SCHEMA_RETRY_COOLDOWN_MS = 60_000;
const MAX_LOG_MESSAGE_LENGTH = 500;

const SENSITIVE_KEY_RE = /(password|passwd|token|secret|authorization|api[_-]?key|access[_-]?key|cookie|session)/i;
const SENSITIVE_ASSIGNMENT_RE =
  /(password|passwd|token|secret|authorization|api[_-]?key|access[_-]?key|cookie|session|__gate|comicine_session|comicine_pending)\s*=\s*[^&\s,;]+/gi;
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_STRING_RE = /\?[^\s"'<>]+/g;

export interface LogEventFields {
  outcome?: string;
  status?: number;
  host?: string;
  path?: string;
  method?: string;
  message?: string;
  durationMs?: number;
  ip?: string;
  country?: string;
  accountId?: number;
  actorSub?: string;
}

/**
 * Create the table idempotently before the first write in each isolate, so
 * requests do not depend on a manually applied migration.
 *
 * Constraints (tasks/22 W9-19):
 * 1. Record an attempt, not only a success. During a D1 outage, sending a
 *    batch of DDL that will fail on every request would amplify the outage;
 *    retry at most once per minute after failure.
 * 2. Run all four DDL statements in one `db.batch` round trip instead of four
 *    serial `run()` calls. Fall back to individual statements only when
 *    `db.batch` is unavailable (older drivers or test stubs).
 */
async function ensureEventSchema(env: Env): Promise<void> {
  if (eventSchemaReady || !env.DB) return;
  const now = Date.now();
  if (now - eventSchemaAttemptAt < SCHEMA_RETRY_COOLDOWN_MS) return;
  eventSchemaAttemptAt = now;
  const ddl = [
    `CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event       TEXT    NOT NULL,
      ts          INTEGER NOT NULL DEFAULT (unixepoch()),
      request_id  TEXT    DEFAULT '',
      host        TEXT    DEFAULT '',
      path        TEXT    DEFAULT '',
      method      TEXT    DEFAULT '',
      status      INTEGER DEFAULT 0,
      outcome     TEXT    DEFAULT '',
      ip_hash     TEXT    DEFAULT '',
      country     TEXT    DEFAULT '',
      duration_ms INTEGER DEFAULT 0,
      message     TEXT    DEFAULT '',
      account_id  TEXT    DEFAULT '',
      actor_sub   TEXT    DEFAULT ''
    )`,
    "CREATE INDEX IF NOT EXISTS idx_events_ts_event ON events (ts, event)",
    "CREATE INDEX IF NOT EXISTS idx_events_event_outcome_ts ON events (event, outcome, ts)",
    "CREATE INDEX IF NOT EXISTS idx_events_request_id ON events (request_id)",
  ];
  try {
    const db = env.DB;
    if (db.batch) {
      // executeBatch returns false when batch fails instead of throwing.
      if (await executeBatch(db, ddl.map((sql) => db.prepare(sql)))) {
        eventSchemaReady = true;
      }
      return;
    }
    // CREATE ... IF NOT EXISTS reports meta.changes = 0, which `execute` treats as failure;
    // check the statement result directly so a successful no-op still finishes the bootstrap.
    for (const sql of ddl) {
      const result = await env.DB.prepare(sql).run();
      if (result?.success !== true) return;
    }
    eventSchemaReady = true;
  } catch {
    // Retry after the cooldown if D1 is not ready; do not affect the request.
  }
}

/**
 * Diagnostic throttling lives in sampling.ts: this module only writes what a caller
 * decides to emit. Keep it that way so an audit event added here cannot disappear
 * behind a process-local window.
 */

/** request_id: prefer Cloudflare Ray ID so the request can be found in edge logs. */
export function requestId(request: Request): string {
  return request.headers.get("CF-Ray") ?? `pages-${crypto.randomUUID()}`;
}

/**
 * Pseudonymize IPs with a dedicated OBSERVABILITY_HMAC_KEY using HMAC-SHA256,
 * then keep the first 16 hexadecimal characters. Return an empty string when
 * the key is missing (fail closed); never reuse GATE_HMAC_KEY or a public salt.
 */
export async function ipHash(ip: string, env: Env): Promise<string> {
  if (!ip) return "";
  const key = env.OBSERVABILITY_HMAC_KEY;
  if (!key) return "";
  return (await hmacSha256Hex(key, ip)).slice(0, 16);
}

/** Redact passwords, tokens, cookies, bearer credentials, and full query strings before persisting logs. */
export function sanitizeLogMessage(message: string): string {
  let out = message
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SENSITIVE_ASSIGNMENT_RE, "$1=[redacted]")
    .replace(QUERY_STRING_RE, "?[redacted]");
  if (SENSITIVE_KEY_RE.test(out)) {
    out = out.replace(
      /("(?:password|passwd|token|secret|authorization|api[_-]?key|access[_-]?key|cookie|session)"\s*:\s*)"[^"]*"/gi,
      '$1"[redacted]"',
    );
  }
  return out.slice(0, MAX_LOG_MESSAGE_LENGTH);
}

/** Limit path and message lengths so oversized errors do not burden D1. */
function truncate(value: string, maxLength = 2048): string {
  return value.slice(0, maxLength);
}

/** Emit one JSON line and try to persist it to D1 events. */
export async function logEvent(
  env: Env,
  event: string,
  request: Request,
  fields: LogEventFields = {},
): Promise<void> {
  const url = requestUrl(request);
  const ip = fields.ip ?? clientIpForLogs(request);
  const payload = {
    event,
    ts: Math.floor(Date.now() / 1000),
    request_id: requestId(request),
    host: fields.host ?? url.hostname,
    path: truncate(fields.path ?? url.pathname),
    method: fields.method ?? request.method,
    status: fields.status ?? 0,
    outcome: fields.outcome ?? "",
    ip_hash: await ipHash(ip, env),
    country: fields.country ?? clientCountryForLogs(request),
    duration_ms: fields.durationMs ?? 0,
    message: sanitizeLogMessage(fields.message ?? ""),
    account_id: fields.accountId !== undefined ? String(fields.accountId) : "",
    actor_sub: fields.actorSub ?? "",
  };

  console.log(JSON.stringify(payload));
  if (!env.DB) return;

  try {
    await ensureEventSchema(env);
    const ok = await execute(
      env.DB,
      `INSERT INTO events
        (event, ts, request_id, host, path, method, status, outcome, ip_hash, country, duration_ms, message, account_id, actor_sub)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      payload.event,
      payload.ts,
      payload.request_id,
      payload.host,
      payload.path,
      payload.method,
      payload.status,
      payload.outcome,
      payload.ip_hash,
      payload.country,
      payload.duration_ms,
      payload.message,
      payload.account_id,
      payload.actor_sub,
    );
    if (!ok) throw new Error("D1 execute returned success=false");
  } catch (error) {
// If the events table is unavailable, do not recursively log an error event; use the Pages log only.
    console.error(
      JSON.stringify({
        event: "event_store_error",
        ts: payload.ts,
        request_id: payload.request_id,
        host: payload.host,
        path: payload.path,
        method: payload.method,
        status: payload.status,
        outcome: "failed",
        message: String(error),
      }),
    );
  }
}
