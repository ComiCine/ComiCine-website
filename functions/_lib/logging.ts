/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Shared structured event logging for Pages Functions.
 *
 * Emit one complete JSON object per event, using the same fields as Flask's
 * log_event in src/app.py, and try to write it to D1 events for row-level
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
  /(password|passwd|token|secret|authorization|api[_-]?key|access[_-]?key|cookie|session|__gate|limooo_session|limooo_pending)\s*=\s*[^&\s,;]+/gi;
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
 * 每个 isolate 首次写入前幂等建表，避免依赖人工先执行迁移。
 *
 * 两条约束（tasks/22 W9-19）：
 * 1. 记住的是「**已尝试**」而不是「已成功」：D1 故障期间不能让每个请求都先打一批
 *    必然失败的 DDL，否则一次故障被放大成 N 次；失败后每分钟最多重试一次。
 * 2. 四条 DDL 走**一次** `db.batch` 往返，而不是四次串行 `run()`。
 *    只有 `db.batch` 不存在（老驱动/测试桩）时才退回逐句执行。
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
      // executeBatch 在 batch 抛错时返回 false，不会把异常抛出来。
      if (await executeBatch(db, ddl.map((sql) => db.prepare(sql)))) {
        eventSchemaReady = true;
      }
      return;
    }
    for (const sql of ddl) {
      if (!(await execute(env.DB, sql))) return;
    }
    eventSchemaReady = true;
  } catch {
    // D1 尚未就绪时等冷却窗口过后重试，不影响业务。
  }
}

/** request_id：优先使用 Cloudflare Ray ID，便于按边缘日志反查 */
export function requestId(request: Request): string {
  return request.headers.get("CF-Ray") ?? `pages-${crypto.randomUUID()}`;
}

/**
 * IP 脱敏：使用独立的 OBSERVABILITY_HMAC_KEY 做 HMAC-SHA256 并截取前 16 位。
 * 密钥缺失时返回空串（fail-closed），绝不复用 GATE_HMAC_KEY 或使用公开盐值。
 */
export async function ipHash(ip: string, env: Env): Promise<string> {
  if (!ip) return "";
  const key = env.OBSERVABILITY_HMAC_KEY;
  if (!key) return "";
  return (await hmacSha256Hex(key, ip)).slice(0, 16);
}

/** 日志文本脱敏：移除口令、token、Cookie、Bearer 与完整 query，避免敏感值落盘。 */
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
