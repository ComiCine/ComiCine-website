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

  it("uses the localized home routes for the docs-home alias", () => {
    const chinese = redirectLocalizedEntry(
      request({ Cookie: "user_lang_preference=zh-cn" }),
      "/docs-home",
    );
    const english = redirectLocalizedEntry(
      request({ Cookie: "user_lang_preference=en-us" }),
      "/docs-home",
    );

    expect(chinese.headers.get("Location")).toBe("https://docs.comicine.com/docs-home/zh-cn");
    expect(english.headers.get("Location")).toBe("https://docs.comicine.com/en-us");
  });
});
