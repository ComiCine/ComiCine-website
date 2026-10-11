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

import { sendViaSmtp, type SmtpConfig } from "./smtp";
import { runRetention } from "./retention";
import { WATCHED_JOBS, formatUtc, readLatestRuns, runIssues, type RunIssue } from "./runwatch";
import { LIST_NAME, checkBlocklistInvariant } from "./blocklist";
import {
  STATUS_CSS,
  STATUS_JS,
  THEME_JS,
  esc,
  notFoundHtml,
  renderErrorHtml,
  statusPageHtml,
} from "./page";
/** 旧的导入路径（测试从 index 取）继续可用。 */
export { esc, statusKey } from "./page";
import { DEFAULT_LANG, alertDetail, isLang, msgCode, pickLang, type Lang } from "./i18n";

/**
 * limooo 状态探针 Worker（tasks/17 阶段 2）
 *
 * 取代 Uptime Kuma：
 *   - scheduled() 每分钟跑一轮探针，写 D1 heartbeats / probe_state
 *   - 判 down 后交给 ProbeState（Durable Object）每 10 秒复查，恢复即记录
 *   - GET /api/status 供状态页取数；GET /_health 存活探针
 *
 * 告警邮件（阶段 3）在 maybeAlert() 处落地；cron 失败可见性与封禁链路不变量
 * 在每日任务里检查（runDailyChecks()，判定见 runwatch.ts / blocklist.ts）。
 *
 * 公网写接口只有三个：POST /run（跑一轮探针、写 D1）、POST /alert-test
 * （真的发信）与 POST /daily-checks（立刻跑一遍每日检查，真的会发信）。
 * 本 Worker 挂在 status.limooo.cn 上、没有 Cloudflare Access，
 * 因此三者都要求 `Authorization: Bearer $STATUS_TOKEN`——见 authorized()。
 * **部署后必须 `wrangler secret put STATUS_TOKEN`，否则这些接口一直是 401。**
 */

export interface Env {
  DB: D1Database;
  PROBE_STATE: DurableObjectNamespace;
  /** 运维写接口（/run、/alert-test）的共享密钥；未配置时这两个接口一律 401。 */
  STATUS_TOKEN?: string;
  EMAIL?: { send: (msg: unknown) => Promise<unknown> };
  /** 告警通道首选：HTTP webhook（默认飞书自定义机器人格式）。 */
  ALERT_WEBHOOK_URL?: string;
  /** webhook 形态：feishu（默认）/ slack / generic。 */
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
   * 封禁列表不变量检查要读 Cloudflare IP List（blocklist.ts）。两个都没配时
   * 这一步只记日志、不报警（fail-open），所以是可选绑定：
   * `wrangler secret put CLOUDFLARE_API_TOKEN` / `... CLOUDFLARE_ACCOUNT_ID`。
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

/** 跑一次探针，只负责测量，不写库。 */
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
      headers: { "User-Agent": "Limooo-Status/2.0" },
    });
    // 门禁页以 403 原地渲染，视为服务可达；5xx 才判失败
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

/** 写入心跳并推进 probe_state。 */
export async function record(
  env: Env,
  probeId: number,
  result: ProbeResult,
): Promise<RecordOutcome> {
  const now = Math.floor(Date.now() / 1000);
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

  await env.DB.batch([
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
    // 7 天在线率按天累加，状态页只读这一张表（每探针最多 7 行）。
    // 旧实现每次渲染都要 COUNT 7 天 heartbeats：页面每 60 秒自动重载一次，
    // 单次约 6 万行读取，是 D1 每日读取上限的定时炸弹。
    env.DB.prepare(
      `INSERT INTO probe_uptime_daily (probe_id, day, total, up)
       VALUES (?1, ?2 - (?2 % 86400), 1, ?3)
       ON CONFLICT (probe_id, day) DO UPDATE SET
         total = total + 1,
         up = up + excluded.up`,
    ).bind(probeId, now, result.status === UP ? 1 : 0),
  ]);

  return { status, consecutiveFail, downSince, becameDown, recovered };
}

