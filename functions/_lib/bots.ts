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
 * Match crawler and AI tool user agents (2026-10-12).
 *
 * The site-owned `docs/lists/robots.txt` is the source list. Its crawler rules
 * are published at `/robots.txt`; the builder adds a contract-generated
 * Sitemap line. `ops/check_gate_trust.py --emit` lowercases each **explicit**
 * `User-agent:` entry except `*` and writes it to
 * `functions/_data/gateTrust.ts` as `GATE_TRUST_CRAWLER_UAS`. This module only
 * matches against that list.
 *
 * Adding a User-agent to robots.txt now updates both crawler rules and the gate
 * allowlist, so they cannot drift apart. Before 2026-10-12 they lived in
 * crawlers.txt and hardcoded builder text.
 *
 * This trust layer **only bypasses human verification**; it does not make the source trusted.
 *
 * User agents are self-reported; anyone can claim to be `GPTBot`. A matching
 * request therefore:
 *   * Does not set `sourceTrusted`; middleware still checks `blocked_ips`.
 *   * Does not receive a `__gate` cookie, so a self-reported identity cannot
 *     obtain a reusable signed cookie.
 *   * Is not counted in visitor statistics.
 * The only identity checks that cannot be self-reported are Cloudflare
 * verified bots (`request.cf.botManagement.verifiedBot`; see isTrustedCrawler
 * in tracking.ts) and the IP allowlist (docs/lists/own-ips.txt).
 */

import { GATE_TRUST, GATE_TRUST_CRAWLER_UAS } from "../_data/gateTrust";

/**
 * Maximum user-agent prefix length considered for matching.
 *
 * User-Agent headers have no length limit, and the visitor contract in README
 * makes no promise otherwise. The list has nearly 100 substring matches.
 * Truncating to 512 characters covers real user agents (the longest browser
 * user agents are under 200 characters) and prevents oversized values from
 * slowing every unverified request.
 */
export const CRAWLER_UA_MAX_LENGTH = 512;

/**
 * Return the matched lowercase fragment, or an empty string when there is no match.
 *
 * Return the fragment instead of a boolean so logs can show which entry
 * allowed the request. The list has nearly 100 entries, and a boolean alone
 * cannot explain why a user agent matched.
 *
 * Contract switch: when `GATE_TRUST.ua_allowlist_enabled` is false, the entire
 * list is disabled (`gate_trust.ua_allowlist_enabled` in
 * config-contract.json). Production issues can then be handled by changing
 * the contract without deleting the list.
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

/** Whether a crawler user agent matched; this means only that it bypasses verification (see the file header). */
export function isDeclaredCrawler(request: Request): boolean {
  return declaredCrawlerToken(request) !== "";
}
