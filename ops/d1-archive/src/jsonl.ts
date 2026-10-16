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

/**
 * Serialize row data as JSONL + gzip for both analytics archives (analytics/) and configuration snapshots (backup/).
 *
 * Keep this in one module so both write paths use exactly the same byte format: one JSON object
 * per line, a trailing \n, and gzip. Otherwise the restore script would need separate parsers for
 * each prefix.
 *
 * Type fidelity is a disaster-recovery requirement. JSON distinguishes `0` / `1` / `"0"` / `""` /
 * `null`, preserving active=0/1, epoch integers, NULL, and empty strings. Do not stringify values
 * or fill in defaults here; that would lose type information.
 */
export async function gzipJsonl(rows: unknown[]): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const source = rows.map((row) => `${JSON.stringify(row)}\n`).join("");
  const stream = new Blob([encoder.encode(source)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
