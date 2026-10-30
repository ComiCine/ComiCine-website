/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STATUS_CSS,
  STATUS_JS,
  THEME_JS,
  navHtml,
  notFoundHtml,
  renderErrorHtml,
  statusPageHtml,
  type PagePayload,
} from "./page";
import { LANGS } from "./i18n";

/** One healthy and one failing probe cover both render branches: no reason for up, translated reason for down. */
function payload(over: Partial<PagePayload> = {}): PagePayload {
  return {
    updated_at: 1_700_000_000,
    total: 2,
    down: 1,
    probes: [
      {
        name: "Website",
        group: "public",
        label_key: "card_website",
        status: 1,
        uptime: 99.5,
        detail: "http_200",
      },
      {
        name: "D1 Health",
        group: "internal",
        label_key: null,
        status: 0,
        uptime: 12.34,
        detail: "http_503",
      },
    ],
    ...over,
  };
}

describe("page chrome (inherited from base.html / _footer.html)", () => {
  const html = statusPageHtml(payload(), "zh-cn");

  it("renders the main-site nav: brand, three links, flyout, switch, socials", () => {
    for (const needle of [
      'class="site-nav"',
      '<span class="nav-brand">ComiCine</span>',
      'href="https://comicine.com"',
      'href="https://services.comicine.com"',
      'href="https://contact.comicine.com"',
      'class="nav-external"',
      'class="lang-btn"',
      'id="langMenu"',
      'id="theme-switch"',
      'class="appearance-switch"',
      "https://github.com/ComiCine",
      "https://space.bilibili.com/1234163143",
      'class="icon-svg"',
    ]) {
      expect(html, needle).toContain(needle);
    }
    expect(STATUS_CSS).toContain("@font-face{font-family:'Delius Swash Caps'");
    expect(STATUS_CSS).toContain("unicode-range:U+0020,U+002D,U+0030-0039,U+0043");
    expect(STATUS_CSS).toContain(".nav-brand{font-family:'Delius Swash Caps'");
    expect(STATUS_CSS).toContain(".footer-copyright .brand-word{font-family:'Delius Swash Caps'");
  });

  it("keeps the nav link order of base.html (home → services → contact)", () => {
    // base.html is the canonical header; derive the expected order from its three nav template variables, then compare it with navHtml().
    const base = readFileSync(new URL("../../../src/templates/base.html", import.meta.url), "utf8");
    const nav = base.slice(base.indexOf("<nav"), base.indexOf("</nav>"));
    const literal = ["https://comicine.com", "https://services.comicine.com", "https://contact.comicine.com"];
    const slots = ["home_url", "services_url", "contact_url"].map((name, i) => ({
      url: literal[i]!,
      at: nav.indexOf(`{{ ${name} }}`),
    }));
    expect(slots.every((slot) => slot.at >= 0), "base.html <nav> 里三个链接都在").toBe(true);
    const expected = [...slots].sort((a, b) => a.at - b.at).map((slot) => slot.url);
    expect(expected).toEqual(literal); // The canonical order is home → services → contact.

    // Check the order of the three hrefs in navHtml()'s .global-nav section.
    const html = navHtml("zh-cn");
    const globalNav = html.slice(
      html.indexOf('class="global-nav"'),
      html.indexOf('class="nav-divider"'),
    );
    const actual = (globalNav.match(/href="[^"]+"/g) ?? []).map((href) =>
      href.slice('href="'.length, -1),
    );
    expect(actual).toEqual(expected);
  });

  it("renders the shared footer with the AGPL/source row", () => {
    for (const needle of [
      'class="global-footer"',
      'class="footer-item footer-copyright">&copy; <span data-copyright-years data-copyright-start-year="2026">2026</span> <span class="brand-word">ComiCine</span></span>',
      'data-copyright-start-year="2026"',
      "保留所有权利",
      "AGPL-3.0",
      "https://github.com/ComiCine/ComiCine-website",
      'rel="noopener noreferrer"',
    ]) {
      expect(html, needle).toContain(needle);
    }
  });

  it("uses the dedicated favicon assets", () => {
  expect(html).toContain('rel="icon" href="https://images.comicine.com/static/icons/comicine-favicon.svg?v=12"');
  expect(html).toContain('rel="apple-touch-icon" href="https://images.comicine.com/static/icons/comicine-favicon.png?v=12"');
  });

  it("marks the active language and lists all four options", () => {
    for (const lang of LANGS) {
      const page = statusPageHtml(payload(), lang);
      expect(page).toContain(`<html lang="${lang}">`);
      expect(page, lang).toContain(`data-lang="${lang}"`);
      expect(page, lang).toContain(`class="theme-option selected" data-lang="${lang}"`);
      expect(page.split('class="theme-option').length - 1, lang).toBe(4);
    }
  });

  it("keeps the CI-enforced properties: no inline script, no inline style", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).toContain('href="/status.css"');
    expect(html).toContain('src="/status.js"');
    expect(html).toContain('src="/status-theme.js"');
  });
});

