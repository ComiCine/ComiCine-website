/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Shared redirect page (redirect.<root_domain>); only forwards requests and skips human verification. */

import { detectLang, escapeHtml, requestUrl, templateText, withLangCookie } from "./routing";
import type { RequestContext } from "./routing";
import { BASE_URL, REDIRECT_HOSTNAME } from "./config";
import { REDIRECT_I18N, REDIRECT_PRELOAD_IMAGES } from "../_data/runtime";

/** Read the generated <lang>/redirect.html and inject to, preload, and preload_links. */
export async function renderRedirectPage(context: RequestContext): Promise<Response> {
  const { request, env } = context;
  const url = requestUrl(request);
  let to = url.searchParams.get("to") ?? "";
  if (!/^https:\/\//.test(to)) to = `${BASE_URL}/`;
  const lang = detectLang(request);
  const preload = to.startsWith(`${BASE_URL}/`);
  const rels = preload ? REDIRECT_PRELOAD_IMAGES : [];
  const preloadLinks = rels
    .map((rel) => `<link rel="preload" as="image" href="${escapeHtml(rel)}">`)
    .join("\n    ");

// Reuse template text per language in the process; fetch from ASSETS once and read from memory thereafter.
  const source = await templateText(env, lang, "redirect.html");
  if (source === null) return new Response("Redirect page unavailable", { status: 503 });
// The build renders the language in <html lang="{{ g.lang }}">. No template or
// artifact contains a `{{lang}}` placeholder; inject only runtime to/preload values.
  const html = source
    .replaceAll("{{to}}", escapeHtml(to))
    .replaceAll("{{preload}}", JSON.stringify(rels))
    .replaceAll("{{preload_links}}", preloadLinks);

  return withLangCookie(
    request,
    new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }),
    lang,
  );
}

/** Check for the redirect subdomain for middleware routing. */
export function isRedirectHost(hostname: string): boolean {
  return hostname === REDIRECT_HOSTNAME;
}
