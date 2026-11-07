/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker, {
  ComiCineProbeStateV2,
  MIN_PROBE_INTERVAL_S,
  PROBE_JITTER_MAX_S,
  buildAlertEmail,
  checkD1Budget,
  esc,
  pageLang,
  probeIntervalSeconds,
  probeJitterMs,
  record,
  renderStatusPage,
  reportRetention,
  resetRetentionAlertDedupe,
  runAll,
  runDailyChecks,
  runProbe,
  deliverAlert,
  sendAlert,
  statusKey,
  statusPayload,
  STATUS_HTML_CACHE_CONTROL,
  type Env,
} from "./index";
import type { PruneResult } from "./retention";

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

describe("runAll", () => {
  it("skips probes whose interval has not elapsed", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb({
      all: (sql) =>
        sql.includes("FROM probes")
          ? {
              results: [
                { ...probe, id: 1, interval_s: 60, checked_at: 1_000 },
                { ...probe, id: 2, interval_s: 900, checked_at: 1_000 },
              ],
            }
          : { results: [] },
    });

    const ran = await runAll({ DB: db } as Env, 1_100);

    expect(ran).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

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

describe("ComiCineProbeStateV2", () => {
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
    const res = await new ComiCineProbeStateV2(state, env).fetch(
      new Request("https://probe.internal/arm", { headers: { "X-Probe-Id": "7" } }),
    );
    expect(res.status).toBe(200);
    expect(store.get("probe_id")).toBe(7);
    expect(getAlarm()).toBeGreaterThan(Date.now());
  });

  it("disarm clears the alarm", async () => {
    const { state, getAlarm } = makeState();
    const env = { DB: fakeDb({}).db } as Env;
    await new ComiCineProbeStateV2(state, env).fetch(new Request("https://probe.internal/disarm"));
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
    await new ComiCineProbeStateV2(state, { DB: db, RETRY_INTERVAL_S: "10", RETRY_WINDOW_S: "280" } as Env).alarm();
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

  it("pageLang prefers a supported lang query parameter", () => {
    const request = new Request("https://x/?lang=ja-jp", {
      headers: { "Accept-Language": "en-US" },
    });
    expect(pageLang(request)).toBe("ja-jp");
  });

  it("pageLang honors Accept-Language quality weights and excludes q=0 entries", () => {
    expect(
      pageLang(
        new Request("https://x/", {
          headers: { "Accept-Language": "en-US;q=0.2, ja-JP;q=0.9" },
        }),
      ),
    ).toBe("ja-jp");
    expect(
      pageLang(
        new Request("https://x/", {
          headers: { "Accept-Language": "zh-CN;q=0, ko-KR;q=0.1" },
        }),
      ),
    ).toBe("ko-kr");
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

  it("falls back to the Email binding when a Feishu bot returns an error code with HTTP 200", async () => {
    const captured = { value: null as unknown };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: 9499, msg: "too many requests" })),
    );
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

  it("sends browser 404s to the main site's 404 without using a 3xx response", async () => {
    const html = await worker.fetch(
      new Request(`${URL_BASE}/nope`, { headers: { Accept: "text/html,application/xhtml+xml" } }),
      okEnv(),
    );
    expect(html.status).toBe(404);
    expect(html.headers.get("Cache-Control")).toBe("no-store");
    expect(html.headers.get("Refresh")).toBe("0; url=https://comicine.com/404");
    expect(html.headers.get("Location")).toBeNull();
    expect(await html.text()).toContain("https://comicine.com/404");

    const text = await worker.fetch(new Request(`${URL_BASE}/nope`), okEnv());
    expect(text.status).toBe(404);
    expect(await text.text()).toBe("Not Found");
  });
});

/**
 * Record every prepare/bind pair so inserted rows can be asserted field by field.
 * `run()` can be made to fail per SQL to test bookkeeping that must never interrupt the caller.
 */
function recordingDb(
  options: { first?: (sql: string) => unknown; throwOn?: (sql: string) => boolean } = {},
) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      const statement = (values: unknown[]) => {
        calls.push({ sql, values });
        return {
          first: async () => options.first?.(sql) ?? null,
          all: async () => ({ results: [] }),
          run: async () => {
            if (options.throwOn?.(sql)) throw new Error("D1_ERROR: unavailable");
            return { meta: { changes: 0 } };
          },
        };
      };
      return {
        bind: (...values: unknown[]) => statement(values),
        first: async () => options.first?.(sql) ?? null,
        all: async () => ({ results: [] }),
        run: async () => {
          if (options.throwOn?.(sql)) throw new Error("D1_ERROR: unavailable");
          return { meta: { changes: 0 } };
        },
      };
    },
    batch: async () => [],
  };
  return { db: db as unknown as D1Database, calls };
}

