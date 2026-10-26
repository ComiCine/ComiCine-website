/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Orchestration tests for forced challenges: ignore allowlisted IPs and cf_clearance while preserving the original URL.
 *
 * The `onRequest wrapper` section also covers the actual Pages entry point: security
 * header distribution, preserving multiple Set-Cookie headers, and skipping tracking
 * on 403 responses. This is the final layer outside `handleOnRequest`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOnRequest, onRequest, pageCacheKey, withSecurityHeaders } from "./_middleware";
import { GATE_TURNSTILE_ACTION, mintGateCookie } from "./_lib/gate";
import { SECURITY_HEADERS } from "./_lib/security";
import { recordRay, recordVisit, shouldTrackRay, shouldTrackVisit } from "./_lib/tracking";
import type { Env } from "./_lib/env";
import type { RequestContext } from "./_lib/routing";

// Replace tracking functions with spies. Existing cases assume tracking is disabled
// by default; onRequest cases enable it with mockReturnValue and assert whether
// recordVisit / recordRay were called.
vi.mock("./_lib/tracking", () => ({
  isTrustedCrawler: vi.fn(() => false),
  recordRay: vi.fn(async () => undefined),
  recordVisit: vi.fn(async () => undefined),
  shouldTrackRay: vi.fn(() => false),
  shouldTrackVisit: vi.fn(() => false),
}));

const keys = {
  TURNSTILE_SECRET: "turnstile-secret",
  GATE_HMAC_KEY: "a".repeat(64),
  SESSION_HMAC_KEY: "b".repeat(64),
};

function context(request: Request, env: Partial<Env> = {}): RequestContext {
  return {
    request,
    env: { ...keys, ...env } as Env,
    next: async () => new Response("next", { status: 200 }),
    waitUntil: async () => undefined,
  };
}

