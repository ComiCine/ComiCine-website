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
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * All user-visible copy for status.limooo.cn, in one table for four languages.
 *
 * Why this file carries its own table instead of reading `site/locales/*.json`:
 *   The status page is server-rendered by a separate Worker, and Pages locales are unavailable
 *   at runtime. The copy must also remain available when the main site is down.
 *   The tradeoff is that matching keys in this table and `site/locales/*.json` must be kept in
 *   sync manually. The page's own `title`, `sub`, and related keys are independent; only
 *   `nav_*`, `footer_*`, and `lang_*` share wording with the main site.
 *
 * Why the key set is defined by a base language and required to match across the others:
 *   `UI` uses `Record<UiKey, string>` and `UiKey = keyof typeof ZH_CN`; **tsc reports an error**
 *   if any language is missing a key (`npm run typecheck` catches it).
 *   This guarantees that every possible error has a translation: a missing error message
 *   cannot ship silently and instead fails compilation in CI.
 */

export const LANGS = ["zh-cn", "en-us", "ja-jp", "ko-kr"] as const;
export type Lang = (typeof LANGS)[number];

/** Default language without Accept-Language or a cookie; matches the previous `pageLang()` behavior. */
export const DEFAULT_LANG: Lang = "zh-cn";

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v);
}

/**
 * Preferences shared across subdomains. These values must match `lang_cookie`, `theme_cookie`,
 * `lang_cookie_max_age`, and `root_domain` in `site/config-contract.json`. The Worker cannot read
 * the contract file, so these constants mirror it. Update them with the contract; `site/tests/`
 * does not include contract tests for this Worker.
 */
export const ROOT_DOMAIN = "limooo.cn";
export const LANG_COOKIE = "user_lang_preference";
export const THEME_COOKIE = "limooo_theme";
export const COOKIE_MAX_AGE = 31536000;

/** Each language's own name in the overlay; must match `lang_<primary>` in `site/locales/*.json`. */
export const LANG_LABELS: Record<Lang, string> = {
  "zh-cn": "简体中文",
  "en-us": "English",
  "ja-jp": "日本語",
  "ko-kr": "한국어",
};

/**
 * Map the region subtag of a language code to a flag emoji (`zh-cn` → 🇨🇳). This matches
 * `_lang_flag()` in `site/src/render_app.py`: return an empty string when no region is present.
 */
export function langFlag(code: string): string {
  const parts = code.split("-");
  if (parts.length < 2 || parts[1].length !== 2 || !/^[a-z]{2}$/.test(parts[1])) return "";
  const region = parts[1].toUpperCase();
  return String.fromCodePoint(
    ...[...region].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - "A".charCodeAt(0)),
  );
}

/**
 * Language selection order: explicit `?lang=` > Accept-Language prefix > default language.
 *
 * `?lang=` supports the language overlay and a second redirect when the cookie disagrees with
 * the initial page language. The HTML is edge-cached with `Vary: Accept-Language`. Rendering
 * from a language cookie would require `Vary: Cookie`, fragmenting the cache by cookie value and
 * increasing D1 reads. The query string is already part of the cache key, with only four
 * possible language variants.
 */
export function pickLang(request: Request, url?: URL): Lang {
  const explicit = url?.searchParams.get("lang")?.trim().toLowerCase();
  if (isLang(explicit)) return explicit;
  const accept = (request.headers.get("Accept-Language") ?? "").toLowerCase();
  for (const part of accept.split(",")) {
    const p = part.trim().split(";")[0];
    if (p.startsWith("zh")) return "zh-cn";
    if (p.startsWith("ja")) return "ja-jp";
    if (p.startsWith("ko")) return "ko-kr";
    if (p.startsWith("en")) return "en-us";
  }
  return DEFAULT_LANG;
}

/**
 * Normalize probe values from `heartbeats.msg` into error codes.
 *
 * The database stores **English machine codes** (`http_503`, `fetch_error: TypeError: fetch failed`, etc.).
 * This only classifies them; it does not translate or **expose raw exception text**. Values after
 * `d1_error:` or `fetch_error:` contain runtime exception details and may reveal SQL, database
 * names, or internal information. The status page is public, so it translates normalized codes
 * and exposes only those codes in public JSON (`/api/status`). Raw text remains in alert emails
 * and logs for troubleshooting.
 */
