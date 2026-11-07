/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Pure-function tests for shared-ui.js.
 *
 * The file is a classic script that only assigns `globalThis.ComiCineUI`, so importing it in Node
 * exercises the same source the browser loads without needing a DOM. These tests cover the state
 * helpers (i18n parsing, translation, cookies, theme and page metadata); the DOM renderers are
 * intentionally out of scope.
 */

import { describe, expect, it } from "vitest";
import "../../src/static/js/shared-ui.js";

type I18nParams = Record<string, string>;
type TranslationParams = Record<string, string | number>;
type PageMeta = { titleKey: string; descriptionKey: string | null };

interface SharedUI {
  parseI18nText: (spec: string | null | undefined) => { key: string; params: I18nParams };
  parseI18nAttr: (
    spec: string | null | undefined,
  ) => Array<{ attr: string; key: string; params: I18nParams }>;
  formatText: (template: string, params?: TranslationParams | null) => string;
  translator: (
    dict: Record<string, string> | null,
  ) => (key: string, params?: TranslationParams) => string | null;
  cookieValue: (cookieString: string, name: string) => string | null;
  cookieDomainFor: (host: string, rootDomain: string) => string;
  normalizeTheme: (value: unknown) => string | null;
  pageMetaFor: (hostname: string, pathname: string, rootDomain: string) => PageMeta | null;
}

// The classic script has no module exports; it publishes its API on the global object.
const UI = (globalThis as unknown as { ComiCineUI: SharedUI }).ComiCineUI;

describe("parseI18nText", () => {
  it("parses a bare key into the key and empty params", () => {
    expect(UI.parseI18nText("page_title_home")).toEqual({
      key: "page_title_home",
      params: {},
    });
  });

  it("splits semicolon params off the key", () => {
    expect(UI.parseI18nText("greeting;name=ComiCine;count=2")).toEqual({
      key: "greeting",
      params: { name: "ComiCine", count: "2" },
    });
  });

  it("treats empty and null specs as an empty key without throwing", () => {
    expect(UI.parseI18nText("")).toEqual({ key: "", params: {} });
    expect(UI.parseI18nText(null)).toEqual({ key: "", params: {} });
  });
});

describe("parseI18nAttr", () => {
  it("expands comma-separated attributes and parses key params", () => {
    expect(UI.parseI18nAttr("attr1,attr2:key;param=value|attr3:key2")).toEqual([
      { attr: "attr1", key: "key", params: { param: "value" } },
      { attr: "attr2", key: "key", params: { param: "value" } },
      { attr: "attr3", key: "key2", params: {} },
    ]);
  });

  it("trims whitespace around attribute names", () => {
    expect(UI.parseI18nAttr(" href , title :page_cta")).toEqual([
      { attr: "href", key: "page_cta", params: {} },
      { attr: "title", key: "page_cta", params: {} },
    ]);
  });

  it("ignores segments without a key separator", () => {
    expect(UI.parseI18nAttr("placeholder|aria-label:page_label")).toEqual([
      { attr: "aria-label", key: "page_label", params: {} },
    ]);
  });
});

describe("formatText", () => {
  it("substitutes matching placeholders", () => {
    expect(UI.formatText("{n} items", { n: 3 })).toBe("3 items");
  });

  it("returns the template unchanged when no params are given", () => {
    expect(UI.formatText("{n} items")).toBe("{n} items");
    expect(UI.formatText("{n} items", null)).toBe("{n} items");
  });

  it("replaces every occurrence of a repeated placeholder", () => {
    expect(UI.formatText("{n}/{n}", { n: 2 })).toBe("2/2");
  });

  it("substitutes numeric values, including zero, never treating them as empty", () => {
    expect(UI.formatText("{n} items", { n: 0 })).toBe("0 items");
    expect(UI.formatText("total: {n}", { n: 12 })).toBe("total: 12");
  });
});

describe("translator", () => {
  it("formats a known key with its params", () => {
    const translate = UI.translator({ hello: "Hello, {name}!" });
    expect(translate("hello", { name: "ComiCine" })).toBe("Hello, ComiCine!");
  });

  it("returns null for a missing key instead of the key text", () => {
    const translate = UI.translator({ hello: "Hello" });
    expect(translate("missing")).toBeNull();
  });

  it("returns null when the dictionary itself is null", () => {
    const translate = UI.translator(null);
    expect(translate("hello")).toBeNull();
  });
});