describe("shared identity navigation", () => {
  it("preserves no-referrer on the 401 navigation document", () => {
    const request = new Request("https://visitor.limooo.cn/");
    const response = withSecurityHeaders(
      request,
      new Response("sign in", { headers: { "Referrer-Policy": "no-referrer" } }),
    );

    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("returns a 401 document with a host-bound identity handoff for browser page requests", async () => {
    const request = new Request("https://visitor.limooo.cn/", {
      headers: {
        Accept: "text/html",
        "CF-Connecting-IP": "97.64.18.11",
      },
    });
    const response = await handleOnRequest(context(request));
    const html = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("/static/js/auth-redirect.js?v=1");

    const targetAttribute = html.match(/data-target="([^"]+)"/)?.[1];
    expect(targetAttribute).toBeDefined();
    const identityUrl = new URL(targetAttribute!.replaceAll("&amp;", "&"));
    expect(identityUrl.origin).toBe("https://identity.comicine.com");
    expect(identityUrl.pathname).toBe("/login");

    const callback = new URL(identityUrl.searchParams.get("next") ?? "");
    expect(callback.origin).toBe("https://visitor.limooo.cn");
    expect(callback.pathname).toBe("/identity/callback");
    const state = callback.searchParams.get("state");
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("Set-Cookie") ?? ""];
    expect(cookies.join("; ")).toContain(`comicine_identity_state_${state}=${state};`);
  });

  it("keeps API authentication failures as JSON 401 responses", async () => {
    const request = new Request("https://visitor.limooo.cn/api/visitors", {
      headers: {
        Accept: "text/html",
        "CF-Connecting-IP": "97.64.18.11",
      },
    });
    const response = await handleOnRequest({
      ...context(request),
      next: async () => Response.json({ error: "unauthorized" }, { status: 401 }),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });
});

describe("force theme challenge", () => {
  it("renders the gate at an unverified visitor's original URL", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/"),
        {
          ASSETS: {
            fetch: async () => new Response("{{host}} {{next}}", {
              headers: { "Content-Type": "text/html" },
            }),
          },
        },
      ),
    );

    expect(resp.status).toBe(403);
    expect(resp.headers.get("Location")).toBeNull();
    await expect(resp.text()).resolves.toContain("limooo.cn /");
  });

  it("renders the gate at the original URL for forced challenges", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/services?challenge=1", {
          headers: {
            "CF-Connecting-IP": "97.64.18.11",
            Cookie: "cf_clearance=test",
          },
        }),
        {
          ASSETS: {
            fetch: async () => new Response("{{host}} {{next}}", {
              headers: { "Content-Type": "text/html" },
            }),
          },
        },
      ),
    );

    expect(resp.status).toBe(403);
    expect(resp.headers.get("Location")).toBeNull();
    await expect(resp.text()).resolves.toContain("limooo.cn /services");
  });

  it("308s the legacy /__gate entry and keeps the forced challenge on /gate", async () => {
    const assets = {
      ASSETS: {
        fetch: async () =>
          new Response(
            "<html><body>{{host}} {{next}} {{lang}} {{error}}</body></html>",
            { headers: { "Content-Type": "text/html" } },
          ),
      },
    };

    const legacy = await handleOnRequest(
      context(
        new Request(
          "https://limooo.cn/__gate?challenge=1&host=limooo.cn&next=%2Fservices",
          { headers: { Cookie: "cf_clearance=test" } },
        ),
        assets,
      ),
    );

    expect(legacy.status).toBe(308);
    expect(legacy.headers.get("Location")).toBe(
      "https://limooo.cn/gate?challenge=1&host=limooo.cn&next=%2Fservices",
    );

    // A forced challenge still blocks through the normalized entry point; cf_clearance is not trusted.
    const forced = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?challenge=1&host=limooo.cn&next=%2Fservices", {
          headers: { Cookie: "cf_clearance=test" },
        }),
        assets,
      ),
    );

    expect(forced.status).toBe(403);
    expect(forced.headers.get("Location")).toBeNull();
  });

  it("ignores client-supplied X-ComiCine-Client-IP when deciding trust", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/", {
          headers: {
            "CF-Connecting-IP": "203.0.113.9",
            "X-ComiCine-Client-IP": "97.64.18.11",
            "X-ComiCine-Client-Country": "CN",
          },
        }),
        {
          ASSETS: {
            fetch: async () => new Response("{{host}} {{next}}", {
              headers: { "Content-Type": "text/html" },
            }),
          },
        },
      ),
    );

    expect(resp.status).toBe(403);
  });

  it("serves redirect static assets directly instead of rendering the redirect page", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://redirect.limooo.cn/static/css/redirect.css"),
      ),
    );
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("next");
  });

  it("serves the health probe without human verification", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/_health", {
          headers: { "CF-Connecting-IP": "1.2.3.4" },
        }),
      ),
    );

    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("ok\n");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("renders the gate page in place on the gate host for verified visitors", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://auth.comicine.com/", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
        {
          ASSETS: {
            fetch: async () =>
              new Response("{{host}} {{next}}", {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }),
          },
        },
      ),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Location")).toBeNull();
    await expect(resp.text()).resolves.toContain("auth.comicine.com /");
  });

  it("serves public pages with edge-cache headers", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/", {
          headers: {
            "CF-Connecting-IP": "97.64.18.11",
            Cookie: "user_lang_preference=zh-cn",
          },
        }),
        {
          ASSETS: {
            fetch: async () =>
              new Response("<html>home</html>", {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }),
          },
        },
      ),
    );

    expect(resp.status).toBe(200);
    // Observed on 2026-10-11: Pages Functions responses do not enter the edge cache,
    // so s-maxage is omitted. max-age serves only the browser's private cache, while
    // stale-while-revalidate remains enabled.
    expect(resp.headers.get("Cache-Control")).toBe(
      "public, max-age=300, stale-while-revalidate=3600",
    );
    expect(resp.headers.get("Cache-Control")).not.toContain("s-maxage");
    expect(resp.headers.get("Vary")).toContain("Accept-Language");
    // Cookie must not appear in Vary: it has no effect at the edge and creates a cache bucket per visitor.
    expect(resp.headers.get("Vary")).not.toContain("Cookie");
  });

  it("keys the in-process page cache by host so two hosts cannot share a page", async () => {
    // www and the apex host have identical routes; omitting the host from the cache key would mix their pages.
    // Assert pageCacheKey directly; the rendering path uses this same function.
    const main = pageCacheKey("limooo.cn", "/en-us/index.html", "en-us").href;
    const www = pageCacheKey("www.limooo.cn", "/en-us/index.html", "en-us").href;
    expect(main).not.toBe(www);
    expect(new URL(main).hostname).toBe("limooo.cn");
    expect(new URL(www).hostname).toBe("www.limooo.cn");
    // The language and asset path must remain in the key, or changing languages could return a stale page.
    expect(pageCacheKey("limooo.cn", "/en-us/index.html", "en-us").href).not.toBe(
      pageCacheKey("limooo.cn", "/zh-cn/index.html", "zh-cn").href,
    );
  });

  it("records the request host in the cache key it actually uses", async () => {
    const written: string[] = [];
    const original = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async () => undefined,
        put: async (req: RequestInfo | URL) => {
          written.push(typeof req === "string" ? req : req instanceof URL ? req.href : req.url);
        },
      },
    };
    try {
      const resp = await handleOnRequest(
        context(
          new Request("https://limooo.cn/", {
            headers: {
              "CF-Connecting-IP": "97.64.18.11",
              Cookie: "user_lang_preference=zh-cn",
            },
          }),
          {
            ASSETS: {
              fetch: async () =>
                new Response("<html>home</html>", {
                  headers: { "Content-Type": "text/html; charset=utf-8" },
                }),
            },
          },
        ),
      );
      expect(resp.status).toBe(200);
    } finally {
      (globalThis as { caches?: unknown }).caches = original;
    }

    expect(written).toHaveLength(1);
    expect(new URL(written[0]).hostname).toBe("limooo.cn");
    expect(new URL(written[0]).searchParams.get("lang")).toBe("zh-cn");
  });
});

describe("legacy HTML redirects", () => {
  it.each([
    ["https://limooo.cn/www.html", "https://comicine.com/"],
    ["https://limooo.cn/images.html", "https://comicine.com/"],
    ["https://limooo.cn/portfolio.html", "https://comicine.com/portfolio"],
    ["https://limooo.cn/visitor.html", "https://visitor.comicine.com/"],
    ["https://limooo.cn/apple-account.html", "https://account.comicine.com/"],
    ["https://limooo.cn/redirect.html", "https://redirect.comicine.com/"],
    ["https://limooo.cn/status.html", "https://status.comicine.com/"],
    ["https://services.limooo.cn/index.html", "https://services.comicine.com/"],
  ])("redirects known alias %s to %s", async (requestUrl, target) => {
    const resp = await handleOnRequest(context(new Request(requestUrl)));

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe(target);
  });

  it("redirects known aliases before the images static-only handler and preserves query", async () => {
    let assetCalls = 0;
    const resp = await handleOnRequest(
      context(
        new Request("https://images.limooo.cn/services.html?from=legacy"),
        {
          ASSETS: {
            fetch: async () => {
              assetCalls += 1;
              return new Response("missing", { status: 404 });
            },
          },
        },
      ),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe(
      "https://services.comicine.com/?from=legacy",
    );
    expect(assetCalls).toBe(0);
  });

  it("routes known www aliases directly to their destination", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://www.limooo.cn/contact.html")),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://contact.comicine.com/");
  });

  it("sends the docs alias to the main site without the docs-root redirect hop", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://limooo.cn/docs.html")),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://comicine.com/");
  });

  it("returns HTTP 404 for unknown html targets without redirecting", async () => {
    const aliases = [
      "https://limooo.cn/not-a-page.html",
      "https://services.limooo.cn/fail.html?from=legacy",
    ];

    for (const url of aliases) {
      const resp = await handleOnRequest(
        context(
          new Request(url, {
            headers: { "CF-Connecting-IP": "97.64.18.11" },
          }),
        ),
      );

      expect(resp.status).toBe(404);
      expect(resp.headers.get("Location")).toBeNull();
      await expect(resp.text()).resolves.toBe("Not Found");
    }
  });

  it("does not apply legacy aliases to unlisted subdomains", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://preview.limooo.cn/services.html", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
      ),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Location")).toBeNull();
  });

  it("keeps forced challenges ahead of known aliases", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/services.html?challenge=1", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
        {
          ASSETS: {
            fetch: async () => new Response("{{host}} {{next}}", {
              headers: { "Content-Type": "text/html" },
            }),
          },
        },
      ),
    );

    expect(resp.status).toBe(403);
    expect(resp.headers.get("Location")).toBeNull();
  });
});

