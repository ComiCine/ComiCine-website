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
 * 爬虫 / AI 工具的 UA 名单判定（2026-10-12）。
 *
 * 名单本体就是站点自己的 `docs/lists/robots.txt`（同一份文件原样发布到
 * `/robots.txt`）：`ops/check_gate_trust.py --emit` 把其中每条**显式**
 * `User-agent:`（`*` 除外）转小写后生成到 `functions/_data/gateTrust.ts` 的
 * `GATE_TRUST_CRAWLER_UAS`，这里只做匹配。
 *
 * 因此「往 robots.txt 加一个 User-agent」= 同时放宽抓取规则与门禁；两者再也
 * 不会各写一份、改漏一边（2026-10-12 之前是 crawlers.txt + 构建器里的手写文本）。
 *
 * ## 这一层信任**只免人机验证**，不等于「已信任来源」
 *
 * UA 是访客自报的：任何人都能把它写成 `GPTBot`。因此命中名单的请求：
 *   * 不参与 `sourceTrusted`（中间件照样做 `blocked_ips` 封禁检查）；
 *   * 不签发 `__gate` cookie（不给自报者换一枚可长期复用的签名 cookie）；
 *   * 不计入访客统计。
 * 真正不可自报的身份判定只有两处：Cloudflare verified bot
 * （`request.cf.botManagement.verifiedBot`，见 tracking.ts 的 isTrustedCrawler）
 * 与 IP 白名单（docs/lists/own-ips.txt）。
 */

import { GATE_TRUST, GATE_TRUST_CRAWLER_UAS } from "../_data/gateTrust";

/**
 * 参与匹配的 UA 前缀长度上限。
 *
 * User-Agent 头没有长度上限（README 的访客约定里也没人保证这一点），而名单是
 * 近百条子串匹配：截断到 512 字符既能覆盖真实 UA（最长的浏览器 UA 也不到
 * 200 字符），又让「超长 UA 拖慢每个未验证请求」不成立。
 */
export const CRAWLER_UA_MAX_LENGTH = 512;

/**
 * 命中名单时返回命中的片段（已小写），否则返回空串。
 *
 * 返回片段而不是布尔值是为了日志能写清「按哪一条放行的」——名单有近百条，
 * 排查「为什么这个 UA 进来了」时只有布尔值是不够的。
 *
 * 契约开关：`GATE_TRUST.ua_allowlist_enabled` 为 false 时整份名单不生效
 * （config-contract.json 的 `gate_trust.ua_allowlist_enabled`），这样线上
 * 出问题可以只改契约、不必删名单。
 */
export function declaredCrawlerToken(request: Request): string {
  if (GATE_TRUST.ua_allowlist_enabled !== true) return "";
  const userAgent = request.headers.get("User-Agent");
  if (!userAgent) return "";
  const value = userAgent.slice(0, CRAWLER_UA_MAX_LENGTH).toLowerCase();
  for (const token of GATE_TRUST_CRAWLER_UAS) {
    if (value.includes(token)) return token;
  }
  return "";
}

/** 是否命中爬虫 UA 名单（只表示「免人机验证」，见文件头）。 */
export function isDeclaredCrawler(request: Request): boolean {
  return declaredCrawlerToken(request) !== "";
}