/** 判 down 时安排 DO 复查；恢复时取消。 */
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

// ── 告警邮件（tasks/17 阶段 3） ───────────────────────────────────
//
// 通过 Cloudflare Email Service 的 `send_email` binding（env.EMAIL）发送。
// 未配置 binding / 收件人时只记日志、不报错，保证探针本身不受影响。
// 文案的唯一来源是本文件的 ALERT_I18N（tasks/22 W7-13）：
//
// 只有英文（2026-10-11 用户要求）：告警同时投递到飞书 webhook 与邮件，
// 两类读者都按英文读。此前有中/日/韩三份，实际只增维护面。
// 新增 kind 时只需补这一份 —— ALERT_KINDS 是 kind 的唯一清单。
// 判定见 blocklist.ts）。新增 kind 时四语都要补齐——`ALERT_KINDS` 是 kind 的
// 全量清单，`runwatch.test.ts` 逐语言逐 kind 校验键齐全，漏一门就红。

export const ALERT_KINDS = ["down", "up", "runs", "blocklist"] as const;

/**
 * 告警固定用英文（2026-10-11 用户要求）。
 *
 * `ALERT_I18N` 现在只有 `en-us` 一份：告警同时投递到飞书 webhook 与邮件，两类读者都按英文读，
 * 此前的中/日/韩三份只增加维护面。这里用常量而不是删掉 `buildAlertEmail` 的 `lang` 形参，
 * 是为了让「这一份文案」永远走同一条代码路径（也方便测试断言「无论 ALERT_LANG 配成什么，
 * 出去的都必须是英文」）。`env.ALERT_LANG` 因此**已不再影响告警**，保留字段只为不破坏既有绑定。
 */
export const ALERT_LANG_FORCED: Lang = "en-us";
export type AlertKind = (typeof ALERT_KINDS)[number];

/** 四语文案表；导出只为让测试逐语言核对键齐全（运行时只用下面的取用函数）。 */
export const ALERT_I18N: Record<string, Record<string, string>> = {
  "en-us": {
    // subject 的形状（2026-10-11 用户定）：`<事件> · Limooo` —— 品牌放后缀，事件在前。
    // 飞书群与邮箱列表里扫一眼就能看出是什么事；详情交给 title/intro。
    subject_down: "Health check alert · Limooo",
    subject_up: "Service recovered · Limooo",
    intro_down: "Following issue(s) detected by Limooo monitoring:",
    intro_up: "The following service(s) recovered:",
    subject_runs: "Cron job failure · Limooo",
    intro_runs: "A scheduled job did not succeed — the last recorded run of these jobs failed (a repeat alert means it is still broken):",
    hint_runs: "Triage: the error column for this job in the D1 worker_runs table, or the Workers logs in the Cloudflare dashboard.",
    subject_blocklist: "Blocklist drift · Limooo",
    intro_blocklist: "Blocked IP list has drifted — the Cloudflare IP List and the active rows of D1 blocked_ips disagree, so edge blocking no longer matches the authority:",
    hint_blocklist: "Triage: python3 ops/check_blocklist_sync.py (this Worker runs the same comparison daily at 03:47 UTC).",
    view: "View status page",
    hint: "Sent automatically by Limooo monitoring. If this keeps arriving, check the service and confirm recovery on the status page.",
  },
};

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * 告警正文里的一行：`<name> — <detail>`。
 * 探针告警永远只有一行（name=探针名）；每日检查告警可能多行（每个出问题的
 * job / 每条漂移各一行），因此模板必须支持多行。
 */
export interface AlertItem {
  name: string;
  detail: string;
}

interface AlertBlock {
  subject: string;
  /**
   * 正文第一行，负责说清「出了什么事」。
   *
   * **没有 title 字段**（2026-10-11 用户定）：三类告警统一成「subject 报事件 + intro 说详情」
   * 两行结构，正文里不再有重复的标题行。此前每类都有一行 `<h1>` title，而它与 subject
   * 是同一件事（`Service issue detected` vs `Health check alert · Limooo`；
   * `A scheduled job did not succeed` vs `Cron job failure`），删掉后信息量不变、噪声少一行。
   * 原来那些 `title_*` 文案已从 `ALERT_I18N` 移除，不要再加回来。
   */
  intro: string;
  hint: string;
  /** 左侧色条与链接颜色：故障红 / 恢复青。 */
  color: string;
}