describe("Feishu path aliases", () => {
  it.each([
    ["https://limooo.cn/feishu", "https://comicine.feishu.cn/"],
    ["https://limooo.cn/feishu/docs/guide?lang=zh-cn", "https://comicine.feishu.cn/docs/guide?lang=zh-cn"],
    ["https://limooo.cn/lark/open?from=site", "https://comicine.feishu.cn/open?from=site"],
  ])("redirects %s to the ComiCine Feishu site", async (requestUrl, target) => {
    const resp = await handleOnRequest(context(new Request(requestUrl)));

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe(target);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("images host routing", () => {
  it("keeps permanent redirects for retired landing paths", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://images.limooo.cn/index.html")),
    );

    expect(resp.status).toBe(301);
    expect(resp.headers.get("Location")).toBe("https://comicine.com/");
  });

  it("never forwards API paths to Pages Functions", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://images.limooo.cn/api/visitors")),
    );

    expect(resp.status).toBe(404);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    await expect(resp.text()).resolves.toBe("Not Found");
  });
});

describe("public /files", () => {
  const assetsEnv = (env: Partial<Env> = {}) => ({
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/static/files/after_sign_in.png")) {
          return new Response("png-bytes", {
            headers: { "Content-Type": "image/png", ETag: '"abc"' },
          });
        }
        return new Response("missing", { status: 404 });
      },
    },
    ...env,
  });

  it("serves /files/<name> without the gate, even for an unverified visitor", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://limooo.cn/files/after_sign_in.png"), assetsEnv()),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
    expect(resp.headers.get("Cache-Control")).toContain("max-age=86400");
    await expect(resp.text()).resolves.toBe("png-bytes");
  });

  it("also maps the clean URL on the images subdomain", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://images.limooo.cn/files/after_sign_in.png"),
        assetsEnv(),
      ),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toBe("image/png");
  });

  it("404s unknown names and path traversal without touching the gate", async () => {
    const unknown = await handleOnRequest(
      context(new Request("https://limooo.cn/files/nope.png"), assetsEnv()),
    );
    expect(unknown.status).toBe(404);

    const traversal = await handleOnRequest(
      context(new Request("https://limooo.cn/files/..%2Fsecrets"), assetsEnv()),
    );
    expect(traversal.status).toBe(404);
  });
});

