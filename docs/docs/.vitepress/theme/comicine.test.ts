/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */


import { afterEach, describe, expect, it, vi } from "vitest";
import { readCookie, readThemeCookie } from "./comicine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readCookie", () => {
  it("returns malformed cookie values without interrupting theme initialization", () => {
    vi.stubGlobal("document", { cookie: "comicine_theme=%" });

    expect(readCookie("comicine_theme")).toBe("%");
  });

  it("reads the shared theme cookie", () => {
    vi.stubGlobal("document", { cookie: "comicine_theme=dark" });

    expect(readThemeCookie()).toBe("dark");
  });

  it("decodes valid cookie values", () => {
    vi.stubGlobal("document", { cookie: "user_lang_preference=ja%2Djp" });

    expect(readCookie("user_lang_preference")).toBe("ja-jp");
  });
});
