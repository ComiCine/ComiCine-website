/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/** Visitor IP encryption and decryption: dedicated key, fail-open writes, and fail-closed reads. */

import { describe, expect, it } from "vitest";
import { decryptVisitorIp, encryptVisitorIp, visitorIpKey } from "./visitor-ip";
import type { Env } from "./env";

const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

function env(key: string | undefined): Env {
  return { VISITOR_IP_KEY: key } as Env;
}

describe("visitor-ip", () => {
  it("round-trips IPv4 and IPv6", async () => {
    for (const ip of ["8.8.8.8", "2001:4860:4860::8888"]) {
      const token = await encryptVisitorIp(ip, env(TEST_KEY));
      expect(token).not.toBe("");
      expect(token).not.toContain(ip);
      expect(await decryptVisitorIp(token, env(TEST_KEY))).toBe(ip);
    }
  });

  it("writes nothing without a key (fail-open; tracking must not break)", async () => {
    expect(await encryptVisitorIp("8.8.8.8", env(""))).toBe("");
    expect(await encryptVisitorIp("8.8.8.8", env(undefined))).toBe("");
    expect(await encryptVisitorIp("", env(TEST_KEY))).toBe("");
  });

  it("returns null when it cannot decrypt (fail-closed)", async () => {
    const token = await encryptVisitorIp("8.8.8.8", env(TEST_KEY));
    expect(await decryptVisitorIp("", env(TEST_KEY))).toBeNull();
    expect(await decryptVisitorIp(token, env(""))).toBeNull();
    expect(await decryptVisitorIp("not-a-token", env(TEST_KEY))).toBeNull();
    expect(
      await decryptVisitorIp(token, env("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ9")),
    ).toBeNull();
  });

  it("trims the key", () => {
    expect(visitorIpKey(env(`  ${TEST_KEY}  `))).toBe(TEST_KEY);
    expect(visitorIpKey(env("   "))).toBe("");
  });
});
