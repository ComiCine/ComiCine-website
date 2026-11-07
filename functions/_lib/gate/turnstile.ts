/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Turnstile siteverify: idempotent retry plus hostname, action, and cdata validation. */

import { isPublicHost } from "../routing";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 3000;
/**
 * Retry once, and only for failures that may clear on a second attempt.
 *
 * Turnstile tokens are single-use, but siteverify replays the first result for
 * the same idempotency_key, so a transient timeout or 5xx does not force the
 * visitor through another challenge. `success:false`, HTTP 4xx (403/429
 * included), and hostname/action/cdata mismatches are final.
 */
const SITEVERIFY_MAX_ATTEMPTS = 2;
/** 300-500 ms lets a transient edge failure clear without stalling the visitor. */
const SITEVERIFY_RETRY_BACKOFF_MS = 400;

/**
 * Shared action identifier for the gate widget and siteverify response.
 */
export const GATE_TURNSTILE_ACTION = "gate";

type SiteverifyResult =
  | { kind: "response"; response: Response }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "http"; status: number };

/**
 * Derive a UUID-shaped idempotency key from the token.
 *
 * Cloudflare documents the field as a UUID and ignores other shapes, so a bare
 * 32-hex string would silently disable idempotency. Hashing keeps the raw token
 * out of the form, and one token always yields one key, which is what makes the
 * retry safe.
 */
async function siteverifyIdempotencyKey(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(result: SiteverifyResult): boolean {
  return (
    result.kind === "timeout" ||
    result.kind === "network" ||
    (result.kind === "http" && result.status >= 500)
  );
}

/**
 * One siteverify POST.
 *
 * An abort is our own timeout; any other fetch rejection is a network failure.
 * 4xx stays a distinct result so the caller can report the exact status and
 * refuse to retry it.
 */
async function siteverifyAttempt(body: string): Promise<SiteverifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SITEVERIFY_TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (response.ok) return { kind: "response", response };
    return { kind: "http", status: response.status };
  } catch (error) {
    const aborted =
      controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
    return aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call Turnstile siteverify; derive `remoteip` only from `CF-Connecting-IP`.
 *
 * In addition to `success`, require **hostname** to be one of the site's
 * managed hosts (`isPublicHost`, shared with the redirect allowlist). If the
 * same sitekey is used on another domain, tokens solved there may also pass
 * siteverify. Checking only `success` would let the sitekey configuration
 * define who counts as a visitor (tasks/22 W9-16, defense in depth). Reject a
 * missing hostname.
 *
 * The gate widget declares `action: "gate"` (src/static/js/auth.js) and
 * siteverify echoes it; a token minted with a different or missing action is
 * rejected. `expectedCdata` is optional: no front-end sends cdata today, so the
 * echo check stays inactive until a widget supplies it.
 *
 * Exported so tests can verify that visitor-supplied forwarding headers never
 * reach remoteip. `handleVerify` is the only production caller.
 */
export async function verifyTurnstile(
  token: string,
  remoteip: string,
  secret: string,
  diagnostics?: { reason?: string },
  expectedCdata?: string,
): Promise<boolean> {
  const body = new URLSearchParams({
    secret,
    response: token,
    remoteip,
    idempotency_key: await siteverifyIdempotencyKey(token),
  }).toString();

// Reuse the same body for both attempts so the token and idempotency key stay paired.
  let result = await siteverifyAttempt(body);
  for (let attempt = 1; attempt < SITEVERIFY_MAX_ATTEMPTS; attempt++) {
    if (!isRetryable(result)) break;
    await sleep(SITEVERIFY_RETRY_BACKOFF_MS);
    result = await siteverifyAttempt(body);
  }

  if (result.kind === "timeout" || result.kind === "network") {
    if (diagnostics) diagnostics.reason = result.kind;
    throw new Error(`siteverify ${result.kind}`);
  }
  if (result.kind === "http") {
    if (diagnostics) {
      diagnostics.reason = result.status >= 500 ? "http_5xx" : `http_${result.status}`;
    }
    throw new Error(`siteverify HTTP ${result.status}`);
  }

  const data = (await result.response.json()) as {
    success?: boolean;
    hostname?: unknown;
    action?: unknown;
    cdata?: unknown;
    "error-codes"?: unknown;
  };
  if (data.success !== true) {
    const errorCodes = Array.isArray(data["error-codes"])
      ? data["error-codes"].filter(
          (code: unknown): code is string =>
            typeof code === "string" && /^[a-z0-9-]{1,40}$/.test(code),
        ).slice(0, 4)
      : [];
    if (diagnostics) {
      diagnostics.reason = errorCodes.length
        ? `siteverify_${errorCodes.join("_")}`
        : "siteverify_rejected";
    }
    return false;
  }
  const hostname = typeof data.hostname === "string" ? data.hostname : "";
  if (!isPublicHost(hostname)) {
    if (diagnostics) diagnostics.reason = "hostname_rejected";
    return false;
  }
  if (data.action !== GATE_TURNSTILE_ACTION) {
    if (diagnostics) diagnostics.reason = "action_mismatch";
    return false;
  }
  const cdata = expectedCdata ?? "";
  if (cdata !== "" && data.cdata !== cdata) {
    if (diagnostics) diagnostics.reason = "cdata_mismatch";
    return false;
  }
  return true;
}
