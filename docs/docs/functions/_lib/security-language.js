/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

export const SUPPORTED_LANGS = ["zh-cn", "en-us", "ja-jp", "ko-kr"];
export const DEFAULT_LANG = "en-us";
const LANG_COOKIE = "user_lang_preference";

/**
 * Read the shared language cookie. Decode with `decodeURIComponent`, fall back
 * to the raw value when the client sent a malformed percent sequence, then
 * lowercase for language matching. The main site applies the same rule in
 * `functions/_lib/cookies.ts` (`getCookie`); keep the two aligned.
 */
function readLanguageCookie(header) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const equals = part.indexOf("=");
    if (equals < 0 || part.slice(0, equals).trim() !== LANG_COOKIE) continue;
    const value = part.slice(equals + 1).trim();
    try {
      return decodeURIComponent(value).toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  }
  return null;
}

function acceptedLanguageTags(header) {
  const accepted = [];
  for (const [order, part] of header.split(",").entries()) {
    const [rawTag, ...parameters] = part.trim().split(";");
    const tag = rawTag?.trim().toLowerCase();
    if (!tag || tag === "*") continue;

    const qualityParameter = parameters.find((parameter) => /^q\s*=/i.test(parameter));
    let quality = 1;
    if (qualityParameter) {
      const rawQuality = qualityParameter.slice(qualityParameter.indexOf("=") + 1).trim();
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(rawQuality)) continue;
      quality = Number(rawQuality);
    }
    if (quality > 0) accepted.push({ tag, quality, order });
  }

  return accepted
    .sort((left, right) => right.quality - left.quality || left.order - right.order)
    .map(({ tag }) => tag);
}

function languageFromAcceptHeader(header) {
  for (const tag of acceptedLanguageTags(header)) {
    const exact = SUPPORTED_LANGS.find((language) => language === tag);
    if (exact) return exact;
    const primary = tag.split("-", 1)[0];
    const matchingPrimary = SUPPORTED_LANGS.find(
      (language) => language.split("-", 1)[0] === primary,
    );
    if (matchingPrimary) return matchingPrimary;
  }
  return null;
}

function languageFromCountry(country) {
  const code = country?.toUpperCase();
  if (!code) return null;
  return SUPPORTED_LANGS.find((language) => language.split("-")[1]?.toUpperCase() === code) ?? null;
}

export function detectMainSiteLanguage(request) {
  const cookie = readLanguageCookie(request.headers.get("Cookie"));
  if (SUPPORTED_LANGS.includes(cookie)) return cookie;

  const accepted = languageFromAcceptHeader(request.headers.get("Accept-Language") ?? "");
  if (accepted) return accepted;

  const country = request.cf?.country ?? "";
  return languageFromCountry(country) ?? DEFAULT_LANG;
}

export function redirectLocalizedEntry(request, entryPath) {
  const url = new URL(request.url);
  const language = detectMainSiteLanguage(request);
  url.pathname = `${entryPath}/${language}`;

  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "private, no-store",
      Location: url.toString(),
    },
  });
}
