/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/** PUT /api/apple-account/reorder (requires admin access and CSRF; uses a D1 batch transaction with no partial updates). */

import { executeBatch, queryAll } from "../../_lib/d1";
import { requireAdminSession } from "../../_lib/session";
import { verifyCsrf } from "../../_lib/csrf";
import { logEvent } from "../../_lib/logging";
import { validateOrder } from "../../_lib/apple-account";
import type { Env } from "../../_lib/env";

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  if (!(await verifyCsrf(context.env, context.request, auth.session.sid))) {
    return Response.json({ error: "无权限" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  let data: unknown;
  try {
    data = await context.request.json();
  } catch {
    return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const order = validateOrder(data);
  if (!order) return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const existing = await queryAll<{ id: number }>(context.env.DB, "SELECT id FROM apple_accounts");
  const ids = new Set(existing.map((r) => r.id));
  if (!order.every((id) => ids.has(id))) {
    return Response.json({ error: "包含不存在的账号" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  // Require the submitted set to **exactly match** the database set. If validation only checks that
  // submitted IDs exist, omitted rows retain their old sort_order and may collide with submitted rows,
  // making the result ambiguous (the order would depend on D1's row order).
  if (order.length !== ids.size) {
    return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const statements = order
    .map((id, index) =>
      context.env.DB?.prepare("UPDATE apple_accounts SET sort_order = ? WHERE id = ?").bind(index, id),
    )
    .filter((statement): statement is NonNullable<typeof statement> => Boolean(statement));
  if (!(await executeBatch(context.env.DB, statements))) {
    await logEvent(context.env, "audit_event", context.request, {
      outcome: "accounts_reorder_failed",
      status: 500,
      actorSub: auth.session.sub,
      message: "apple_account_reorder_batch_failed",
    });
    return Response.json({ error: "排序失败" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  // Record who changed the order; the order itself can be reconstructed from the account list and need not be stored in the audit row.
  await logEvent(context.env, "audit_event", context.request, {
    outcome: "accounts_reordered",
    status: 200,
    actorSub: auth.session.sub,
    message: `count=${order.length}`,
  });
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
};
