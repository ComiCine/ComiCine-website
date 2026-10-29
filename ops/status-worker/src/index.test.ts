/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { describe, expect, it, vi } from "vitest";
import worker, {
  ProbeState,
  buildAlertEmail,
  esc,
  pageLang,
  record,
  renderStatusPage,
  runProbe,
  deliverAlert,
  sendAlert,
  statusKey,
  statusPayload,
  STATUS_HTML_CACHE_CONTROL,
  type Env,
} from "./index";

/** Minimal D1 stub: returns preset results based on SQL keywords and records writes. */
function fakeDb(handlers: {
  first?: (sql: string) => unknown;
  all?: (sql: string) => unknown;
  batch?: (stmts: unknown[]) => void;
}) {
  const prepared: string[] = [];
  const db = {
    prepare(sql: string) {
      prepared.push(sql);
      return {
        bind: (..._args: unknown[]) => ({
          first: async () => handlers.first?.(sql) ?? null,
          all: async () => handlers.all?.(sql) ?? { results: [] },
          run: async () => ({}),
        }),
        first: async () => handlers.first?.(sql) ?? null,
        all: async () => handlers.all?.(sql) ?? { results: [] },
        run: async () => ({}),
      };
    },
    batch: async (stmts: unknown[]) => {
      handlers.batch?.(stmts);
      return [];
    },
  };
  return { db: db as unknown as D1Database, prepared };
}

const probe = {
  id: 1,
  name: "Website",
  type: "http",
  target: "https://comicine.com/_health",
  group_key: "public",
  interval_s: 60,
};

describe("runProbe", () => {
  it("200 maps to up and records latency", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const { db } = fakeDb({});
    const r = await runProbe({ DB: db } as Env, probe);
    expect(r.status).toBe(1);
    expect(r.msg).toBe("http_200");
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("403 (gate page) still counts as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    const { db } = fakeDb({});
    expect((await runProbe({ DB: db } as Env, probe)).status).toBe(1);
  });

  it("503 → down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { db } = fakeDb({});
    expect((await runProbe({ DB: db } as Env, probe)).status).toBe(0);
  });

  it("a thrown error maps to down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    const { db } = fakeDb({});
    const r = await runProbe({ DB: db } as Env, probe);
    expect(r.status).toBe(0);
    expect(r.msg).toContain("fetch_error");
  });

  it("the d1 probe runs SELECT 1", async () => {
    const { db } = fakeDb({ first: () => ({ ok: 1 }) });
    const r = await runProbe({ DB: db } as Env, { ...probe, type: "d1", target: null });
    expect(r.status).toBe(1);
  });
});

describe("record state machine", () => {
  it("the first failure only reaches pending; no down before the threshold", async () => {
    const { db } = fakeDb({
      first: () => ({ last_status: 1, consecutive_fail: 0, down_since: null }),
    });
    const out = await record({ DB: db, FAIL_THRESHOLD: "2" } as Env, 1, {
      status: 0,
      latency_ms: null,
      msg: "x",
    });
    expect(out.status).toBe(2);
    expect(out.becameDown).toBe(false);
  });

  it("reaching the threshold marks down and records down_since", async () => {
    const { db } = fakeDb({
      first: () => ({ last_status: 2, consecutive_fail: 1, down_since: null }),
    });
    const out = await record({ DB: db, FAIL_THRESHOLD: "2" } as Env, 1, {
      status: 0,
      latency_ms: null,
      msg: "x",
    });
    expect(out.status).toBe(0);
    expect(out.becameDown).toBe(true);
    expect(out.downSince).toBeGreaterThan(0);
  });

  it("recovery from down fires recovered exactly once", async () => {
    const down = fakeDb({
      first: () => ({ last_status: 0, consecutive_fail: 3, down_since: 100 }),
    });
    const out = await record({ DB: down.db, FAIL_THRESHOLD: "2" } as Env, 1, {
      status: 1,
      latency_ms: 5,
      msg: "ok",
    });
    expect(out.recovered).toBe(true);
    expect(out.downSince).toBeNull();

    const up = fakeDb({
      first: () => ({ last_status: 1, consecutive_fail: 0, down_since: null }),
    });
    const again = await record({ DB: up.db, FAIL_THRESHOLD: "2" } as Env, 1, {
      status: 1,
      latency_ms: 5,
      msg: "ok",
    });
    expect(again.recovered).toBe(false);
  });
});

