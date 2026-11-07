/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate HMAC key rotation: previous-key validation, current-key-only issuance, and diagnostic reasons. */

import { describe, expect, it, vi } from "vitest";
import {
  gateValidationKeys,
  handleVerify,
  mintGateCookie,
  readGateCookie,
  resolveGateTrust,
} from "../gate";
import type { RequestContext } from "../routing";
import { GATE_TTL_SECONDS } from "../config";

const CURRENT_KEY = "c".repeat(64);
const PREVIOUS_KEY = "p".repeat(64);
const UNKNOWN_KEY = "u".repeat(64);

function context(
  request: Request,
  keys: { current?: string; previous?: string },
): RequestContext {
  const env: Record<string, string> = {};
  if (keys.current !== undefined) env.GATE_HMAC_KEY = keys.current;
  if (keys.previous !== undefined) env.GATE_HMAC_KEY_PREVIOUS = keys.previous;
  return { request, env, next: async () => new Response("next") } as never;
}

function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0].split("=").slice(1).join("=");
}

async function mintedValue(key: string): Promise<string> {
  return cookieValue(await mintGateCookie(key));
}

function cookieRequest(value: string): Request {
  return new Request("https://comicine.com/", { headers: { Cookie: `__gate=${value}` } });
}

describe("gate HMAC keyring", () => {
  it("accepts a cookie signed with the previous key during rotation", async () => {
    const value = await mintedValue(PREVIOUS_KEY);
    const trust = await resolveGateTrust(
      context(cookieRequest(value), { current: CURRENT_KEY, previous: PREVIOUS_KEY }),
    );

    expect(trust.cookieValid).toBe(true);
    expect(trust.cookieReason).toBe("ok");
  });

  it("accepts a cookie signed with the current key", async () => {
    const value = await mintedValue(CURRENT_KEY);
    const trust = await resolveGateTrust(
      context(cookieRequest(value), { current: CURRENT_KEY, previous: PREVIOUS_KEY }),
    );

    expect(trust.cookieValid).toBe(true);
    expect(trust.cookieReason).toBe("ok");
  });

  it("rejects a cookie signed with an unknown key", async () => {
    const value = await mintedValue(UNKNOWN_KEY);
    const trust = await resolveGateTrust(
      context(cookieRequest(value), { current: CURRENT_KEY, previous: PREVIOUS_KEY }),
    );

    expect(trust.cookieValid).toBe(false);
    expect(trust.cookieReason).toBe("bad_signature");
  });

  it("keeps current-key behavior when no previous key is configured", async () => {
    const current = await mintedValue(CURRENT_KEY);
    const previous = await mintedValue(PREVIOUS_KEY);

    const accepted = await resolveGateTrust(
      context(cookieRequest(current), { current: CURRENT_KEY }),
    );
    const rejected = await resolveGateTrust(
      context(cookieRequest(previous), { current: CURRENT_KEY }),
    );

    expect(accepted.cookieValid).toBe(true);
    expect(rejected.cookieValid).toBe(false);
    expect(rejected.cookieReason).toBe("bad_signature");
  });

  it("accepts a previous key equal to the current key without error", async () => {
    const value = await mintedValue(CURRENT_KEY);
    const trust = await resolveGateTrust(
      context(cookieRequest(value), { current: CURRENT_KEY, previous: CURRENT_KEY }),
    );

    expect(gateValidationKeys({
      GATE_HMAC_KEY: CURRENT_KEY,
      GATE_HMAC_KEY_PREVIOUS: CURRENT_KEY,
    })).toEqual([CURRENT_KEY]);
    expect(trust.cookieValid).toBe(true);
  });

  it("signs new cookies with the current key only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ success: true, hostname: "comicine.com", action: "gate" }),
      ),
    );
    const form = new FormData();
    form.set("cf-turnstile-response", "token");
    form.set("host", "comicine.com");
    form.set("next", "/");
    const resp = await handleVerify({
      request: new Request("https://comicine.com/__gate/verify", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      }),
      env: {
        TURNSTILE_SECRET: "turnstile-secret",
        GATE_HMAC_KEY: CURRENT_KEY,
        GATE_HMAC_KEY_PREVIOUS: PREVIOUS_KEY,
      },
      next: async () => new Response("next"),
    } as never);
    vi.unstubAllGlobals();

    expect(resp.status).toBe(204);
    const issued = resp.headers
      .getSetCookie()
      .find((header) => header.includes("Max-Age=3600")) ?? "";
    const value = cookieValue(issued);
    await expect(readGateCookie(value, CURRENT_KEY)).resolves.toMatchObject({ valid: true });
    await expect(readGateCookie(value, PREVIOUS_KEY)).resolves.toMatchObject({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("reports expired rather than bad_signature for a previous-key cookie", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_700_000_000 * 1000);
      const value = await mintedValue(PREVIOUS_KEY);
      vi.setSystemTime((1_700_000_000 + GATE_TTL_SECONDS + 1) * 1000);
      const trust = await resolveGateTrust(
        context(cookieRequest(value), { current: CURRENT_KEY, previous: PREVIOUS_KEY }),
      );

      expect(trust.cookieValid).toBe(false);
      expect(trust.cookieReason).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the keyring from non-blank keys with the current key first", () => {
    expect(gateValidationKeys({
      GATE_HMAC_KEY: CURRENT_KEY,
      GATE_HMAC_KEY_PREVIOUS: PREVIOUS_KEY,
    })).toEqual([CURRENT_KEY, PREVIOUS_KEY]);
    expect(gateValidationKeys({ GATE_HMAC_KEY: CURRENT_KEY })).toEqual([CURRENT_KEY]);
    expect(gateValidationKeys({
      GATE_HMAC_KEY: CURRENT_KEY,
      GATE_HMAC_KEY_PREVIOUS: "   ",
    })).toEqual([CURRENT_KEY]);
// Key material is used raw; trimming only decides whether a key is blank.
    const spaced = ` ${CURRENT_KEY} `;
    expect(gateValidationKeys({ GATE_HMAC_KEY: spaced })).toEqual([spaced]);
  });

  it("returns 503 from handleVerify when the current key is missing", async () => {
    const form = new FormData();
    form.set("cf-turnstile-response", "token");
    form.set("host", "comicine.com");
    form.set("next", "/");
    const resp = await handleVerify({
      request: new Request("https://comicine.com/__gate/verify", {
        method: "POST",
        headers: { Accept: "application/json" },
        body: form,
      }),
      env: {
        TURNSTILE_SECRET: "turnstile-secret",
        GATE_HMAC_KEY_PREVIOUS: PREVIOUS_KEY,
      },
      next: async () => new Response("next"),
    } as never);

    expect(resp.status).toBe(503);
    expect(resp.headers.get("Set-Cookie")).toBeNull();
  });
});
