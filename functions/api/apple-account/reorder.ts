/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** PUT /api/apple-account/reorder (requires admin access and CSRF; uses a D1 batch transaction with no partial updates). */

import { executeBatch, queryAll } from "../../_lib/d1";
import { jsonBodyRejection, readJsonBody } from "../../_lib/request";
import { requireAdminSession } from "../../_lib/session";
import { verifyCsrf } from "../../_lib/csrf";
import { logEvent } from "../../_lib/logging";
import { validateOrder } from "../../_lib/apple-account";
import type { Env } from "../../_lib/env";

/**
 * `validateOrder` accepts up to 1000 ids (`MAX_ORDER_LENGTH`), and a body of that size is roughly
 * 17 KB even with 16-digit ids, so this endpoint cannot use the 8 KB default. A real admin reorder
 * is a few dozen bytes; the cap only has to stay above what the validator accepts.
 */
const MAX_BODY_BYTES = 32 * 1024;

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request);
  if (auth instanceof Response) return auth;
  if (!(await verifyCsrf(context.env, context.request, auth.session.sid))) {
    return Response.json({ error: "Forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const body = await readJsonBody(context.request, { maxBytes: MAX_BODY_BYTES });
  if (!body.ok) return jsonBodyRejection(body);
  const order = validateOrder(body.value);
  if (!order) return Response.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const existing = await queryAll<{ id: number }>(context.env.DB, "SELECT id FROM apple_accounts");
  const ids = new Set(existing.map((r) => r.id));
  if (!order.every((id) => ids.has(id))) {
    return Response.json({ error: "Order contains an unknown account" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  // Require the submitted set to **exactly match** the database set. If validation only checks that
  // submitted IDs exist, omitted rows retain their old sort_order and may collide with submitted rows,
  // making the result ambiguous (the order would depend on D1's row order).
  if (order.length !== ids.size) {
    return Response.json({ error: "Invalid request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
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
    return Response.json({ error: "Reorder failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
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
