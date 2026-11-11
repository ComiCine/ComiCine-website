/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { sendViaSmtp, type SmtpConfig } from "./smtp";
import { runRetention, type PruneResult } from "./retention";
import { runVisitorDailyAggregate } from "./visitor-daily";
import {
  WATCHED_JOBS,
  errorSummary,
  formatUtc,
  readLatestRuns,
  runIssues,
  type RunIssue,
} from "./runwatch";
import { LIST_NAME, checkBlocklistInvariant } from "./blocklist";
import {
  D1_DAILY_READ_LIMIT,
  D1_DAILY_WRITE_LIMIT,
  assessD1Budget,
  budgetAlertDetail,
  readD1Usage,
} from "./d1budget";
import {
  readStatusPageCache,
  statusCacheAvailable,
  statusPageCacheKey,
  writeStatusPageCache,
} from "./statuscache";
import {
  STATUS_CSS,
  STATUS_JS,
  THEME_JS,
  esc,
  renderErrorHtml,
  renderNotFoundHtml,
  statusPageHtml,
  type PageDay,
} from "./page";
/** Keep the legacy import path available for tests that import from index. */
export { esc, statusKey } from "./page";
import { DEFAULT_LANG, alertDetail, isLang, msgCode, pickLang, type Lang } from "./i18n";

/**
 * ComiCine status probe Worker (tasks/17, phase 2)
 *
 * Replaces Uptime Kuma:
 * - scheduled() runs probes every minute and writes D1 heartbeats / probe_state
 * - After a down result, ComiCineProbeStateV2 (Durable Object) retries every 10 seconds and records recovery.
 * - GET /api/status supplies data to the status page; GET /_health is the liveness probe.
 *
 * Alert email delivery (phase 3) is implemented in maybeAlert(); cron failure visibility and the blocklist invariant
 * are checked by the daily task (runDailyChecks(); see runwatch.ts / blocklist.ts for the criteria).
 *
 * There are only three public write endpoints: POST /run (runs probes and writes to D1), POST /alert-test
 * (sends a real alert) and POST /daily-checks (runs daily checks immediately and may send alerts).
 * This Worker is exposed at status.comicine.com without Cloudflare Access,
 * so all three require `Authorization: Bearer $STATUS_TOKEN`; see authorized().
 * **After deployment, run `wrangler secret put STATUS_TOKEN`; otherwise these endpoints always return 401.**
 */

export interface Env {
  DB: D1Database;
  PROBE_STATE: DurableObjectNamespace;
  /** Shared secret for operational write endpoints (/run, /alert-test, and /daily-checks); they return 401 when it is not configured. */
  STATUS_TOKEN?: string;
  EMAIL?: { send: (msg: unknown) => Promise<unknown> };
  /** Preferred alert channel: HTTP webhook (Feishu custom bot format by default). */
  ALERT_WEBHOOK_URL?: string;
  /** Webhook format: feishu (default), slack, or generic. */
  ALERT_WEBHOOK_KIND?: string;
  ALERT_TO?: string;
  ALERT_FROM?: string;
  ALERT_LANG?: string;
  ALERT_COOLDOWN_S?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  SMTP_FROM?: string;
  FAIL_THRESHOLD?: string;
  RETRY_INTERVAL_S?: string;
  RETRY_WINDOW_S?: string;
  /**
   * The blocklist invariant check reads the Cloudflare IP List (blocklist.ts). If neither binding is configured,
   * this check only logs and does not alert (fail-open), so the binding is optional:
   * `wrangler secret put CLOUDFLARE_API_TOKEN` / `... CLOUDFLARE_ACCOUNT_ID`.
   */
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

const UP = 1;
const DOWN = 0;
const PENDING = 2;
const HTTP_TIMEOUT_MS = 10_000;

interface Probe {
  id: number;
  name: string;
  type: string;
  target: string | null;
  group_key: string;
  interval_s: number;
}

export interface ProbeResult {
  status: number;
  latency_ms: number | null;
  msg: string;
}

export interface RecordOutcome {
  status: number;
  consecutiveFail: number;
  downSince: number | null;
  becameDown: boolean;
  recovered: boolean;
}

const num = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Run one probe for measurement only; do not write to the database. */
export async function runProbe(env: Env, probe: Probe): Promise<ProbeResult> {
  if (probe.type === "d1") {
    const started = Date.now();
    try {
      const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      const ok = row?.ok === 1;
      return {
        status: ok ? UP : DOWN,
        latency_ms: Date.now() - started,
        msg: ok ? "ok" : "unexpected_result",
      };
    } catch (err) {
      return { status: DOWN, latency_ms: null, msg: `d1_error: ${String(err)}` };
    }
  }

  if (!probe.target) {
    return { status: PENDING, latency_ms: null, msg: "missing_target" };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(probe.target, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "ComiCine-Status/2.0" },
    });
    // A gate page rendered with 403 means the service is reachable; only 5xx responses count as failures.
    return {
      status: res.status < 500 ? UP : DOWN,
      latency_ms: Date.now() - started,
      msg: `http_${res.status}`,
    };
  } catch (err) {
    return { status: DOWN, latency_ms: null, msg: `fetch_error: ${String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which path produced a probe sample (suggestion 14).
 *
 * The Durable Object rechecks a down probe every `RETRY_INTERVAL_S` (10 s by default). Those
 * retry samples must keep `probe_state` and `heartbeats` current, but they are **not** planned
 * samples: counting them would inflate `probe_uptime_daily.total` for every 10-second recheck.
 * A five-minute outage used to add ~30 failing retry samples next to ~5 scheduled ones, which
 * made the page show about 97.7% instead of roughly 99.65%. Retry samples therefore update the
 * live state only; `probe_uptime_daily` receives one sample per planned interval.
 */
export type ProbeSampleSource = "cron" | "manual" | "retry";

/** Write the heartbeat and advance probe_state. */
export async function record(
  env: Env,
  probeId: number,
  result: ProbeResult,
  source: ProbeSampleSource = "cron",
  /**
   * Planned sample time (epoch seconds). `runAll` passes the cron tick time rather than the
   * completion time so the deterministic jitter offset cannot stretch the next due check: a
   * 60-second probe with a 30-second offset would otherwise record completion at tick+30 and be
   * skipped at the next tick, halving its cadence. Direct callers default to the current time.
   */
  at = Math.floor(Date.now() / 1000),
): Promise<RecordOutcome> {
  const now = at;
  const threshold = num(env.FAIL_THRESHOLD, 2);
  const prev = await env.DB
    .prepare(
      "SELECT last_status, consecutive_fail, down_since FROM probe_state WHERE probe_id = ?1",
    )
    .bind(probeId)
    .first<{
      last_status: number | null;
      consecutive_fail: number;
      down_since: number | null;
    }>();

  let consecutiveFail = prev?.consecutive_fail ?? 0;
  let status: number;
  let downSince: number | null = prev?.down_since ?? null;
  let becameDown = false;
  let recovered = false;

  if (result.status === UP) {
    status = UP;
    consecutiveFail = 0;
    if (downSince !== null) {
      recovered = true;
      downSince = null;
    }
  } else {
    consecutiveFail += 1;
    if (consecutiveFail >= threshold) {
      status = DOWN;
      if (downSince === null) {
        downSince = now;
        becameDown = true;
      }
    } else {
      status = PENDING;
    }
  }

  const statements = [
    env.DB.prepare(
      "INSERT INTO heartbeats (probe_id, ts, status, latency_ms, msg) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(probeId, now, result.status, result.latency_ms, result.msg),
    env.DB.prepare(
      `INSERT INTO probe_state (probe_id, last_status, consecutive_fail, down_since, checked_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (probe_id) DO UPDATE SET
         last_status = excluded.last_status,
         consecutive_fail = excluded.consecutive_fail,
         down_since = excluded.down_since,
         checked_at = excluded.checked_at`,
    ).bind(probeId, status, consecutiveFail, downSince, now),
  ];
  // Retry samples update the live state above but never the daily uptime denominator; see
  // ProbeSampleSource for the incident this prevents. Historical rows are not recomputed.
  if (source !== "retry") {
    // Aggregate seven-day uptime by day; the status page reads only this table (at most seven rows per probe).
    // The old implementation counted seven days of heartbeats on every render. The page reloads every 60 seconds,
    // so each render read about 60,000 rows, creating a recurring risk of hitting D1 daily read limits.
    statements.push(
      env.DB.prepare(
        `INSERT INTO probe_uptime_daily (probe_id, day, total, up)
         VALUES (?1, ?2 - (?2 % 86400), 1, ?3)
         ON CONFLICT (probe_id, day) DO UPDATE SET
           total = total + 1,
           up = up + excluded.up`,
      ).bind(probeId, now, result.status === UP ? 1 : 0),
    );
  }
  await env.DB.batch(statements);

  return { status, consecutiveFail, downSince, becameDown, recovered };
}

/** Schedule a DO retry after a down result; cancel it on recovery. */
export async function scheduleRetry(
  env: Env,
  probeId: number,
  active: boolean,
): Promise<void> {
  const id = env.PROBE_STATE.idFromName(`probe-${probeId}`);
  const stub = env.PROBE_STATE.get(id);
  await stub.fetch(
    new Request(`https://probe.internal/${active ? "arm" : "disarm"}`, {
      headers: { "X-Probe-Id": String(probeId) },
    }),
  );
}