/** Email-only alert channel; captures messages without touching the network. */
function mailEnv(db: D1Database, extra: Partial<Env> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const env = {
    DB: db,
    ALERT_TO: "ops@example.com",
    EMAIL: { send: async (m: unknown) => void sent.push(m as Record<string, unknown>) },
    ...extra,
  } as unknown as Env;
  return { env, sent };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetRetentionAlertDedupe();
});

describe("uptime sampling weight (suggestion 14)", () => {
  it("counts planned samples but not Durable Object retry samples in probe_uptime_daily", async () => {
    const downPrev = () => ({ last_status: 0, consecutive_fail: 3, down_since: 1_700_000_000 });

    const planned = recordingDb({ first: downPrev });
    await record(
      { DB: planned.db } as Env,
      7,
      { status: 0, latency_ms: null, msg: "http_503" },
      "cron",
      1_700_000_100,
    );
    expect(planned.calls.some((c) => /probe_uptime_daily/.test(c.sql))).toBe(true);

    const retry = recordingDb({ first: downPrev });
    await record(
      { DB: retry.db } as Env,
      7,
      { status: 0, latency_ms: null, msg: "http_503" },
      "retry",
      1_700_000_110,
    );
    expect(retry.calls.some((c) => /probe_uptime_daily/.test(c.sql))).toBe(false);
    // The retry still refreshes the live state and latency/msg the page reads.
    expect(retry.calls.some((c) => /INSERT INTO heartbeats/.test(c.sql))).toBe(true);
    expect(retry.calls.some((c) => /INSERT INTO probe_state/.test(c.sql))).toBe(true);
  });

  it("timestamps a planned sample with the cron tick rather than the jittered completion time", async () => {
    const { db, calls } = recordingDb();
    await record(
      { DB: db } as Env,
      3,
      { status: 1, latency_ms: 5, msg: "ok" },
      "cron",
      1_700_000_000,
    );
    const heartbeat = calls.find((c) => /INSERT INTO heartbeats/.test(c.sql));
    const uptime = calls.find((c) => /INSERT INTO probe_uptime_daily/.test(c.sql));
    expect(heartbeat?.values[1]).toBe(1_700_000_000);
    expect(uptime?.values[1]).toBe(1_700_000_000);
  });

  it("keeps uptime near the real availability during a five-minute outage with retries", async () => {
    const totals = new Map<number, { total: number; up: number }>();
    const db = {
      prepare(sql: string) {
        const make = (values: unknown[]) => ({
          __sql: sql,
          __values: values,
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 0 } }),
        });
        return { bind: (...values: unknown[]) => make(values), ...make([]) };
      },
      batch: async (statements: Array<{ __sql: string; __values: unknown[] }>) => {
        for (const statement of statements) {
          if (!/probe_uptime_daily/.test(statement.__sql)) continue;
          const probeId = Number(statement.__values[0]);
          const up = Number(statement.__values[2]);
          const entry = totals.get(probeId) ?? { total: 0, up: 0 };
          entry.total += 1;
          entry.up += up;
          totals.set(probeId, entry);
        }
        return [];
      },
    } as unknown as D1Database;

    // Five planned samples, one per minute; the Durable Object retries every 10 seconds.
    for (let minute = 0; minute < 5; minute += 1) {
      await record(
        { DB: db } as Env,
        9,
        { status: 1, latency_ms: 5, msg: "ok" },
        "cron",
        1_700_000_000 + minute * 60,
      );
      for (let retry = 0; retry < 6; retry += 1) {
        await record(
          { DB: db } as Env,
          9,
          { status: 0, latency_ms: null, msg: "http_503" },
          "retry",
          1_700_000_010 + minute * 60 + retry * 10,
        );
      }
    }

    const rollup = totals.get(9);
    expect(rollup?.total).toBe(5);
    expect(rollup?.up).toBe(5);
    expect(((rollup?.up ?? 0) / (rollup?.total ?? 1)) * 100).toBe(100);
    // The old behavior counted every retry (5 planned + 29 retry samples) and showed 5/34 = 14.7%.
    expect(((5 / 34) * 100).toFixed(1)).toBe("14.7");
  });
});

