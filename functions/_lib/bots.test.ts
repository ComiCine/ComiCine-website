/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Crawler user-agent allowlist (2026-10-12): bypass human verification only
 * and **never** match real browsers.
 *
 * The list determines who may bypass Turnstile; guard against both errors:
 *   * A real browser user agent matches, so users never see the challenge.
 *   * A listed crawler fails to match, making the allowlist ineffective.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CRAWLER_UA_MAX_LENGTH, declaredCrawlerToken, isDeclaredCrawler } from "./bots";

/** Real browser user agents used online: Safari, Chrome, Firefox, Edge, iOS, and Android WebView. */
const BROWSER_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)",
];

/**
 * In-app browsers and device model names the generic markers must not match (2026-11-07).
 *
 * These are real users, so they must still see the challenge. MicroMessenger,
 * WeChat, MQQBrowser and QQ/ matched the WeChat and QQ in-app browsers, and `bot`
 * matched CUBOT phones; all five were removed from docs/lists/robots.txt.
 */
const IN_APP_BROWSER_UAS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x1800323c) NetType/WIFI Language/zh_CN",
  "Mozilla/5.0 (Linux; Android 14; V2309A Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160065 MMWEBSDK/20240404 MMWEBID/7205 MicroMessenger/8.0.49.2600(0x2800313d) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64",
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 NetType/WIFI MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090a5a) XWEB/9129 Flue",
  "Mozilla/5.0 (Linux; U; Android 13; zh-cn; V2244A Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/105.0.0.0 Mobile Safari/537.36 MQQBrowser/14.7",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/9.0.50.616 V1_IPH_SQ_9.0.50_1_APP_A Pixel/1125 Core/WKWebView Device/Apple(iPhone 15) NetType/WIFI QBWebViewType/1",
  "Mozilla/5.0 (Linux; Android 9; CUBOT X19) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Linux; Android 11; CUBOT P30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
];

/**
 * Device, TV and preview-build browsers whose UA contains a word a generic
 * marker used to catch (2026-11-07).
 *
 * `sogou` matched the Sogou mobile browser, `spider` a Spider 8 tablet,
 * `preview` preview builds and `AI-` AKAI/Funai TV browsers. Those tokens are
 * gone, or narrowed to `Sogou web spider`, so these real users see the challenge.
 */
const MARKER_SHARING_BROWSER_UAS = [
  "Mozilla/5.0 (Linux; Android 9; MI 9 Build/PKQ1.181121.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/54.0.3438.43 Mobile Safari/537.36 AWP/2.0 SogouMSE,SogouMobileBrowser/5.22.4",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 12_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SogouMobileBrowser/5.17.1",
  "Mozilla/5.0 (Linux; Android 13; Spider 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) MicrosoftTeams-Preview/1.3.00.5153 Chrome/69.0.3497.128 Electron/4.2.12 Safari/537.36",
  "Mozilla/5.0 (Windows; U; Windows NT 6.1; en-US; rv:1.9.3a1) Gecko/20100208 MozillaDeveloperPreview/3.7a1",
  "Opera/9.80 (Linux mips; U; ; en) Presto/2.10.287 Version/12.00 (avkb/pc,B:461;avvp/ssl;avui/tv;avst/off;avdn/AKAI-v.tv.2013)",
  "Mozilla/5.0 (Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Safari/537.36 OPR/46.0.2207.0 OMI/20.11.2.40.Wasabi.275 Model/Funai-Model18-50PFL5703F7 TV Store/20.11",
];

/** Generic HTTP clients are excluded because they cannot be distinguished from server scripts; keep them behind the gate. */
const GENERIC_CLIENT_UAS = [
  "curl/8.22.0",
  "python-requests/2.32.3",
  "Go-http-client/1.1",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
  "Wget/1.21.4",
];

function withUserAgent(userAgent: string): Request {
  return new Request("https://comicine.com/", {
    headers: userAgent ? { "User-Agent": userAgent } : {},
  });
}

