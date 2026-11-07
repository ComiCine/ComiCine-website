/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Central sampling policy for diagnostic events written through logEvent().
 *
 * Attacker-controlled requests (a junk `__gate` cookie, `?challenge=1`, a spoofed
 * crawler User-Agent, a blocked IP, a self-declared crawler hitting `/logout`) would
 * otherwise write one D1 `events` row per request and exhaust the free plan's daily
 * write budget. These events are diagnostics, not billing records: keeping the first
 * event per source per window preserves the signal.
 *
 * Every diagnostic event is declared once per throttle dimension with its window,
 * key dimension, and entry cap, so adding an event cannot silently fall back to one
 * row per request. Two dimensions may share one emitted event name (`gate_bypass`,
 * `gate_verify`); they keep separate windows. Events that are not declared are
 * treated as audit records (blocklist changes, Apple Account actions, login
 * attempts) and are **always** written: the sampler refuses to sample them and logs
 * the policy violation instead.
 *
 * State lives in isolate memory only. Each colo keeps its own copy and cold starts
 * reset it, which is intentional: persisting throttle state to D1 or KV would
 * recreate the write amplification this module exists to prevent.
 *
 * Reading the counters: a window ends when the same source is seen again after
 * `windowMs`, when a periodic sweep drops windows that were never seen again, or
 * every SUPPRESSED_REPORT_EVERY suppressions inside one open window. Each of those
 * events prints one structured console line `{ "event": <emitted event>,
 * "diagnostic": <throttle dimension>, "outcome": "suppressed", "suppressed": N,
 * "window_ms": ..., "key_kind": ..., "reason": "window_end" | "expired" |
 * "interval" }` (`expired` lines also carry the number of `windows` aggregated).
 * It goes to the Pages log only and never calls logEvent(), so a summary line adds
 * no D1 write. The throttle key (IP, crawler token) is never included.
 *
 * Debugging at full fidelity: set the event's `windowMs` to 0 in SAMPLING_POLICIES
 * (a new window opens on every call, so nothing is suppressed), or call logEvent()
 * directly for the event under investigation. Both are code changes on purpose;
 * a runtime flag would need a new Pages Secret and still a deploy.
 */

/**
 * Diagnostic events that may be sampled. The name is the throttle dimension, which
 * is not always the emitted event name: trusted and declared-crawler gate bypasses
 * share the `gate_bypass` event but keep separate windows.
 */
export type DiagnosticEvent =
  | "block_match"
  | "gate_bypass"
  | "gate_bypass_crawler"
  | "gate_entry"
  | "gate_redirect"
  | "gate_stale_cookie"
  | "gate_verify"
  | "gate_verify_invalid_form"
  | "login_start"
  | "logout"
  | "rate_limit";

/**
 * Audit event names. They must never enter SAMPLING_POLICIES: the sampler rejects
 * them by name so a misplaced call still writes every row.
 */
export const AUDIT_EVENTS = ["audit_event", "blocklist_change", "login_attempt"] as const;

/** How the caller derives the throttle key. Recorded in summary lines; the key is never logged. */
export type SamplingKeyKind = "ip" | "normalized_ip" | "ip_and_crawler_token";

export interface SamplingPolicy {
  /** Event name passed to logEvent(); two rows may share one event name. */
  event: string;
  /** Source dimension the caller keys the throttle on; kept for review. */
  keyKind: SamplingKeyKind;
  /** Length of the keep-first window in milliseconds. */
  windowMs: number;
  /** Write the first event of each window. All current rows keep it. */
  keepFirst: boolean;
  /** Maximum distinct sources tracked for this event in one isolate. */
  maxEntries: number;
}

/** Emit a suppression summary every this many suppressions inside one window. */
const SUPPRESSED_REPORT_EVERY = 1_000;