describe("probe interval and jitter (suggestion 16)", () => {
  it("rejects intervals below the one-minute cron and falls back to 60", () => {
    expect(probeIntervalSeconds(undefined)).toBe(60);
    expect(probeIntervalSeconds(null)).toBe(60);
    expect(probeIntervalSeconds("")).toBe(60);
    expect(probeIntervalSeconds("abc")).toBe(60);
    expect(probeIntervalSeconds(0)).toBe(60);
    expect(probeIntervalSeconds(-30)).toBe(60);
    expect(probeIntervalSeconds(30)).toBe(60);
    expect(probeIntervalSeconds(60)).toBe(60);
    expect(probeIntervalSeconds(90.9)).toBe(90);
    expect(MIN_PROBE_INTERVAL_S).toBe(60);
  });

  it("clamps a stored 30-second interval and logs the invalid configuration once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { db } = fakeDb({
      all: (sql) =>
        sql.includes("FROM probes")
          ? { results: [{ ...probe, interval_s: 30, checked_at: 1_800_000_000 - 45 }] }
          : { results: [] },
    });

    const ran = await runAll({ DB: db } as Env, 1_800_000_000);
    // 45 s elapsed is below the clamped 60 s, so nothing runs (the old `|| 60` would have run it).
    expect(ran).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some((call) => String(call[0] ?? "").includes("probe_interval_invalid")),
    ).toBe(true);

    await runAll({ DB: db } as Env, 1_800_000_060);
    expect(
      warn.mock.calls.filter((call) => String(call[0] ?? "").includes("probe_interval_invalid")),
    ).toHaveLength(1);
  });

  it("starts cron probes at deterministic staggered offsets", async () => {
    vi.useFakeTimers();
    const start = 1_800_000_000_000;
    vi.setSystemTime(start);
    const startedAt: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        startedAt.push(Date.now());
        return new Response("", { status: 200 });
      }),
    );
    const { db } = fakeDb({
      all: (sql) =>
        sql.includes("FROM probes")
          ? {
              results: [
                { ...probe, id: 1, interval_s: 60, checked_at: 0 },
                { ...probe, id: 2, interval_s: 60, checked_at: 0 },
              ],
            }
          : { results: [] },
    });

    const running = runAll({ DB: db } as Env, Math.floor(start / 1000), { jitter: true });
    await vi.advanceTimersByTimeAsync(PROBE_JITTER_MAX_S * 1000 + 1_000);
    await running;

    const offsets = startedAt.map((at) => at - start).sort((a, b) => a - b);
    const expected = [probeJitterMs(1), probeJitterMs(2)].sort((a, b) => a - b);
    expect(startedAt).toHaveLength(2);
    expect(offsets).toEqual(expected);
    expect(new Set(offsets).size).toBe(2);
    expect(Math.max(...offsets)).toBeLessThanOrEqual(PROBE_JITTER_MAX_S * 1000);
  });

  it("keeps jitter deterministic and bounded", () => {
    expect(probeJitterMs(1)).toBe(probeJitterMs(1));
    expect(probeJitterMs(1)).toBeGreaterThanOrEqual(0);
    expect(probeJitterMs(1)).toBeLessThanOrEqual(PROBE_JITTER_MAX_S * 1000);
    expect(probeJitterMs(1, 1)).toBe(0);
    expect(new Set([1, 2, 3, 4].map((id) => probeJitterMs(id))).size).toBeGreaterThan(1);
  });
});

