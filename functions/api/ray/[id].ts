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
