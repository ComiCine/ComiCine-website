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

/** Generic HTTP clients are excluded because they cannot be distinguished from server scripts; keep them behind the gate. */
const GENERIC_CLIENT_UAS = [
  "curl/8.22.0",
  "python-requests/2.32.3",
  "Go-http-client/1.1",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36",
  "Wget/1.21.4",
];

function withUserAgent(userAgent: string): Request {
  return new Request("https://limooo.cn/", {
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
