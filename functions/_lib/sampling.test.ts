/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Direct tests for the centralized diagnostic sampling policy: per-event
 * declarations, keep-first windows, source isolation, entry-cap eviction, the
 * expired-window sweep, suppression summaries, and audit-event protection.
 * No D1 or network access: summary lines are captured from console.log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUDIT_EVENTS,
  SAMPLING_POLICIES,
  resetDiagnosticSampling,
  shouldLogDiagnostic,
} from "./sampling";

type JsonLine = Record<string, unknown>;

const POLICY_KEYS = [
  "block_match",
  "gate_bypass",
  "gate_bypass_crawler",
  "gate_entry",
  "gate_redirect",
  "gate_stale_cookie",
  "gate_verify",
  "gate_verify_invalid_form",
  "login_start",
  "logout",
  "rate_limit",
];

const KEY_KINDS = ["ip", "normalized_ip", "ip_and_crawler_token"];

function parseLines(calls: readonly unknown[][]): JsonLine[] {
  return calls
    .map((call) => {
      try {
        const parsed: unknown = JSON.parse(String(call[0]));
        return parsed && typeof parsed === "object" ? (parsed as JsonLine) : null;
      } catch {
        return null;
      }
    })
    .filter((line): line is JsonLine => line !== null);
}

function summaries(spy: { mock: { calls: unknown[][] } }): JsonLine[] {
  return parseLines(spy.mock.calls).filter((line) => line.outcome === "suppressed");
}

type Spy = { mock: { calls: unknown[][] }; mockClear(): void };

let logSpy: Spy;
let errorSpy: Spy;

beforeEach(() => {
  resetDiagnosticSampling();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sampling policy table", () => {
  it("declares every diagnostic event once with explicit defaults", () => {
    expect(Object.keys(SAMPLING_POLICIES).sort()).toEqual([...POLICY_KEYS].sort());
    for (const [kind, policy] of Object.entries(SAMPLING_POLICIES)) {
      expect(policy.event, `${kind}.event`).toMatch(/^[a-z_]+$/);
      expect(KEY_KINDS, `${kind}.keyKind`).toContain(policy.keyKind);
      expect(policy.windowMs, `${kind}.windowMs`).toBe(60_000);
      expect(policy.keepFirst, `${kind}.keepFirst`).toBe(true);
      expect(policy.maxEntries, `${kind}.maxEntries`).toBe(512);
    }
    // Two throttle dimensions may share one emitted event name.
    expect(SAMPLING_POLICIES.gate_bypass_crawler.event).toBe("gate_bypass");
    expect(SAMPLING_POLICIES.gate_verify_invalid_form.event).toBe("gate_verify");
  });

  it("never declares an audit event as a diagnostic", () => {
    for (const name of AUDIT_EVENTS) {
      expect(SAMPLING_POLICIES).not.toHaveProperty(name);
    }
  });
});

describe("keep-first windows", () => {
  it("keeps the first event per source and resumes after the window", () => {
    const now = 1_000_000;
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now)).toBe(true);
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now + 1_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now + 59_999)).toBe(false);
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now + 60_000)).toBe(true);
  });

  it("isolates sources and events inside the same window", () => {
    const now = 1_000_000;
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now)).toBe(true);
    expect(shouldLogDiagnostic("gate_redirect", "203.0.113.9", now + 1_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_redirect", "198.51.100.7", now + 1_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_stale_cookie", "203.0.113.9", now + 1_000)).toBe(true);
  });

  it("collapses a missing source key to one shared anon window", () => {
    const now = 1_000_000;
    expect(shouldLogDiagnostic("gate_verify", "", now)).toBe(true);
    expect(shouldLogDiagnostic("gate_verify", "", now + 1_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_verify", "anon", now + 2_000)).toBe(false);
  });

  it("treats a clock that moved backwards as a new window", () => {
    expect(shouldLogDiagnostic("gate_entry", "203.0.113.9", 1_000_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_entry", "203.0.113.9", 999_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_entry", "203.0.113.9", 1_001_000)).toBe(false);
  });
});

describe("suppression counters", () => {
  it("reports the window-end count with the event and throttle dimension", () => {
    const now = 1_000_000;
    expect(shouldLogDiagnostic("gate_verify_invalid_form", "203.0.113.9", now)).toBe(true);
    expect(shouldLogDiagnostic("gate_verify_invalid_form", "203.0.113.9", now + 1_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_verify_invalid_form", "203.0.113.9", now + 2_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_verify_invalid_form", "203.0.113.9", now + 3_000)).toBe(false);
    expect(shouldLogDiagnostic("gate_verify_invalid_form", "203.0.113.9", now + 60_000)).toBe(true);

    const lines = summaries(logSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "gate_verify",
      diagnostic: "gate_verify_invalid_form",
      outcome: "suppressed",
      suppressed: 3,
      window_ms: 60_000,
      key_kind: "ip",
      reason: "window_end",
    });
    // The throttle key (a full IP here) must never reach the log line.
    expect(JSON.stringify(lines)).not.toContain("203.0.113.9");
  });

  it("reports every thousand suppressions inside one open window", () => {
    const now = 1_000_000;
    expect(shouldLogDiagnostic("gate_bypass", "203.0.113.9", now)).toBe(true);
    for (let i = 0; i < 1_000; i++) {
      expect(shouldLogDiagnostic("gate_bypass", "203.0.113.9", now + 1)).toBe(false);
    }
    let lines = summaries(logSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "gate_bypass", suppressed: 1_000, reason: "interval" });

    expect(shouldLogDiagnostic("gate_bypass", "203.0.113.9", now + 2)).toBe(false);
    expect(summaries(logSpy)).toHaveLength(1);

    expect(shouldLogDiagnostic("gate_bypass", "203.0.113.9", now + 60_000)).toBe(true);
    lines = summaries(logSpy);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ event: "gate_bypass", suppressed: 1, reason: "window_end" });
  });
});

