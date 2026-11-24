/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * `functions/_data/gateTrust.ts` should contain only fields consumed at runtime.
 *
 * Full-trust ASN entries remain confined to the manual zone-level Access Rule script. Only the
 * separate challenge-only ASN list is sent to the isolate.
 */

import { describe, expect, it } from "vitest";
import {
  GATE_TRUST,
  GATE_TRUST_CHALLENGE_BYPASS_ASNS,
  GATE_TRUST_IPS,
  GATE_TRUST_NETWORKS,
} from "./gateTrust";

describe("gateTrust runtime payload", () => {
  it("only carries what the runtime reads", () => {
    expect(Object.keys(GATE_TRUST).sort()).toEqual([
      "challenge_bypass_asns",
      "ip_cidrs",
      "ua_allowlist_enabled",
      "verified_bot",
    ]);
  });

  it("carries only the challenge-only ASN list", () => {
    expect(GATE_TRUST_CHALLENGE_BYPASS_ASNS).toEqual(new Set(GATE_TRUST.challenge_bypass_asns));
    expect(GATE_TRUST.challenge_bypass_asns).toContain(4134);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(4809);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(4837);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(9929);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(9808);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(24400);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(4538);
    expect(GATE_TRUST.challenge_bypass_asns).toContain(23910);
  });

  it("keeps the fully allowed IPs usable", () => {
    expect(GATE_TRUST_IPS.size).toBe(GATE_TRUST_NETWORKS.length);
    expect(GATE_TRUST_IPS.size).toBeGreaterThan(0);
    for (const ip of GATE_TRUST_IPS) {
      expect(typeof ip).toBe("string");
      expect(ip.length).toBeGreaterThan(0);
    }
    for (const [network, prefix] of GATE_TRUST_NETWORKS) {
      expect(GATE_TRUST_IPS.has(network)).toBe(true);
      expect(Number.isInteger(prefix)).toBe(true);
    }
  });
});