describe("blocked IP enforcement", () => {
  /**
   * D1 stub: every query for a blocked_ips network or prefix returns one IPv4 /32 ban.
   * This is the only read that isBlocked() relies on in production.
   */
  const blockedEnv = (env: Partial<Env> = {}) => ({
    DB: {
      prepare: () => ({
        bind: () => ({
          first: async () => null,
          all: async () => ({
            results: [{ cidr: "203.0.113.9/32", network: "203.0.113.9", prefix: 32 }],
          }),
          run: async () => ({}),
        }),
        first: async () => null,
        all: async () => ({
          results: [{ cidr: "203.0.113.9/32", network: "203.0.113.9", prefix: 32 }],
        }),
        run: async () => ({}),
      }),
    },
    ASSETS: {
      fetch: async () => new Response("assets", { status: 200 }),
    },
    ...env,
  });

  const blockedRequest = (path: string) =>
    new Request(`https://limooo.cn${path}`, {
      headers: { "CF-Connecting-IP": "203.0.113.9" },
    });

  it("blocks a banned IP on /api/* instead of letting the API early-return skip the check", async () => {
    // Regression: /api/* used to return next() before isBlocked(), disabling bans across the API surface.
    // /api/ray, /api/auth, and /api/apple-account are exempt; see the next case.
    for (const path of ["/api/visitors", "/api/blocklist", "/api/status", "/api/i18n/zh-cn"]) {
      const resp = await handleOnRequest(context(blockedRequest(path), blockedEnv()));
      expect(resp.status, `${path} must be blocked`).toBe(403);
    }
  });

  it("keeps the blocked page uncacheable and shows the blocked copy", async () => {
    const env = blockedEnv({
      ASSETS: {
        fetch: async () =>
          new Response("<html><body>{{host}} {{next}} {{error}}</body></html>", {
            headers: { "Content-Type": "text/html" },
          }),
      },
    });
    const resp = await handleOnRequest(context(blockedRequest("/api/visitors"), env));
    expect(resp.status).toBe(403);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    await expect(resp.text()).resolves.toContain("blocked");
  });

  it("skips the block query entirely for an already-trusted source", async () => {
    // W2-2: allowlisted IPs and verified crawlers need no database lookup. A ban check
    // can probe up to 33 IPv4 prefixes (129 for IPv6), making checks for every trusted
    // source the largest fixed read cost identified in this audit.
    let blockQueries = 0;
    const env = blockedEnv({
      ASSETS: { fetch: async () => new Response("assets") },
    });
    const db = env.DB as unknown as { prepare: (...args: unknown[]) => unknown };
    const original = db.prepare;
    db.prepare = (...args: unknown[]) => {
      if (String(args[0] ?? "").includes("blocked_ips")) blockQueries += 1;
      return original(...args);
    };

    // 97.64.18.11 is allowlisted in the gate_trust contract and is also the banned row.
    // Trust takes precedence, so it should neither query the database nor be blocked.
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/services", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
        env,
      ),
    );
    expect(blockQueries).toBe(0);
    expect(resp.status).toBe(200);

    // With the same banned IP and environment, removing trust must trigger a lookup and block the request.
    const blocked = await handleOnRequest(context(blockedRequest("/services"), env));
    expect(blockQueries).toBeGreaterThan(0);
    expect(blocked.status).toBe(403);
  });

  /**
   * Crawler UA allowlist (2026-10-12): matching entries bypass human verification and receive the real page.
   *
   * Keep the trust boundary explicit: the UA allowlist is not part of sourceTrusted,
   * which contains only allowlisted IPs and verified bots. Self-identified crawlers
   * must still pass the blocked_ips check.
   */
  it("serves the real page to a declared crawler and keeps the gate for a browser", async () => {
    const CRAWLER_UA = "Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)";
    const env = blockedEnv({
      // The real page and gate page use the same ASSETS template path; distinguish them by their content.
      ASSETS: {
        fetch: async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("index.html")) {
            return new Response("<html><body>real home</body></html>", {
              headers: { "Content-Type": "text/html" },
            });
          }
          return new Response("<html><body>{{host}} {{next}}</body></html>", {
            headers: { "Content-Type": "text/html" },
          });
        },
      },
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({}),
          }),
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({}),
        }),
      },
    });

    const crawler = await handleOnRequest(
      context(new Request("https://limooo.cn/", { headers: { "User-Agent": CRAWLER_UA } }), env),
    );
    expect(crawler.status).toBe(200);
    await expect(crawler.text()).resolves.toContain("real home");

    const browser = await handleOnRequest(
      context(
        new Request("https://limooo.cn/", {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
          },
        }),
        env,
      ),
    );
    expect(browser.status).toBe(403);
  });

  it("does not exempt a declared crawler from the blocklist", async () => {
    // A self-identified GPTBot from a banned IP must still receive 403; a claimed UA cannot lift a ban.
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/services", {
          headers: {
            "CF-Connecting-IP": "203.0.113.9",
            "User-Agent": "Mozilla/5.0 (compatible; GPTBot/1.4; +https://openai.com/gptbot)",
          },
        }),
        blockedEnv(),
      ),
    );

    expect(resp.status).toBe(403);
  });

  it("still lets a banned IP reach the exempt API escape hatches", async () => {
    // Keep exempt paths reachable so administrators can use login and management APIs from a banned IP;
    // otherwise they must wait for the next Cloudflare IP List sync. Assert that an exempt match skips
    // isBlocked rather than checking a particular status code.
    let blockQueries = 0;
    const env = blockedEnv({
      ASSETS: { fetch: async () => new Response("assets") },
    });
    const db = env.DB as unknown as { prepare: (...args: unknown[]) => unknown };
    const original = db.prepare;
    db.prepare = (...args: unknown[]) => {
      const sql = String(args[0] ?? "");
      if (sql.includes("blocked_ips")) blockQueries += 1;
      return original(...args);
    };

    // routing.ts isExemptPath matches an exact path or its descendants: `/api/auth` matches,
    // but `/api/auth/status` does not, preventing lookalikes such as `/api/authx`.
    // Use only actual exempt paths here; routing.test.ts covers descendant matching.
    for (const path of ["/api/auth", "/api/apple-account/accounts", "/api/ray/abc123"]) {
      const resp = await handleOnRequest(context(blockedRequest(path), env));
      expect(resp.status, `${path} must stay reachable`).toBe(200);
    }
    expect(blockQueries).toBe(0);

    // Control case: a non-exempt path queries the ban table, proving the earlier zero was not a skipped check.
    const blocked = await handleOnRequest(context(blockedRequest("/api/visitors"), env));
    expect(blocked.status).toBe(403);
    expect(blockQueries).toBeGreaterThan(0);
  });

  it("does not run the block query for static assets or clean /files URLs", async () => {
    let queries = 0;
    const env = blockedEnv({
      ASSETS: {
        fetch: async (input: RequestInfo | URL) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith("/static/js/actions.js")) {
            return new Response("js", { headers: { "Content-Type": "text/javascript" } });
          }
          return new Response("missing", { status: 404 });
        },
      },
    });
    const db = env.DB as unknown as { prepare: (...args: unknown[]) => unknown };
    const original = db.prepare;
    db.prepare = (...args: unknown[]) => {
      queries += 1;
      return original(...args);
    };

    const staticResp = await handleOnRequest(
      context(new Request("https://limooo.cn/static/js/actions.js"), env),
    );
    const filesResp = await handleOnRequest(
      context(new Request("https://limooo.cn/files/after_sign_in.png"), env),
    );

    expect(staticResp.status).toBe(200);
    expect(filesResp.status).toBe(404);
    expect(queries).toBe(0);
  });

  it("does not exempt lookalike prefixes: /account-x still hits the block table", async () => {
    // A broad startsWith("/account") check would also exempt /account-anything; exemptions must match
    // an exact path or its descendants. Check whether blocked_ips was queried rather than the status:
    // non-API exempt paths do not get the blocked page, but may still receive the gate page (also 403).
    let blockQueries = 0;
    const env = blockedEnv();
    const db = env.DB as unknown as { prepare: (...args: unknown[]) => unknown };
    const original = db.prepare;
    db.prepare = (...args: unknown[]) => {
      if (String(args[0] ?? "").includes("blocked_ips")) blockQueries += 1;
      return original(...args);
    };

    for (const path of ["/account-takeover", "/api/raytrace", "/visitors"]) {
      blockQueries = 0;
      const resp = await handleOnRequest(context(blockedRequest(path), env));
      expect(resp.status, `${path} must be blocked`).toBe(403);
      expect(blockQueries, `${path} must consult blocked_ips`).toBeGreaterThan(0);
    }

    // Exact paths and real descendants remain exempt and skip the ban table, so administrators
    // can still sign in from a banned IP. Check query counts; the response may be the gate page's 403.
    for (const path of ["/account", "/account/apple", "/login", "/login/callback", "/logout", "/visitor"]) {
      blockQueries = 0;
      await handleOnRequest(context(blockedRequest(path), env));
      expect(blockQueries, `${path} must stay exempt`).toBe(0);
    }
  });

  it("lets a whitelisted IP through to /api/* untouched", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/api/visitors", {
          headers: { "CF-Connecting-IP": "97.64.18.11" },
        }),
        blockedEnv(),
      ),
    );
    expect(resp.status).toBe(200);
  });
});