describe("cookieValue", () => {
  it("reads a named cookie from a document.cookie string", () => {
    expect(UI.cookieValue("a=1; b=2", "b")).toBe("2");
  });

  it("returns null when the cookie is absent", () => {
    expect(UI.cookieValue("a=1; b=2", "c")).toBeNull();
  });

  it("treats an empty cookie value as missing", () => {
    expect(UI.cookieValue("x=; ", "x")).toBeNull();
  });

  it("does not mistake a longer cookie name for the requested prefix", () => {
    expect(UI.cookieValue("theme_extra=1", "theme")).toBeNull();
  });
});

describe("cookieDomainFor", () => {
  it("scopes a shared cookie to the root domain for subdomains", () => {
    expect(UI.cookieDomainFor("www.comicine.com", "comicine.com")).toBe("; domain=.comicine.com");
  });

  it("returns the same domain scope for the root domain itself", () => {
    expect(UI.cookieDomainFor("comicine.com", "comicine.com")).toBe("; domain=.comicine.com");
  });

  it("rejects lookalike hosts that do not sit below the root domain", () => {
    expect(UI.cookieDomainFor("evilcomicine.com", "comicine.com")).toBe("");
  });

  it("returns no domain scope when no root domain is configured", () => {
    expect(UI.cookieDomainFor("a.example.com", "")).toBe("");
  });
});

describe("normalizeTheme", () => {
  it("accepts the stored light and dark values", () => {
    expect(UI.normalizeTheme("light")).toBe("light");
    expect(UI.normalizeTheme("dark")).toBe("dark");
  });

  it("rejects values that are not exactly light or dark", () => {
    expect(UI.normalizeTheme("LIGHT")).toBeNull();
    expect(UI.normalizeTheme("")).toBeNull();
    expect(UI.normalizeTheme(undefined)).toBeNull();
  });
});

describe("pageMetaFor", () => {
  const homeKeys = { titleKey: "page_title_home", descriptionKey: "meta_description_home" };
  const servicesKeys = {
    titleKey: "page_title_services",
    descriptionKey: "meta_description_services",
  };
  const contactKeys = {
    titleKey: "page_title_contact",
    descriptionKey: "meta_description_contact",
  };

  it("maps the root domain home page to the home keys", () => {
    expect(UI.pageMetaFor("comicine.com", "/", "comicine.com")).toEqual(homeKeys);
  });

  it("maps the portfolio page to the home keys", () => {
    expect(UI.pageMetaFor("comicine.com", "/portfolio", "comicine.com")).toEqual(homeKeys);
  });

  it("maps the services page path to the services keys", () => {
    expect(UI.pageMetaFor("comicine.com", "/services", "comicine.com")).toEqual(servicesKeys);
  });

  it("normalizes a local .html path before resolving its keys", () => {
    expect(UI.pageMetaFor("localhost", "/services.html", "comicine.com")).toEqual(servicesKeys);
  });

  it("maps the services subdomain to the services keys", () => {
    expect(UI.pageMetaFor("services.comicine.com", "/convention", "comicine.com")).toEqual(
      servicesKeys,
    );
  });

  it("maps the contact subdomain to the contact keys", () => {
    expect(UI.pageMetaFor("contact.comicine.com", "/", "comicine.com")).toEqual(contactKeys);
  });

  it("maps the visitor subdomain to a title-only entry", () => {
    expect(UI.pageMetaFor("visitor.comicine.com", "/", "comicine.com")).toEqual({
      titleKey: "page_title_visitor",
      descriptionKey: null,
    });
  });

  it("maps the account host to the Apple account title without a description", () => {
    expect(UI.pageMetaFor("account.comicine.com", "/apple", "comicine.com")).toEqual({
      titleKey: "page_title_apple_account",
      descriptionKey: null,
    });
  });

  it("maps the images host to the image-specific keys", () => {
    expect(UI.pageMetaFor("images.comicine.com", "/", "comicine.com")).toEqual({
      titleKey: "meta_title_images",
      descriptionKey: "meta_description_images",
    });
  });

  it("returns null for pages that keep their own metadata", () => {
    expect(UI.pageMetaFor("comicine.com", "/gate", "comicine.com")).toBeNull();
    expect(UI.pageMetaFor("comicine.com", "/404", "comicine.com")).toBeNull();
  });

  it("returns null for an unknown path so a not-found page never borrows another title", () => {
    // The middleware answers unknown paths with the not-found page at the requested URL.
    expect(UI.pageMetaFor("comicine.com", "/foo", "comicine.com")).toBeNull();
    expect(UI.pageMetaFor("comicine.com", "/visitor", "comicine.com")).not.toBeNull();
  });

  it("treats index.html and the portfolio view as the home page", () => {
    expect(UI.pageMetaFor("comicine.com", "/index.html", "comicine.com")).toEqual(homeKeys);
    expect(UI.pageMetaFor("comicine.com", "/portfolio", "comicine.com")).toEqual(homeKeys);
  });
});
