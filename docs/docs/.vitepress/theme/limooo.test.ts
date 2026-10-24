/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */


import { afterEach, describe, expect, it, vi } from "vitest";
import { readCookie } from "./limooo";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readCookie", () => {
  it("returns malformed cookie values without interrupting theme initialization", () => {
    vi.stubGlobal("document", { cookie: "limooo_theme=%" });

    expect(readCookie("limooo_theme")).toBe("%");
  });

  it("decodes valid cookie values", () => {
    vi.stubGlobal("document", { cookie: "user_lang_preference=ja%2Djp" });

    expect(readCookie("user_lang_preference")).toBe("ja-jp");
  });
});
