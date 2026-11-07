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
  renderErrorHtml,
  sevenDayWindow,
  statusPageHtml,
  type PagePayload,
} from "./page";
import { LANGS } from "./i18n";

/** First day of the seven-day window for `updated_at` 1_700_000_000 (2023-11-08 UTC). */
const FIRST_DAY = 1_699_401_600;

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
        latency_ms: 123,
        uptime: 99.5,
        detail: "http_200",
        // One full, one partial, and one failed day; the remaining four days have no row yet.
        days: [
          { day: FIRST_DAY, up: 10, total: 10 },
          { day: FIRST_DAY + 86400, up: 5, total: 10 },
          { day: FIRST_DAY + 2 * 86400, up: 0, total: 10 },
        ],
      },
      {
        name: "D1 Health",
        group: "internal",
        label_key: null,
        status: 0,
        latency_ms: null,
        uptime: 12.34,
        detail: "http_503",
        days: [],
      },
    ],
    ...over,
  };
}

describe("probe label resolution", () => {
  it("does not resolve Object.prototype names as label keys", () => {
    const html = statusPageHtml(
      payload({
        probes: [
          {
            name: "Prototype Probe",
            group: "public",
            label_key: "toString",
            status: 1,
            latency_ms: 42,
            uptime: 99.5,
            detail: "http_200",
            days: [],
          },
        ],
      }),
      "en-us",
    );
    expect(html).toContain("Prototype Probe");
    expect(html).not.toContain("function");
  });
});

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
    expect(slots.every((slot) => slot.at >= 0), "all three links from base.html <nav> are present").toBe(true);
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
  expect(html).toContain('rel="icon" href="https://images.comicine.com/static/icons/comicine-favicon.svg?v=13"');
  expect(html).toContain('rel="apple-touch-icon" href="https://images.comicine.com/static/icons/comicine-favicon.png?v=13"');
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

  it("renders a compact overall strip with the muted down count", () => {
    const zh = statusPageHtml(payload(), "zh-cn");
    expect(zh).toContain('class="overall partial"');
    expect(zh).toContain("部分系统异常");
    expect(zh).toContain('<span class="overall-count">(1/2)</span>');
    // The strip is a tinted panel, not a large outlined card.
    expect(STATUS_CSS).toContain(".overall{");
    expect(STATUS_CSS).toContain(".overall.partial{");
    expect(STATUS_CSS).not.toContain(".overall.all{border-color");
  });

  it("shows latency only when it is known, the uptime, and a translated status pill", () => {
    const zh = statusPageHtml(payload(), "zh-cn");
    expect(zh).toContain('<span class="probe-latency">123 ms</span>');
    expect(zh.match(/class="probe-latency"/g)?.length).toBe(1); // The second probe has no latency.
    expect(zh).toContain('<span class="probe-uptime" title="7 天在线率">99.50%</span>');
    expect(zh).toContain('<span class="pill up">运行正常</span>');
    expect(zh).toContain('<span class="pill down">异常</span>');

    const base = payload();
    const pending = statusPageHtml(
      { ...base, probes: [{ ...base.probes[0]!, status: null, latency_ms: null, uptime: null }] },
      "zh-cn",
    );
    expect(pending).toContain('<span class="pill pending">待检测</span>');
    expect(statusPageHtml(payload(), "en-us")).toContain('<span class="pill down">Down</span>');
  });

  it("renders an empty state instead of probe cards when no probe is active", () => {
    const empty = statusPageHtml(payload({ total: 0, down: 0, probes: [] }), "zh-cn");
    expect(empty).toContain("暂无探针配置");
    expect(empty).not.toContain('class="probe-card"');
    expect(empty).not.toContain('class="heartbeat"');
    expect(empty).toContain("(0/0)");
  });

  it("no longer renders the data-source note on either page", () => {
    for (const page of [statusPageHtml(payload(), "zh-cn"), renderErrorHtml("zh-cn")]) {
      expect(page).not.toContain('class="note"');
      expect(page).not.toContain("数据来源");
    }
    expect(STATUS_CSS).not.toContain(".note{");
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
            latency_ms: null,
            uptime: null,
            detail: "d1_error",
            days: [],
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

describe("7-day heartbeat bar", () => {
  it("renders seven segments per probe, colored by each day's uptime", () => {
    const html = statusPageHtml(payload(), "zh-cn");
    // Two probes × seven days; missing daily buckets still get a gray segment.
    expect(html.match(/class="hb-seg/g)?.length).toBe(14);
    expect(html.match(/class="hb-seg up"/g)?.length).toBe(1);
    expect(html.match(/class="hb-seg partial"/g)?.length).toBe(1);
    expect(html.match(/class="hb-seg down"/g)?.length).toBe(1);
    expect(html.match(/class="hb-seg" role="img"/g)?.length).toBe(11);
  });

  it("labels each segment with its UTC day and percentage in the current language", () => {
    const zh = statusPageHtml(payload(), "zh-cn");
    expect(zh).toContain('title="2023-11-08 · 在线率 100.00%"');
    expect(zh).toContain('aria-label="2023-11-09 · 在线率 50.00%"');
    expect(zh).toContain('title="2023-11-10 · 在线率 0.00%"');
    expect(zh).toContain('title="2023-11-11 · 无数据"');

    const en = statusPageHtml(payload(), "en-us");
    expect(en).toContain('title="2023-11-08 · 100.00% uptime"');
    expect(en).toContain('aria-label="2023-11-11 · no data"');

    const ja = statusPageHtml(payload(), "ja-jp");
    expect(ja).toContain("2023-11-11 · データなし");
    const ko = statusPageHtml(payload(), "ko-kr");
    expect(ko).toContain("2023-11-11 · 데이터 없음");
  });

  it("aligns the day window with the seven full-day query window", () => {
    // statusPayload() reads `day >= midnight - 6 days`; the last bucket is today's midnight.
    const days = sevenDayWindow(1_700_000_000);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe(FIRST_DAY);
    expect(days[6]).toBe(1_699_920_000);
    expect(days[6]! - days[0]!).toBe(6 * 86400);
  });
});

describe("failure pages", () => {
  it("the render-failure page is localized and explains itself", () => {
    expect(renderErrorHtml("zh-cn")).toContain("状态数据暂时不可用");
    expect(renderErrorHtml("en-us")).toContain("Status data is temporarily unavailable");
    expect(renderErrorHtml("en-us")).toContain("Go to comicine.com");
    expect(renderErrorHtml("en-us")).not.toContain("Data source");
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

  it("preloads the theme before paint, preferring the shared cookie", () => {
    expect(THEME_JS.indexOf("document.cookie.match")).toBeLessThan(
      THEME_JS.indexOf("localStorage.getItem('theme')"),
    );
    expect(THEME_JS).toContain("localStorage.getItem('theme')");
    expect(THEME_JS).toContain("comicine_theme");
    expect(THEME_JS).toContain("prefers-color-scheme: light");
    expect(THEME_JS).toContain("classList.add('light-mode')");
  });

  it("defines every class the status content renders", () => {
    for (const selector of [
      ".status-main",
      ".status-head",
      ".status-sub",
      ".overall",
      ".overall-text",
      ".overall-count",
      ".dot",
      ".group",
      ".group-label",
      ".probe-list",
      ".probe-card",
      ".probe-row",
      ".probe-id",
      ".probe-name",
      ".probe-meta",
      ".probe-latency",
      ".probe-uptime",
      ".pill",
      ".reason",
      ".heartbeat",
      ".hb-seg",
      ".empty",
      ".status-footer",
    ]) {
      expect(STATUS_CSS, selector).toContain(`${selector}{`);
    }
  });

  it("keeps status colors readable in both themes", () => {
    expect(STATUS_CSS).toContain("--up:#4ade80");
    expect(STATUS_CSS).toContain("--down:#f87171");
    expect(STATUS_CSS).toContain("--pending:#fbbf24");
    // Light mode overrides the same tokens with darker text colors for contrast on white.
    expect(STATUS_CSS).toContain("--up:#166534");
    expect(STATUS_CSS).toContain("--down:#b91c1c");
    expect(STATUS_CSS).toContain("--pending:#92400e");
    // The heartbeats stay seven segments on a phone-width column.
    expect(STATUS_CSS).toContain("@media(max-width:560px)");
  });

  it("wires the flyout, the theme pill, the countdown and the language menu", () => {
    expect(STATUS_JS).toContain("user_lang_preference");
    expect(STATUS_JS).toContain("comicine_theme");
    expect(STATUS_JS).toContain("catch(e){return m[1]}");
    expect(STATUS_JS).toContain("domain=.'+ROOT");
    expect(STATUS_JS).toContain("refresh-count");
    expect(STATUS_JS).toContain("location.reload()");
    // The language menu writes the shared cookie and reloads with ?lang=.
    expect(STATUS_JS).toContain("save(LANG_COOKIE,c)");
    expect(STATUS_JS).toContain("searchParams.set('lang'");
    // The server resolves the language, so there is no client-side redirect any more.
    expect(STATUS_JS).not.toContain("location.replace");
    expect(STATUS_JS).not.toContain("sessionStorage");
    expect(STATUS_JS).not.toContain("comicine_status_lang_synced");
    // The automatic refresh interval must use the same constant as the initial countdown.
    expect(STATUS_JS).toContain("var REFRESH=300");
    const html = statusPageHtml(payload(), "zh-cn");
    expect(html).toContain('id="refresh-count">300<');
  });
});
