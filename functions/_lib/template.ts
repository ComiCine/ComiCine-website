/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Single-pass `{{key}}` substitution for generated HTML templates.
 *
 * Template text loaded from ASSETS contains `{{key}}` placeholders; the redirect
 * page injects runtime values here, and the gate page follows in a later task
 * book. Build one global regular expression from the caller's keys and replace
 * in a single pass: sequential `replaceAll` calls let a substituted value that
 * itself contains `{{error}}` be rescanned and consumed by a later replacement.
 *
 * This function does not escape values. Callers pass already-escaped values
 * (`escapeHtml`) or serialized JSON text (`JSON.stringify`). A placeholder that
 * is not listed in `keys` stays unchanged, and a listed key missing from
 * `values` renders as an empty string.
 */

/** Escape regular expression metacharacters so keys such as `a.b` match literally. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Replace every listed `{{key}}` in one pass; values are used verbatim and never rescanned. */
export function inject(
  source: string,
  keys: readonly string[],
  values: Readonly<Record<string, string>>,
): string {
  if (!keys.length) return source;
  const pattern = new RegExp(`\\{\\{(${keys.map(escapeRegExp).join("|")})\\}\\}`, "g");
  return source.replace(pattern, (_match, key: string) => values[key] ?? "");
}