describe("statusPayload", () => {
  it("summarises overall / down / uptime", async () => {
    const { db } = fakeDb({
      all: () => ({
        results: [
          {
            id: 1,
            name: "Website",
            type: "http",
            target: "https://comicine.com/_health",
            group_key: "public",
            active: 1,
            status: 1,
            latency_ms: 12,
            checked_at: 1,
            total: 10,
            up: 9,
          },
          {
            id: 2,
            name: "Admin",
            type: "http",
            target: "https://admin.comicine.com/_health",
            group_key: "internal",
            active: 1,
            status: 0,
            latency_ms: null,
            checked_at: 1,
            total: 10,
            up: 4,
          },
        ],
      }),
    });
    const payload = await statusPayload({ DB: db } as Env);
    expect(payload.total).toBe(2);
    expect(payload.down).toBe(1);
    expect(payload.overall).toBe("partial");
    expect(payload.probes[0].uptime).toBeCloseTo(90);
    expect(payload.probes[1].uptime).toBeCloseTo(40);
  });

  it("uptime is null when there are no heartbeats", async () => {
    const { db } = fakeDb({
      all: () => ({
        results: [
          {
            id: 1,
            name: "X",
            type: "http",
            target: "t",
            group_key: "public",
            active: 1,
            status: null,
            latency_ms: null,
            checked_at: null,
            total: 0,
            up: 0,
          },
        ],
      }),
    });
    const payload = await statusPayload({ DB: db } as Env);
    expect(payload.probes[0].uptime).toBeNull();
    expect(payload.overall).toBe("all");
  });
});

describe("status page edge cache", () => {
  it("HTML is edge-cacheable with a TTL aligned to the probe cadence", () => {
    // Status page SSR reads D1 on every request; reverting to no-store would hit the
    // database on every refresh or crawl.
    expect(STATUS_HTML_CACHE_CONTROL).not.toContain("no-store");
    expect(STATUS_HTML_CACHE_CONTROL).toContain("s-maxage=60");
    // Allow brief staleness to avoid sending all requests to the origin during upstream
    // instability.
    expect(STATUS_HTML_CACHE_CONTROL).toContain("stale-while-revalidate");
  });

  it("browser TTL is shorter than the edge TTL", () => {
    const maxAge = Number(/max-age=(\d+)/.exec(STATUS_HTML_CACHE_CONTROL)?.[1]);
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(STATUS_HTML_CACHE_CONTROL)?.[1]);
    expect(maxAge).toBeLessThan(sMaxAge);
  });
});

