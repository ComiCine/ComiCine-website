/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * tasks/22 W4-4: `functions/_data/gateTrust.ts` should contain only fields consumed at runtime.
 *
 * ASN entries are not part of the runtime payload; only `GATE_TRUST.verified_bot`, `GATE_TRUST_IPS`,
 * and `GATE_TRUST_NETWORKS` are read at runtime. ASN data is consumed only by the manually run
 * zone-level Access Rule script. This test locks down the generated contract and fails if ASN data
 * is added back to the isolate.
 */

import { describe, expect, it } from "vitest";
import { GATE_TRUST, GATE_TRUST_IPS, GATE_TRUST_NETWORKS } from "./gateTrust";

describe("gateTrust runtime payload", () => {
  it("only carries what the runtime reads", () => {
    expect(Object.keys(GATE_TRUST).sort()).toEqual([
      "ip_cidrs",
      "ua_allowlist_enabled",
      "verified_bot",
    ]);
  });

  it("does not carry ASN entries", () => {
    expect("asns" in GATE_TRUST).toBe(false);
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