/**
 * 告警邮件的唯一渲染模板（纯函数）。三个场景（探针 down/up、cron 运行异常、
 * 封禁列表漂移）都从这里出，避免出现第二套模板后各自漂移。
 *
 * 单行输入下 HTML 与重构前逐字一致（既有测试钉着这一点）。纯文本正文多了一行
 * 时间戳：原来只有 HTML 里有 `when`，而 webhook（飞书）与 SMTP 纯文本走的都是
 * 这一份——「什么时候」是告警的基本信息，不能在纯文本通道里丢掉。
 */
function renderAlert(
  t: Record<string, string>,
  block: AlertBlock,
  items: AlertItem[],
  at: number,
): AlertEmail {
  // 与 runwatch.ts 的 formatUtc 共用同一实现（YYYY-MM-DD-HH-MM，UTC）：此前这里与
  // 那边各拼一遍同样的字符串，任何格式调整都会漏掉一处。见 tasks/22 的执行记录。
  const when = formatUtc(at);
  // 正文结构（三类告警统一）：intro 说详情 → 条目列表 → 时间 → 状态页链接 → 落款/排障提示。
  // 没有标题行 —— subject 已经报了事件，见 AlertBlock 的说明。
  const text =
    `${block.intro}\n\n` +
    items.map((i) => `- ${i.name}: ${i.detail}`).join("\n") +
    `\n\n${when}\n\n${t.view}: https://status.limooo.cn/\n\n${block.hint}\n`;
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
    `<p style="margin:16px 0 0"><a href="https://status.limooo.cn/" style="color:${block.color};font-size:14px">${esc(t.view)}</a></p>` +
    `<p style="color:#71717a;font-size:12px;margin:18px 0 0;border-top:1px solid #e4e4e7;padding-top:12px">${esc(block.hint)}</p>` +
    `</div>`;
  return { subject: block.subject, text, html };
}

/** 构造探针告警邮件（纯函数，便于测试与预览）。 */
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
      // subject 不再追加探针名（2026-10-11 用户定）：整串就是 `Health check alert · Limooo`。
      // 探针是谁由正文的条目行给出（`- Website: selftest`），标题只需说清「出了什么事」。
      subject: down ? t.subject_down : t.subject_up,
      // 没有 title（2026-10-11 用户要求去掉正文那行 `Service issue detected`）：
      // 它与 subject 说的是同一件事，正文直接从 intro 开始。
      intro: down ? t.intro_down : t.intro_up,
      hint: t.hint,
      color: down ? "#dc2626" : "#05A5A6",
    },
    // 库里存的是 `http_503` / `fetch_error: TypeError: …` 这类英文机器码：
    // 翻译成人话，但把运行时细节原样留在后面（排障要看原文）。
    [{ name: probeName, detail: alertDetail(msg, isLang(lang) ? lang : ALERT_LANG_FORCED) }],
    at,
  );
}

/** 主题行长度上限，避免一条长 error 把主题撑爆（正文里有完整摘要）。 */
export const ALERT_SUBJECT_CHARS = 120;

/**
 * 构造**每日检查**告警（cron 运行异常 / 封禁列表漂移）。复用同一张 ALERT_I18N
 * 与同一个渲染模板，只是多了「一行一个问题」的列表。
 *
 * `subjectNote` 供调用方补一个一眼可见的摘要（例如 `to_add=1 to_remove=0`）；
 * 不传时用各项名字（例如 job 名）拼。
 */
