/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/** POST /api/apple-account/accounts/:id/reveal (admin + recent authentication + CSRF; audit and discard the plaintext after returning it). */

import { queryAll } from "../../../../_lib/d1";
import { fernetDecrypt } from "../../../../_lib/fernet";
import { requireRecentAdminSession } from "../../../../_lib/session";
import { verifyCsrf } from "../../../../_lib/csrf";
import { parseAccountId } from "../../../../_lib/apple-account";
import { logEvent } from "../../../../_lib/logging";
import type { Env } from "../../../../_lib/env";

/**
 * Order: authentication and recent-authentication check (`requireRecentAdminSession`) → CSRF → data lookup.
 *
 * The session must be loaded before CSRF can be checked because the token is bound to `sid`.
 * Recent-authentication failures return 401, non-admin users return 403, and CSRF failures
 * return 403, so the rejection order is fixed as authentication → recent authentication → CSRF
 * (tasks/21 T2/T4).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const auth = await requireRecentAdminSession(context.env, context.request);
  if (auth instanceof Response) {
    // Record an audit event even when recent authentication has expired, including who tried to decrypt a password and when.
    if (auth.status === 401) {
      await logEvent(context.env, "audit_event", context.request, {
        outcome: "reauth_required",
        status: 401,
        message: "password_reveal_reauth_required",
      });
    }
    return auth;
  }
  const { session } = auth;
  if (!(await verifyCsrf(context.env, context.request, session.sid))) {
    return Response.json({ error: "无权限" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const id = parseAccountId((context.params as { id?: string }).id);
  if (!id) return Response.json({ error: "无效请求" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const rows = await queryAll<{ password: string }>(
    context.env.DB,
    "SELECT password FROM apple_accounts WHERE id = ?",
    id,
  );
  if (!rows.length) return Response.json({ error: "未找到" }, { status: 404, headers: { "Cache-Control": "no-store" } });

  let plain = "";
  try {
    if (!context.env.APPLE_ACCOUNT_ENCRYPTION_KEY) throw new Error("missing encryption key");
    plain = await fernetDecrypt(rows[0].password, context.env.APPLE_ACCOUNT_ENCRYPTION_KEY);
  } catch {
    await logEvent(context.env, "audit_event", context.request, {
      outcome: "decrypt_failed",
      status: 500,
      accountId: id,
      actorSub: session.sub,
      message: "password_reveal_failed",
    });
    return Response.json(
      { error: "解密失败，已记录审计事件" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  await logEvent(context.env, "audit_event", context.request, {
    outcome: "password_revealed",
    status: 200,
    accountId: id,
    actorSub: session.sub,
    message: "password_reveal",
  });
  return Response.json({ password: plain }, { headers: { "Cache-Control": "no-store" } });
};
