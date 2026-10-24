/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

import { describe, expect, it } from "vitest";
import {
  LANGS,
  LANG_LABELS,
  UI,
  alertDetail,
  fmt,
  isLang,
  langFlag,
  msgCode,
  pickLang,
  probeDetail,
  type UiKey,
} from "./i18n";

/** HTTP codes with complete descriptions in the table; other three-digit codes use `http_other`. */
const CURATED_HTTP = [
  200, 400, 401, 403, 404, 405, 408, 409, 410, 429, 451, 500, 501, 502, 503, 504, 505, 520, 521,
  522, 523, 524, 525, 526, 530,
];

/** Every error code that `runProbe()` or the page itself can produce. */
const PROBE_CODES = [
  "ok",
  "no_data",
  "unexpected_result",
  "missing_target",
  "d1_error",
  "fetch_error",
  "fetch_timeout",
  "unknown",
];

describe("language table", () => {
  it("every language carries the same keys with non-empty text", () => {
    const base = Object.keys(UI["zh-cn"]).sort();
    expect(base.length).toBeGreaterThan(60);
    for (const lang of LANGS) {
      expect(Object.keys(UI[lang]).sort(), lang).toEqual(base);
      for (const key of base) {
        expect(UI[lang][key as UiKey].trim().length, `${lang}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("interpolated templates keep their placeholders in every language", () => {
    for (const lang of LANGS) {
      expect(UI[lang].reason_line, lang).toContain("{detail}");
      expect(UI[lang].http_other, lang).toContain("{code}");
      expect(UI[lang].err_unknown_code, lang).toContain("{code}");
    }
  });

  it("labels every supported language with a flag", () => {
    for (const lang of LANGS) {
      expect(LANG_LABELS[lang].length, lang).toBeGreaterThan(0);
      expect(langFlag(lang).length, lang).toBeGreaterThan(0);
    }
    expect(langFlag("zh-cn")).toBe("🇨🇳");
    expect(langFlag("ja-jp")).toBe("🇯🇵");
    expect(langFlag("en")).toBe(""); // Do not invent a flag when the region subtag is missing.
  });

  it("isLang accepts only the four contract languages", () => {
    for (const lang of LANGS) expect(isLang(lang)).toBe(true);
    for (const bad of ["en", "zh", "fr-fr", "", null, undefined, 42]) expect(isLang(bad)).toBe(false);
  });
});

describe("probe error codes", () => {
  it("classifies every msg runProbe() can store", () => {
    expect(msgCode(null)).toBe("no_data");
    expect(msgCode("")).toBe("no_data");
    expect(msgCode("ok")).toBe("ok");
    expect(msgCode("missing_target")).toBe("missing_target");
    expect(msgCode("unexpected_result")).toBe("unexpected_result");
    expect(msgCode("http_200")).toBe("http_200");
    expect(msgCode("http_530")).toBe("http_530");
    expect(msgCode("d1_error: Error: D1_ERROR: no such table: probes")).toBe("d1_error");
    expect(msgCode("fetch_error: TypeError: fetch failed")).toBe("fetch_error");
    // AbortController timeouts are DOMException/AbortError at runtime and are classified separately from network errors.
    expect(msgCode("fetch_error: AbortError: The operation was aborted")).toBe("fetch_timeout");
    expect(msgCode("something_else")).toBe("unknown");
  });

  it("normalisation never leaks the raw exception text", () => {
    const codes = ["d1_error: Error: D1_ERROR: no such table: probes", "fetch_error: boom"];
    for (const raw of codes) {
      expect(msgCode(raw)).not.toContain(" ");
      expect(msgCode(raw)).not.toContain(":");
    }
  });

  it("has a translated string for every probe code in every language", () => {
    for (const lang of LANGS) {
      for (const code of PROBE_CODES) {
        const text = probeDetail(code, lang);
        expect(text.trim().length, `${lang}/${code}`).toBeGreaterThan(0);
      }
    }
  });

  it("curates the HTTP codes that matter instead of falling back", () => {
    for (const code of CURATED_HTTP) {
      const fallback = fmt(UI["zh-cn"].http_other, { code: String(code) });
      expect(probeDetail(`http_${code}`, "zh-cn"), `http_${code}`).not.toBe(fallback);
      expect(probeDetail(`http_${code}`, "zh-cn")).toContain(String(code));
    }
  });

  it("keeps the zh-cn table and CURATED_HTTP in sync both ways", () => {
    // Include every http_<three-digit-code> key in the table: catch unused entries and codes missing from the list.
    const inTable = Object.keys(UI["zh-cn"])
      .filter((key) => /^http_\d{3}$/.test(key))
      .map((key) => Number(key.slice("http_".length)))
      .sort((a, b) => a - b);
    expect(inTable).toEqual([...CURATED_HTTP].sort((a, b) => a - b));

    // Conversely, every listed code must resolve to a complete zh-cn entry, not the http_other fallback or its template.
    for (const code of CURATED_HTTP) {
      const text = probeDetail(`http_${code}`, "zh-cn");
      const fallback = fmt(UI["zh-cn"].http_other, { code: String(code) });
      expect(text, `http_${code}`).not.toBe(fallback);
      expect(text, `http_${code}`).not.toContain("{code}");
      expect(text.trim().length, `http_${code}`).toBeGreaterThan(0);
    }
  });

  it("falls back to a template for unknown HTTP codes and unknown error codes", () => {
    for (const lang of LANGS) {
      expect(probeDetail("http_599", lang)).toContain("599");
      expect(probeDetail("http_599", lang)).not.toContain("{code}");
      expect(probeDetail("mystery", lang)).toContain("mystery");
      expect(probeDetail("", lang)).toContain("unknown");
    }
  });

  it("alert detail keeps the raw exception text, page detail does not", () => {
    const raw = "d1_error: Error: D1_ERROR: no such table: probes";
    const mail = alertDetail(raw, "en-us");
    expect(mail).toContain("Database query failed");
    expect(mail).toContain("no such table"); // Keep raw text for troubleshooting.
    // A machine code alone adds no detail, so do not repeat it.
    expect(alertDetail("http_503", "en-us")).toBe("Service unavailable (HTTP 503)");
    expect(alertDetail(null, "en-us")).toBe("No probe record yet");
  });
});

describe("language detection", () => {
  const req = (accept?: string) =>
    new Request("https://status.limooo.cn/", accept ? { headers: { "Accept-Language": accept } } : {});

  it("reads Accept-Language by prefix and defaults to zh-cn", () => {
    expect(pickLang(req("zh-CN,zh;q=0.9"))).toBe("zh-cn");
    expect(pickLang(req("en-US,en;q=0.9"))).toBe("en-us");
    expect(pickLang(req("ja-JP"))).toBe("ja-jp");
    expect(pickLang(req("ko-KR"))).toBe("ko-kr");
    expect(pickLang(req(""))).toBe("zh-cn");
    expect(pickLang(req("de-DE"))).toBe("zh-cn");
  });

  it("lets an explicit ?lang= override the header, and ignores junk values", () => {
    const url = (q: string) => new URL(`https://status.limooo.cn/${q}`);
    expect(pickLang(req("en-US"), url("?lang=ja-jp"))).toBe("ja-jp");
    expect(pickLang(req("en-US"), url("?lang=EN-US"))).toBe("en-us");
    expect(pickLang(req("en-US"), url("?lang=fr-fr"))).toBe("en-us");
    expect(pickLang(req("en-US"), url("?lang="))).toBe("en-us");
    expect(pickLang(req("en-US"), url("?lang=%20"))).toBe("en-us");
  });
});
