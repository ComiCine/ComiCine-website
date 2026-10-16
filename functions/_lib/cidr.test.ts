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

/** IPv4/IPv6 normalization and matching tests (tasks/10). */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalCidr,
  contains,
  networkAddress,
  normalizeIp,
  parseCidr,
} from "./cidr";

/**
 * Shared consistency vectors for the TypeScript `functions/_lib/cidr.ts` and
 * Python `src/cidr.py` implementations.
 *
 * `expected_*` values come from CPython `ipaddress`. The blocklist compares
 * `blocked_ips(network, prefix)` using **string equality**, so any
 * normalization mismatch means Python-written rows will never match the
 * Worker candidate and blocking silently fails open.
 */
const PARITY = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../tests/fixtures/cidr_parity.json", import.meta.url)),
    "utf8",
  ),
) as {
  normalize: Array<{ input: string; expected: string }>;
  cidr: Array<{ input: string; expected_network: string; expected_prefix: number }>;
};

describe("cidr", () => {
  it("normalizes IPv4 and IPv6 addresses", () => {
    expect(normalizeIp("1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("2001:0db8:0:0:0:0:0:1")).toBe("2001:db8::1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("2001:::1")).toBeNull();
  });

  it("parses and canonicalizes CIDRs", () => {
    expect(parseCidr("1.2.3")).toEqual({
      network: "1.2.3.0",
      prefix: 24,
      cidr: "1.2.3.0/24",
      version: 4,
    });
    expect(parseCidr("1.2.3.4")).toEqual({
      network: "1.2.3.4",
      prefix: 32,
      cidr: "1.2.3.4/32",
      version: 4,
    });
    expect(parseCidr("2001:db8::1/64")).toEqual({
      network: "2001:db8::",
      prefix: 64,
      cidr: "2001:db8::/64",
      version: 6,
    });
    expect(canonicalCidr("2001:0db8:0:0:0:0:0:1/64")).toBe("2001:db8::/64");
  });

  it("computes network addresses and matching", () => {
    expect(networkAddress("1.2.3.4", 24)).toBe("1.2.3.0");
    expect(networkAddress("2001:db8::1", 64)).toBe("2001:db8::");
    expect(contains("2001:db8::", 64, "2001:db8::1")).toBe(true);
    expect(contains("2001:db8::", 64, "2001:db9::1")).toBe(false);
    expect(contains("1.2.3.0", 24, "1.2.3.9")).toBe(true);
  });

  it("rejects invalid prefixes", () => {
    expect(parseCidr("1.2.3.4/33")).toBeNull();
    expect(parseCidr("2001:db8::1/129")).toBeNull();
  });

  it("renders IPv4-mapped IPv6 in CPython's dotted-quad form", () => {
// Regression: the old output `::ffff:102:304` differed from Python's
// `::ffff:1.2.3.4`, so string equality against blocked_ips never matched and
// blocking became a silent no-op.
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("::ffff:1.2.3.4");
    expect(normalizeIp("::FFFF:1.2.3.4")).toBe("::ffff:1.2.3.4");
// An address is IPv4-mapped only when its first 80 bits are zero and its sixth
// group is ffff. ::ffff:0:1.2.3.4 has bytes ...:0000:ffff:0000:0102:0304;
// CPython renders it using hexadecimal groups.
    expect(normalizeIp("::ffff:0:1.2.3.4")).toBe("::ffff:0:102:304");
// NAT64 prefixes are not IPv4-mapped; preserve hexadecimal notation.
    expect(normalizeIp("64:ff9b::1.2.3.4")).toBe("64:ff9b::102:304");
  });

  it("matches CPython ipaddress for every shared parity vector", () => {
    for (const { input, expected } of PARITY.normalize) {
      expect(normalizeIp(input), `normalizeIp(${input})`).toBe(expected);
    }
    for (const { input, expected_network, expected_prefix } of PARITY.cidr) {
      const parsed = parseCidr(input);
      expect(parsed, `parseCidr(${input})`).not.toBeNull();
      expect(parsed!.network, `network(${input})`).toBe(expected_network);
      expect(parsed!.prefix, `prefix(${input})`).toBe(expected_prefix);
      expect(parsed!.cidr).toBe(`${expected_network}/${expected_prefix}`);
      expect(canonicalCidr(input)).toBe(`${expected_network}/${expected_prefix}`);
    }
  });

  it("keeps a Python-written ::ffff ban row matchable", () => {
// End-to-end behavior: Python writes "::ffff:1.2.3.4" as the network value
// from normalize_cidr("::ffff:1.2.3.4") in blocked_ips. The Worker must derive
// the same candidate for the same visitor IP.
    expect(parseCidr("::ffff:1.2.3.4")).toEqual({
      network: "::ffff:1.2.3.4",
      prefix: 128,
      cidr: "::ffff:1.2.3.4/128",
      version: 6,
    });
    expect(networkAddress("::ffff:1.2.3.4", 128)).toBe("::ffff:1.2.3.4");
    expect(networkAddress("::ffff:1.2.3.4", 96)).toBe("::ffff:0.0.0.0");
    expect(networkAddress("::ffff:1.2.3.4", 120)).toBe("::ffff:1.2.3.0");
  });
});