describe("status content", () => {
  it("shows the translated reason on non-up cards only", () => {
    const zh = statusPageHtml(payload(), "zh-cn");
    expect(zh).toContain("服务不可用（HTTP 503）");
    expect(zh).toContain("原因：");
    // The up card has no reason line; it contains only http_200.
    expect(zh.match(/class="reason"/g)?.length).toBe(1);

    const en = statusPageHtml(payload(), "en-us");
    expect(en).toContain("Service unavailable (HTTP 503)");
    expect(en).toContain("Reason: ");
  });

  it("translates the probe label via label_key and falls back to the DB name", () => {
    expect(statusPageHtml(payload(), "ja-jp")).toContain("ComiCine ウェブサイト");
    expect(statusPageHtml(payload(), "ko-kr")).toContain("D1 Health"); // Without label_key, use the database name.
  });

  it("renders an empty state instead of an empty grid when no probe is active", () => {
    const empty = statusPageHtml(payload({ total: 0, down: 0, probes: [] }), "zh-cn");
    expect(empty).toContain("暂无探针配置");
    expect(empty).not.toContain('class="grid"');
    expect(empty).toContain("(0/0)");
  });

  it("escapes anything that comes from the database", () => {
    const nasty = statusPageHtml(
      payload({
        total: 1,
        down: 1,
        probes: [
          {
            name: '<img src=x onerror="alert(1)">',
            group: "public",
            label_key: null,
            status: 0,
            uptime: null,
            detail: "d1_error",
          },
        ],
      }),
      "zh-cn",
    );
    expect(nasty).not.toContain("<img src=x");
    expect(nasty).toContain("&lt;img src=x");
    expect(nasty).toContain("—"); // A null uptime uses a placeholder, not 0%.
  });
});

describe("failure pages", () => {
  it("404 keeps the chrome, is localized and offers two ways out", () => {
    for (const lang of LANGS) {
      const html = notFoundHtml(lang);
      expect(html, lang).toContain('class="site-nav"');
      expect(html, lang).toContain('class="global-footer"');
      expect(html, lang).toContain('class="btn primary" href="/"');
      expect(html, lang).toContain("https://comicine.com");
      expect(html, lang).not.toContain("<script>");
    }
    expect(notFoundHtml("zh-cn")).toContain("页面不存在");
    expect(notFoundHtml("ko-kr")).toContain("페이지를 찾을 수 없습니다");
  });

  it("the render-failure page is localized and explains itself", () => {
    expect(renderErrorHtml("zh-cn")).toContain("状态数据暂时不可用");
    expect(renderErrorHtml("en-us")).toContain("Status data is temporarily unavailable");
    expect(renderErrorHtml("en-us")).toContain("ComiCine Status Worker");
  });
});

describe("assets", () => {
  it("styles the page from the shared design tokens and inlines the brand font", () => {
    expect(STATUS_CSS).toContain("--accent:#05A5A6");
    expect(STATUS_CSS).toContain("--radius-lg:16px");
    expect(STATUS_CSS).toContain("data:font/woff2;base64,");
    expect(STATUS_CSS).toContain(".light-mode");
    expect(STATUS_CSS).toContain(".global-footer");
    expect(STATUS_CSS).toContain(".site-nav");
    expect(STATUS_CSS).not.toContain("@import");
  });

  it("keeps the stylesheet structurally valid: balanced braces, @font-face closed first", () => {
    // A missing `}` (the brand font once omitted the closing `format('woff2')`) makes the parser
    // absorb the remaining stylesheet into an open declaration block, leaving only UA defaults.
    // Vitest does not render CSS, so structural assertions are the available safeguard.
    expect((STATUS_CSS.match(/\{/g) ?? []).length).toBe((STATUS_CSS.match(/\}/g) ?? []).length);
    const fontFace = STATUS_CSS.match(/@font-face\{[^}]*\}/)?.[0];
    expect(fontFace).toBeDefined();
    expect(fontFace).toContain("format('woff2')");
    expect(fontFace).toMatch(/unicode-range:[^;}]+;}$/);
    // @font-face must close at the first `}`; `:root{` can appear only afterward.
    expect(STATUS_CSS.indexOf(":root{")).toBeGreaterThan(STATUS_CSS.indexOf("}"));
    for (const needle of [".light-mode", ".global-footer", ".site-nav", "--accent:#05A5A6"]) {
      expect(STATUS_CSS, needle).toContain(needle);
    }
  });

  it("preloads the theme before paint, from localStorage then the shared cookie", () => {
    expect(THEME_JS).toContain("localStorage.getItem('theme')");
    expect(THEME_JS).toContain("comicine_theme");
    expect(THEME_JS).toContain("prefers-color-scheme: light");
    expect(THEME_JS).toContain("classList.add('light-mode')");
  });

  it("wires the flyout, the theme pill, the countdown and the cookie bridge", () => {
    expect(STATUS_JS).toContain("user_lang_preference");
    expect(STATUS_JS).toContain("comicine_theme");
    expect(STATUS_JS).toContain("comicine_status_lang_synced");
    expect(STATUS_JS).toContain("domain=.'+ROOT");
    expect(STATUS_JS).toContain("refresh-count");
    expect(STATUS_JS).toContain("location.reload()");
    expect(STATUS_JS).toContain("searchParams.set('lang'");
    expect(STATUS_JS).toContain("location.replace");
    // The automatic refresh interval must use the same constant as the initial countdown.
    expect(STATUS_JS).toContain("var REFRESH=300");
    const html = statusPageHtml(payload(), "zh-cn");
    expect(html).toContain('id="refresh-count">300<');
  });
});