describe("declared crawler User-Agent matching", () => {
  it("matches the AI crawlers observed on the live zone", () => {
    const uas = [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
      "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
      "Mozilla/5.0 (compatible; Claude-User/1.0; +claudebot@anthropic.com)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      "CCBot/2.0 (https://commoncrawl.org/faq/)",
      "Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com) AppleWebKit/537.36",
      "Mozilla/5.0 (compatible; DeepSeekBot/1.0; +https://www.deepseek.com/)",
      "Mozilla/5.0 (compatible; KimiBot/1.0; +https://kimi.ai/)",
      "Mozilla/5.0 (compatible; xAI-Grok/1.0; +https://x.ai/)",
      "Mozilla/5.0 (compatible; Meta-ExternalAgent/1.0; +https://developers.facebook.com/docs/sharing/webmasters/crawler)",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    ];
    for (const ua of uas) {
      expect(isDeclaredCrawler(withUserAgent(ua)), ua).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(isDeclaredCrawler(withUserAgent("gptbot/1.0"))).toBe(true);
    expect(declaredCrawlerToken(withUserAgent("mOziLLa/5.0 GPTBOT/1.4"))).toBe("gptbot");
  });

  it("never matches a real browser User-Agent", () => {
    for (const ua of BROWSER_UAS) {
      expect(isDeclaredCrawler(withUserAgent(ua)), ua).toBe(false);
    }
  });

  it("never matches a WeChat or QQ in-app browser, or a CUBOT phone model", () => {
    for (const ua of IN_APP_BROWSER_UAS) {
      expect(isDeclaredCrawler(withUserAgent(ua)), ua).toBe(false);
      expect(declaredCrawlerToken(withUserAgent(ua)), ua).toBe("");
    }
  });

  it("never matches a device, TV or preview build that shares a marker", () => {
    for (const ua of MARKER_SHARING_BROWSER_UAS) {
      expect(isDeclaredCrawler(withUserAgent(ua)), ua).toBe(false);
      expect(declaredCrawlerToken(withUserAgent(ua)), ua).toBe("");
    }
  });

  it("keeps matching the real crawlers whose markers were narrowed", () => {
    expect(
      declaredCrawlerToken(withUserAgent("Mozilla/5.0 (compatible; QQBot/1.0; +http://www.qq.com)")),
    ).toBe("qqbot");
    expect(
      declaredCrawlerToken(
        withUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
      ),
    ).toBe("googlebot");
    expect(
      declaredCrawlerToken(
        withUserAgent("Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)"),
      ),
    ).toBe("sogou web spider");
    expect(
      declaredCrawlerToken(
        withUserAgent("Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)"),
      ),
    ).toBe("baiduspider");
  });

  it("never matches a generic HTTP client, so scripts stay behind the gate", () => {
    for (const ua of GENERIC_CLIENT_UAS) {
      expect(isDeclaredCrawler(withUserAgent(ua)), ua).toBe(false);
    }
  });

  it("treats a missing or empty User-Agent as not a crawler", () => {
    expect(isDeclaredCrawler(withUserAgent(""))).toBe(false);
    expect(declaredCrawlerToken(withUserAgent(""))).toBe("");
  });

  it("returns the matched token so the bypass log says which rule fired", () => {
    expect(declaredCrawlerToken(withUserAgent("Mozilla/5.0 GPTBot/1.4"))).toBe("gptbot");
    expect(declaredCrawlerToken(withUserAgent("Mozilla/5.0"))).toBe("");
  });

  it("ignores anything beyond the matching prefix, so a long UA cannot smuggle a token", () => {
    const padding = "x".repeat(CRAWLER_UA_MAX_LENGTH);
    expect(isDeclaredCrawler(withUserAgent(`${padding} GPTBot/1.4`))).toBe(false);
// A match within the configured boundary still succeeds.
    const inside = "x".repeat(CRAWLER_UA_MAX_LENGTH - "GPTBot/1.4".length);
    expect(isDeclaredCrawler(withUserAgent(`${inside}GPTBot/1.4`))).toBe(true);
  });

  it("honours the ua_allowlist_enabled contract switch", async () => {
    vi.resetModules();
    vi.doMock("../_data/gateTrust", async () => {
      const actual = await vi.importActual<typeof import("../_data/gateTrust")>(
        "../_data/gateTrust",
      );
      return { ...actual, GATE_TRUST: { ...actual.GATE_TRUST, ua_allowlist_enabled: false } };
    });
    try {
      const disabled = await import("./bots");
      expect(disabled.isDeclaredCrawler(withUserAgent("GPTBot/1.4"))).toBe(false);
    } finally {
      vi.doUnmock("../_data/gateTrust");
      vi.resetModules();
    }
  });
});

afterEach(() => {
  vi.resetModules();
});