describe("ProbeState", () => {
  function makeState() {
    const store = new Map<string, unknown>();
    let alarm: number | null = null;
    const state = {
      storage: {
        put: async (k: string, v: unknown) => void store.set(k, v),
        get: async (k: string) => store.get(k) ?? null,
        setAlarm: async (ts: number) => void (alarm = ts),
        deleteAlarm: async () => void (alarm = null),
      },
    } as unknown as DurableObjectState;
    return { state, store, getAlarm: () => alarm };
  }

  it("arm stores probe_id and sets an alarm", async () => {
    const { state, store, getAlarm } = makeState();
    const env = { DB: fakeDb({}).db, RETRY_INTERVAL_S: "10" } as Env;
    const res = await new ProbeState(state, env).fetch(
      new Request("https://probe.internal/arm", { headers: { "X-Probe-Id": "7" } }),
    );
    expect(res.status).toBe(200);
    expect(store.get("probe_id")).toBe(7);
    expect(getAlarm()).toBeGreaterThan(Date.now());
  });

  it("disarm clears the alarm", async () => {
    const { state, getAlarm } = makeState();
    const env = { DB: fakeDb({}).db } as Env;
    await new ProbeState(state, env).fetch(new Request("https://probe.internal/disarm"));
    expect(getAlarm()).toBeNull();
  });

  it("alarm reschedules while still down and inside the window", async () => {
    const { state, store, getAlarm } = makeState();
    store.set("probe_id", 1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { db } = fakeDb({
      first: (sql: string) =>
        sql.includes("FROM probes")
          ? probe
          : { last_status: 0, consecutive_fail: 3, down_since: Math.floor(Date.now() / 1000) },
    });
    await new ProbeState(state, { DB: db, RETRY_INTERVAL_S: "10", RETRY_WINDOW_S: "280" } as Env).alarm();
    expect(getAlarm()).not.toBeNull();
  });
});

describe("status page rendering", () => {
  it("pageLang is chosen from Accept-Language", () => {
    const mk = (v: string) => new Request("https://x/", { headers: { "Accept-Language": v } });
    expect(pageLang(mk("zh-CN,zh;q=0.9"))).toBe("zh-cn");
    expect(pageLang(mk("en-US,en;q=0.9"))).toBe("en-us");
    expect(pageLang(mk("ja-JP"))).toBe("ja-jp");
    expect(pageLang(mk("ko-KR"))).toBe("ko-kr");
    expect(pageLang(mk(""))).toBe("zh-cn");
  });

  it("esc escapes HTML metacharacters", () => {
    expect(esc('<b>"x"&y</b>')).toBe("&lt;b&gt;&quot;x&quot;&amp;y&lt;/b&gt;");
  });

  it("statusKey maps 1 / 0 / other", () => {
    expect(statusKey(1)).toBe("up");
    expect(statusKey(0)).toBe("down");
    expect(statusKey(null)).toBe("pending");
  });

  it("renderStatusPage emits i18n text with no inline script/style", async () => {
    const { db } = fakeDb({
      all: () => ({
        results: [
          {
            id: 1,
            name: "Website",
            type: "http",
            target: "https://comicine.com/_health",
            group_key: "public",
            active: 1,
            label_key: "card_website",
            status: 1,
            latency_ms: 12,
            checked_at: 1,
            total: 10,
            up: 10,
          },
        ],
      }),
    });
    const html = await renderStatusPage({ DB: db } as Env, "zh-cn");
    expect(html).toContain("服务状态");
    expect(html).toContain("ComiCine 网站"); // label_key matches the same key in locales
    expect(html).toContain("运行正常");
    expect(html).toContain('href="/status.css"');
    expect(html).toContain('src="/status.js"');
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/\sstyle="/);
  });
});

describe("alert email", () => {
  it("down uses red, up uses the brand teal, both name the probe in the body", () => {
    const down = buildAlertEmail("zh-cn", "down", "Website", "http_503", 1700000000);
    const up = buildAlertEmail("zh-cn", "up", "Website", "http_200", 1700000000);
    // The probe name is **not in the subject** (user decision on 2026-10-11: subject is
    // `Health check alert · ComiCine`); it appears in the body row. The title only reports
    // what happened.
    expect(down.subject).toBe("Health check alert · ComiCine");
    expect(down.subject).not.toContain("Website");
    expect(down.text).toContain("Website");
    expect(down.html).toContain("#dc2626");
    expect(up.html).toContain("#05A5A6");
    // Error codes in the body are now human-readable; append the raw machine code only
    // when it is part of the actual exception text.
    expect(down.text).toContain("服务不可用（HTTP 503）");
  });

  it("all four languages render copy", () => {
    for (const lang of ["zh-cn", "en-us", "ja-jp", "ko-kr"]) {
      const mail = buildAlertEmail(lang, "down", "X", "m", 1700000000);
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.html).toContain("X");
    }
  });

  it("degrades without throwing when EMAIL is unbound", async () => {
    const { db } = fakeDb({});
    const r = await sendAlert({ DB: db } as Env, "down", "X", "m");
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("no_alert_channel");
  });

  it("degrades when bound but no recipient is set", async () => {
    const { db } = fakeDb({});
    const r = await sendAlert(
      { DB: db, EMAIL: { send: async () => ({}) } } as unknown as Env,
      "down",
      "X",
      "m",
    );
    expect(r.sent).toBe(false);
    expect(r.reason).toBe("alert_to_missing");
  });

  it("returns sent=true on a successful send", async () => {
    const { db } = fakeDb({});
    let captured: unknown = null;
    const r = await sendAlert(
      {
        DB: db,
        ALERT_TO: "ops@example.com",
        EMAIL: { send: async (m: unknown) => void (captured = m) },
      } as unknown as Env,
      "up",
      "Website",
      "http_200",
    );
    expect(r.sent).toBe(true);
    expect(JSON.stringify(captured)).toContain("ops@example.com");
  });
});

/**
 * Alert channel priority (AGENTS.md: ALERT_WEBHOOK_URL first, with the Email binding as fallback).
 *
 * Regression: webhook used to come after the more expensive SMTP path, and **any channel
 * failure returned immediately**, so a configured webhook plus a failing SMTP silently
 * lost the alert.
 */