describe("canonical /gate entry", () => {
  const assetsEnv = {
    ASSETS: {
      fetch: async () =>
        new Response("<html><body>{{host}} {{next}} {{error}}</body></html>", {
          headers: { "Content-Type": "text/html" },
        }),
    },
  };

  it("serves the gate page for an unverified visitor", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://limooo.cn/gate?host=limooo.cn&next=%2Fservices"), assetsEnv),
    );
    expect(resp.status).toBe(403);
    await expect(resp.text()).resolves.toContain("limooo.cn /services");
  });

  it("sends a visitor holding a valid cookie straight back without re-challenging", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const cookie = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];

    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2Fservices", {
          headers: { Cookie: cookie, "CF-Connecting-IP": "203.0.113.7" },
        }),
        assetsEnv,
      ),
    );

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/services");
    vi.useRealTimers();
  });

  it("does not re-issue the cookie on every request while it is still fresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const cookie = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];
    vi.setSystemTime((1_700_000_000 + 60) * 1000);

    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2F", {
          headers: { Cookie: cookie, "CF-Connecting-IP": "203.0.113.7" },
        }),
        assetsEnv,
      ),
    );

    expect(resp.status).toBe(302);
    // A language cookie may also be set, but __gate must not be issued again.
    expect(resp.headers.get("Set-Cookie") ?? "").not.toContain("__gate=");
    vi.useRealTimers();
  });

  it("renews the cookie on a normal page hit once it is 3/4 through its TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const cookie = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];
    // After 3/4 of the TTL has elapsed, a page request should renew the cookie in its response instead of showing the gate.
    vi.setSystemTime((1_700_000_000 + 2700 + 1) * 1000);

    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/", {
          headers: {
            Cookie: cookie,
            "CF-Connecting-IP": "203.0.113.7",
            "Host": "limooo.cn",
          },
        }),
        {
          ASSETS: {
            fetch: async () =>
              new Response("<html>home</html>", {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }),
          },
        },
      ),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Set-Cookie") ?? "").toContain("__gate=");
    vi.useRealTimers();
  });

  it("does not renew on every page hit, so the hour is not a sliding window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const cookie = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];
    vi.setSystemTime((1_700_000_000 + 120) * 1000);

    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/", {
          headers: {
            Cookie: cookie,
            "CF-Connecting-IP": "203.0.113.7",
            "Host": "limooo.cn",
          },
        }),
        {
          ASSETS: {
            fetch: async () =>
              new Response("<html>home</html>", {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }),
          },
        },
      ),
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Set-Cookie") ?? "").not.toContain("__gate=");
    vi.useRealTimers();
  });

  it("caps how many same-name __gate cookies it will verify", async () => {
    // There is no limit on same-name cookies; each one would run a regex, WebCrypto importKey, and sign.
    // A 32 KB Cookie header can hold about 400 cookies and cause about 400 WebCrypto calls, letting an
    // attacker control CPU usage (tasks/22 W9-10). Verify only the first N cookies.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const valid = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];
    const junk = `__gate=1700000000.1700003600.${"a".repeat(64)}`;

    // The first valid cookie within the limit still works, preserving the existing behavior where an older-scope cookie comes first.
    const withinCap = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2Fservices", {
          headers: { Cookie: `${junk}; ${valid}`, "CF-Connecting-IP": "203.0.113.7" },
        }),
        assetsEnv,
      ),
    );
    expect(withinCap.status).toBe(302);

    // A valid cookie after the ninth entry is beyond the limit and is not checked, so the request is denied.
    const flood = Array.from({ length: 40 }, () => junk).join("; ");
    const beyondCap = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2Fservices", {
          headers: { Cookie: `${flood}; ${valid}`, "CF-Connecting-IP": "203.0.113.7" },
        }),
        assetsEnv,
      ),
    );
    vi.useRealTimers();

    expect(beyondCap.status).toBe(403);
  });

  it("accepts the request when a stale __gate precedes a valid one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000 * 1000);
    const valid = (await mintGateCookie(keys.GATE_HMAC_KEY)).split(";")[0];

    // An expired __gate from the old scope comes first; checking only the first cookie would reject the request.
    const stale = `__gate=1700000000.1700003600.${"a".repeat(64)}`;
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate?host=limooo.cn&next=%2Fservices", {
          headers: { Cookie: `${stale}; ${valid}`, "CF-Connecting-IP": "203.0.113.7" },
        }),
        assetsEnv,
      ),
    );
    vi.useRealTimers();

    expect(resp.status).toBe(302);
    expect(resp.headers.get("Location")).toBe("https://limooo.cn/services");
  });

  it("never lets the challenge page be cached at the content URL", async () => {
    const resp = await handleOnRequest(
      context(new Request("https://limooo.cn/services"), assetsEnv),
    );
    expect(resp.status).toBe(403);
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
  });

  it("308s the legacy /__gate entry to /gate, preserving the query", async () => {
    const resp = await handleOnRequest(
      context(
        new Request("https://limooo.cn/__gate?host=limooo.cn&next=%2Fservices"),
        assetsEnv,
      ),
    );

    expect(resp.status).toBe(308);
    expect(resp.headers.get("Location")).toBe(
      "https://limooo.cn/gate?host=limooo.cn&next=%2Fservices",
    );
  });

  it("answers the canonical config/diag/verify endpoints", async () => {
    const config = await handleOnRequest(
      context(new Request("https://limooo.cn/gate/config")),
    );
    expect(config.status).toBe(200);
    await expect(config.json()).resolves.toHaveProperty("root_domain", "comicine.com");

    const diag = await handleOnRequest(
      context(
        new Request("https://limooo.cn/gate/diag", {
          headers: { "CF-Connecting-IP": "203.0.113.7" },
        }),
      ),
    );
    expect(diag.status).toBe(200);
  });
});

