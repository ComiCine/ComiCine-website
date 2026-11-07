/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Runtime config validation for the optional previous gate HMAC key. */

import { describe, expect, it } from "vitest";
import {
  GATE_HMAC_KEY_MIN_LENGTH,
  gatePreviousKeyConfigError,
  type Env,
} from "./env";
import { runtimeConfigError } from "./session";

const CURRENT_KEY = "c".repeat(64);

function env(overrides: Partial<Env> = {}): Env {
  return {
    TURNSTILE_SITEKEY: "sitekey",
    TURNSTILE_SECRET: "turnstile-secret",
    GATE_HMAC_KEY: CURRENT_KEY,
    SESSION_HMAC_KEY: "s".repeat(64),
    ...overrides,
  } as Env;
}

describe("gatePreviousKeyConfigError", () => {
  it("accepts an absent or blank previous key", () => {
    expect(gatePreviousKeyConfigError(env())).toBeNull();
    expect(gatePreviousKeyConfigError(env({ GATE_HMAC_KEY_PREVIOUS: "" }))).toBeNull();
    expect(gatePreviousKeyConfigError(env({ GATE_HMAC_KEY_PREVIOUS: "   " }))).toBeNull();
  });

  it("accepts a previous key of at least 32 non-space characters", () => {
    expect(gatePreviousKeyConfigError(env({
      GATE_HMAC_KEY_PREVIOUS: "p".repeat(GATE_HMAC_KEY_MIN_LENGTH),
    }))).toBeNull();
    expect(gatePreviousKeyConfigError(env({
      GATE_HMAC_KEY_PREVIOUS: `  ${"p".repeat(64)}  `,
    }))).toBeNull();
  });

  it("rejects a short previous key", () => {
    expect(gatePreviousKeyConfigError(env({
      GATE_HMAC_KEY_PREVIOUS: "p".repeat(GATE_HMAC_KEY_MIN_LENGTH - 1),
    }))).toBe("invalid_GATE_HMAC_KEY_PREVIOUS");
  });

  it("rejects a previous key containing whitespace", () => {
    expect(gatePreviousKeyConfigError(env({
      GATE_HMAC_KEY_PREVIOUS: `${"p".repeat(31)} x`,
    }))).toBe("invalid_GATE_HMAC_KEY_PREVIOUS");
    expect(gatePreviousKeyConfigError(env({
      GATE_HMAC_KEY_PREVIOUS: `${"p".repeat(20)} ${"p".repeat(20)}`,
    }))).toBe("invalid_GATE_HMAC_KEY_PREVIOUS");
  });
});

describe("runtimeConfigError with key rotation", () => {
  it("keeps missing_GATE_HMAC_KEY when the current key is missing", () => {
    expect(runtimeConfigError(env({ GATE_HMAC_KEY: "" }))).toBe("missing_GATE_HMAC_KEY");
    expect(runtimeConfigError(env({ GATE_HMAC_KEY: "   " }))).toBe("missing_GATE_HMAC_KEY");
// A malformed previous key must not mask the missing current key.
    expect(runtimeConfigError(env({
      GATE_HMAC_KEY: "",
      GATE_HMAC_KEY_PREVIOUS: "short",
    }))).toBe("missing_GATE_HMAC_KEY");
  });

  it("returns the invalid-previous error only when the other secrets are present", () => {
    expect(runtimeConfigError(env({ GATE_HMAC_KEY_PREVIOUS: "short" })))
      .toBe("invalid_GATE_HMAC_KEY_PREVIOUS");
    expect(runtimeConfigError(env({
      TURNSTILE_SECRET: "",
      GATE_HMAC_KEY_PREVIOUS: "short",
    }))).toBe("missing_TURNSTILE_SECRET");
    expect(runtimeConfigError(env({
      SESSION_HMAC_KEY: "",
      GATE_HMAC_KEY_PREVIOUS: "short",
    }))).toBe("missing_SESSION_HMAC_KEY");
  });

  it("does not add format validation to the current key", () => {
    expect(runtimeConfigError(env({ GATE_HMAC_KEY: "short" }))).toBeNull();
    expect(runtimeConfigError(env({ GATE_HMAC_KEY_PREVIOUS: CURRENT_KEY }))).toBeNull();
  });
});
