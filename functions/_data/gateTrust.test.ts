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
