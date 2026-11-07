/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Host and path alias tables: identity allowlist, image landing paths, legacy `.html` redirects, and the Feishu mirror. */

import {
  APPLE_ACCOUNT_HOSTNAME,
  BASE_URL,
  IMAGES_HOSTNAME,
  REDIRECT_HOSTNAME,
  ROOT_DOMAIN,
  ROOT_DOMAINS,
  VISITOR_HOSTNAME,
} from "./config";

export const IDENTITY_ALLOWED_PATHS = new Set([
  "/login",
  "/api/identity/exchange",
  // CSP reports raised on the identity login page must reach the same-origin collector.
  // Deliberately not added to EXEMPT_PATH_PREFIXES in _lib/routing.ts, so the blocklist still applies.
  "/api/csp-report",
  "/gate",
  "/gate/verify",
  "/gate/config",
  "/gate/diag",
  "/__gate",
  "/__gate/verify",
  "/__gate/config",
  "/__gate/diag",
]);

export const IMAGE_ASSET_LANDING_PATHS = new Set([
  "/",
  "/index.html",
  "/portfolio",
  "/qr-codes",
  "/icons",
]);

const LEGACY_HTML_HOST_ROOTS = new Map<string, string>();
for (const domain of ROOT_DOMAINS) {
  LEGACY_HTML_HOST_ROOTS.set(domain, `${BASE_URL}/`);
  LEGACY_HTML_HOST_ROOTS.set(`www.${domain}`, `${BASE_URL}/`);
  LEGACY_HTML_HOST_ROOTS.set(`images.${domain}`, `${BASE_URL}/`);
  LEGACY_HTML_HOST_ROOTS.set(`services.${domain}`, `https://services.${ROOT_DOMAIN}/`);
  LEGACY_HTML_HOST_ROOTS.set(`contact.${domain}`, `https://contact.${ROOT_DOMAIN}/`);
  LEGACY_HTML_HOST_ROOTS.set(`visitor.${domain}`, `https://${VISITOR_HOSTNAME}/`);
  LEGACY_HTML_HOST_ROOTS.set(`account.${domain}`, `https://${APPLE_ACCOUNT_HOSTNAME}/`);
}

const LEGACY_HTML_PATH_TARGETS = new Map<string, string>([
  ["www", `${BASE_URL}/`],
  ["images", `${BASE_URL}/`],
  ["portfolio", `${BASE_URL}/portfolio`],
  ["services", `https://services.${ROOT_DOMAIN}/`],
  ["contact", `https://contact.${ROOT_DOMAIN}/`],
  ["visitor", `https://${VISITOR_HOSTNAME}/`],
  // account.<root> serves only /apple; its root is a deliberate 404.
  ["apple-account", `https://${APPLE_ACCOUNT_HOSTNAME}/apple`],
  ["redirect", `https://${REDIRECT_HOSTNAME}/`],
  // This legacy .html alias is separate from docs.comicine.com, whose root is a 404.
  ["docs", `${BASE_URL}/`],
  ["status", `https://status.${ROOT_DOMAIN}/`],
]);

export type LegacyHtmlResolution =
  | { kind: "redirect"; target: string }
  | { kind: "not_found" };

const COMICINE_FEISHU_BASE_URL = "https://comicine.feishu.cn";

export function resolveFeishuPathAlias(pathname: string): string | null {
  const match = pathname.match(/^\/(?:feishu|lark)(\/.*)?$/);
  if (!match) return null;
  return `${COMICINE_FEISHU_BASE_URL}${match[1] || "/"}`;
}

export function isImageAssetHost(hostname: string): boolean {
  return hostname === IMAGES_HOSTNAME || ROOT_DOMAINS.some((domain) => hostname === `images.${domain}`);
}

export function resolveLegacyHtmlAlias(
  hostname: string,
  pathname: string,
): LegacyHtmlResolution | null {
  const hostRoot = LEGACY_HTML_HOST_ROOTS.get(hostname);
  if (!hostRoot) return null;
  const match = pathname.match(/^\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.html$/i);
  if (!match) return null;

  const subdomain = match[1].toLowerCase();
  if (subdomain === "index") return { kind: "redirect", target: hostRoot };
  const target = LEGACY_HTML_PATH_TARGETS.get(subdomain);
  return target ? { kind: "redirect", target } : { kind: "not_found" };
}