describe("retention bookkeeping and alerts (suggestion 13)", () => {
  const NOW = 1_800_000_000;
  const successes: PruneResult[] = [
    { table: "heartbeats", deleted: 3, cutoff: NOW - 30 * 86400 },
    { table: "events", deleted: 0, cutoff: NOW - 90 * 86400 },
  ];
  const failures: PruneResult[] = [
    {
      table: "heartbeats",
      deleted: 0,
      cutoff: NOW - 30 * 86400,
      error: "D1_ERROR: database is locked (code 5)",
    },
  ];

  it("writes one retention_state row per bucket and stays silent on success", async () => {
    const { db, calls } = recordingDb();
    const { env, sent } = mailEnv(db);

    const report = await reportRetention(env, successes, NOW);

    expect(report).toEqual({ state_rows: 2, failures: 0, alerted: false });
    expect(sent).toHaveLength(0);
    const writes = calls.filter((c) => /INSERT INTO retention_state/.test(c.sql));
    expect(writes).toHaveLength(2);
    expect(writes[0].values[0]).toBe("heartbeats");
    expect(writes[0].values[1]).toBe(NOW);
    // A success clears last_error and records the success time.
    expect(writes[0].sql).toContain("last_error = ''");
  });

  it("records the failure row and sends one alert with the table and error summary", async () => {
    const { db, calls } = recordingDb();
    const { env, sent } = mailEnv(db);

    const report = await reportRetention(env, failures, NOW);

    expect(report).toEqual({ state_rows: 1, failures: 1, alerted: true });
    expect(sent).toHaveLength(1);
    const mail = sent[0] as { subject: string; text: string };
    expect(mail.subject).toContain("D1 retention failure");
    expect(mail.text).toContain("heartbeats");
    expect(mail.text).toContain("database is locked");
    const write = calls.find((c) => /INSERT INTO retention_state/.test(c.sql));
    expect(write?.values).toEqual([
      "heartbeats",
      NOW,
      "D1_ERROR: database is locked (code 5)",
    ]);
    // A failure keeps the previous last_success_at instead of zeroing recovery evidence.
    expect(write?.sql).toContain("last_run_at = excluded.last_run_at");
    expect(write?.sql).not.toContain("last_success_at = excluded.last_success_at");
  });

  it("alerts only once per table per hour and re-arms after a successful pass", async () => {
    const { db } = recordingDb();
    const { env, sent } = mailEnv(db);

    expect((await reportRetention(env, failures, NOW)).alerted).toBe(true);
    expect(sent).toHaveLength(1);
    expect((await reportRetention(env, failures, NOW + 60)).alerted).toBe(false);
    expect(sent).toHaveLength(1);

    await reportRetention(env, [successes[0]], NOW + 120);
    expect((await reportRetention(env, failures, NOW + 180)).alerted).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it("still alerts when the retention_state bookkeeping cannot be written", async () => {
    const { db } = recordingDb({ throwOn: (sql) => /retention_state/.test(sql) });
    const { env, sent } = mailEnv(db);

    const report = await reportRetention(env, failures, NOW);

    expect(report.state_rows).toBe(0);
    expect(report.failures).toBe(1);
    expect(report.alerted).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("does not throw when no alert channel is configured", async () => {
    const { db } = recordingDb();
    const report = await reportRetention({ DB: db } as Env, failures, NOW);
    expect(report.alerted).toBe(false);
  });
});

describe("D1 daily budget check (suggestion 21)", () => {
  const NOW = 1_800_000_000;
  const yesterday = new Date((NOW - (NOW % 86400) - 86400) * 1000).toISOString().slice(0, 10);

  function graphqlPayload(rowsRead: number, rowsWritten = 29_000) {
    return {
      data: {
        viewer: {
          accounts: [
            {
              d1AnalyticsAdaptiveGroups: [
                {
                  dimensions: { databaseId: "db-main", date: yesterday },
                  sum: { rowsRead, rowsWritten },
                },
                {
                  dimensions: { databaseId: "db-sink", date: yesterday },
                  sum: { rowsRead: 1, rowsWritten: 0 },
                },
              ],
            },
          ],
        },
      },
    };
  }

  function budgetEnv(db: D1Database, extra: Partial<Env> = {}) {
    return mailEnv(db, { CLOUDFLARE_API_TOKEN: "cf-token", CLOUDFLARE_ACCOUNT_ID: "acct-id", ...extra });
  }

  it("alerts once when the last complete day reaches 70%", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(graphqlPayload(3_900_000))));
    const { env, sent } = budgetEnv(fakeDb({}).db);

    const step = await checkD1Budget(env, NOW);

    expect(step).toEqual({ ok: true, issues: 1, alerted: true });
    expect(sent).toHaveLength(1);
    const mail = sent[0] as { subject: string; text: string };
    expect(mail.subject).toContain("D1 daily budget warning");
    expect(mail.text).toContain("rows_read 78% of 5000000");
    expect(mail.text).toContain("level=warn");
  });

  it("stays silent below the threshold", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(graphqlPayload(3_400_000))));
    const { env, sent } = budgetEnv(fakeDb({}).db);

    const step = await checkD1Budget(env, NOW);

    expect(step).toEqual({ ok: true, issues: 0, alerted: false });
    expect(sent).toHaveLength(0);
  });

  it("fails open when the token or account id is missing and never calls the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { env, sent } = mailEnv(fakeDb({}).db);

    const step = await checkD1Budget(env, NOW);

    expect(step).toEqual({
      ok: false,
      issues: 0,
      alerted: false,
      reason: "usage_unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("fails open without alerting when the GraphQL request keeps failing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { env, sent } = budgetEnv(fakeDb({}).db);

    const running = checkD1Budget(env, NOW);
    await vi.advanceTimersByTimeAsync(1_100);
    const step = await running;

    expect(step.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sent).toHaveLength(0);
  });

  it("is wired into runDailyChecks, in the middle of the other steps", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/graphql")) return Response.json(graphqlPayload(3_900_000));
      if (/\/rules\/lists/.test(url)) return Response.json({ result: [] });
      if (/\/items/.test(url)) return Response.json({ result: [], result_info: {} });
      return new Response("unexpected", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { env, sent } = budgetEnv(fakeDb({}).db);

    const result = await runDailyChecks(env, NOW);

    expect(result.runs.ok).toBe(true);
    expect(result.budget.issues).toBe(1);
    expect(result.blocklist.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(String((sent[0] as { subject: string }).subject)).toContain("D1 daily budget warning");
  });

  it("exposes the budget step through POST /daily-checks without disturbing the other steps", async () => {
    const { db } = fakeDb({ all: () => ({ results: [] }) });
    const res = await worker.fetch(
      new Request("https://status.comicine.com/daily-checks", {
        method: "POST",
        headers: { Authorization: "Bearer ops-token" },
      }),
      { DB: db, STATUS_TOKEN: "ops-token" } as Env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runs: { ok: boolean };
      budget: { ok: boolean; reason?: string };
      blocklist: { ok: boolean };
    };
    expect(body.runs.ok).toBe(true);
    // No Cloudflare credentials: the budget step cannot run, and it stays independent.
    expect(body.budget).toMatchObject({
      ok: false,
      issues: 0,
      alerted: false,
      reason: "usage_unavailable",
    });
    expect(body.blocklist.ok).toBe(false);
  });
});