// Alert email (tasks/17, phase 3)
//
// Send through the Cloudflare Email Service `send_email` binding (env.EMAIL).
// If the binding or recipient is missing, only log the issue; do not throw, so probes keep working.
// The only source of alert copy is ALERT_I18N in this file (tasks/22 W7-13):
//
// English only (requested on 2026-10-11): alerts go to both the Feishu webhook and email,
// and both audiences read English. The previous Chinese, Japanese, and Korean versions only added maintenance work.
// Add new kinds only to this copy; ALERT_KINDS is the authoritative list of kinds.
// See blocklist.ts for the criteria. Add each new kind to the English copy; `ALERT_KINDS` is the complete list of kinds, and
// `runwatch.test.ts` verifies that every kind has a matching key.

export const ALERT_KINDS = ["down", "up", "runs", "blocklist", "retention", "budget"] as const;

/**
 * Alerts always use English (requested on 2026-10-11).
 *
 * `ALERT_I18N` now has only an `en-us` entry because alerts go to both the Feishu webhook and email, and both audiences read English.
 * The previous Chinese, Japanese, and Korean entries only added maintenance work. Keep the `lang` parameter on `buildAlertEmail` for compatibility, but use a constant so
 * the same copy always follows the same code path. This also lets tests assert that no matter how ALERT_LANG is configured,
 * the outgoing alert is English. `env.ALERT_LANG` no longer affects alerts; the field remains to preserve existing bindings.
 */
export const ALERT_LANG_FORCED: Lang = "en-us";

/** Alert copy table; exported only so tests can verify that every kind has a key (runtime uses only the accessor below). */
export const ALERT_I18N: Record<string, Record<string, string>> = {
  "en-us": {
    // Subject format (set on 2026-10-11): `<event> · ComiCine` — put the event first and the brand in the suffix.
    // Readers can identify the event at a glance in Feishu and email; title/intro provide the details.
    subject_down: "Health check alert · ComiCine",
    subject_up: "Service recovered · ComiCine",
    intro_down: "Following issue(s) detected by ComiCine monitoring:",
    intro_up: "The following service(s) recovered:",
    subject_runs: "Cron job failure · ComiCine",
    intro_runs: "A scheduled job did not succeed — the last recorded run of these jobs failed (a repeat alert means it is still broken):",
    hint_runs: "Triage: the error column for this job in the D1 worker_runs table, or the Workers logs in the Cloudflare dashboard.",
    subject_blocklist: "Blocklist drift · ComiCine",
    intro_blocklist: "Blocked IP list has drifted — the Cloudflare IP List and the active rows of D1 blocked_ips disagree, so edge blocking no longer matches the authority:",
    hint_blocklist: "Triage: python3 ops/check_blocklist_sync.py (this Worker runs the same comparison daily at 03:47 UTC).",
    subject_retention: "D1 retention failure · ComiCine",
    intro_retention: "The daily D1 retention pass failed for the tables below — expired rows keep growing until the next successful pass, which risks the daily write quota:",
    hint_retention: "Triage: SELECT name, last_run_at, last_error FROM retention_state, or search the Worker logs for retention_alert. The pass runs again daily at 03:47 UTC.",
    subject_budget: "D1 daily budget warning · ComiCine",
    intro_budget: "Account-level D1 usage is approaching the free-plan daily limit — when a limit is reached every D1 endpoint fails with APIError 7500 until UTC midnight:",
    hint_budget: "Triage: check the visitor page polling and status page cache first, then shrink visitor windows or move to Workers Paid. Re-check with `wrangler d1 info comicine`.",
    view: "View status page",
    hint: "Sent automatically by ComiCine monitoring. If this keeps arriving, check the service and confirm recovery on the status page.",
  },
};

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * One alert-body row: `<name> — <detail>`.
 * Probe alerts always have one row (name is the probe name); daily check alerts may have multiple rows (one for each failing
 * job or drift), so the template must support multiple rows.
 */
export interface AlertItem {
  name: string;
  detail: string;
}

interface AlertBlock {
  subject: string;
  /**
   * First line of the body, stating what happened.
   *
   * **No title field** (set on 2026-10-11): all three alert types use the subject for the event and intro for the details,
   * with a two-line structure and no duplicate title in the body. Each type used to have an `<h1>` title that repeated the subject,
   * for example, `Service issue detected` vs `Health check alert · ComiCine`, or
   * `A scheduled job did not succeed` vs `Cron job failure`. Removing it keeps the same information with one less noisy line.
   * The old `title_*` copy has been removed from `ALERT_I18N`; do not add it back.
   */
  intro: string;
  hint: string;
  /** Left accent bar and link color: red for failures, teal for recovery. */
  color: string;
}

/**
 * The only alert email rendering template (pure function). It handles three cases: probe down/up, cron failure,
 * and blocklist drift. Keep one template to avoid diverging implementations.
 *
 * For single-row input, the HTML remains byte-for-byte identical to before the refactor (covered by existing tests). The plain-text body adds a
 * timestamp. Previously `when` appeared only in HTML, while Feishu webhooks and SMTP both use this plain-text body,
 * and the time is essential alert information that must not be omitted from plain-text channels.
 */
function renderAlert(
  t: Record<string, string>,
  block: AlertBlock,
  items: AlertItem[],
  at: number,
): AlertEmail {
  // Reuse the same formatUtc implementation as runwatch.ts (YYYY-MM-DD-HH-MM, UTC). Previously this and
  // runwatch.ts duplicated the formatting, so a format change could update only one. See the tasks/22 execution notes.
  const when = formatUtc(at);
  // Body structure shared by all three alert types: intro with details, item list, time, status-page link, then sign-off/troubleshooting note.
  // There is no title line because the subject already states the event; see AlertBlock.
  const text =
    `${block.intro}\n\n` +
    items.map((i) => `- ${i.name}: ${i.detail}`).join("\n") +
    `\n\n${when}\n\n${t.view}: https://status.comicine.com/\n\n${block.hint}\n`;
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:10px 12px;border:1px solid #e4e4e7;border-left:3px solid ${block.color};font-size:14px">` +
        `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${block.color};margin-right:8px"></span>` +
        `${esc(i.name)} — ${esc(i.detail)}</td></tr>`,
    )
    .join("");
  const html =
    `<div style="font-family:Inter,system-ui,-apple-system,sans-serif;max-width:560px">` +
    `<p style="color:#52525b;font-size:14px;margin:0 0 16px">${esc(block.intro)}</p>` +
    `<table style="width:100%;border-collapse:collapse">${rows}</table>` +
    `<p style="font-size:13px;color:#52525b;margin:14px 0 0">${esc(when)}</p>` +
    `<p style="margin:16px 0 0"><a href="https://status.comicine.com/" style="color:${block.color};font-size:14px">${esc(t.view)}</a></p>` +
    `<p style="color:#71717a;font-size:12px;margin:18px 0 0;border-top:1px solid #e4e4e7;padding-top:12px">${esc(block.hint)}</p>` +
    `</div>`;
  return { subject: block.subject, text, html };
}

