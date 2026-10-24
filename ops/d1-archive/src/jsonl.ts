/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
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
