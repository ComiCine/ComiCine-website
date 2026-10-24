/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * detectLang must use the contract DEFAULT_LANG as its fallback, not a hardcoded language code.
 *
 * Replace config.DEFAULT_LANG with another supported language and assert the
 * result. This test fails if detectLang still contains a literal such as
 * `"en-us"`.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, DEFAULT_LANG: "ja-jp" };
});

import { DEFAULT_LANG, SUPPORTED_LANGS } from "./config";
import { detectLang } from "./routing";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://limooo.cn/", { headers: { Host: "limooo.cn", ...headers } });
}

describe("detectLang fallback follows the contract DEFAULT_LANG", () => {
  it("uses the contract value, not a hardcoded language code", () => {
    expect(DEFAULT_LANG).toBe("ja-jp");
    expect(SUPPORTED_LANGS).toContain("ja-jp");
    expect(detectLang(req())).toBe("ja-jp");
  });

  it("still prefers the cookie and Accept-Language over the fallback", () => {
    expect(detectLang(req({ Cookie: "user_lang_preference=ko-kr" }))).toBe("ko-kr");
    expect(detectLang(req({ "Accept-Language": "zh-CN,zh;q=0.9" }))).toBe("zh-cn");
  });
});