/** Build a probe alert email (pure function for testing and preview). */
export function buildAlertEmail(
  lang: string,
  kind: "down" | "up",
  probeName: string,
  msg: string,
  at: number,
): AlertEmail {
  const t = ALERT_I18N[lang] ?? ALERT_I18N[ALERT_LANG_FORCED];
  const down = kind === "down";
  return renderAlert(
    t,
    {
      // Do not append the probe name to the subject (set on 2026-10-11); use `Health check alert · ComiCine` as the full subject.
      // The body row (`- Website: selftest`) identifies the probe; the subject only needs to state what happened.
      subject: down ? t.subject_down : t.subject_up,
      // No title (the `Service issue detected` body line was removed at the user’s request on 2026-10-11):
      // it repeated the subject, so the body starts with intro.
      intro: down ? t.intro_down : t.intro_up,
      hint: t.hint,
      color: down ? "#dc2626" : "#05A5A6",
    },
    // The database stores English machine codes such as `http_503` and `fetch_error: TypeError: …`:
    // Make them readable while preserving runtime details for troubleshooting.
    [{ name: probeName, detail: alertDetail(msg, isLang(lang) ? lang : ALERT_LANG_FORCED) }],
    at,
  );
}

/** Subject length limit; prevent a long error from overflowing the subject (the body contains the full summary). */
export const ALERT_SUBJECT_CHARS = 120;

/**
 * Build **daily check** alerts (cron failures / blocklist drift). Reuse ALERT_I18N
 * and the same rendering template, with an additional list containing one row per issue.
 *
 * `subjectNote` lets the caller add a concise summary (for example, `to_add=1 to_remove=0`);
 * if omitted, the item names (such as job names) are used.
 */
export function buildCheckAlertEmail(
  lang: string,
  kind: "runs" | "blocklist" | "retention" | "budget",
  items: AlertItem[],
  at: number,
  subjectNote = "",
): AlertEmail {
  const t = ALERT_I18N[lang] ?? ALERT_I18N[ALERT_LANG_FORCED];
  // The subject is `<event> · ComiCine`; **do not append item names** (set on 2026-10-11). Item names can be long
  // (for example, `blocklist_sync, d1_archive, …`) and are already listed in the body. Keep the `subjectNote` parameter in
  // the signature for compatibility with existing call sites, but it no longer affects the subject.
  void subjectNote;
  const subject = t[`subject_${kind}`].slice(0, ALERT_SUBJECT_CHARS);
  return renderAlert(
    t,
    {
      subject,
      // No title (set on 2026-10-11): all three alert types omit the title line; intro explains
      // why the event is considered a failure (for example, `A scheduled job did not succeed — …`).
      intro: t[`intro_${kind}`],
      hint: t[`hint_${kind}`] ?? t.hint,
      // Both checks report conditions that need human attention, so use failure red.
      color: "#dc2626",
    },
    items,
    at,
  );
}

export interface DeliverResult {
  sent: boolean;
  via?: "webhook" | "email";
  reason?: string;
}

/**
 * Deliver an alert. Use the channel priority defined in `AGENTS.md`:
 * **HTTP webhook (preferred, Feishu bot format by default) → Email binding → SMTP**.
 *
 * Two requirements (tasks/22 W2-3):
 * 1. Order: the webhook is the cheapest and most reliable channel, so it must precede SMTP. SMTP used to come first,
 * but its production configuration is not always available, leaving webhook-configured alerts undelivered.
 * 2. Fallback: continue to the next channel after any failure. Previously, an SMTP failure returned immediately,
 * silently dropping the alert. This is worse than having no channel because the system appears configured.
 * If all channels fail, return the last channel’s reason without throwing.
 */