export function buildCheckAlertEmail(
  lang: string,
  kind: "runs" | "blocklist",
  items: AlertItem[],
  at: number,
  subjectNote = "",
): AlertEmail {
  const t = ALERT_I18N[lang] ?? ALERT_I18N[ALERT_LANG_FORCED];
  // subject 就是 `<事件> · Limooo`，**不追加条目名**（2026-10-11 用户定）：条目名可能很长
  // （`blocklist_sync, d1_archive, …`），而且正文已经逐条列出。`subjectNote` 形参保留在
  // 签名里只为兼容既有调用点，不再影响标题。
  void subjectNote;
  const subject = t[`subject_${kind}`].slice(0, ALERT_SUBJECT_CHARS);
  return renderAlert(
    t,
    {
      subject,
      // 不传 title（2026-10-11 用户定）：三类告警统一没有标题行，「为什么算异常」由
      // intro 第一句承担（`A scheduled job did not succeed — …`）。
      intro: t[`intro_${kind}`],
      hint: t[`hint_${kind}`] ?? t.hint,
      // 两种检查报出来的都是「需要人去处理」的状态，用故障红。
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
 * 投递告警。通道优先级按 `AGENTS.md` 的定义：
 * **HTTP webhook（首选，默认飞书机器人格式）→ Email binding → SMTP**。
 *
 * 两个要点（tasks/22 W2-3）：
 * 1. 顺序：webhook 是最便宜也最可靠的一跳，必须排在 SMTP 之前。此前 SMTP 在最前，
 *    而 SMTP 配置在线上并不总是可用，于是「配了 webhook 却拿不到告警」。
 * 2. 降级：任一通道失败都要继续试下一个，不能直接 return。此前 SMTP 失败即返回，
 *    告警被静默丢弃——这比不配置通道更危险，因为看起来是「已配置」的。
 * 全部失败时返回最后一个通道的原因，仍然不抛错。
 */
export async function deliverAlert(
  env: Env,
  mail: AlertEmail,
  only?: "webhook" | "email" | "smtp",
): Promise<DeliverResult> {
  let lastReason: string | undefined;
  let lastVia: "webhook" | "email" | undefined;

  // `only` 让调用方指定**只走某一条通道**，其余跳过。
  //
  // 为什么需要它（2026-10-11）：投递是「webhook 一成功就 return」的短路链，所以只要
  // webhook 配着，SMTP/Email 这两条**永远不会被执行** —— `/alert-test` 长期只证明了
  // webhook 能用，用户问「为什么我从没收到过邮件」时无法回答。自动告警仍走完整降级链
  // （不传 only），只有人工自测用得上这个参数。
  const want = (channel: "webhook" | "email" | "smtp") => !only || only === channel;

  // 1) HTTP webhook（首选）
  const url = env.ALERT_WEBHOOK_URL;
  if (url && want("webhook")) {
    const kind = (env.ALERT_WEBHOOK_KIND ?? "feishu").toLowerCase();
    const text = `${mail.subject}\n${mail.text}`;
    const body =
      kind === "slack"
        ? { text }
        : kind === "generic"
          ? mail
          : { msg_type: "text", content: { text } }; // feishu 自定义机器人
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return { sent: true, via: "webhook" };
      lastReason = `webhook_http_${res.status}`;
    } catch (err) {
      lastReason = `webhook_error: ${String(err)}`;
    }
    lastVia = "webhook";
    console.log(JSON.stringify({ event: "webhook_failed", reason: lastReason }));
  }

  // 2) Email binding（后备）
  if (env.EMAIL && env.ALERT_TO && want("email")) {
    try {
      await env.EMAIL.send({
        to: env.ALERT_TO,
        from: { email: env.ALERT_FROM ?? "no-reply@limooo.cn", name: "Limooo Monitor" },
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

  // 3) 邮箱服务商 SMTP（最后兜底；配置不齐时 sendViaSmtp 自己会返回原因）
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.ALERT_TO && want("smtp")) {
    const cfg: SmtpConfig = {
      host: env.SMTP_HOST,
      port: Number.parseInt(env.SMTP_PORT ?? "465", 10) || 465,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM ?? "no-reply@limooo.cn",
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

/** 发送探针告警；任何失败都只返回原因，绝不抛出。 */
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
 * 告警钩子：down 有冷却时间（避免抖动刷屏），恢复必发。
 * 任何失败都不影响探针本身。
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

// ── 每日检查（cron `47 3 * * *`） ─────────────────────────────────
//
// 两个 cron Worker 的运行记录（`worker_runs`，迁移 018）写下来了但**没有读者**：
// 同步/归档失败只留在表里，不会通知任何人。这里补上读者，顺带把另一条只有手工
// 入口的不变量（Cloudflare IP List == D1 `blocked_ips` active 集合）也搬进自动化。
//
// 位置是刻意的：`47 3 * * *` 排在归档（`0 0 * * *`）与同步（`30 3 * * *`）之后，
// 读到的一定是当天两个任务的最终结果。**绝不放进每分钟那个 cron**——那是探针的
// 节奏，把每日检查塞进去等于每天读 1440 次 D1（AGENTS.md「D1 读取预算」）。
//
// 三步全部 fail-open：读不到（表不存在/没配 secret/API 失败）只记日志、不报警，
// 更不能把每日任务里的 D1 保留清理带倒——所以清理先跑，检查后跑。

/** 每日检查里单步的结果。`ok=false` 表示「这一步没跑成」，不是「没有问题」。 */
export interface CheckStep {
  ok: boolean;
  /** 发现的问题条数（0 = 正常）。 */
  issues: number;
  alerted: boolean;
  reason?: string;
}

export interface DailyCheckResult {
  runs: CheckStep;
  blocklist: CheckStep;
}

/**
 * 步骤 1：`worker_runs` 里每个 job 的最近一次运行是否成功。
 *
 * 查询、判定与阈值都在 `runwatch.ts`（含「为什么不是 GROUP BY」的成本证据）。
 * 这里只负责：读一次 → 有问题就发**一条**汇总告警 → 结构化日志。
 */
export async function checkWorkerRuns(
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<CheckStep> {
  try {
    const latest = await readLatestRuns(env.DB);
    if (latest.error) {
      // 「读不到」绝不能当成「没有记录」，更不能报警——那是运维噪音。
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
    // readLatestRuns 已经自己兜了；这层是双保险，保证「检查」永远不带倒每日任务。
    console.error(JSON.stringify({ event: "worker_runs_check_failed", message: String(err) }));
    return { ok: false, issues: 0, alerted: false, reason: String(err).slice(0, 140) };
  }
}

/** 漂移清单里最多列几条明细（再多就只报数字了）。 */
export const DRIFT_SAMPLE_ITEMS = 3;

/**
 * 步骤 2：Cloudflare IP List == D1 `blocked_ips` (active=1)。
 *
 * 与 `ops/check_blocklist_sync.py` 是两个入口、同一条不变量：脚本给人手工排查
 * （还能 `--record` 写回运行记录），这里给自动化。**一致时不发告警**——每天一条
 * 「一切正常」是纯噪音，只会让人把告警静音。
 */
export async function checkBlocklistRuns(env: Env): Promise<CheckStep> {
  try {
    const res = await checkBlocklistInvariant(env);
    if (!res.ok || !res.snapshot) {
      // 缺凭据是最常见的一种：别人 clone 后没配 secret，这里只记日志。
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
 * 每日检查总入口，由 `scheduled()` 的 `47 3 * * *` 分支与运维接口
 * `POST /daily-checks` 共用（后者是为了不等到 03:47 也能验证这条链路）。
 * 两步彼此独立：一步失败不影响另一步。
 */
export async function runDailyChecks(
  env: Env,
  now: number = Math.floor(Date.now() / 1000),
): Promise<DailyCheckResult> {
  const runs = await checkWorkerRuns(env, now);
  const blocklist = await checkBlocklistRuns(env);
  console.log(JSON.stringify({ event: "daily_checks", runs, blocklist }));
  return { runs, blocklist };
}

export async function runAll(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    "SELECT id, name, type, target, group_key, interval_s FROM probes WHERE active = 1 ORDER BY id",
  ).all<Probe>();
  const probes = results ?? [];

  for (const probe of probes) {
    const result = await runProbe(env, probe);
    const state = await record(env, probe.id, result);
    if (state.becameDown) {
      await maybeAlert(env, probe, "down", result.msg);
      await scheduleRetry(env, probe.id, true);
    } else if (state.recovered) {
      await maybeAlert(env, probe, "up", result.msg);
      await scheduleRetry(env, probe.id, false);
    }
  }
  return probes.length;
}

interface StatusRow {
  id: number;
  name: string;
  type: string;
  target: string | null;
  group_key: string;
  active: number;
  label_key: string | null;
  /** 最新一条心跳的原始 msg（英文机器码）；页面只暴露归一化后的错误码。 */
  msg: string | null;  status: number | null;
  latency_ms: number | null;
  checked_at: number | null;
  total: number | null;
  up: number | null;
}

export async function statusPayload(env: Env) {
  const now = Math.floor(Date.now() / 1000);
  // 7 天窗口按「天」取整，才能命中 probe_uptime_daily 的按天汇总。
  // day 桶是 UTC 整天（写入侧 floor 到当天零点），所以起点必须落在零点上：
  // 「今天零点」回推 6 天 = 恰好 7 个整天桶（含今天）。
  // 旧写法 now - 7*86400 - 86400 会把 8 天前那一整天也圈进来（实际 8–9 个桶）。
  const todayStart = now - (now % 86400);
  const sinceDay = todayStart - 6 * 86400;
  const { results } = await env.DB.prepare(
    // 延迟与错误码必须来自**同一条**最新心跳：原来只有一个 latency 子查询，
    // 现在改成「先取最新 id、再 join 那一行」，一次索引定位拿到两列，
    // 既不会出现「延迟是新的、错误码是旧的」，也不比原来多读一行/探针。
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
    .all<StatusRow>();

  const probes = (results ?? []).map((row) => {
    const total = row.total ?? 0;
    const up = row.up ?? 0;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      group: row.group_key,
      label_key: row.label_key,
      // 归一化错误码（http_503 / fetch_timeout / d1_error …）：公开 JSON 与
      // 渲染层都只用它，原始异常文本（可能含库名/SQL）不出这个 Worker。
      detail: msgCode(row.msg),
      status: row.status ?? PENDING,
      latency_ms: row.latency_ms,
      uptime: total > 0 ? (up / total) * 100 : null,
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

// ── 状态页（服务端渲染；tasks/17 阶段 2） ─────────────────────────
//
// 页面标记 / 样式 / 脚本 / 文案分别在 page.ts 与 i18n.ts，本文件只负责取数与路由。
// 由本 Worker 直接出 HTML，因此没有客户端取数、也没有内联 script/style
// （遵守 tasks/14 的 CSP 约束）：status.js 只管倒计时、自动刷新、语言浮层与深浅胶囊，
// status-theme.js 只负责首屏前把浅色 class 打上（避免深色闪一下）。

/** 语言判定兼容入口：`?lang=` > Accept-Language > zh-cn（实现见 i18n.ts 的 pickLang）。 */
export function pageLang(request: Request): string {
  return pickLang(request);
}

/**
 * 状态页 HTML 的边缘缓存策略。
 *
 * 探针每分钟才写一次数据，但状态页每次 SSR 都要读 D1（probes + probe_state +
 * latency + 按天在线率）。不给缓存时，页面自动重载、监控工具抓取、爬虫扫描
 * 都会变成一次真实的库读取——这是 2026-09-17 撞到每日读取上限的成因之一。
 *
 * 取 60s：与 cron 探针节奏对齐，最坏情况状态显示滞后一分钟，对状态页完全可接受；
 * 同时把重复请求从「每次都读库」压到「每分钟最多一次」。
 */
export const STATUS_HTML_CACHE_CONTROL =
  "public, max-age=30, s-maxage=60, stale-while-revalidate=300";

/**
 * 状态页 CSP：全站最紧的一页，只有三个自源资源（样式 + 两个脚本）与一个图标主机。
 *
 *   - `script-src 'self'`：没有 unsafe-inline，页头页脚的交互全在外链脚本里；
 *   - `style-src 'self'`：样式来自 /status.css，模板里没有任何 style=""；
 *   - `font-src 'self' data:`：品牌字体是内联在 CSS 里的 woff2 子集
 *     （见 brand-font.ts，主站那份字体跨源且需要 CORS，状态页不依赖它）；
 *   - `img-src` 只放开 favicon 所在的 images.limooo.cn（与 base.html 同一个图标地址）。
 * 放宽任何一条都要先问一句：这个资源挂了会不会把状态页一起带下去。
 */
export const STATUS_CSP =
  "default-src 'none'; style-src 'self'; script-src 'self'; font-src 'self' data:; " +
  "img-src 'self' data: https://images.limooo.cn; connect-src 'self'; base-uri 'none'; " +
  "form-action 'none'; frame-ancestors 'none'";

/** HTML 响应头：正常页、404 页与故障页共用，只有 Cache-Control 不同。 */
const PAGE_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": STATUS_CSP,
};

/** 服务端渲染状态页；数据来自 D1，无客户端取数。 */
export async function renderStatusPage(env: Env, lang: string): Promise<string> {
  const payload = await statusPayload(env);
  return statusPageHtml(payload, isLang(lang) ? lang : DEFAULT_LANG);
}

/**
 * 运维写接口（/run、/alert-test、/daily-checks）的鉴权：比对
 * `Authorization: Bearer <STATUS_TOKEN>`。
 *
 * 这个 Worker 挂在公网（status.limooo.cn）且没有 Cloudflare Access，而这三个接口
 * 代价都不小——/run 会写 D1（探针 × heartbeats/probe_state/probe_uptime_daily，
 * 循环调用能烧掉每日写入额度），/alert-test 与 /daily-checks 会真的发告警信。
 * 共享密钥是唯一闸门。
 *
 * 与 ops/sync-worker 的 authorized() 同源：**未配置 STATUS_TOKEN 时 fail-closed**
 * （拒绝一切，而不是「没设密码就等于开放」）；长度相等才逐字符比较，避免提前返回
 * 泄露前缀。scheduled() 走内部调用，不经过这里。
 */
export function authorized(request: Request, env: Env): boolean {
  const expected = (env.STATUS_TOKEN ?? "").trim();
  if (!expected) return false;
  const header = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length).trim();
  if (!provided || provided.length !== expected.length) return false;
  // 长度相等时逐字符比较，避免提前返回泄露前缀信息。
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/** /alert-test 的同 IP 节流窗口（秒）。 */
export const ALERT_TEST_THROTTLE_S = 60;

// isolate 级内存节流：尽力而为（多 isolate 各自计数），只作为鉴权之外的第二层，
// 防止拿到 token 的手滑脚本循环发信把收件箱打爆。
const alertTestHits = new Map<string, number>();

/** 记录本次 /alert-test 并判断是否该节流；顺带清掉过期条目，避免 Map 无界增长。 */
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // 写接口先过闸：未授权时连 D1 都不碰，第三方页面的简单 POST 因此打不到探针与告警。
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
      return Response.json({ ok: true, service: "limooo-status" });
    }
    if (url.pathname === "/status.css") {
      return new Response(STATUS_CSS, {
        headers: {
          "Content-Type": "text/css; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }
    // 两个脚本：/status-theme.js 在 <head> 里同步跑（防白闪），/status.js 是页面交互。
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
      const lang: Lang = pickLang(request, url);
      let html: string;
      try {
        html = await renderStatusPage(env, lang);
      } catch (err) {
        // 读不到库时返回自己的 503 页，而不是让请求炸成 Cloudflare 的通用错误页：
        // 后者没有品牌也没有出口，访客会以为整个 limooo.cn 都挂了。错误页绝不缓存。
        console.error(
          JSON.stringify({ event: "status_render_failed", lang, error: String(err) }),
        );
        return new Response(renderErrorHtml(lang), {
          status: 503,
          headers: { ...PAGE_HEADERS, "Cache-Control": "no-store" },
        });
      }
      return new Response(html, {
        headers: {
          ...PAGE_HEADERS,
          // 边缘缓存：状态数据每分钟才变一次，SSR 每次都要读 D1。
          // 无缓存时每个请求（含 5 分钟自动重载、外部抓取、爬虫）都直接打库，
          // 是 D1 每日读取配额的放大器。s-maxage 让 Cloudflare 边缘吸收重复请求，
          // max-age 让浏览器短时间内复用（配合下方 Vary，四语言各自缓存）。
          "Cache-Control": STATUS_HTML_CACHE_CONTROL,
          // 语言变体只有两种来源：Accept-Language 与显式 `?lang=`（查询串天然进
          // 缓存键）。**故意不 Vary: Cookie**——那会按 cookie 原文打碎边缘缓存，
          // 把 D1 读取放大回去；共享 cookie 只用于客户端的一次性跳转。
          "Vary": "Accept-Language",
        },
      });
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
    // 手动触发一轮探针（运维/排障用，需要 STATUS_TOKEN；只返回公开的状态数据）
    if (url.pathname === "/run" && request.method === "POST") {
      const ran = await runAll(env);
      return Response.json({ ran, status: await statusPayload(env) });
    }

    // 立刻跑一遍每日检查（worker_runs + 封禁链路不变量）。存在的理由：03:47 UTC
    // 那个 cron 一天只有一次，改完/配完 secret 后没法当场验证这条链路。
    // 与 scheduled 走**同一个** runDailyChecks()，所以它会真的发告警。
    if (url.pathname === "/daily-checks" && request.method === "POST") {
      return Response.json(await runDailyChecks(env), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // 告警邮件预览（不发信，用于核对文案与排样）
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
    // 告警发送自检：真实调用 binding，返回是否配置成功（不泄密）
    if (url.pathname === "/alert-test" && request.method === "POST") {
      // 第二层：同 IP 60 s 一次（鉴权已在上方过闸，这里只防「有 token 也手滑」）。
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
      // `?via=webhook|email|smtp` 只走那一条通道。不传则走完整降级链（与自动告警一致）。
      // 加它的理由：投递是短路链，webhook 配着时邮件路径永远不执行，
      // 于是「邮件到底能不能发」这个问题长期无法用现成接口回答。
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
      // `configured` 必须反映**全部三条通道**。此前它只看 `env.EMAIL`，而投递顺序是
      // webhook → Email → SMTP —— 于是「只配了 webhook」时会出现
      // `{"configured":false,"sent":true,"via":"webhook"}` 这种自相矛盾的响应，
      // 任何只看 configured 的监控都会以为这台 worker 没有任何告警通道。
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
    // 未知路径：浏览器（Accept: text/html）拿品牌化的四语 404 页，
    // 其余客户端继续拿纯文本 —— 探针/抓取脚本不该因为多了一段 HTML 而改解析。
    if (request.method === "GET" && (request.headers.get("Accept") ?? "").includes("text/html")) {
      const lang = pickLang(request, url);
      return new Response(notFoundHtml(lang), {
        status: 404,
        headers: { ...PAGE_HEADERS, "Cache-Control": "no-store" },
      });
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // 每分钟：探针；每日 03:47：D1 保留清理（迁移自 VPS 的 prune_d1.py）+ 每日检查
    if (event.cron === "47 3 * * *") {
      // 顺序是有意的：保留清理是防爆库的关键路径，先跑；每日检查（worker_runs
      // 最近一次运行 + 封禁链路不变量）整段 fail-open，即使全挂也不影响清理。
      await runRetention(env);
      await runDailyChecks(env);
      return;
    }
    await runAll(env);
  },
};

/**
 * 单探针的复查状态机。
 *
 * Cron 每分钟跑一轮；一旦判 down，本对象用 alarm 每 RETRY_INTERVAL_S 秒
 * 复查一次，直到恢复或超出 RETRY_WINDOW_S 窗口（之后交回 Cron 节奏）。
 */
export class ProbeState implements DurableObject {
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
    const state = await record(this.env, probeId, result);

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