describe("entry cap", () => {
  it("evicts the oldest source without wiping the map", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 512; i++) {
      expect(shouldLogDiagnostic("gate_redirect", `source-${i}`, t0)).toBe(true);
    }
    // The map is full; a new source evicts the oldest window instead of clearing all.
    expect(shouldLogDiagnostic("gate_redirect", "extra", t0 + 1_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_redirect", "source-0", t0 + 2_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_redirect", "source-500", t0 + 2_000)).toBe(false);

    // A source seen later must survive when still-active neighbours age out.
    expect(shouldLogDiagnostic("gate_redirect", "normal", t0 + 2_000)).toBe(true);
    for (let i = 0; i < 100; i++) {
      expect(shouldLogDiagnostic("gate_redirect", `later-${i}`, t0 + 2_000)).toBe(true);
    }
    expect(shouldLogDiagnostic("gate_redirect", "normal", t0 + 3_000)).toBe(false);
  });

  it("prunes expired windows under cap pressure without flooding summaries", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 512; i++) {
      expect(shouldLogDiagnostic("gate_entry", `source-${i}`, t0)).toBe(true);
    }
    expect(shouldLogDiagnostic("gate_entry", "after-window", t0 + 60_001)).toBe(true);
    expect(summaries(logSpy)).toHaveLength(0);
    expect(shouldLogDiagnostic("gate_entry", "after-window", t0 + 60_002)).toBe(false);
  });
});

describe("expired windows", () => {
  it("reports a burst that ended without the source being seen again", () => {
    const start = 1_000_000;
    for (const source of ["source-a", "source-b"]) {
      expect(shouldLogDiagnostic("gate_verify", source, start)).toBe(true);
      expect(shouldLogDiagnostic("gate_verify", source, start + 100)).toBe(false);
      expect(shouldLogDiagnostic("gate_verify", source, start + 200)).toBe(false);
    }

    // The sweep is amortized over 64 calls; the 64th call happens after the window
    // ended, so the two expired windows are reported together and then dropped.
    const afterWindow = start + 60_000;
    for (let i = 0; i < 58; i++) {
      expect(shouldLogDiagnostic("gate_verify", `filler-${i}`, afterWindow)).toBe(true);
    }

    const lines = summaries(logSpy).filter((line) => line.reason === "expired");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      event: "gate_verify",
      diagnostic: "gate_verify",
      suppressed: 4,
      windows: 2,
      window_ms: 60_000,
    });
    expect(shouldLogDiagnostic("gate_verify", "source-a", afterWindow)).toBe(true);
  });
});

describe("audit protection", () => {
  it("forces every audit event through without sampling it", () => {
    for (const name of AUDIT_EVENTS) {
      resetDiagnosticSampling();
      errorSpy.mockClear();
      expect(shouldLogDiagnostic(name as never, "203.0.113.9", 1_000_000)).toBe(true);
      expect(shouldLogDiagnostic(name as never, "203.0.113.9", 1_000_001)).toBe(true);
      const violations = parseLines(errorSpy.mock.calls).filter(
        (line) => line.event === "sampling_policy_violation",
      );
      expect(violations).toHaveLength(2);
      expect(violations[0]).toMatchObject({
        diagnostic: name,
        outcome: "audit_event_not_sampled",
      });
    }
  });

  it("rejects an audit name even if it is added to the policy table", () => {
    const policies = SAMPLING_POLICIES as unknown as Record<string, unknown>;
    policies.login_attempt = {
      event: "login_attempt",
      keyKind: "ip",
      windowMs: 60_000,
      keepFirst: true,
      maxEntries: 512,
    };
    try {
      expect(shouldLogDiagnostic("login_attempt" as never, "203.0.113.9", 1_000_000)).toBe(true);
      expect(shouldLogDiagnostic("login_attempt" as never, "203.0.113.9", 1_000_001)).toBe(true);
    } finally {
      delete policies.login_attempt;
    }
    const violation = parseLines(errorSpy.mock.calls).find(
      (line) => line.event === "sampling_policy_violation",
    );
    expect(violation).toMatchObject({ diagnostic: "login_attempt", outcome: "audit_event_not_sampled" });
  });

  it("forces an unknown event name through and reports the typo", () => {
    expect(shouldLogDiagnostic("gate_redirct" as never, "203.0.113.9", 1_000_000)).toBe(true);
    expect(shouldLogDiagnostic("gate_redirct" as never, "203.0.113.9", 1_000_001)).toBe(true);
    const violation = parseLines(errorSpy.mock.calls).find(
      (line) => line.event === "sampling_policy_violation",
    );
    expect(violation).toMatchObject({
      diagnostic: "gate_redirct",
      outcome: "unknown_event_not_sampled",
    });
  });
});
