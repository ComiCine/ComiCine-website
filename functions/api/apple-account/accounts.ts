/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** GET /api/apple-account/accounts (redacted list) / POST (create; requires admin access and CSRF). */

import { queryAll, execute } from "../../_lib/d1";
import { fernetEncrypt } from "../../_lib/fernet";
import { authUnavailableResponse, requireAdminSession, requireAuth } from "../../_lib/session";
import { verifyCsrf } from "../../_lib/csrf";
import { maskPassword, validateCreatePayload } from "../../_lib/apple-account";
import { describeWriteError, isUniqueConflict } from "../../_lib/apple-account-errors";
import { logEvent } from "../../_lib/logging";
import type { Env } from "../../_lib/env";

interface Row {
  id: number;
  email: string;
  password: string;
  notes: string;
  sort_order: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  let session: Awaited<ReturnType<typeof requireAuth>>;
  try {
    session = await requireAuth(context.env, context.request);
  } catch {
    return authUnavailableResponse();
  }
  if (!session) {
    return Response.json({ error: "未登录" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const rows = await queryAll<Row>(
    context.env.DB,
    "SELECT id, email, password, notes, sort_order FROM apple_accounts ORDER BY sort_order, email",
  );
  return Response.json(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      password: maskPassword(r.password),
      notes: r.notes,
      sort_order: r.sort_order,
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  if (!(await verifyCsrf(context.env, context.request, auth.session.sid))) {
    return Response.json({ error: "无权限" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (!context.env.APPLE_ACCOUNT_ENCRYPTION_KEY) {
    return Response.json({ error: "服务器未配置加密密钥" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  let data: unknown;
  try {
    data = await context.request.json();
  } catch {
    return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const parsed = validateCreatePayload(data);
  if (!parsed) {
    return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const encrypted = await fernetEncrypt(parsed.password, context.env.APPLE_ACCOUNT_ENCRYPTION_KEY);
  const max = await queryAll<{ n: number }>(
    context.env.DB,
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM apple_accounts",
  );
  const sortOrder = max.length ? max[0].n : 0;

  let ok = false;
  try {
    ok = await execute(
      context.env.DB,
      "INSERT INTO apple_accounts (email, password, notes, sort_order) VALUES (?, ?, ?, ?)",
      parsed.email,
      encrypted,
      parsed.notes,
      sortOrder,
    );
  } catch (err) {
    // Return 409 only for an actual UNIQUE conflict. Exhausted write quotas, broken bindings, and network
    // failures were previously reported as "this email already exists," hiding real failures (tasks/22 W9-6).
    const conflict = isUniqueConflict(err);
    await logEvent(context.env, "audit_event", context.request, {
      outcome: conflict ? "account_create_conflict" : "account_create_failed",
      status: conflict ? 409 : 500,
      actorSub: auth.session.sub,
      message: conflict ? "apple_account_duplicate_email" : describeWriteError(err),
    });
    if (conflict) {
      return Response.json({ error: "该邮箱已存在" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "写入失败" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  if (!ok) {
    await logEvent(context.env, "audit_event", context.request, {
      outcome: "account_create_failed",
      status: 500,
      actorSub: auth.session.sub,
      message: "zero_rows_affected",
    });
    return Response.json({ error: "写入失败" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  await logEvent(context.env, "audit_event", context.request, {
    outcome: "account_created",
    status: 200,
    actorSub: auth.session.sub,
    message: "apple_account_create",
  });
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
};
