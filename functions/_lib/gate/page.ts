/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate page rendering: load the generated auth.html and inject request values. */

import {
  detectLang,
  escapeHtml,
  safeNextPath,
  sanitizeHost,
  templateText,
  withLangCookie,
  type RequestContext,
} from "../routing";

export interface GateRenderOptions {
  next?: string;
  host?: string;
  errorKey?: string;
  unavailable?: boolean;
/** True when a verified visitor requests this page from the gate host; render in place with status 200. */
  passed?: boolean;
/** Pass the result when the caller already ran detectLang to avoid duplicate work. */
  lang?: string;
}

/** Load the generated <lang>/auth.html gate page and inject only host, next, error, and lang. */
export async function renderGatePage(
  context: RequestContext,
  opts: GateRenderOptions,
): Promise<Response> {
  const { request, env } = context;
  const host = sanitizeHost(opts.host);
  const next = safeNextPath(opts.next ?? "/");
  const lang = opts.lang ?? detectLang(request);
  const status = opts.unavailable ? 503 : opts.passed ? 200 : 403;

// Reuse template text per language in the process (fetch from ASSETS once,
// then read from memory). Injection matches the per-request render path; only
// template loading is skipped.
  const source = await templateText(env, lang, "auth.html");
  if (source === null) return new Response("Gate page unavailable", { status: 503 });
// The build renders the language in <html lang="{{ g.lang }}">. No template or
// artifact contains a `{{lang}}` placeholder, so do not perform a needless replacement.
  // One pass, so a value that itself contains a placeholder token is never rescanned. Sequential
  // replaceAll calls let `next=/x?q={{error}}` swallow the later replacement.
  const values: Record<string, string> = {
    host: escapeHtml(host),
    next: escapeHtml(next),
    error: escapeHtml(opts.errorKey ?? ""),
  };
  const html = source.replace(/\{\{(host|next|error)\}\}/g, (_match, key: string) => values[key] ?? "");

// Never cache the gate page.
  //
// This page replaces the real-content URL in place and returns 403. A previous
// `max-age=300` private browser cache could replay the challenge after
// verification when location.replace returned to the same URL, causing a loop
// and another verify request on every replay. The challenge has no cache value;
// no-store is the correct behavior.
  return withLangCookie(
    request,
    new Response(html, {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Cookie",
      },
    }),
    lang,
  );
}
