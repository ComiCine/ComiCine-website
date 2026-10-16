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
 * Tests for GET /api/i18n/<lang> locale dictionary endpoint (tasks/22 W9-5).
 *
 * Regression case: `translations[lang]` can resolve inherited members such as `constructor`, `toString`,
 * `valueOf`, and `__proto__`. Treating one as a supported language and passing a function to
 * `JSON.stringify` returns `undefined`, producing an empty 200 response (`__proto__` returns the
 * Object.prototype object itself) that would also be cached for `max-age=86400`.
 */

import { describe, expect, it } from "vitest";
import { onRequestGet } from "./[lang]";
import { translations } from "../../_data/i18n";

function get(lang: string): Response {
  return onRequestGet({ params: { lang } }) as Response;
}

describe("api/i18n/[lang]", () => {
  it("serves a supported language", async () => {
    const resp = get("zh-cn");
    expect(resp.status).toBe(200);
    const dict = (await resp.json()) as Record<string, string>;
    expect(Object.keys(dict).length).toBeGreaterThan(0);
    expect(dict).toEqual(translations["zh-cn"]);
    expect(resp.headers.get("Cache-Control")).toContain("max-age=86400");
  });

  it("404s an unknown language", () => {
    expect(get("xx-yy").status).toBe(404);
    expect(get("").status).toBe(404);
  });

  it("never resolves Object.prototype members as languages", async () => {
    // These are members of Object.prototype, not language codes.
    for (const lang of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "__defineGetter__",
    ]) {
      const resp = get(lang);
      expect(resp.status, `/${lang} must be 404`).toBe(404);
      const body = (await resp.json()) as { error?: string };
      expect(body.error, `/${lang} body`).toBe("unsupported language");
    }
  });

  it("only serves languages the contract actually declares", () => {
    // Conversely, the endpoint must support exactly the languages present in the data.
    for (const lang of Object.keys(translations)) {
      expect(get(lang).status, `/${lang}`).toBe(200);
    }
  });
});
