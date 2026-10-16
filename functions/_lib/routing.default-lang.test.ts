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
