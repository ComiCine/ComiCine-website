/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * GET /api/blocklist            — admin-only paginated query
 * POST /api/blocklist           — admin-only block or reactivate
 * DELETE /api/blocklist?cidr=…  — admin-only unblock (soft delete + audit)
 *
 * D1 blocked_ips is the sole source of truth; each change also writes to blocklist_audit and events.
 */

import { execute, executeBatch, queryAll } from "../_lib/d1";
import { logEvent } from "../_lib/logging";
import { parseCidr } from "../_lib/cidr";
import { requireAdminSession } from "../_lib/session";
import { verifyCsrf } from "../_lib/csrf";
import type { Env } from "../_lib/env";

interface BlockedRow {
  cidr: string;
  network: string;
  prefix: number;
  reason: string;
  source: string;
  created_at: string;
  updated_at: string;
  updated_by: string;
  active: number;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** Maximum block-reason length, consistent with the caps on other string fields and preventing oversized rows. */
const BLOCKLIST_REASON_MAX_LENGTH = 255;

function pageParams(url: URL): { page: number; pageSize: number; offset: number } {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(url.searchParams.get("page_size") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** This file uses more direct admin-facing copy than the default, so pass it explicitly. */
function adminSession(env: Env, request: Request) {
  return requireAdminSession(env, request, "需要管理员权限");
}

async function actorOf(session: { user: { email?: string; name?: string } }): Promise<string> {
  return session.user?.email || session.user?.name || "admin";
}

function blockedWhere(url: URL): { sql: string; values: string[] } {
  const active = url.searchParams.get("active");
  if (active === "true") return { sql: " WHERE active = 1", values: [] };
  if (active === "false") return { sql: " WHERE active = 0", values: [] };
  return { sql: "", values: [] };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await adminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  const url = new URL(context.request.url);
  const { page, pageSize, offset } = pageParams(url);
  const where = blockedWhere(url);
  const totalRows = await queryAll<{ n: number }>(
    context.env.DB,
    `SELECT COUNT(*) AS n FROM blocked_ips${where.sql}`,
    ...where.values,
  );
  const rows = await queryAll<BlockedRow>(
    context.env.DB,
    `SELECT cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active
     FROM blocked_ips${where.sql}
     ORDER BY updated_at DESC, cidr
     LIMIT ? OFFSET ?`,
    pageSize,
    offset,
  );
  return Response.json({
    ok: true,
    page,
    page_size: pageSize,
    total: totalRows[0]?.n ?? 0,
    items: rows,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await adminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  if (!(await verifyCsrf(context.env, context.request, auth.session.sid))) {
    return Response.json({ error: "csrf_invalid" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const { session } = auth;
  const request = context.request;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const raw = (body as { cidr?: unknown })?.cidr;
  if (typeof raw !== "string") {
    return Response.json({ error: "cidr required" }, { status: 400 });
  }
  const parsed = parseCidr(raw);
  if (!parsed) {
    return Response.json({ error: "invalid cidr" }, { status: 400 });
  }
  // Limit the reason length. Other string fields are capped, but this one was not, so one request
  // could write hundreds of KB. That could overwhelm paginated responses, consume the 500 MB database,
  // and cause the audit row to be lost with the change if the batch statement grew too large.
  const rawReason =
    typeof (body as { reason?: unknown }).reason === "string" ? (body as { reason: string }).reason : "";
  const reason = rawReason.slice(0, BLOCKLIST_REASON_MAX_LENGTH);
  const actor = await actorOf(session);
  const now = "datetime('now')";
  const mutationSql =
    `INSERT INTO blocked_ips
       (cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active)
     VALUES (?, ?, ?, ?, 'admin/add', ${now}, ${now}, ?, 1)
     ON CONFLICT(cidr) DO UPDATE SET
       network = excluded.network, prefix = excluded.prefix, reason = excluded.reason,
       source = 'admin/add', updated_at = excluded.updated_at, updated_by = excluded.updated_by,
       active = 1`;
  const auditSql =
    `INSERT INTO blocklist_audit
       (cidr, network, prefix, action, actor, reason, source, previous_reason,
        previous_source, previous_updated_at, created_at)
     VALUES (?, ?, ?, 'add', ?, ?, 'admin/add', '', '', '', ${now})`;
  const ok = await writeAndAudit(
    context.env,
    mutationSql,
    [parsed.cidr, parsed.network, parsed.prefix, reason, actor],
    auditSql,
    [parsed.cidr, parsed.network, parsed.prefix, actor, reason],
  );
  if (!ok) {
    return Response.json({ error: "D1 write failed" }, { status: 500 });
  }
  await logEvent(context.env, "blocklist_change", request, {
    outcome: "success",
    status: 200,
    path: "blocklist",
    message: `add ${parsed.cidr} by ${actor}`,
  });
  return Response.json({ ok: true, cidr: parsed.cidr, action: "add" }, { status: 201 });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await adminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  if (!(await verifyCsrf(context.env, context.request, auth.session.sid))) {
    return Response.json({ error: "csrf_invalid" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const { session } = auth;
  const url = new URL(context.request.url);
  const raw = url.searchParams.get("cidr");
  if (!raw) {
    return Response.json({ error: "cidr required" }, { status: 400 });
  }
  const parsed = parseCidr(raw);
  if (!parsed) {
    return Response.json({ error: "invalid cidr" }, { status: 400 });
  }
  const rows = await queryAll<BlockedRow>(
    context.env.DB,
    `SELECT cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active
     FROM blocked_ips WHERE cidr = ?`,
    parsed.cidr,
  );
  if (!rows.length) {
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const row = rows[0];
  if (row.active === 0) {
    return Response.json({ ok: true, cidr: row.cidr, already_unblocked: true });
  }
  const actor = await actorOf(session);
  const request = context.request;
  const now = "datetime('now')";
  const mutationSql =
    `UPDATE blocked_ips
     SET active = 0, source = 'admin/unblock', updated_at = ${now}, updated_by = ?
     WHERE cidr = ?`;
  const auditSql =
    `INSERT INTO blocklist_audit
       (cidr, network, prefix, action, actor, reason, source, previous_reason,
        previous_source, previous_updated_at, created_at)
     VALUES (?, ?, ?, 'unblock', ?, ?, 'admin/unblock', ?, ?, ?, ${now})`;
  const ok = await writeAndAudit(
    context.env,
    mutationSql,
    [actor, parsed.cidr],
    auditSql,
    [parsed.cidr, parsed.network, parsed.prefix, actor, row.reason, row.reason, row.source, row.updated_at],
  );
  if (!ok) {
    return Response.json({ error: "D1 write failed" }, { status: 500 });
  }
  await logEvent(context.env, "blocklist_change", request, {
    outcome: "success",
    status: 200,
    path: "blocklist",
    message: `unblock ${parsed.cidr} by ${actor}`,
  });
  return Response.json({ ok: true, cidr: parsed.cidr, action: "unblock" });
};

async function writeAndAudit(
  env: Env,
  mutationSql: string,
  mutationValues: unknown[],
  auditSql: string,
  auditValues: unknown[],
): Promise<boolean> {
  if (env.DB?.batch) {
    const ok = await executeBatch(env.DB, [
      env.DB.prepare(mutationSql).bind(...mutationValues),
      env.DB.prepare(auditSql).bind(...auditValues),
    ]);
  // Use a D1 batch to keep the block change and audit atomic. On failure, do not fall back to
  // two separate writes, which could leave a production change without an audit record.
    return ok;
  }
  const mutationOk = await execute(env.DB, mutationSql, ...mutationValues);
  if (!mutationOk) return false;
  return execute(env.DB, auditSql, ...auditValues);
}