export const MSG_CODES = [
  "ok",
  "no_data",
  "unexpected_result",
  "missing_target",
  "d1_error",
  "fetch_error",
  "fetch_timeout",
  "unknown",
] as const;
export type MsgCode = (typeof MSG_CODES)[number] | `http_${number}`;

export function msgCode(msg: string | null | undefined): MsgCode {
  const raw = (msg ?? "").trim();
  if (!raw) return "no_data";
  if (raw === "ok" || raw === "missing_target" || raw === "unexpected_result") return raw;
  if (/^http_\d{3}$/.test(raw)) return raw as MsgCode;
  if (raw.startsWith("d1_error")) return "d1_error";
  if (raw.startsWith("fetch_error")) return /abort/i.test(raw) ? "fetch_timeout" : "fetch_error";
  return "unknown";
}

/** Replace `{name}` placeholders with whole-string replacement; values come from this table or database error codes. */
export function fmt(template: string, params: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/** The base language is the sole source of truth for keys; the type system enforces the same set in other languages. */
const ZH_CN = {
  // Page content
  title: "系统状态",
  sub: "Limooo 各项服务的实时可用性。",
  overall_all: "全部系统运行正常",
  overall_partial: "部分系统异常",
  overall_down: "系统中断",
  up: "运行正常",
  down: "服务中断",
  pending: "检测中",
  group_public: "公开服务",
  group_internal: "内部服务",
  uptime: "7 天在线率",
  updated: "最后更新",
  refresh: "自动刷新",
  note: "数据来源：limooo-status Worker · Cloudflare D1",
  reason_line: "原因：{detail}",
  no_probes: "暂无探针配置。",
  card_website: "Limooo 网站",
  card_d1: "Limooo D1 健康检查",
  card_status: "边缘静态资源",

  // Page-level errors (render failure or missing route)
  err_title: "状态数据暂时不可用",
  err_text: "无法从数据库读取探针数据，请稍后重试。",
  err_retry: "重试",
  notfound_title: "页面不存在",
  notfound_text: "这个地址在状态页上没有对应内容。",
  back_status: "状态页",
  back_home: "回到 limooo.cn",

  // Header and footer (matching keys and values in site/locales/*.json)
  nav_home: "主页",
  nav_services: "服务",
  nav_contact: "联系方式",
  nav_menu_aria: "菜单",
  lang_aria: "切换语言",
  theme_aria: "切换主题",
  visit_bilibili: "访问B站主页",
  footer_rights: "保留所有权利",
  footer_source: "AGPL-3.0",
  footer_source_link: "源码",

  // Probe result codes
  err_ok: "探针正常",
  err_no_data: "暂无探测记录",
  err_unexpected_result: "探针返回了非预期结果",
  err_missing_target: "探针未配置目标地址",
  err_d1_error: "数据库查询失败",
  err_fetch_error: "无法连接目标（网络错误）",
  err_fetch_timeout: "请求超时，目标未在时限内响应",
  err_unknown_code: "未知错误（{code}）",
  http_200: "请求成功（HTTP 200）",
  http_400: "请求无效（HTTP 400）",
  http_401: "需要认证（HTTP 401）",
  http_403: "访问被拒绝（HTTP 403）",
  http_404: "资源不存在（HTTP 404）",
  http_405: "请求方法不被允许（HTTP 405）",
  http_408: "请求超时（HTTP 408）",
  http_409: "请求冲突（HTTP 409）",
  http_410: "资源已下线（HTTP 410）",
  http_429: "请求过于频繁（HTTP 429）",
  http_451: "因法律原因不可访问（HTTP 451）",
  http_500: "服务内部错误（HTTP 500）",
  http_501: "功能未实现（HTTP 501）",
  http_502: "网关错误（HTTP 502）",
  http_503: "服务不可用（HTTP 503）",
  http_504: "网关超时（HTTP 504）",
  http_505: "HTTP 版本不受支持（HTTP 505）",
  http_520: "源站返回未知错误（HTTP 520）",
  http_521: "源站已宕机（HTTP 521）",
  http_522: "与源站连接超时（HTTP 522）",
  http_523: "源站不可达（HTTP 523）",
  http_524: "源站响应超时（HTTP 524）",
  http_525: "SSL 握手失败（HTTP 525）",
  http_526: "SSL 证书无效（HTTP 526）",
  http_530: "源站 DNS 解析失败（HTTP 530）",
  http_other: "服务返回 HTTP {code}",
} as const;

export type UiKey = keyof typeof ZH_CN;

export const UI: Record<Lang, Record<UiKey, string>> = {
  "zh-cn": ZH_CN,
  "en-us": {
    title: "System Status",
    sub: "Live availability for Limooo services.",
    overall_all: "All Systems Operational",
    overall_partial: "Partially Operational",
    overall_down: "Systems Down",
    up: "Operational",
    down: "Downtime",
    pending: "Pending",
    group_public: "Public Services",
    group_internal: "Internal Services",
    uptime: "7-day uptime",
    updated: "Last updated",
    refresh: "Auto refresh in",
    note: "Data source: limooo-status Worker · Cloudflare D1",
    reason_line: "Reason: {detail}",
    no_probes: "No probes configured yet.",
    card_website: "Limooo Website",
    card_d1: "Limooo D1 Health Check",
    card_status: "Edge Static Assets",

    err_title: "Status data is temporarily unavailable",
    err_text: "Could not read probe data from the database. Please try again later.",
    err_retry: "Retry",
    notfound_title: "Page not found",
    notfound_text: "There is nothing at this address on the status page.",
    back_status: "Status page",
    back_home: "Go to limooo.cn",

    nav_home: "Home",
    nav_services: "Services",
    nav_contact: "Contact",
    nav_menu_aria: "Menu",
    lang_aria: "Switch language",
    theme_aria: "Toggle theme",
    visit_bilibili: "Visit Bilibili",
    footer_rights: "All rights reserved",
    footer_source: "AGPL-3.0",
    footer_source_link: "Source",

    err_ok: "Probe is healthy",
    err_no_data: "No probe record yet",
    err_unexpected_result: "Probe returned an unexpected result",
    err_missing_target: "Probe has no target configured",
    err_d1_error: "Database query failed",
    err_fetch_error: "Cannot reach the target (network error)",
    err_fetch_timeout: "Request timed out before the target answered",
    err_unknown_code: "Unknown error ({code})",
    http_200: "Request succeeded (HTTP 200)",
    http_400: "Invalid request (HTTP 400)",
    http_401: "Authentication required (HTTP 401)",
    http_403: "Access denied (HTTP 403)",
    http_404: "Resource not found (HTTP 404)",
    http_405: "Method not allowed (HTTP 405)",
    http_408: "Request timed out (HTTP 408)",
    http_409: "Request conflict (HTTP 409)",
    http_410: "Resource gone (HTTP 410)",
    http_429: "Too many requests (HTTP 429)",
    http_451: "Unavailable for legal reasons (HTTP 451)",
    http_500: "Internal server error (HTTP 500)",
    http_501: "Not implemented (HTTP 501)",
    http_502: "Bad gateway (HTTP 502)",
    http_503: "Service unavailable (HTTP 503)",
    http_504: "Gateway timed out (HTTP 504)",
    http_505: "HTTP version not supported (HTTP 505)",
    http_520: "Origin returned an unknown error (HTTP 520)",
    http_521: "Origin is down (HTTP 521)",
    http_522: "Connection to origin timed out (HTTP 522)",
    http_523: "Origin is unreachable (HTTP 523)",
    http_524: "Origin response timed out (HTTP 524)",
    http_525: "SSL handshake failed (HTTP 525)",
    http_526: "Invalid SSL certificate (HTTP 526)",
    http_530: "Origin DNS resolution failed (HTTP 530)",
    http_other: "Service returned HTTP {code}",
  },
  "ja-jp": {
    title: "システムステータス",
    sub: "Limooo 各サービスのリアルタイム稼働状況。",
    overall_all: "すべてのシステム正常稼働",
    overall_partial: "一部システムに問題",
    overall_down: "システム停止中",
    up: "稼働中",
    down: "停止中",
    pending: "確認中",
    group_public: "公開サービス",
    group_internal: "内部サービス",
    uptime: "7 日間の稼働率",
    updated: "最終更新",
    refresh: "自動更新",
    note: "データソース：limooo-status Worker · Cloudflare D1",
    reason_line: "理由：{detail}",
    no_probes: "プローブが未設定です。",
    card_website: "Limooo ウェブサイト",
    card_d1: "Limooo D1 ヘルスチェック",
    card_status: "エッジ静的アセット",

    err_title: "ステータスデータを一時的に取得できません",
    err_text: "データベースからプローブデータを読み取れませんでした。しばらくしてから再度お試しください。",
    err_retry: "再試行",
    notfound_title: "ページが見つかりません",
    notfound_text: "このアドレスに該当するページはありません。",
    back_status: "ステータスページ",
    back_home: "limooo.cn へ",

    nav_home: "ホーム",
    nav_services: "サービス",
    nav_contact: "お問い合わせ",
    nav_menu_aria: "メニュー",
    lang_aria: "言語切替",
    theme_aria: "テーマ切替",
    visit_bilibili: "Bilibili を見る",
    footer_rights: "すべての権利を保有",
    footer_source: "AGPL-3.0",
    footer_source_link: "ソースコード",

    err_ok: "プローブは正常です",
    err_no_data: "プローブ記録がありません",
    err_unexpected_result: "プローブが想定外の結果を返しました",
    err_missing_target: "プローブにターゲットが設定されていません",
    err_d1_error: "データベースクエリに失敗しました",
    err_fetch_error: "ターゲットに接続できません（ネットワークエラー）",
    err_fetch_timeout: "制限時間内に応答がありませんでした（タイムアウト）",
    err_unknown_code: "不明なエラー（{code}）",
    http_200: "リクエスト成功（HTTP 200）",
    http_400: "リクエストが不正です（HTTP 400）",
    http_401: "認証が必要です（HTTP 401）",
    http_403: "アクセスが拒否されました（HTTP 403）",
    http_404: "リソースが見つかりません（HTTP 404）",
    http_405: "許可されていないメソッドです（HTTP 405）",
    http_408: "リクエストがタイムアウトしました（HTTP 408）",
    http_409: "リクエストが競合しました（HTTP 409）",
    http_410: "リソースは削除済みです（HTTP 410）",
    http_429: "リクエストが多すぎます（HTTP 429）",
    http_451: "法的理由により利用できません（HTTP 451）",
    http_500: "サーバー内部エラー（HTTP 500）",
    http_501: "未実装です（HTTP 501）",
    http_502: "ゲートウェイエラー（HTTP 502）",
    http_503: "サービス利用不可（HTTP 503）",
    http_504: "ゲートウェイタイムアウト（HTTP 504）",
    http_505: "HTTP バージョンが非対応です（HTTP 505）",
    http_520: "オリジンが不明なエラーを返しました（HTTP 520）",
    http_521: "オリジンがダウンしています（HTTP 521）",
    http_522: "オリジンへの接続がタイムアウトしました（HTTP 522）",
    http_523: "オリジンに到達できません（HTTP 523）",
    http_524: "オリジンの応答がタイムアウトしました（HTTP 524）",
    http_525: "SSL ハンドシェイクに失敗しました（HTTP 525）",
    http_526: "SSL 証明書が無効です（HTTP 526）",
    http_530: "オリジンの DNS 解決に失敗しました（HTTP 530）",
    http_other: "サービスが HTTP {code} を返しました",
  },
  "ko-kr": {
    title: "시스템 상태",
    sub: "Limooo 서비스의 실시간 가용성.",
    overall_all: "모든 시스템 정상 작동",
    overall_partial: "일부 시스템 문제",
    overall_down: "시스템 중단",
    up: "정상 운영",
    down: "중단",
    pending: "확인 중",
    group_public: "공개 서비스",
    group_internal: "내부 서비스",
    uptime: "7일 가동률",
    updated: "마지막 업데이트",
    refresh: "자동 새로고침",
    note: "데이터 출처: limooo-status Worker · Cloudflare D1",
    reason_line: "원인: {detail}",
    no_probes: "구성된 프로브가 없습니다.",
    card_website: "Limooo 웹사이트",
    card_d1: "Limooo D1 상태 확인",
    card_status: "엣지 정적 자산",

    err_title: "상태 데이터를 일시적으로 사용할 수 없습니다",
    err_text: "데이터베이스에서 프로브 데이터를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
    err_retry: "다시 시도",
    notfound_title: "페이지를 찾을 수 없습니다",
    notfound_text: "이 주소에 해당하는 상태 페이지 내용이 없습니다.",
    back_status: "상태 페이지",
    back_home: "limooo.cn으로",

    nav_home: "홈",
    nav_services: "서비스",
    nav_contact: "문의",
    nav_menu_aria: "메뉴",
    lang_aria: "언어 전환",
    theme_aria: "테마 전환",
    visit_bilibili: "빌리빌리 방문",
    footer_rights: "모든 권리 보유",
    footer_source: "AGPL-3.0",
    footer_source_link: "소스 코드",

    err_ok: "프로브 정상",
    err_no_data: "프로브 기록이 없습니다",
    err_unexpected_result: "프로브가 예상치 못한 결과를 반환했습니다",
    err_missing_target: "프로브에 대상이 설정되어 있지 않습니다",
    err_d1_error: "데이터베이스 쿼리에 실패했습니다",
    err_fetch_error: "대상에 연결할 수 없습니다 (네트워크 오류)",
    err_fetch_timeout: "제한 시간 안에 응답이 없었습니다 (시간 초과)",
    err_unknown_code: "알 수 없는 오류 ({code})",
    http_200: "요청 성공 (HTTP 200)",
    http_400: "잘못된 요청입니다 (HTTP 400)",
    http_401: "인증이 필요합니다 (HTTP 401)",
    http_403: "접근이 거부되었습니다 (HTTP 403)",
    http_404: "리소스를 찾을 수 없습니다 (HTTP 404)",
    http_405: "허용되지 않은 메서드입니다 (HTTP 405)",
    http_408: "요청 시간이 초과되었습니다 (HTTP 408)",
    http_409: "요청이 충돌했습니다 (HTTP 409)",
    http_410: "리소스가 삭제되었습니다 (HTTP 410)",
    http_429: "요청이 너무 많습니다 (HTTP 429)",
    http_451: "법적 사유로 이용할 수 없습니다 (HTTP 451)",
    http_500: "서버 내부 오류 (HTTP 500)",
    http_501: "구현되지 않았습니다 (HTTP 501)",
    http_502: "게이트웨이 오류 (HTTP 502)",
    http_503: "서비스를 사용할 수 없습니다 (HTTP 503)",
    http_504: "게이트웨이 시간 초과 (HTTP 504)",
    http_505: "지원하지 않는 HTTP 버전입니다 (HTTP 505)",
    http_520: "오리진이 알 수 없는 오류를 반환했습니다 (HTTP 520)",
    http_521: "오리진이 다운되었습니다 (HTTP 521)",
    http_522: "오리진 연결 시간이 초과되었습니다 (HTTP 522)",
    http_523: "오리진에 연결할 수 없습니다 (HTTP 523)",
    http_524: "오리진 응답 시간이 초과되었습니다 (HTTP 524)",
    http_525: "SSL 핸드셰이크 실패 (HTTP 525)",
    http_526: "SSL 인증서가 유효하지 않습니다 (HTTP 526)",
    http_530: "오리진 DNS 조회에 실패했습니다 (HTTP 530)",
    http_other: "서비스가 HTTP {code}를 반환했습니다",
  },
};

/** Get copy for a key guaranteed by the `UiKey` union; `{param}` placeholders use `fmt()`. */
export function t(lang: Lang, key: UiKey, params?: Record<string, string>): string {
  const table = UI[lang] ?? UI[DEFAULT_LANG];
  const text = table[key] ?? UI[DEFAULT_LANG][key];
  return params ? fmt(text, params) : text;
}

/**
 * Map an error code to a localized description. **The only error-copy entry point for the public page.**
 *
 * `http_<code>` handles any three-digit status. Known codes use a complete table entry (for
 * example, 503 maps to "Service Unavailable"); unknown codes use the `http_other` template with
 * the code inserted, so an unfamiliar status never exposes its raw English text. Unknown
 * non-HTTP codes use `err_unknown_code` and display the code for troubleshooting.
 */
export function probeDetail(code: string, lang: Lang): string {
  const table = UI[lang] ?? UI[DEFAULT_LANG];
  const http = /^http_(\d{3})$/.exec(code);
  if (http) {
    const key = `http_${http[1]}` as UiKey;
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    return fmt(table.http_other, { code: http[1] });
  }
  const key = `err_${code}` as UiKey;
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
  return fmt(table.err_unknown_code, { code: code || "unknown" });
}

/**
 * One line for alert emails and logs: translate the message and **preserve raw exception text**.
 *
 * Unlike the public page, email goes to operators, who need details such as
 * `d1_error: Error: D1_ERROR: no such table: probes` for troubleshooting. Append the raw text
 * only when it adds information beyond the code (in the form `code: details`); do not repeat
 * codes such as `http_503`.
 */
export function alertDetail(msg: string | null | undefined, lang: Lang): string {
  const raw = (msg ?? "").trim();
  const code = msgCode(raw);
  const text = probeDetail(code, lang);
  const hasDetail = raw.includes(":") && raw !== code;
  return hasDetail ? `${text} — ${raw}` : text;
}
