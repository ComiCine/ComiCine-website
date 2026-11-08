/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { describe, expect, it } from "vitest";
import contract from "../../../../config-contract.json";
import {
  DEFAULT_LANG,
  SUPPORTED_LANGS,
  detectMainSiteLanguage,
  redirectLocalizedEntry,
} from "../../functions/_lib/security-language.js";
import { onRequest as amc10Entry } from "../../functions/private/articles/amc-10-formula-guide.js";
import { onRequest as mu5735Entry } from "../../functions/private/articles/mu5735-report.js";
import { onRequest as ukMajorsEntry } from "../../functions/private/articles/uk-undergraduate-majors.js";

function request(headers: Record<string, string> = {}, country?: string): Request {
  const result = new Request("https://docs.comicine.com/security/policy", { headers });
  if (country) Object.defineProperty(result, "cf", { value: { country } });
  return result;
}

describe("docs language selection follows the main site", () => {
  it("keeps the supported languages and fallback aligned with the contract", () => {
    expect(SUPPORTED_LANGS).toEqual(contract.supported_langs);
    expect(DEFAULT_LANG).toBe(contract.default_lang);
  });

  it("uses a valid shared preference cookie before Accept-Language", () => {
    expect(
      detectMainSiteLanguage(
        request({ Cookie: "user_lang_preference=ja-jp", "Accept-Language": "en-US" }, "US"),
      ),
    ).toBe("ja-jp");
  });

  it("falls through an invalid cookie to the first supported Accept-Language", () => {
    expect(
      detectMainSiteLanguage(
        request({ Cookie: "user_lang_preference=fr-fr", "Accept-Language": "ko-KR, en-US;q=0.8" }, "US"),
      ),
    ).toBe("ko-kr");
  });

  it("does not throw on a malformed percent-encoded cookie and falls through to Accept-Language", () => {
    const detect = () =>
      detectMainSiteLanguage(
        request({ Cookie: "user_lang_preference=%zz", "Accept-Language": "ko-KR" }, "US"),
      );
    expect(detect).not.toThrow();
    expect(detect()).toBe("ko-kr");
  });

  it("honors Accept-Language quality weights and excludes q=0 entries", () => {
    expect(
      detectMainSiteLanguage(request({ "Accept-Language": "en-US;q=0.2, ja-JP;q=0.9" })),
    ).toBe("ja-jp");
    expect(
      detectMainSiteLanguage(request({ "Accept-Language": "zh-CN;q=0, ko-KR;q=0.1" })),
    ).toBe("ko-kr");
  });

  it("uses Cloudflare country metadata when cookie and Accept-Language do not match", () => {
    expect(detectMainSiteLanguage(request({ "Accept-Language": "de-DE" }, "JP"))).toBe("ja-jp");
  });

  it("falls back to the main site's contract default when no earlier signal matches", () => {
    expect(detectMainSiteLanguage(request({ "Accept-Language": "de-DE" }, "BR"))).toBe("en-us");
  });

  it("redirects language-less entries and preserves query parameters", async () => {
    const response = redirectLocalizedEntry(
      new Request("https://docs.comicine.com/security/policy?source=security-txt", {
        headers: { Cookie: "user_lang_preference=zh-cn" },
      }),
      "/security/policy",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://docs.comicine.com/security/policy/zh-cn?source=security-txt",
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

});

describe("private article entry routes", () => {
  for (const [entry, slug] of [
    [amc10Entry, "amc-10-formula-guide"],
    [mu5735Entry, "mu5735-report"],
    [ukMajorsEntry, "uk-undergraduate-majors"],
  ] as const) {
    it(`resolves /private/articles/${slug} with the shared language preference`, () => {
      const response = entry({
        request: new Request(`https://docs.comicine.com/private/articles/${slug}`, {
          headers: { Cookie: "user_lang_preference=ja-jp" },
        }),
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `https://docs.comicine.com/private/articles/${slug}/ja-jp`,
      );
    });
  }
});