describe("onRequest wrapper", () => {
  /**
   * onRequest tracking uses context.waitUntil. Collect deferred promises so the test can
   * await them and assert that they were passed to waitUntil instead of being fire-and-forget.
   */
  function wrapperContext(
    request: Request,
    env: Partial<Env> = {},
    next: () => Promise<Response> = async () => new Response("next", { status: 200 }),
  ) {
    const deferred: Promise<unknown>[] = [];
    const context: RequestContext = {
      request,
      env: { ...keys, ...env } as Env,
      next,
      waitUntil: (promise: Promise<unknown>) => {
        deferred.push(promise);
      },
    };
    return { context, deferred };
  }

  const htmlEnv = (body = "<html><body>{{host}} {{next}}</body></html>") => ({
    ASSETS: {
      fetch: async () =>
        new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } }),
    },
  });

  /**
   * Create a response with workerd semantics: iteration (the path used by
   * `new Headers(resp.headers)`) sees one comma-joined `set-cookie`, while
   * `getSetCookie()` still returns both cookies.
   *
   * Node/undici's copy constructor preserves multiple Set-Cookie headers, so it does not
   * model this behavior. Removing `preserveSetCookie` would still pass locally, while
   * production runs on workerd.
   */
  function foldingCookieResponse(cookies: string[], status = 200): Response {
    const real = new Headers({ "Content-Type": "application/json" });
    for (const cookie of cookies) real.append("Set-Cookie", cookie);
    const resp = new Response("{}", { status, headers: real });
    Object.defineProperty(resp, "headers", {
      value: {
        getSetCookie: () => real.getSetCookie(),
        *[Symbol.iterator]() {
          yield ["content-type", "application/json"] as [string, string];
          yield ["set-cookie", real.getSetCookie().join(", ")] as [string, string];
        },
      },
    });
    return resp;
  }

  beforeEach(() => {
    vi.mocked(shouldTrackVisit).mockReturnValue(true);
    vi.mocked(shouldTrackRay).mockReturnValue(true);
    vi.mocked(recordVisit).mockClear();
    vi.mocked(recordRay).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(shouldTrackVisit).mockReturnValue(false);
    vi.mocked(shouldTrackRay).mockReturnValue(false);
  });

  it("adds the full security header set to pages and only nosniff to /api/*", async () => {
    const { context: pageContext } = wrapperContext(
      new Request("https://limooo.cn/services", {
        headers: { "CF-Connecting-IP": "97.64.18.11" },
      }),
      htmlEnv("<html>services</html>"),
    );
    const page = await onRequest(pageContext);

    expect(page.status).toBe(200);
    // Pages must match SECURITY_HEADERS exactly; import values from the single source instead of duplicating strings.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(page.headers.get(name), `${name} on a page`).toBe(value);
    }
    expect(page.headers.get("Content-Security-Policy")).toBe(
      SECURITY_HEADERS["Content-Security-Policy"],
    );

    const { context: apiContext } = wrapperContext(
      new Request("https://limooo.cn/api/visitors", {
        headers: { "CF-Connecting-IP": "97.64.18.11" },
      }),
    );
    const api = await onRequest(apiContext);

    expect(api.status).toBe(200);
    // /api/* only gets nosniff; the other four headers, including CSP, must be absent to avoid breaking JSON APIs.
    expect(api.headers.get("X-Content-Type-Options")).toBe(
      SECURITY_HEADERS["X-Content-Type-Options"],
    );
    expect(api.headers.get("Content-Security-Policy")).toBeNull();
    for (const name of Object.keys(SECURITY_HEADERS)) {
      if (name === "X-Content-Type-Options") continue;
      expect(api.headers.get(name), `${name} must not be added to /api/*`).toBeNull();
    }
  });

  it("keeps both Set-Cookie headers that /gate/verify issues", async () => {
    // /gate/verify intentionally sends two Set-Cookie headers: clear the old host-only scope,
    // then write the new domain cookie. Sending only one cannot remove the old cookie; Safari
    // uses only the first cookie when multiple headers are folded together.
    vi.stubGlobal("fetch", async () =>
      Response.json({ success: true, hostname: "limooo.cn", action: GATE_TURNSTILE_ACTION }),
    );

    const { context } = wrapperContext(
      new Request("https://limooo.cn/gate/verify", {
        method: "POST",
        headers: {
          "CF-Connecting-IP": "203.0.113.7",
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "cf-turnstile-response": "token",
          next: "/",
          host: "limooo.cn",
        }).toString(),
      }),
    );
    const resp = await onRequest(context);

    expect(resp.status).toBe(204);
    const cookies = resp.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((cookie) => cookie.startsWith("__gate="))).toBe(true);
    // The values differ: one clears the old scope with Max-Age=0, and the other is the new signed cookie.
    expect(new Set(cookies).size).toBe(2);
  });

  it("does not fold multiple Set-Cookie headers when rewrapping the response", async () => {
    // A multi-cookie response from next() (for example, an API setting session and CSRF cookies)
    // passes through onRequest. The response headers use workerd semantics; see foldingCookieResponse.
    const cookies = [
      "limooo_session=abc; Path=/; HttpOnly",
      "limooo_csrf=def; Path=/; SameSite=Lax",
    ];
    const { context } = wrapperContext(
      new Request("https://limooo.cn/api/auth/status", {
        headers: { "CF-Connecting-IP": "97.64.18.11" },
      }),
      {},
      async () => foldingCookieResponse(cookies),
    );

    const resp = await onRequest(context);

    expect(resp.status).toBe(200);
    expect(resp.headers.getSetCookie()).toEqual(cookies);
  });

  it("skips visit and ray tracking for 403 gate rejections", async () => {
    const { context, deferred } = wrapperContext(
      new Request("https://limooo.cn/services", {
        headers: { "CF-Connecting-IP": "203.0.113.7" },
      }),
      htmlEnv(),
    );
    const resp = await onRequest(context);
    await Promise.all(deferred);

    expect(resp.status).toBe(403);
    // Gate rejections, like banned-source responses, must not write visit or Ray logs; scan traffic must not consume D1 quota.
    // beforeEach enables tracking, so these not.toHaveBeenCalled assertions exercise the real path.
    expect(vi.mocked(recordVisit)).not.toHaveBeenCalled();
    expect(vi.mocked(recordRay)).not.toHaveBeenCalled();
  });

  it("records the visit and ray on tracked responses, handing both to waitUntil", async () => {
    const { context, deferred } = wrapperContext(
      new Request("https://limooo.cn/services", {
        headers: { "CF-Connecting-IP": "97.64.18.11" },
      }),
      htmlEnv("<html>services</html>"),
    );
    const resp = await onRequest(context);
    await Promise.all(deferred);

    expect(resp.status).toBe(200);
    expect(vi.mocked(recordVisit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordRay)).toHaveBeenCalledTimes(1);

    // Pass through the actual response status instead of hard-coding it.
    expect(vi.mocked(recordVisit).mock.calls[0][2]).toBe(200);
    const rayCall = vi.mocked(recordRay).mock.calls[0];
    expect(rayCall[2]).toBe(200);
    expect(typeof rayCall[3]).toBe("number");

    // Tracking promises must go to waitUntil so they do not block the response or run fire-and-forget.
    expect(deferred).toContain(vi.mocked(recordVisit).mock.results[0].value);
    expect(deferred).toContain(vi.mocked(recordRay).mock.results[0].value);
  });
});