export async function deliverAlert(
  env: Env,
  mail: AlertEmail,
  only?: "webhook" | "email" | "smtp",
): Promise<DeliverResult> {
  let lastReason: string | undefined;
  let lastVia: "webhook" | "email" | undefined;

  // `only` lets the caller select **exactly one channel** and skip the others.
  //
  // Why it is needed (2026-10-11): delivery returns as soon as the webhook succeeds, so whenever
  // a webhook is configured, SMTP and Email are **never exercised**. For a long time, `/alert-test` only proved
  // that the webhook worked, so it could not answer why email never arrived. Automatic alerts still use the full fallback chain
  // (without `only`); this parameter is only for manual checks.
  const want = (channel: "webhook" | "email" | "smtp") => !only || only === channel;

  // 1) HTTP webhook (preferred)
  const url = env.ALERT_WEBHOOK_URL;
  if (url && want("webhook")) {
    const kind = (env.ALERT_WEBHOOK_KIND ?? "feishu").toLowerCase();
    const text = `${mail.subject}\n${mail.text}`;
    const body =
      kind === "slack"
        ? { text }
        : kind === "generic"
          ? mail
          : { msg_type: "text", content: { text } }; // Feishu custom bot
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        // Feishu custom bots answer HTTP 200 even when the bot rejects the message
        // ({"code": 9xxx, "msg": "..."}); treating that as delivered silently skipped
        // the email/SMTP fallback. An unparseable body keeps the historical success path.
        if (kind === "feishu") {
          let code: unknown = undefined;
          try {
            const payload = (await res.json()) as { code?: unknown } | null;
            code = payload?.code;
          } catch {
            code = undefined;
          }
          if (typeof code === "number" && code !== 0) {
            lastReason = `webhook_feishu_code_${code}`;
          } else {
            return { sent: true, via: "webhook" };
          }
        } else {
          return { sent: true, via: "webhook" };
        }
      } else {
        lastReason = `webhook_http_${res.status}`;
      }
    } catch (err) {
      lastReason = `webhook_error: ${String(err)}`;
    }
    lastVia = "webhook";
    console.log(JSON.stringify({ event: "webhook_failed", reason: lastReason }));
  }

  // 2) Email binding (fallback)
  if (env.EMAIL && env.ALERT_TO && want("email")) {
    try {
      await env.EMAIL.send({
        to: env.ALERT_TO,
        from: { email: env.ALERT_FROM ?? "no-reply@comicine.com", name: "ComiCine Monitor" },
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return { sent: true, via: "email" };
    } catch (err) {
      lastReason = `send_failed: ${String(err)}`;
      lastVia = "email";
    }
  } else if (env.EMAIL && !env.ALERT_TO && want("email")) {
    lastReason = "alert_to_missing";
    lastVia = "email";
  }

  // 3) SMTP provider (last fallback; sendViaSmtp returns a reason when configuration is incomplete)
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.ALERT_TO && want("smtp")) {
    const cfg: SmtpConfig = {
      host: env.SMTP_HOST,
      port: Number.parseInt(env.SMTP_PORT ?? "465", 10) || 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM ?? "no-reply@comicine.com",
    };
    const r = await sendViaSmtp(cfg, {
      to: env.ALERT_TO,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    if (r.sent) return { sent: true, via: "email" };
    lastReason = r.reason;
    lastVia = "email";
    console.log(JSON.stringify({ event: "smtp_failed", reason: r.reason }));
  }

  if (!lastReason) return { sent: false, reason: "no_alert_channel" };
  return { sent: false, via: lastVia, reason: lastReason };
}

/** Send a probe alert; return a reason for any failure without throwing. */
export async function sendAlert(
  env: Env,
  kind: "down" | "up",
  probeName: string,
  msg: string,
  only?: "webhook" | "email" | "smtp",
): Promise<DeliverResult> {
  const mail = buildAlertEmail(
    ALERT_LANG_FORCED,
    kind,
    probeName,
    msg,
    Math.floor(Date.now() / 1000),
  );
  const result = await deliverAlert(env, mail, only);
  console.log(
    JSON.stringify({
      event: result.sent ? "probe_alert_sent" : "probe_alert_skipped",
      probe: probeName,
      kind,
      via: result.via,
      reason: result.reason,
    }),
  );
  return result;
}

/**
 * Alert hook: rate-limit down alerts to prevent flapping noise, but always send recovery alerts.
 * Failures never affect the probe itself.
 */
export async function maybeAlert(
  env: Env,
  probe: Probe,
  kind: "down" | "up",
  msg: string,
): Promise<void> {
  try {
    if (kind === "down") {
      const cooldown = num(env.ALERT_COOLDOWN_S, 1800);
      const now = Math.floor(Date.now() / 1000);
      const row = await env.DB.prepare(
        "SELECT last_alert_at FROM probe_state WHERE probe_id = ?1",
      )
        .bind(probe.id)
        .first<{ last_alert_at: number | null }>();
      if (row?.last_alert_at && now - row.last_alert_at < cooldown) return;
      await env.DB.prepare("UPDATE probe_state SET last_alert_at = ?2 WHERE probe_id = ?1")
        .bind(probe.id, now)
        .run();
    }
    await sendAlert(env, kind, probe.name, msg);
  } catch (err) {
    console.error(JSON.stringify({ event: "probe_alert_failed", message: String(err) }));
  }
}

// Daily checks (cron `47 3 * * *`)
//
// The two cron Workers write run records to `worker_runs` (migration 018), but **nothing reads them**:
// sync and archive failures stay in the table without notifying anyone. Add a reader here and automate another invariant that was only
// checked manually: Cloudflare IP List must equal the active D1 `blocked_ips` set.
//
// The schedule is intentional: `47 3 * * *` runs after archive (`0 0 * * *`) and sync (`30 3 * * *`),
// so it sees the final results of both jobs for the day. **Never put this in the per-minute cron**; that cron runs probes,
// and adding daily checks there would read D1 1,440 times per day (see the D1 read budget in AGENTS.md).
//
// All three steps fail open: if a table is missing, a secret is unset, or an API call fails, only log the issue; do not alert,
// and never let checks disrupt D1 retention cleanup or the visitor aggregation in the daily task. Run cleanup, then aggregation, then checks.

/** Result of one daily check. `ok=false` means the check did not run successfully, not that it found an issue. */
export interface CheckStep {
  ok: boolean;
  /** Number of issues found (0 means healthy). */
  issues: number;
  alerted: boolean;
  reason?: string;
}

export interface DailyCheckResult {
  runs: CheckStep;
  budget: CheckStep;
  blocklist: CheckStep;
}

/**
 * Step 1: check whether each job’s latest run in `worker_runs` succeeded.
 *
 * The query, criteria, and thresholds are in `runwatch.ts`, including the cost rationale for not using GROUP BY.
 * This function only reads once, sends **one** summary alert if needed, and writes a structured log.
 */
export async function checkWorkerRuns(
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<CheckStep> {
  try {
    const latest = await readLatestRuns(env.DB);
    if (latest.error) {
      // A read failure must not be treated as “no records,” and must not trigger an alert; that would create operational noise.
      console.error(JSON.stringify({ event: "worker_runs_unreadable", reason: latest.error }));
      return { ok: false, issues: 0, alerted: false, reason: latest.error };
    }

    const issues: RunIssue[] = runIssues(latest.rows, now);
    const missing = WATCHED_JOBS.filter((job) => !latest.rows.some((r) => r.job === job));
    console.log(
      JSON.stringify({
        event: "worker_runs_checked",
        jobs: WATCHED_JOBS.length,
        found: latest.rows.length,
        missing,
        issues: issues.length,
      }),
    );
    if (!issues.length) return { ok: true, issues: 0, alerted: false };

    const mail = buildCheckAlertEmail(
      ALERT_LANG_FORCED,
      "runs",
      issues.map((i) => ({ name: i.job, detail: i.detail })),
      now,
    );
    const result = await deliverAlert(env, mail);
    console.log(
      JSON.stringify({
        event: result.sent ? "worker_runs_alert_sent" : "worker_runs_alert_skipped",
        jobs: issues.map((i) => i.job),
        outcomes: issues.map((i) => i.outcome),
        via: result.via,
        reason: result.reason,
      }),
    );
    return { ok: true, issues: issues.length, alerted: result.sent };
  } catch (err) {
    // readLatestRuns already handles its own errors; this is a second guard to ensure checks never disrupt the daily task.
    console.error(JSON.stringify({ event: "worker_runs_check_failed", message: String(err) }));
    return { ok: false, issues: 0, alerted: false, reason: String(err).slice(0, 140) };
  }
}

/** Maximum number of drift details to list; beyond this, report only the count. */
export const DRIFT_SAMPLE_ITEMS = 3;

/**
 * Step 3: compare the Cloudflare IP List with active rows in D1 `blocked_ips`.
 *
 * This and `ops/check_blocklist_sync.py` are two entry points for the same invariant. The script supports manual inspection
 * and can write a run record with `--record`; this path is automated. **Do not alert when they match**; a daily
 * “everything is fine” alert is noise and may cause alerts to be muted.
 */
export async function checkBlocklistRuns(env: Env): Promise<CheckStep> {
  try {
    const res = await checkBlocklistInvariant(env);
    if (!res.ok || !res.snapshot) {
      // Missing credentials are common when someone clones the project without configuring secrets; only log this case.
      console.log(
        JSON.stringify({ event: "blocklist_invariant_skipped", reason: res.reason ?? "unknown" }),
      );
      return { ok: false, issues: 0, alerted: false, reason: res.reason };
    }

    const { desired, actual, diff, listMissing } = res.snapshot;
    const { toAdd, toRemove } = diff;
    console.log(
      JSON.stringify({
        event: "blocklist_invariant_checked",
        desired: desired.length,
        actual: actual.length,
        to_add: toAdd.length,
        to_remove: toRemove.length,
        list_missing: listMissing,
      }),
    );
    if (!toAdd.length && !toRemove.length) return { ok: true, issues: 0, alerted: false };

    const sample = (list: string[]): string =>
      list.length > DRIFT_SAMPLE_ITEMS
        ? `${list.slice(0, DRIFT_SAMPLE_ITEMS).join(", ")} (+${list.length - DRIFT_SAMPLE_ITEMS} more)`
        : list.join(", ");
    const detail =
      `desired=${desired.length} actual=${actual.length} ` +
      `to_add=${toAdd.length} to_remove=${toRemove.length}` +
      (toAdd.length ? ` · add: ${sample(toAdd)}` : "") +
      (toRemove.length ? ` · remove: ${sample(toRemove)}` : "") +
      (listMissing ? ` · list ${LIST_NAME} not found` : "");

    const mail = buildCheckAlertEmail(
      ALERT_LANG_FORCED,
      "blocklist",
      [{ name: LIST_NAME, detail }],
      Math.floor(Date.now() / 1000),
      `to_add=${toAdd.length} to_remove=${toRemove.length}`,
    );
    const result = await deliverAlert(env, mail);
    console.log(
      JSON.stringify({
        event: result.sent ? "blocklist_alert_sent" : "blocklist_alert_skipped",
        to_add: toAdd.length,
        to_remove: toRemove.length,
        via: result.via,
        reason: result.reason,
      }),
    );
    return { ok: true, issues: toAdd.length + toRemove.length, alerted: result.sent };
  } catch (err) {
    console.error(JSON.stringify({ event: "blocklist_check_failed", message: String(err) }));
    return { ok: false, issues: 0, alerted: false, reason: String(err).slice(0, 140) };
  }
}

/**
 * In-isolate dedupe window for retention failure alerts: one alert per table per hour.
 *
 * The scheduled pass runs once a day, so this mainly protects manual/retried runs. In-memory
 * state is lost on a cold start, which is acceptable: losing it can only produce one duplicate
 * alert, while writing a dedupe row per request would work against the D1 budget. A successful
 * pass clears the table's entry so a new failure episode alerts again.
 */
export const RETENTION_ALERT_WINDOW_S = 3600;

const retentionAlertedAt = new Map<string, number>();

/** Test hook: forget the in-memory dedupe state. Never called by the Worker itself. */
export function resetRetentionAlertDedupe(): void {
  retentionAlertedAt.clear();
}

/** Error text stored in `retention_state.last_error`; long enough to identify the cause, short enough for a row. */
export const RETENTION_ERROR_CHARS = 200;

const RETENTION_STATE_SUCCESS_SQL =
  `INSERT INTO retention_state (name, last_run_at, last_success_at, last_error)
   VALUES (?1, ?2, ?2, '')
   ON CONFLICT (name) DO UPDATE SET
     last_run_at = excluded.last_run_at,
     last_success_at = excluded.last_success_at,
     last_error = ''`;

// On failure, keep the previous last_success_at: it is the recovery evidence an operator needs.
const RETENTION_STATE_FAILURE_SQL =
  `INSERT INTO retention_state (name, last_run_at, last_success_at, last_error)
   VALUES (?1, ?2, 0, ?3)
   ON CONFLICT (name) DO UPDATE SET
     last_run_at = excluded.last_run_at,
     last_error = excluded.last_error`;

export interface RetentionReportResult {
  /** Table rows written to `retention_state` (0 when the table is unavailable). */
  state_rows: number;
  /** Number of buckets whose prune failed. */
  failures: number;
  alerted: boolean;
}

/**
 * Record the outcome of one retention pass and alert on failures (suggestion 13).
 *
 * Previously `scheduled()` called `runRetention()` and discarded the results: a failed DELETE
 * only appeared in the `d1_retention` log line, `retention_state` was written only by the manual
 * `prune_d1.py`, and D1 could keep growing until it hit a storage or write limit unnoticed.
 * This function is the automated writer:
 *
 *   1. Upsert one `retention_state` row per bucket (at most 8 D1 writes per day). A success
 *      clears `last_error`; a failure updates `last_run_at`/`last_error` and keeps the previous
 *      `last_success_at`.
 *   2. Send one English alert for the tables whose failure has not alerted in the last hour.
 *      The alert names the table and truncates the error summary; it never includes row content.
 *   3. Never throw. `retention_state` bookkeeping, alert rendering, and delivery are each
 *      guarded so the retention pass and the daily checks always continue.
 */
export async function reportRetention(
  env: Env,
  results: readonly PruneResult[],
  now: number = Math.floor(Date.now() / 1000),
): Promise<RetentionReportResult> {
  let stateRows = 0;
  const failures: PruneResult[] = [];

  for (const result of results) {
    const error = (result.error ?? "").trim();
    if (error) failures.push(result);
    try {
      if (error) {
        await env.DB.prepare(RETENTION_STATE_FAILURE_SQL)
          .bind(result.table, now, error.slice(0, RETENTION_ERROR_CHARS))
          .run();
      } else {
        await env.DB.prepare(RETENTION_STATE_SUCCESS_SQL).bind(result.table, now).run();
        retentionAlertedAt.delete(result.table);
      }
      stateRows += 1;
    } catch (err) {
      // A fresh clone may not have migration 005 applied; bookkeeping must never break the prune.
      // The alert below still fires: a failed prune is more important than its bookkeeping row.
      console.warn(
        JSON.stringify({
          event: "retention_state_write_failed",
          table: result.table,
          message: String(err).slice(0, 140),
        }),
      );
    }
  }

  if (!failures.length) {
    return { state_rows: stateRows, failures: 0, alerted: false };
  }

  const due = failures.filter((failure) => {
    const last = retentionAlertedAt.get(failure.table) ?? 0;
    if (now - last < RETENTION_ALERT_WINDOW_S) {
      console.log(
        JSON.stringify({
          event: "retention_alert_suppressed",
          table: failure.table,
          window_s: RETENTION_ALERT_WINDOW_S,
        }),
      );
      return false;
    }
    return true;
  });
  if (!due.length) {
    return { state_rows: stateRows, failures: failures.length, alerted: false };
  }

  try {
    const mail = buildCheckAlertEmail(
      ALERT_LANG_FORCED,
      "retention",
      due.map((failure) => ({
        name: failure.table,
        detail: `deleted ${failure.deleted} rows · error: ${errorSummary(failure.error)}`,
      })),
      now,
    );
    const delivered = await deliverAlert(env, mail);
    if (delivered.sent) {
      for (const failure of due) retentionAlertedAt.set(failure.table, now);
    }
    console.log(
      JSON.stringify({
        event: delivered.sent ? "retention_alert_sent" : "retention_alert_skipped",
        tables: due.map((failure) => failure.table),
        via: delivered.via,
        reason: delivered.reason,
      }),
    );
    return { state_rows: stateRows, failures: failures.length, alerted: delivered.sent };
  } catch (err) {
    // Deliberately not thrown: a broken alert channel must not stop the rest of the daily task.
    console.error(
      JSON.stringify({ event: "retention_alert_failed", message: String(err).slice(0, 140) }),
    );
    return { state_rows: stateRows, failures: failures.length, alerted: false };
  }
}

/**
 * Step 2: account-level D1 daily budget check (suggestion 21).
 *
 * The free plan allows 5,000,000 rows read and 100,000 rows written per day for the whole account.
 * On 2026-09-17 production read 7,882,267 rows in one day, after which every D1 endpoint returned
 * `APIError 7500` until UTC midnight; there was no early warning before that. This step reads the
 * Cloudflare GraphQL D1 dataset (`d1AnalyticsAdaptiveGroups`) once per day, which costs one HTTPS
 * request and **0 D1 reads**.
 *
 * The decision uses the **last complete UTC day**, not the current one: at 03:47 the current day
 * bucket is only about four hours old, so its ratio would always look alarming. The current day
 * only raises an early warning when at least a third of it has elapsed and it has already spent
 * half of the read budget.
 *
 * Fail open: missing credentials, a token without Account Analytics Read, an HTTP error, a
 * timeout, or a malformed body all log only. The step never throws and never disturbs the
 * retention pass or the other daily checks.
 */
export async function checkD1Budget(
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<CheckStep> {
  try {
    const usage = await readD1Usage(env, now);
    if (!usage) {
      console.log(JSON.stringify({ event: "d1_budget_skipped", reason: "usage_unavailable" }));
      return { ok: false, issues: 0, alerted: false, reason: "usage_unavailable" };
    }

    const assessment = assessD1Budget(usage, now);
    console.log(
      JSON.stringify({
        event: "d1_budget_checked",
        day: usage.day,
        rows_read: usage.rows_read,
        rows_written: usage.rows_written,
        ratio: usage.rows_read / D1_DAILY_READ_LIMIT,
        write_ratio: usage.rows_written / D1_DAILY_WRITE_LIMIT,
        level: assessment.level,
        early_warning: assessment.early_warning,
      }),
    );
    if (assessment.level === "ok") return { ok: true, issues: 0, alerted: false };

    const mail = buildCheckAlertEmail(
      ALERT_LANG_FORCED,
      "budget",
      [{ name: "D1 usage", detail: budgetAlertDetail(usage, assessment) }],
      now,
    );
    const result = await deliverAlert(env, mail);
    console.log(
      JSON.stringify({
        event: result.sent ? "d1_budget_alert_sent" : "d1_budget_alert_skipped",
        level: assessment.level,
        day: usage.day,
        via: result.via,
        reason: result.reason,
      }),
    );
    return { ok: true, issues: 1, alerted: result.sent };
  } catch (err) {
    console.error(JSON.stringify({ event: "d1_budget_check_failed", message: String(err).slice(0, 140) }));
    return { ok: false, issues: 0, alerted: false, reason: String(err).slice(0, 140) };
  }
}

/**
 * Daily check entry point, shared by the `47 3 * * *` branch in `scheduled()` and the operational endpoint
 * `POST /daily-checks` (the endpoint allows verification without waiting until 03:47).
 * The three steps are independent; one can fail without affecting the others.
 */
export async function runDailyChecks(
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<DailyCheckResult> {
  const runs = await checkWorkerRuns(env, now);
  const budget = await checkD1Budget(env, now);
  const blocklist = await checkBlocklistRuns(env);
  console.log(JSON.stringify({ event: "daily_checks", runs, budget, blocklist }));
  return { runs, budget, blocklist };
}

/** Smallest accepted probe interval. The cron trigger fires every minute, so anything faster would over-sample. */
export const MIN_PROBE_INTERVAL_S = 60;

/** Largest deterministic stagger applied to a cron probe run, in seconds. */
export const PROBE_JITTER_MAX_S = 30;

/**
 * Resolve `probes.interval_s` for the due check.
 *
 * Values below `MIN_PROBE_INTERVAL_S`, non-numeric values, and negative values are rejected and
 * treated as 60 (suggestion 16). The baseline `Number(...) || 60` accepted a 30-second interval,
 * which the one-minute cron cannot honour. Migrations and manual probe inserts must also use
 * `interval_s >= 60`; the read path is the only enforcement point because no admin write endpoint
 * for probes exists.
 */
export function probeIntervalSeconds(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= MIN_PROBE_INTERVAL_S
    ? Math.floor(seconds)
    : MIN_PROBE_INTERVAL_S;
}

const warnedInvalidIntervals = new Set<number>();

/** Log an invalid stored interval once per isolate instead of once per minute. */
function warnInvalidInterval(probeId: number, raw: unknown, used: number): void {
  if (warnedInvalidIntervals.has(probeId)) return;
  warnedInvalidIntervals.add(probeId);
  console.warn(
    JSON.stringify({
      event: "probe_interval_invalid",
      probe_id: probeId,
      interval_s: String(raw),
      used_s: used,
    }),
  );
}

/**
 * Deterministic 0..`PROBE_JITTER_MAX_S` second stagger for one probe (suggestion 16).
 *
 * Every probe used to start in the same second of the cron tick. The offset is derived from the
 * probe id with a multiplicative hash instead of `Math.random()` so the schedule is reproducible
 * in tests and stable between runs. The upper bound is clamped to `interval - 1` so a probe is
 * never delayed past its next planned sample.
 */
export function probeJitterMs(probeId: number, intervalS: number = MIN_PROBE_INTERVAL_S): number {
  const id = Number.isFinite(probeId) ? Math.trunc(probeId) : 0;
  const hashed = Math.imul(id, 0x9e3779b1) >>> 0;
  const maxSeconds = Math.max(0, Math.min(PROBE_JITTER_MAX_S, Math.floor(intervalS) - 1));
  return (hashed % (maxSeconds + 1)) * 1000;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RunAllOptions {
  /** Stagger probe start times by their deterministic offset. Only the cron path sets this. */
  jitter?: boolean;
  /** Sample source recorded for uptime accounting; manual runs still count as planned samples. */
  source?: ProbeSampleSource;
}

export async function runAll(
  env: Env,
  now = Math.floor(Date.now() / 1000),
  options: RunAllOptions = {},
): Promise<number> {
  // Join probe_state so a probe whose configured interval has not elapsed is skipped. The cron runs
  // every minute; without this check a 900-second probe was checked 15 times per interval.
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.type, p.target, p.group_key, p.interval_s, s.checked_at
       FROM probes p LEFT JOIN probe_state s ON s.probe_id = p.id
      WHERE p.active = 1 ORDER BY p.id`,
  ).all<Probe & { checked_at: number | null }>();
  const probes = results ?? [];
  const due: Array<{ probe: Probe; slotMs: number }> = [];

  for (const probe of probes) {
    const declared = Number(probe.interval_s);
    const interval = probeIntervalSeconds(probe.interval_s);
    if (!Number.isFinite(declared) || declared < MIN_PROBE_INTERVAL_S) {
      warnInvalidInterval(probe.id, probe.interval_s, interval);
    }
    const lastChecked = Number(probe.checked_at ?? 0);
    if (lastChecked > 0 && now - lastChecked < interval) continue;
    due.push({
      probe,
      slotMs: options.jitter ? probeJitterMs(probe.id, interval) : 0,
    });
  }

  // Jitter is applied as a target start time relative to the beginning of the run, not as an
  // independent sleep per probe: that bounds the added wall time to PROBE_JITTER_MAX_S instead of
  // the sum of every probe's offset. Manual runs leave `jitter` unset and start immediately.
  if (options.jitter) due.sort((a, b) => a.slotMs - b.slotMs || a.probe.id - b.probe.id);
  const startedAt = Date.now();
  let ran = 0;

  for (const { probe, slotMs } of due) {
    if (slotMs > 0) {
      const waitMs = slotMs - (Date.now() - startedAt);
      if (waitMs > 0) await sleep(waitMs);
    }
    ran += 1;
    const result = await runProbe(env, probe);
    // Record the tick time, not the completion time: the jitter offset is a start-time shift and
    // must not change the effective sampling interval of the next due check (see record()).
    const state = await record(env, probe.id, result, options.source ?? "cron", now);
    if (state.becameDown) {
      await maybeAlert(env, probe, "down", result.msg);
      await scheduleRetry(env, probe.id, true);
    } else if (state.recovered) {
      await maybeAlert(env, probe, "up", result.msg);
      await scheduleRetry(env, probe.id, false);
    }
  }
  return ran;
}

interface StatusRow {
  id: number;
  name: string;
  type: string;
  target: string | null;
  group_key: string;
  active: number;
  label_key: string | null;
  /** Raw msg from the latest heartbeat (an English machine code); the page exposes only the normalized error code. */
  msg: string | null;  status: number | null;
  latency_ms: number | null;
  checked_at: number | null;
  total: number | null;
  up: number | null;
}

/** One row of the daily uptime rollup; `day` is a Unix timestamp floored to UTC midnight. */
interface DailyRow {
  probe_id: number;
  day: number;
  up: number;
  total: number;
}

export async function statusPayload(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  // Round the seven-day window to whole days to match the daily aggregation in probe_uptime_daily.
  // Each day bucket is a full UTC day (the write path floors to midnight), so the start time must also be midnight:
  // Midnight today minus six days gives exactly seven full-day buckets, including today.
  // The old `now - 7*86400 - 86400` expression also included the entire day eight days ago (8–9 buckets total).
  //
  // Sampling semantics (changed 2026-11-07, suggestion 14): buckets written from now on count planned
  // samples only; Durable Object retries update probe_state/heartbeats but do not increment this table.
  // Rows written before the change still mix retry samples and are not recomputed, because the daily
  // rollup cannot be rebuilt. The 7-day percentage therefore mixes two definitions until 2026-11-14.
  const todayStart = now - (now % 86400);
  const sinceDay = todayStart - 6 * 86400;
  // Both statements run together: the totals feed the 7-day percentage on every probe row, while the
  // flat daily query feeds the heartbeat bar. One flat query covers every probe (at most seven rows
  // per probe); a query per probe would multiply round trips and D1 statement overhead.
  const [probeResult, dailyResult] = await Promise.all([
    env.DB.prepare(
      // Latency and error code must come from the **same** latest heartbeat. Previously, there was only a latency subquery,
      // so now the query first finds the latest id and joins that row to read both fields with one index lookup,
      // avoiding mismatched timestamps without reading more rows per probe.
      `SELECT p.id, p.name, p.type, p.target, p.group_key, p.active, p.label_key,
              s.last_status AS status, s.checked_at,
              h.latency_ms AS latency_ms, h.msg AS msg,
              COALESCE((SELECT SUM(d.total) FROM probe_uptime_daily d
                WHERE d.probe_id = p.id AND d.day >= ?1), 0) AS total,
              COALESCE((SELECT SUM(d.up) FROM probe_uptime_daily d
                WHERE d.probe_id = p.id AND d.day >= ?1), 0) AS up
         FROM probes p
         LEFT JOIN probe_state s ON s.probe_id = p.id
         LEFT JOIN heartbeats h
                ON h.id = (SELECT hb.id FROM heartbeats hb
                            WHERE hb.probe_id = p.id ORDER BY hb.ts DESC LIMIT 1)
        WHERE p.active = 1
        ORDER BY p.id`,
    )
      .bind(sinceDay)
      .all<StatusRow>(),
    env.DB.prepare(
      "SELECT probe_id, day, up, total FROM probe_uptime_daily WHERE day >= ?1 ORDER BY probe_id, day",
    )
      .bind(sinceDay)
      .all<DailyRow>(),
  ]);

  const daysByProbe = new Map<number, PageDay[]>();
  for (const row of dailyResult.results ?? []) {
    const day: PageDay = { day: row.day, up: row.up ?? 0, total: row.total ?? 0 };
    const list = daysByProbe.get(row.probe_id);
    if (list) list.push(day);
    else daysByProbe.set(row.probe_id, [day]);
  }
  // Ordered oldest to newest even if the database returns the rows in another order.
  for (const list of daysByProbe.values()) list.sort((left, right) => left.day - right.day);

  const probes = (probeResult.results ?? []).map((row) => {
    const total = row.total ?? 0;
    const up = row.up ?? 0;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      group: row.group_key,
      label_key: row.label_key,
      // Normalized error codes (http_503 / fetch_timeout / d1_error …) are used by public JSON and
      // the renderer; raw exception text (which may contain database names or SQL) never leaves this Worker.
      detail: msgCode(row.msg),
      status: row.status ?? PENDING,
      latency_ms: row.latency_ms,
      uptime: total > 0 ? (up / total) * 100 : null,
      // Days without a row are omitted; the page renders its gray "no data" segment for them.
      days: daysByProbe.get(row.id) ?? [],
      checked_at: row.checked_at,
    };
  });

  const down = probes.filter((p) => p.status === DOWN).length;
  return {
    updated_at: now,
    total: probes.length,
    down,
    overall: down === 0 ? "all" : down < probes.length ? "partial" : "down",
    probes,
  };
}

// Status page (server-rendered; tasks/17, phase 2)
//
// Page markup, styles, scripts, and copy live in page.ts and i18n.ts; this file handles data retrieval and routing only.
// This Worker returns HTML directly, so there is no client-side data fetching or inline script/style
// (in accordance with the CSP requirements in tasks/14). status.js handles the countdown, auto-refresh, language menu, and theme toggle;
// status-theme.js applies the light-theme class before first paint to prevent a dark flash.

/**
 * Language detection entry point: `?lang=` > shared `user_lang_preference` cookie >
 * Accept-Language > zh-cn (implemented by pickLang in i18n.ts). Resolving the cookie here means
 * the very first response is already in the visitor's language, without a client-side redirect.
 */
export function pageLang(request: Request): Lang {
  return pickLang(request, new URL(request.url));
}

/**
 * Edge caching policy for status page HTML.
 *
 * Probes write data only once per minute, but every server-side render reads D1 (probes, probe_state,
 * latency, and daily uptime). Without caching, page reloads, monitoring tools, and crawler scans
 * each cause a real database read. This contributed to hitting the daily read limit on 2026-09-17.
 *
 * Use 60 seconds to match the probe cron cadence. At worst, the status display is one minute stale, which is acceptable;
 * this reduces duplicate requests from one database read each to at most one per minute.
 */
export const STATUS_HTML_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=300";

/**
 * Status page CSP: the strictest page on the site, allowing only three same-origin resources (one stylesheet and two scripts) plus one icon host.
 *
 *   - `script-src 'self'`: no unsafe-inline; header and footer interactions use external scripts;
 *   - `style-src 'self'`: styles come from /status.css, and the template has no style attributes;
 *   - `font-src 'self' data:`: the Delius Swash Caps brand subset is embedded in CSS
 * (see brand-font.ts; the main-site font is cross-origin and requires CORS, so the status page does not depend on it);
 *   - `img-src` allows only images.comicine.com, which hosts the same favicon used by base.html.
 * Before loosening any directive, ask whether failure of that resource could take down the status page.
 */
export const STATUS_CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self' data:; " +
  "img-src 'self' data: https://images.comicine.com; connect-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

/** HTML response headers shared by normal, 404, and error pages; only Cache-Control differs. */
const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": STATUS_CSP,
};

/** Render the status page on the server; data comes from D1 with no client-side fetches. */
export async function renderStatusPage(env: Env, lang: string): Promise<string> {
  const payload = await statusPayload(env);
  return statusPageHtml(payload, isLang(lang) ? lang : DEFAULT_LANG);
}

/**
 * Authentication for operational write endpoints (/run, /alert-test, /daily-checks): compare
 * `Authorization: Bearer <STATUS_TOKEN>`.
 *
 * This Worker is public at status.comicine.com and has no Cloudflare Access. These three endpoints
 * have meaningful costs: /run writes D1 (probes × heartbeats/probe_state/probe_uptime_daily,
 * so repeated calls can exhaust the daily write quota), and /alert-test and /daily-checks can send real alerts.
 * The shared secret is the only access control.
 *
 * Same approach as authorized() in ops/sync-worker: **fail closed when STATUS_TOKEN is not configured**
 * (reject all requests rather than treating a missing secret as open); compare characters only after lengths match to avoid an early return
 * that could reveal a matching prefix. scheduled() calls the internal path and does not use this check.
 */
export function authorized(request: Request, env: Env): boolean {
  const expected = (env.STATUS_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length).trim();
  if (!provided || provided.length !== expected.length) return false;
  // When lengths match, compare characters individually to avoid leaking a matching prefix through an early return.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/** Per-IP rate-limit window for /alert-test, in seconds. */
export const ALERT_TEST_THROTTLE_S = 60;

// Best-effort isolate-local rate limiting (each isolate has its own counter), used only as a second layer beyond authentication,
// to prevent an accidental script with a token from sending enough alerts to overwhelm an inbox.
const alertTestHits = new Map<string, number>();

/** Record this /alert-test request, decide whether to throttle it, and remove expired entries to keep the Map bounded. */
export function throttleAlertTest(ip: string, now: number): boolean {
  const windowMs = ALERT_TEST_THROTTLE_S * 1000;
  for (const [key, at] of alertTestHits) {
    if (now - at >= windowMs) alertTestHits.delete(key);
  }
  const last = alertTestHits.get(ip);
  if (last !== undefined && now - last < windowMs) return true;
  alertTestHits.set(ip, now);
  return false;
}

/** Minimal shape of the Worker execution context; only `waitUntil` is used (Cache API writes). */
export interface FetchContext {
  waitUntil(promise: Promise<unknown>): void;
}

const statusWorker = {
  async fetch(request: Request, env: Env, ctx?: FetchContext): Promise<Response> {
    const url = new URL(request.url);
    // Authenticate before processing write endpoints: unauthorized requests never touch D1, so a simple cross-site POST cannot trigger probes or alerts.
    const isOpsWrite =
      request.method === "POST" &&
      (url.pathname === "/run" ||
        url.pathname === "/alert-test" ||
        url.pathname === "/daily-checks");
    if (isOpsWrite && !authorized(request, env)) {
      console.warn(JSON.stringify({ event: "status_ops_unauthorized", path: url.pathname }));
      return Response.json(
        { error: "unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer", "Cache-Control": "no-store" } },
      );
    }
    if (url.pathname === "/_health") {
      return Response.json({ ok: true, service: "comicine-status" });
    }
    if (url.pathname === "/status.css") {
      return new Response(STATUS_CSS, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    // Two scripts: /status-theme.js runs synchronously in <head> to prevent a theme flash; /status.js handles page interactions.
    if (url.pathname === "/status.js" || url.pathname === "/status-theme.js") {
      const body = url.pathname === "/status-theme.js" ? THEME_JS : STATUS_JS;
      return new Response(body, {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    if (url.pathname === "/" || url.pathname === "/status") {
      const lang: Lang = pageLang(request);
      // Explicit Cache API layer (suggestion 23). Response headers alone do not put a Worker-generated
      // response into the edge cache, so every page view still ran renderStatusPage() and read D1.
      // The cache key uses the resolved language (query string, shared cookie, then Accept-Language),
      // so a cookie-resolved render is stored and read under that language key; there are only four
      // variants. The stored response's `s-maxage=60` sets the TTL, aligning the page with the
      // one-minute probe cron. Only GET is cached; HEAD, POST, 404s, and the 503 page below stay
      // uncached (the response also carries `no-store`).
      const cacheKey =
        request.method === "GET" && statusCacheAvailable() ? statusPageCacheKey(lang) : null;
      if (cacheKey) {
        const cached = await readStatusPageCache(cacheKey);
        if (cached) {
          const hit = new Response(cached.body, cached);
          hit.headers.set("X-Status-Cache", "hit");
          return hit;
        }
      }
      let html: string;
      try {
        html = await renderStatusPage(env, lang);
      } catch (err) {
        // If the database cannot be read, return the branded 503 page instead of Cloudflare’s generic error page,
        // which has no branding or exit path and may make visitors think all of comicine.com is down. Never cache the error page.
        console.error(
          JSON.stringify({ event: "status_render_failed", lang, error: String(err) }),
        );
        return new Response(renderErrorHtml(lang), {
          status: 503,
          headers: { ...PAGE_HEADERS, "Cache-Control": "no-store" },
        });
      }
      const response = new Response(html, {
        headers: {
          ...PAGE_HEADERS,
          // Edge cache: status data changes once per minute, while every SSR request reads D1.
          // Without caching, every request (including five-minute reloads, external fetches, and crawlers) queries the database,
          // amplifying D1 daily reads. s-maxage lets the Cloudflare edge absorb duplicate requests,
          // and max-age lets browsers reuse responses briefly; Vary below keeps the four languages separate.
          "Cache-Control": STATUS_HTML_CACHE_CONTROL,
          // The language is resolved before the explicit cache key: query string, shared
          // `user_lang_preference` cookie, then Accept-Language. A cookie-resolved page is stored
          // and read under its language key, so the cookie never needs to enter this header.
          // **Intentionally omit Vary: Cookie**: varying on raw cookie values would fragment the
          // edge cache, while the explicit key already separates the four language variants.
          "Vary": "Accept-Language",
          // Observability for the explicit cache: hit / miss / bypass (no Cache API or a non-GET request).
          "X-Status-Cache": cacheKey ? "miss" : "bypass",
        },
      });
      if (cacheKey) {
        const waitUntil =
          ctx && typeof ctx.waitUntil === "function"
            ? (promise: Promise<unknown>) => ctx.waitUntil(promise)
            : undefined;
        writeStatusPageCache(cacheKey, response.clone(), waitUntil);
      }
      return response;
    }
    if (url.pathname === "/api/status") {
      try {
        const payload = await statusPayload(env);
        return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
      } catch (err) {
        console.error(JSON.stringify({ event: "status_api_failed", error: String(err) }));
        return Response.json(
          { error: "unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    }
    // Manually run one probe cycle (for operations/troubleshooting; requires STATUS_TOKEN and returns only public status data).
    // Manual runs never jitter: they must start immediately, and their samples are still planned samples for uptime.
    if (url.pathname === "/run" && request.method === "POST") {
      const ran = await runAll(env, Math.floor(Date.now() / 1000), { source: "manual" });
      return Response.json({ ran, status: await statusPayload(env) });
    }

    // Run the daily checks immediately (worker_runs, the D1 budget, and the blocklist invariant). This endpoint exists because
    // the 03:47 UTC cron runs only once a day, so the flow cannot otherwise be verified immediately after a change or secret update.
    // It uses the **same** runDailyChecks() as scheduled(), so it can send real alerts.
    if (url.pathname === "/daily-checks" && request.method === "POST") {
      return Response.json(await runDailyChecks(env), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // Alert email preview (does not send; used to review copy and layout).
    if (url.pathname === "/alert-preview") {
      const kind = url.searchParams.get("kind") === "up" ? "up" : "down";
      const name = url.searchParams.get("probe") ?? "Website";
      const lang = url.searchParams.get("lang") ?? "zh-cn";
      const mail = buildAlertEmail(lang, kind, name, kind === "down" ? "http_503" : "http_200", Math.floor(Date.now() / 1000));
      if (url.searchParams.get("format") === "json") return Response.json(mail);
      return new Response(mail.html, {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    // Alert delivery self-check: calls the binding and reports whether it is configured without exposing secrets.
    if (url.pathname === "/alert-test" && request.method === "POST") {
      // Second layer: one request per IP every 60 seconds. Authentication already passed; this prevents accidental repeats even with a token.
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (throttleAlertTest(ip, Date.now())) {
        return Response.json(
          { error: "too_many_requests", retry_after_s: ALERT_TEST_THROTTLE_S },
          {
            status: 429,
            headers: {
              "Retry-After": String(ALERT_TEST_THROTTLE_S),
              "Cache-Control": "no-store",
            },
          },
        );
      }
      // `?via=webhook|email|smtp` selects one channel. Without it, use the full fallback chain as automatic alerts do.
      // This is needed because delivery short-circuits; when a webhook is configured, the email path never runs,
      // so the existing endpoint could not answer whether email delivery worked.
      const rawVia = url.searchParams.get("via");
      if (rawVia && !["webhook", "email", "smtp"].includes(rawVia)) {
        return Response.json(
          { error: "bad_via", allowed: ["webhook", "email", "smtp"] },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      const only = (rawVia ?? undefined) as "webhook" | "email" | "smtp" | undefined;
      const result = await sendAlert(
        env,
        "down",
        url.searchParams.get("probe") ?? "Website",
        "selftest",
        only,
      );
      // `configured` must reflect **all three channels**. It previously checked only `env.EMAIL`, while delivery order is
      // webhook → Email → SMTP. With only the webhook configured, the response could say
      // `{"configured":false,"sent":true,"via":"webhook"}`, which is contradictory,
      // and monitoring that checks configured would think the Worker has no alert channel.
      const channels = [
        env.ALERT_WEBHOOK_URL ? "webhook" : null,
        env.EMAIL && env.ALERT_TO ? "email" : null,
        env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.ALERT_TO ? "smtp" : null,
      ].filter((name): name is string => name !== null);
      return Response.json({
        configured: channels.length > 0,
        channels,
        tried: only ?? "full-chain",
        recipient_set: Boolean(env.ALERT_TO),
        ...result,
      });
    }
    // Unknown page navigations keep the 404 status and move the browser to the main site's 404 page.
    if (
      !url.pathname.startsWith("/api/") &&
      (request.method === "GET" || request.method === "HEAD") &&
      ((request.headers.get("Sec-Fetch-Dest") === "document") ||
        (request.headers.get("Sec-Fetch-Mode") === "navigate") ||
        (request.headers.get("Accept") ?? "").includes("text/html"))
    ) {
      // Render the status site's own branded 404 instead of a bare "Continue to ComiCine" stub:
      // the stub had no styling and read like an authentication stop.
      return new Response(request.method === "HEAD" ? null : renderNotFoundHtml(pageLang(request)), {
        status: 404,
        headers: {
          ...PAGE_HEADERS,
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // Every minute: probes. Daily at 03:47: D1 retention cleanup (migrated from the VPS prune_d1.py), the
    // visitors_daily aggregation behind /api/visitors, and daily checks.
    if (event.cron === "47 3 * * *") {
      // The order is intentional: run retention cleanup first because it protects the database, then refresh the
      // visitor aggregate (one statement; it logs failures and never throws), then run the daily checks (worker_runs
      // latest-run status, the D1 budget, and the blocklist invariant), which fail open as a whole. reportRetention()
      // runs right after retention: it writes the per-bucket retention_state row and alerts on failures without ever
      // throwing, so neither step below is affected by a delivery failure.
      const retention = await runRetention(env);
      await reportRetention(env, retention);
      await runVisitorDailyAggregate(env);
      await runDailyChecks(env);
      return;
    }
    // The cron path staggers probe starts by a deterministic 0-30 second offset (suggestion 16). The cron trigger's wall time
    // limit is 15 minutes, so the bounded stagger is safe; manual runs from POST /run stay immediate.
    await runAll(env, Math.floor(Date.now() / 1000), { jitter: true, source: "cron" });
  },
};

export default {
  ...statusWorker,
  async fetch(request: Request, env: Env, ctx?: FetchContext): Promise<Response> {
    const response = await statusWorker.fetch(request, env, ctx);
    if (request.method !== "HEAD" || response.body === null) return response;
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};

/**
 * Retry state machine for a single probe.
 *
 * Cron runs once per minute. After a down result, this object uses an alarm to retry every RETRY_INTERVAL_S seconds
 * until recovery or the RETRY_WINDOW_S window expires, after which Cron resumes the checks.
 */
export class ComiCineProbeStateV2 implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pid = Number.parseInt(request.headers.get("X-Probe-Id") ?? "0", 10);

    if (url.pathname === "/arm") {
      if (Number.isFinite(pid) && pid > 0) {
        await this.state.storage.put("probe_id", pid);
      }
      const interval = num(this.env.RETRY_INTERVAL_S, 10);
      await this.state.storage.setAlarm(Date.now() + interval * 1000);
      return Response.json({ armed: true, probe_id: pid });
    }
    if (url.pathname === "/disarm") {
      await this.state.storage.deleteAlarm();
      return Response.json({ armed: false });
    }
    return new Response("Not Found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const probeId = (await this.state.storage.get<number>("probe_id")) ?? 0;
    if (!probeId) return;

    const probe = await this.env.DB.prepare(
      "SELECT id, name, type, target, group_key, interval_s FROM probes WHERE id = ?1 AND active = 1",
    )
      .bind(probeId)
      .first<Probe>();
    if (!probe) return;

    const result = await runProbe(this.env, probe);
    // A retry is not a planned sample: it keeps the live state current but must not enlarge the
    // daily uptime denominator (see ProbeSampleSource).
    const state = await record(this.env, probeId, result, "retry");

    if (state.status === DOWN) {
      const window = num(this.env.RETRY_WINDOW_S, 280);
      const elapsed = Math.floor(Date.now() / 1000) - (state.downSince ?? 0);
      if (elapsed < window) {
        const interval = num(this.env.RETRY_INTERVAL_S, 10);
        await this.state.storage.setAlarm(Date.now() + interval * 1000);
      }
      return;
    }
    if (state.recovered) {
      await maybeAlert(this.env, probe, "up", result.msg);
    }
    await this.state.storage.deleteAlarm();
  }
}