describe("alert channel priority", () => {
  const mail = buildAlertEmail("zh-cn", "down", "Website", "http_503", 1_700_000_000);
  const emailEnv = (captured: { value: unknown }) => ({
    ALERT_TO: "ops@example.com",
    EMAIL: { send: async (m: unknown) => void (captured.value = m) },
  });

  it("prefers the webhook over the Email binding", async () => {
    const captured = { value: null as unknown };
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await deliverAlert(
      { ...emailEnv(captured), ALERT_WEBHOOK_URL: "https://open.feishu.cn/hook" } as unknown as Env,
      mail,
    );
    expect(r).toEqual({ sent: true, via: "webhook" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(captured.value).toBeNull();
    vi.unstubAllGlobals();
  });

  it("falls back to the Email binding when the webhook fails", async () => {
    const captured = { value: null as unknown };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const r = await deliverAlert(
      { ...emailEnv(captured), ALERT_WEBHOOK_URL: "https://open.feishu.cn/hook" } as unknown as Env,
      mail,
    );
    expect(r.sent).toBe(true);
    expect(r.via).toBe("email");
    expect(captured.value).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("falls back to the Email binding when the webhook throws", async () => {
    const captured = { value: null as unknown };
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const r = await deliverAlert(
      { ...emailEnv(captured), ALERT_WEBHOOK_URL: "https://open.feishu.cn/hook" } as unknown as Env,
      mail,
    );
    expect(r).toEqual({ sent: true, via: "email" });
    expect(captured.value).not.toBeNull();
    vi.unstubAllGlobals();
  });

  it("does not let a failing SMTP stand in front of a working webhook", async () => {
    const captured = { value: null as unknown };
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const r = await deliverAlert(
      {
        ...emailEnv(captured),
        ALERT_WEBHOOK_URL: "https://open.feishu.cn/hook",
        // SMTP is fully configured but guaranteed to fail (reserved address); previously
        // this entered the SMTP branch and returned failure immediately.
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: "1",
        SMTP_USER: "u",
        SMTP_PASS: "p",
        SMTP_FROM: "no-reply@example.com",
      } as unknown as Env,
      mail,
    );
    expect(r.sent).toBe(true);
    expect(r.via).toBe("webhook");
    vi.unstubAllGlobals();
  });

  it("reports no_alert_channel when nothing is configured", async () => {
    const r = await deliverAlert({} as Env, mail);
    expect(r).toEqual({ sent: false, reason: "no_alert_channel" });
  });
});

// /run and /alert-test are write endpoints: the former writes to D1 (3 probes × 3 tables),
// while the latter sends real email. This Worker is public (status.comicine.com); without
// this authentication, any third-party page could use a simple POST with an empty body
// to flood the alert channel and consume the daily D1 write quota.
describe("ops endpoint auth", () => {
  const TOKEN = "ops-token-0123456789abcdef";
  const URL_BASE = "https://status.comicine.com";

  /** Fully configured environment with an available alert channel, so "no message sent" is real. */
  function opsEnv(extra: Partial<Env> = {}) {
    const send = vi.fn(async (_msg: unknown) => ({}));
    const env = {
      // Empty probe table: runAll in /run does not run probes; this tests routing and authentication only.
      DB: fakeDb({ all: () => ({ results: [] }) }).db,
      STATUS_TOKEN: TOKEN,
      ALERT_TO: "ops@example.com",
      EMAIL: { send },
      ...extra,
    } as unknown as Env;
    return { env, send };
  }

  function opsRequest(path: string, init: RequestInit = {}) {
    return new Request(`${URL_BASE}${path}`, init);
  }

  function bearer(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  it("rejects POST /run without an ops token", async () => {
    const { env } = opsEnv();
    const res = await worker.fetch(opsRequest("/run", { method: "POST" }), env);
    expect(res.status).toBe(401);
  });

  it("fails closed on POST /run when the token is not configured", async () => {
    // If STATUS_TOKEN was not set with secret put, reject the request; missing config
    // must not mean open access.
    const { env } = opsEnv({ STATUS_TOKEN: undefined });
    const res = await worker.fetch(
      opsRequest("/run", { method: "POST", headers: bearer(TOKEN) }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects POST /alert-test without an ops token and sends nothing", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { env, send } = opsEnv();
    const res = await worker.fetch(opsRequest("/alert-test", { method: "POST" }), env);
    expect(res.status).toBe(401);
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a wrong or truncated token", async () => {
    const { env, send } = opsEnv();
    const headers = [
      `Bearer ${TOKEN.slice(0, 8)}`, // Truncated
      `Bearer ${TOKEN}x`, // One extra character
      `Bearer ${TOKEN.slice(0, -1)}z`, // Same length, different content
      TOKEN, // Missing the Bearer prefix
      `Basic ${TOKEN}`, // Different scheme
      "",
    ];
    for (const header of headers) {
      const res = await worker.fetch(
        opsRequest("/run", { method: "POST", headers: { Authorization: header } }),
        env,
      );
      expect(res.status, `Authorization: ${header}`).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("accepts POST /run with the configured token", async () => {
    const { env } = opsEnv();
    const res = await worker.fetch(
      opsRequest("/run", { method: "POST", headers: bearer(TOKEN) }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ran: 0 });
  });

  it("throttles repeated POST /alert-test from the same IP", async () => {
    const { env, send } = opsEnv();
    const call = () =>
      worker.fetch(
        opsRequest("/alert-test", {
          method: "POST",
          headers: { ...bearer(TOKEN), "CF-Connecting-IP": "203.0.113.9" },
        }),
        env,
      );
    expect((await call()).status).toBe(200);
    // The second request within 60 seconds is throttled and sends no additional message.
    expect((await call()).status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps the public status surface open without a token", async () => {
    const { env } = opsEnv();
    for (const path of [
      "/_health",
      "/",
      "/status.css",
      "/status.js",
      "/status-theme.js",
      "/api/status",
      "/alert-preview",
    ]) {
      const res = await worker.fetch(opsRequest(path), env);
      expect(res.status, path).toBe(200);
    }
  });
});

/**
 * Routing layer: language variants, cache/CSP headers, failure fallback, and 404.
 *
 * These safeguards keep the status page from becoming another failure point: if D1
 * cannot be read, return its own 503 page (rather than Cloudflare's generic error page),
 * and normalize error codes before sending them to clients.
 */
describe("status page routing", () => {
  const URL_BASE = "https://status.comicine.com";
  /** One probe row whose msg contains raw exception text (neither page nor API should expose it). */
  const probeRow = {
    id: 1,
    name: "Website",
    type: "http",
    target: "https://comicine.com/_health",
    group_key: "public",
    active: 1,
    label_key: "card_website",
    status: 0,
    latency_ms: 12,
    checked_at: 1,
    total: 10,
    up: 5,
    msg: "d1_error: Error: D1_ERROR: no such table: probes",
  };
  const okEnv = () => ({ DB: fakeDb({ all: () => ({ results: [probeRow] }) }).db }) as unknown as Env;
  const brokenEnv = () =>
    ({
      DB: fakeDb({
        all: () => {
          throw new Error("D1_ERROR: network unreachable");
        },
      }).db,
    }) as unknown as Env;

  it("takes the language from ?lang= and keeps Accept-Language as the cache key", async () => {
    const res = await worker.fetch(
      new Request(`${URL_BASE}/?lang=ja-jp`, { headers: { "Accept-Language": "en-US" } }),
      okEnv(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Vary")).toBe("Accept-Language");
    expect(res.headers.get("Cache-Control")).toBe(STATUS_HTML_CACHE_CONTROL);
    const html = await res.text();
    expect(html).toContain('<html lang="ja-jp">');
    expect(html).toContain("サービスステータス");
  });

  it("serves the theme preload script that the head blocks on", async () => {
    const res = await worker.fetch(new Request(`${URL_BASE}/status-theme.js`), okEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/javascript");
    expect(await res.text()).toContain("light-mode");
  });

  it("keeps the page CSP tight, allowing only the inlined font and the icon host", async () => {
    const res = await worker.fetch(new Request(`${URL_BASE}/`), okEnv());
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("img-src 'self' data: https://images.comicine.com");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("normalises probe errors and never exposes the raw exception text", async () => {
    const res = await worker.fetch(new Request(`${URL_BASE}/api/status`), okEnv());
    const body = (await res.json()) as { probes: Array<Record<string, unknown>> };
    expect(body.probes[0].detail).toBe("d1_error");
    expect(JSON.stringify(body)).not.toContain("no such table");
    const html = await worker.fetch(new Request(`${URL_BASE}/?lang=zh-cn`), okEnv());
    expect(await html.text()).toContain("数据库查询失败");
  });

  it("returns its own localized 503 page when D1 cannot be read", async () => {
    const res = await worker.fetch(new Request(`${URL_BASE}/?lang=en-us`), brokenEnv());
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain("Status data is temporarily unavailable");
    expect(html).toContain('class="site-nav"');
    expect(html).toContain('class="global-footer"');
  });

  it("answers /api/status with 503 json instead of throwing", async () => {
    const res = await worker.fetch(new Request(`${URL_BASE}/api/status`), brokenEnv());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("gives browsers a branded 404 and every other client plain text", async () => {
    const html = await worker.fetch(
      new Request(`${URL_BASE}/nope`, { headers: { Accept: "text/html,application/xhtml+xml" } }),
      okEnv(),
    );
    expect(html.status).toBe(404);
    expect(html.headers.get("Cache-Control")).toBe("no-store");
    expect(await html.text()).toContain("页面不存在");

    const text = await worker.fetch(new Request(`${URL_BASE}/nope`), okEnv());
    expect(text.status).toBe(404);
    expect(await text.text()).toBe("Not Found");
  });
});
