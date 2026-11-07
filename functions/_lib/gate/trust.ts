/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate trust decision: allowlist, declared crawler, and __gate cookie state. */

import { GATE_COOKIE } from "../config";
import { allCookieValues } from "../cookies";
import { isGateTrustedIp, type RequestContext } from "../routing";
import { isTrustedCrawler } from "../tracking";
import { declaredCrawlerToken } from "../bots";
import {
  MAX_GATE_COOKIE_VALUES,
  gateValidationKeys,
  readGateCookie,
  type GateCookieReason,
  type GateCookieState,
} from "./cookie";

export interface GateTrustState {
/** Allowlisted IPs and Cloudflare-verified bots already bypass verification and need no cookie. */
  trusted: boolean;
  /**
    * A crawler or AI user agent matches an explicit User-agent in
    * docs/lists/robots.txt and **bypasses human verification only**.
   *
    * Keep this separate from trusted because user agents are self-reported.
    * They must not bypass blocked_ips or receive a __gate cookie (see the
    * header in _lib/bots.ts).
   */
  declaredCrawler: boolean;
/** Matched lowercase user-agent fragment, or an empty string; used only for logs. */
  crawlerToken: string;
/** Whether the request has a valid __gate cookie. */
  cookieValid: boolean;
/** Whether to renew the cookie because it is valid and three quarters of its TTL has elapsed. */
  shouldRenew: boolean;
/** The request has __gate cookies but none are valid; helps diagnose blocks after verification. */
  cookiePresent: boolean;
/** Validation result category. */
  cookieReason: GateCookieReason;
}

/**
 * Validate one __gate value against the rotation keyring.
 *
 * Try the current key first. A cookie signed before a rotation matches only the
 * previous key, so a bad signature there can belong to a valid cookie; keep the
 * previous result when it is valid or more specific (expired, future_issued)
 * so diagnostics report the real reason instead of bad_signature.
 */
async function readGateCookieWithKeyring(
  value: string,
  keys: string[],
): Promise<GateCookieState> {
  let state = await readGateCookie(value, keys[0] ?? "");
  for (const key of keys.slice(1)) {
    if (state.valid) return state;
    const previous = await readGateCookie(value, key);
    if (previous.valid || previous.reason !== "bad_signature") state = previous;
  }
  return state;
}

/**
 * The single implementation of the gate decision.
 *
 * Middleware and /gate must both call this function rather than duplicating
 * the allowlist, crawler, and cookie checks. Similar but separate logic
 * previously caused behavior to drift and made repeated challenges difficult
 * to diagnose.
 *
 * Same-name __gate cookies may coexist across scopes; validate each and allow
 * the request if any one is valid.
 */
export async function resolveGateTrust(
  context: RequestContext,
): Promise<GateTrustState> {
  const { request, env } = context;
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const trusted = isGateTrustedIp(ip) || isTrustedCrawler(request);
// Trusted sources do not need another user-agent match; this only saves work.
// Check other sources against the crawler list. A match bypasses verification,
// but not blocking, and does not receive a cookie.
  const crawlerToken = trusted ? "" : declaredCrawlerToken(request);

  const values = allCookieValues(GATE_COOKIE, request.headers.get("Cookie"));
// Compute the rotation keyring once per request. Only validation sees the
// previous key; handleVerify and gateCookieHeaders stay on GATE_HMAC_KEY alone.
  const validationKeys = gateValidationKeys(env);
  let best: GateCookieState = {
    valid: false,
    present: values.length > 0,
    shouldRenew: false,
    reason: values.length > 0 ? "malformed" : "absent",
  };
// The number of same-name cookies is unbounded, and each requires a regular
// expression plus WebCrypto importKey and sign operations. A 32 KB Cookie
// header can contain about 400 cookies, letting an attacker control per-request
// CPU cost (tasks/22 W9-10). Validate only the first N. Normal visitors have at
// most two (old host-only and new domain cookies), so existing behavior is unchanged.
  for (const value of values.slice(0, MAX_GATE_COOKIE_VALUES)) {
    const state = await readGateCookieWithKeyring(value, validationKeys);
    if (state.valid) {
      best = state;
      break;
    }
    if (state.present) best = state;
  }

  return {
    trusted,
    declaredCrawler: crawlerToken !== "",
    crawlerToken,
    cookieValid: best.valid,
    shouldRenew: best.shouldRenew,
    cookiePresent: best.present,
    cookieReason: best.reason,
  };
}
