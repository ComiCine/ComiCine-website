/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/** GET /api/ray/:id — admin-only lookup of a minimal request record by Ray ID. */

import { queryAll } from "../../_lib/d1";
import { requireAdminSession } from "../../_lib/session";
import type { Env } from "../../_lib/env";

interface RayRow {
  ray: string;
  ts: number;
  host: string;
  path: string;
  method: string;
  status: number;
  ip_hash: string;
  ua_family: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env, params, request }) => {
  const auth = await requireAdminSession(env, request, "无权限");
  if (auth instanceof Response) return auth;

  const id = String((params as { id?: string }).id ?? "").toLowerCase().split("-")[0];
  if (!/^[0-9a-f]{16}$/.test(id)) {
    return Response.json({ ok: false, error: "invalid ray id" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  // Prefix matching is **intentional**: stored `ray` values have a colo suffix (for example,
  // `a48923a17e543777-LAX`, 20 characters), while callers provide 16 hexadecimal characters.
  // Replace `LIKE '<id>%'` with a primary-key range: the semantics are the same, but `ray` is a
  // TEXT PRIMARY KEY, so the range uses `sqlite_autoindex_ray_log_v2_1`. LIKE cannot use that index
  // and scans the table through `idx_ray_log_v2_ts` (observed in production: `SCAN` → `SEARCH ... (ray>? AND ray<?)`).
  // Set the upper bound to `id` + U+10FFFF, which exceeds any suffix and matches `-LAX`, `-SIN`,
  // values without suffixes, and values with a different future suffix.
  const rows = await queryAll<RayRow>(
    env.DB,
    `SELECT ray, ts, host, normalized_path AS path, method, status, ip_hash, ua_family
     FROM ray_log_v2
     WHERE ray >= ? AND ray < ?
     ORDER BY ts DESC
     LIMIT 100`,
    id,
    `${id}\u{10ffff}`,
  );
  const safeRows = rows.map(({ ray, ts, host, path, method, status, ip_hash, ua_family }) => ({
    ray, ts, host, path, method, status, ip_hash, ua_family,
  }));
  return Response.json(
    { ok: true, count: safeRows.length, rows: safeRows },
    { headers: { "Cache-Control": "no-store" } },
  );
};