describe("status page cache (suggestion 23)", () => {
  const URL = "https://status.comicine.com";
  const probeRow = {
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
  };

  function fakeCache() {
    const store = new Map<string, Response>();
    const cache = {
      match: async (request: Request) => store.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => {
        store.set(request.url, response.clone());
      },
    };
    vi.stubGlobal("caches", { default: cache });
    return store;
  }

  function countingDb() {
    let reads = 0;
    const { db } = fakeDb({
      all: (sql) => {
        if (sql.includes("FROM probes")) reads += 1;
        return { results: [probeRow] };
      },
    });
    return { db, reads: () => reads };
  }

  /** Execution context used by the Worker route to schedule the Cache API write. */
  function context() {
    const pending: Promise<unknown>[] = [];
    return {
      pending,
      ctx: { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) },
    };
  }

  it("serves a second request from the cache without reading D1 again", async () => {
    const store = fakeCache();
    const { db, reads } = countingDb();
    const env = { DB: db } as Env;
    const { ctx, pending } = context();

    const first = await worker.fetch(new Request(`${URL}/?lang=zh-cn`), env, ctx);
    expect(first.headers.get("X-Status-Cache")).toBe("miss");
    await Promise.all(pending);

    const second = await worker.fetch(new Request(`${URL}/?lang=zh-cn`), env, ctx);
    expect(second.headers.get("X-Status-Cache")).toBe("hit");
    expect(await second.text()).toContain("服务状态");
    expect(store.size).toBe(1);
    expect(reads()).toBe(1);
  });

  it("re-renders after the cached entry expires", async () => {
    const store = fakeCache();
    const { db, reads } = countingDb();
    const env = { DB: db } as Env;
    const { ctx, pending } = context();

    await worker.fetch(new Request(`${URL}/?lang=zh-cn`), env, ctx);
    await Promise.all(pending);
    expect(reads()).toBe(1);

    store.clear(); // the response's s-maxage=60 has elapsed

    const afterExpiry = await worker.fetch(new Request(`${URL}/?lang=zh-cn`), env, ctx);
    expect(afterExpiry.headers.get("X-Status-Cache")).toBe("miss");
    expect(reads()).toBe(2);
  });

  it("keeps one cache entry per language", async () => {
    const store = fakeCache();
    const { db } = countingDb();
    const env = { DB: db } as Env;
    const { ctx, pending } = context();

    await worker.fetch(new Request(`${URL}/?lang=zh-cn`), env, ctx);
    await Promise.all(pending);
    const english = await worker.fetch(new Request(`${URL}/?lang=en-us`), env, ctx);

    expect(english.headers.get("X-Status-Cache")).toBe("miss");
    expect(await english.text()).toContain('<html lang="en-us">');
    expect(store.size).toBe(2);
  });

  it("does not cache POST requests, 404s, or the 503 failure page", async () => {
    const store = fakeCache();
    const { db } = countingDb();
    const { ctx } = context();

    const post = await worker.fetch(
      new Request(`${URL}/?lang=zh-cn`, { method: "POST" }),
      { DB: db } as Env,
      ctx,
    );
    expect(post.headers.get("X-Status-Cache")).toBe("bypass");

    const notFound = await worker.fetch(
      new Request(`${URL}/nope`, { headers: { Accept: "text/html" } }),
      { DB: db } as Env,
      ctx,
    );
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("Cache-Control")).toBe("no-store");

    const broken = fakeDb({
      all: () => {
        throw new Error("D1_ERROR: network unreachable");
      },
    });
    const failed = await worker.fetch(
      new Request(`${URL}/?lang=zh-cn`),
      { DB: broken.db } as Env,
      ctx,
    );
    expect(failed.status).toBe(503);
    expect(store.size).toBe(0);
  });

  it("renders directly when the Cache API is unavailable", async () => {
    const { db } = countingDb();
    const { ctx } = context();
    const res = await worker.fetch(new Request(`${URL}/?lang=zh-cn`), { DB: db } as Env, ctx);
    expect(res.status).toBe(200);
    // No Cache API in this runtime: direct render, and the response says the cache was bypassed.
    expect(res.headers.get("X-Status-Cache")).toBe("bypass");
  });
});