/** One row per diagnostic event. Values are explicit per event so a review can change one. */
export const SAMPLING_POLICIES: Readonly<Record<DiagnosticEvent, SamplingPolicy>> = {
  block_match: {
    event: "block_match",
    keyKind: "normalized_ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_bypass: {
    event: "gate_bypass",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_bypass_crawler: {
    event: "gate_bypass",
    keyKind: "ip_and_crawler_token",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_entry: {
    event: "gate_entry",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_redirect: {
    event: "gate_redirect",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_stale_cookie: {
    event: "gate_stale_cookie",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_verify: {
    event: "gate_verify",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  gate_verify_invalid_form: {
    event: "gate_verify",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  login_start: {
    event: "login_start",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  logout: {
    event: "logout",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
  rate_limit: {
    event: "rate_limit",
    keyKind: "ip",
    windowMs: 60_000,
    keepFirst: true,
    maxEntries: 512,
  },
};

interface SourceWindow {
  /** Start of the current window; insertion order is also the eviction order. */
  firstAt: number;
  /** Suppressions since the last summary line. */
  suppressed: number;
}

const windowsByEvent = new Map<DiagnosticEvent, Map<string, SourceWindow>>();

function policyFor(event: string): SamplingPolicy | undefined {
  if (!Object.prototype.hasOwnProperty.call(SAMPLING_POLICIES, event)) return undefined;
  return (SAMPLING_POLICIES as Record<string, SamplingPolicy>)[event];
}

function windowsFor(event: DiagnosticEvent): Map<string, SourceWindow> {
  const existing = windowsByEvent.get(event);
  if (existing) return existing;
  const created = new Map<string, SourceWindow>();
  windowsByEvent.set(event, created);
  return created;
}

/**
 * Report a diagnostic event that asks to be sampled. Audit and unknown names are
 * forced through: dropping an audit row is worse than one extra D1 write, and the
 * policy violation is visible in the Pages log.
 */
function rejectSampling(event: string, now: number): true {
  const audit = (AUDIT_EVENTS as readonly string[]).includes(event);
  console.error(
    JSON.stringify({
      event: "sampling_policy_violation",
      ts: Math.floor(now / 1000),
      diagnostic: event,
      outcome: audit ? "audit_event_not_sampled" : "unknown_event_not_sampled",
    }),
  );
  return true;
}

type SuppressedReason = "expired" | "interval" | "window_end";

/**
 * Print one suppression summary to the Pages log. Console only: routing this
 * through logEvent() would add a D1 write for the metric itself.
 *
 * `event` is the emitted event name while `diagnostic` names the throttle
 * dimension, so `gate_verify_invalid_form` summaries stay distinguishable from
 * `gate_verify` ones even though both emit `gate_verify` rows.
 */
function reportSuppressed(
  event: DiagnosticEvent,
  policy: SamplingPolicy,
  suppressed: number,
  now: number,
  reason: SuppressedReason,
  windows?: number,
): void {
  if (suppressed <= 0) return;
  console.log(
    JSON.stringify({
      event: policy.event,
      diagnostic: event,
      ts: Math.floor(now / 1000),
      outcome: "suppressed",
      suppressed,
      window_ms: policy.windowMs,
      key_kind: policy.keyKind,
      reason,
      ...(windows !== undefined ? { windows } : {}),
    }),
  );
}

/**
 * Keep one event map under its entry cap: prune expired windows first, then evict
 * the oldest source. Pruning drops a remaining unreported count on purpose; a
 * scanner with more sources than the cap would otherwise emit one summary line per
 * source inside a single request, and per-source counts are near zero in that case.
 */
function makeRoom(
  windows: Map<string, SourceWindow>,
  policy: SamplingPolicy,
  now: number,
): void {
  if (windows.size < policy.maxEntries) return;
  for (const [source, entry] of windows) {
    if (now - entry.firstAt >= policy.windowMs) windows.delete(source);
  }
  while (windows.size >= policy.maxEntries) {
    const oldest = windows.keys().next().value;
    if (oldest === undefined) break;
    windows.delete(oldest);
  }
}

/** Amortize an expired-window sweep across this many sampler calls. */
const SWEEP_EVERY_CALLS = 64;
let callsSinceSweep = 0;

/**
 * Report and drop windows whose period ended before the source was seen again.
 *
 * Without the sweep, a scanner that stops after a burst would keep its suppressed
 * count in memory until the isolate is recycled, so the tail of the burst would
 * never be visible. Sweeping every SWEEP_EVERY_CALLS calls keeps the cost
 * amortized (the map is bounded by the sum of the per-event caps) and emits at most
 * one summary per event instead of one per expired source.
 */
function sweepExpired(now: number): void {
  for (const [event, windows] of windowsByEvent) {
    const policy = SAMPLING_POLICIES[event];
    let suppressed = 0;
    let expired = 0;
    for (const [source, entry] of windows) {
      if (now - entry.firstAt < policy.windowMs) continue;
      if (entry.suppressed > 0) {
        suppressed += entry.suppressed;
        expired += 1;
      }
      windows.delete(source);
    }
    if (suppressed > 0) reportSuppressed(event, policy, suppressed, now, "expired", expired);
  }
}

function maybeSweepExpired(now: number): void {
  callsSinceSweep += 1;
  if (callsSinceSweep < SWEEP_EVERY_CALLS) return;
  callsSinceSweep = 0;
  sweepExpired(now);
}

/**
 * Decide whether a diagnostic event should be written now.
 *
 * Returns true for the first event of each source window (when the policy keeps the
 * first), false while the same source is inside an open window, and true for every
 * call whose event is not in SAMPLING_POLICIES. Callers pass the source they
 * throttle on (IP, normalized IP, or IP plus crawler token); an empty key is
 * collapsed to `anon` so a missing CF-Connecting-IP cannot disable the throttle.
 */
export function shouldLogDiagnostic(
  event: DiagnosticEvent,
  key: string,
  now = Date.now(),
): boolean {
  // Check audit names before the policy table. If someone ever adds `login_attempt`
  // or another audit event to SAMPLING_POLICIES, this branch still refuses to sample
  // it instead of trusting the table.
  if ((AUDIT_EVENTS as readonly string[]).includes(event)) return rejectSampling(event, now);

  const policy = policyFor(event);
  if (!policy) return rejectSampling(event, now);

  maybeSweepExpired(now);

  const source = key || "anon";
  const windows = windowsFor(event);
  const open = windows.get(source);

  if (open) {
    const elapsed = now - open.firstAt;
    // A negative elapsed time means the clock moved backwards; treat the window as
    // over so a skewed clock cannot suppress the source indefinitely.
    if (elapsed >= 0 && elapsed < policy.windowMs) {
      open.suppressed += 1;
      if (open.suppressed >= SUPPRESSED_REPORT_EVERY) {
        reportSuppressed(event, policy, open.suppressed, now, "interval");
        open.suppressed = 0;
      }
      return false;
    }
    reportSuppressed(event, policy, open.suppressed, now, "window_end");
    windows.delete(source);
  }

  makeRoom(windows, policy, now);
  windows.set(source, { firstAt: now, suppressed: 0 });
  return policy.keepFirst;
}

/** Test hook: clear all process-local windows and the sweep counter. */
export function resetDiagnosticSampling(): void {
  windowsByEvent.clear();
  callsSinceSweep = 0;
}
