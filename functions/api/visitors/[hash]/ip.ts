/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * GET /api/visitors/<ip_hash>/ip
 *
 * Admin-only: decrypt the full IP for **one** visitor record when the user clicks a row and opens ipinfo.io.
 *
 * Why this is a separate endpoint instead of being part of the /api/visitors list:
 * - The list can return up to 500 rows per poll, so decrypting all 500 ciphertexts would waste work
 *   and could approach the Workers Free plan's 10 ms CPU limit.
 * - A full IP leaves the Worker only when the user explicitly requests a specific row; list responses contain hashes only.
 *
 * Index: the (ip_hash, last_ts) index on visitor_rollups makes this query read only one row
 * (see ops/migrations/014_visitor_ip_enc.sql).
 */

import { queryAll } from "../../../_lib/d1";
import { requireAdminSession } from "../../../_lib/session";
import { decryptVisitorIp, visitorIpKey } from "../../../_lib/visitor-ip";
import { logEvent } from "../../../_lib/logging";
import type { Env } from "../../../_lib/env";

/** ip_hash is the first 16 hexadecimal characters of HMAC-SHA256 (see ipHash in _lib/logging.ts). */
const IP_HASH_RE = /^[0-9a-f]{16}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const auth = await requireAdminSession(context.env, context.request, "无权限");
  if (auth instanceof Response) return auth;
  const actorSub = auth.session.sub;

  const hash = String(context.params?.hash ?? "");
  if (!IP_HASH_RE.test(hash)) return json({ error: "无效的访客标识" }, 400);

  /**
   * Write an audit row every time a visitor's plaintext IP is retrieved (tasks/22 W9-4).
   *
   * Password reveals (`apple-account/accounts/[id]/reveal.ts`) have always been audited, but this endpoint
   * previously had no audit trail, so there was no way to determine who viewed a visitor's real IP or when.
   * Store only the hash and actor in the audit event; **never store the plaintext IP**, which would create another copy in events.
   */
  const audit = (outcome: string, status: number, message: string): Promise<void> =>
    logEvent(context.env, "audit_event", context.request, {
      outcome,
      status,
      actorSub,
      message: `${message} hash=${hash}`,
    });

  if (!visitorIpKey(context.env)) {
    await audit("visitor_ip_unavailable", 503, "visitor_ip_key_missing");
    return json({ error: "ip_unavailable" }, 503);
  }

  const rows = await queryAll<{ ip_enc: string }>(
    context.env.DB,
    `SELECT ip_enc
       FROM visitor_rollups
      WHERE ip_hash = ? AND ip_enc != ''
      ORDER BY last_ts DESC
      LIMIT 1`,
    hash,
  );
  const token = rows[0]?.ip_enc ?? "";
  if (!token) {
    await audit("visitor_ip_missing", 404, "visitor_ip_not_stored");
    return json({ error: "ip_unavailable" }, 404);
  }

  const ip = await decryptVisitorIp(token, context.env);
  if (!ip) {
    console.error(JSON.stringify({ event: "visitor_ip_decrypt_error", hash }));
    await audit("visitor_ip_decrypt_failed", 500, "visitor_ip_decrypt_failed");
    return json({ error: "ip_unavailable" }, 500);
  }

  await audit("visitor_ip_revealed", 200, "visitor_ip_revealed");
  return json({ ip });
};