/**
 * tasks/22 increment 2: parse `new URL(request.url)` once and call `detectLang` once per request.
 *
 * A proxy/getter counts reads of `request.url` and `Accept-Language`: the former is the
 * number of URL parses, and the latter equals detectLang calls when no language cookie
 * is present (routing.detectLang is the only code that reads this header). Before the
 * change, the counts were 5 and 2 respectively.
 */
describe("request URL is parsed once per request", () => {
  function countingRequest(url: string, cookie?: string) {
    const real = new Request(url, {
      headers: {
        "CF-Connecting-IP": "97.64.18.11",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    const reads = { url: 0, acceptLanguage: 0 };
    Object.defineProperty(real, "url", {
      get() {
        reads.url += 1;
        return url;
      },
    });
    Object.defineProperty(real, "headers", {
      value: new Proxy(real.headers, {
        get(target, prop) {
          if (prop === "get") {
            return (name: string) => {
              if (name.toLowerCase() === "accept-language") reads.acceptLanguage += 1;
              return target.get(name);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    });
    return { request: real, reads };
  }

  function run(request: Request) {
    const deferred: Promise<unknown>[] = [];
    return onRequest({
      request,
      env: {
        ...keys,
        ASSETS: {
          fetch: async () =>
            new Response("<html>services</html>", {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
        },
      } as Env,
      next: async () => new Response("next", { status: 200 }),
      waitUntil: (promise: Promise<unknown>) => {
        deferred.push(promise);
      },
    });
  }

  it("parses the URL once and detects the language once for a page request", async () => {
    const { request, reads } = countingRequest("https://limooo.cn/services");
    const resp = await run(request);

    expect(resp.status).toBe(200);
    expect(reads.url).toBe(1);
    // Reuse the language detected by the middleware in withLangCookie/renderGatePage; do not detect it again.
    expect(reads.acceptLanguage).toBe(1);
  });

  it("still detects the language when the visitor already has a language cookie", async () => {
    const { request, reads } = countingRequest(
      "https://limooo.cn/services",
      "user_lang_preference=ja-jp",
    );
    const resp = await run(request);

    expect(resp.status).toBe(200);
    expect(reads.url).toBe(1);
    // An existing cookie means no detection is needed; the previous implementation behaved the same, so keep this from regressing.
    expect(reads.acceptLanguage).toBe(0);
  });
});

/**
 * `cachedPageAsset` passes the ASSETS body stream through directly (tasks/22 increment 5).
 *
 * Assert three properties: response bytes are unchanged, the status and every response
 * header are unchanged, and cache.put still receives the same bytes (both tee branches
 * can be read to completion). The payload includes NUL, 0xFF, and multibyte UTF-8 to
 * expose any implementation that reconstructs the body as a string.
 */
describe("cachedPageAsset passes the asset body through", () => {
  const BYTES = new Uint8Array([
    0x3c, 0x21, 0x64, 0x6f, 0x63, 0x74, 0x79, 0x70, 0x65, 0x3e, 0x0a, 0x00, 0xff, 0xe4, 0xb8, 0xad,
    0xf0, 0x9f, 0x8e, 0x89, 0x0a, 0x7b, 0x7d, 0x0a,
  ]);
  const ASSET_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(BYTES.length),
    ETag: '"v1"',
  };

  function stubCaches() {
    const puts: Array<{ key: string; bytes: Uint8Array }> = [];
    const hits: Response[] = [];
    const original = (globalThis as { caches?: unknown }).caches;
    (globalThis as { caches?: unknown }).caches = {
      default: {
        match: async () => hits.shift(),
        put: async (req: RequestInfo | URL, resp: Response) => {
          const key = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
          puts.push({ key, bytes: new Uint8Array(await resp.arrayBuffer()) });
        },
      },
    };
    return {
      puts,
      hits,
      restore: () => {
        (globalThis as { caches?: unknown }).caches = original;
      },
    };
  }

  function assetsEnv(body: BodyInit | null = BYTES, status = 200) {
    const fetch = vi.fn(async () =>
      new Response(body, { status, statusText: status === 200 ? "OK" : "Not Found", headers: ASSET_HEADERS }),
    );
    return { fetch } as unknown as Env["ASSETS"];
  }

  function pageRequest(headers: Record<string, string> = {}) {
    return new Request("https://limooo.cn/services", {
      headers: { "CF-Connecting-IP": "97.64.18.11", ...headers },
    });
  }

  it("returns the exact asset bytes and headers, and still fills the cache", async () => {
    const caches = stubCaches();
    const assets = assetsEnv();
    try {
      const resp = await handleOnRequest(
        context(pageRequest({ Cookie: "user_lang_preference=zh-cn" }), { ASSETS: assets }),
      );

      expect(resp.status).toBe(200);
      expect(resp.statusText).toBe("OK");
      // The page cache headers use the overridden values; all other headers are copied from ASSETS.
      expect(resp.headers.get("Cache-Control")).toBe(
        "public, max-age=300, stale-while-revalidate=3600",
      );
      expect(resp.headers.get("Vary")).toBe("Accept-Language");
      expect(resp.headers.get("Content-Type")).toBe(ASSET_HEADERS["Content-Type"]);
      expect(resp.headers.get("Content-Length")).toBe(ASSET_HEADERS["Content-Length"]);
      expect(resp.headers.get("ETag")).toBe(ASSET_HEADERS.ETag);

      // The bytes match exactly, including NUL, 0xFF, and four-byte UTF-8.
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(BYTES);

      // With an existing language cookie, no Set-Cookie is added; the cache is still written with the same bytes.
      expect(resp.headers.getSetCookie()).toEqual([]);
      expect(caches.puts).toHaveLength(1);
      expect(caches.puts[0].bytes).toEqual(BYTES);
      expect(caches.puts[0].key).toContain("lang=zh-cn");
      expect(new URL(caches.puts[0].key).hostname).toBe("limooo.cn");
      expect(String(vi.mocked(assets.fetch).mock.calls[0][0])).toBe(
        "https://comicine.com/zh-cn/services.html",
      );
    } finally {
      caches.restore();
    }
  });

  it("keeps the language Set-Cookie (single header, multiple semantics) on a first visit", async () => {
    const caches = stubCaches();
    try {
      const resp = await handleOnRequest(context(pageRequest(), { ASSETS: assetsEnv() }));

      expect(resp.status).toBe(200);
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(BYTES);
      const cookies = resp.headers.getSetCookie();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toContain("user_lang_preference=en-us");
      // A first visit adds Set-Cookie, so this response is intentionally not cached, as before.
      expect(caches.puts).toHaveLength(0);
    } finally {
      caches.restore();
    }
  });

  it("does not fill the cache for a failed asset fetch", async () => {
    const caches = stubCaches();
    const assets = assetsEnv("missing", 404);
    try {
      const resp = await handleOnRequest(
        context(pageRequest({ Cookie: "user_lang_preference=zh-cn" }), { ASSETS: assets }),
      );

      expect(caches.puts).toHaveLength(0);
      expect(vi.mocked(assets.fetch)).toHaveBeenCalledTimes(1);
      // When an asset is missing, fall through to next() as page routing already does instead of returning 404.
      await expect(resp.text()).resolves.toBe("next");
    } finally {
      caches.restore();
    }
  });

  it("serves a cache hit without touching ASSETS", async () => {
    const caches = stubCaches();
    const assets = assetsEnv();
    caches.hits.push(
      new Response(BYTES.slice(), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );
    try {
      const resp = await handleOnRequest(
        context(pageRequest({ Cookie: "user_lang_preference=zh-cn" }), { ASSETS: assets }),
      );

      expect(resp.status).toBe(200);
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(BYTES);
      expect(vi.mocked(assets.fetch)).not.toHaveBeenCalled();
      expect(caches.puts).toHaveLength(0);
    } finally {
      caches.restore();
    }
  });
});
