/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Pure-function tests for visitor-request.js; failure classification needs no DOM or network. */

import { describe, expect, it } from "vitest";
import { classifyFailure, REQUEST_TIMEOUT_MS } from "../../src/static/js/visitor-request.js";

describe("classifyFailure", () => {
  it("classifies 401 as auth", () => {
    expect(classifyFailure({ status: 401 })).toBe("auth");
  });

  it("classifies 403 as forbidden", () => {
    expect(classifyFailure({ status: 403 })).toBe("forbidden");
  });

  it("classifies a 5xx status as server", () => {
    expect(classifyFailure({ status: 500 })).toBe("server");
    expect(classifyFailure({ status: 599 })).toBe("server");
  });

  it("prefers the explicit timeout flag over a status", () => {
    expect(classifyFailure({ timedOut: true })).toBe("timeout");
    expect(classifyFailure({ status: 500, timedOut: true })).toBe("timeout");
  });

  it("classifies a network TypeError as network", () => {
    expect(classifyFailure({ error: new TypeError("Failed to fetch") })).toBe("network");
  });

  it("classifies an unrecognized status as unknown", () => {
    expect(classifyFailure({ status: 418 })).toBe("unknown");
    expect(classifyFailure({ status: 302 })).toBe("unknown");
  });

  it("does not classify an AbortError without timedOut as network", () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    expect(classifyFailure({ error: abortError })).toBe("unknown");
    // Legacy DOMException.ABORT_ERR and plain objects from wrapped fetch errors.
    expect(classifyFailure({ error: { name: "AbortError" } })).toBe("unknown");
    expect(classifyFailure({ error: { code: 20 } })).toBe("unknown");
  });

  it("tolerates no argument, null, and non-object input", () => {
    expect(classifyFailure()).toBe("unknown");
    expect(classifyFailure(null)).toBe("unknown");
    expect(classifyFailure("boom")).toBe("unknown");
  });
});

describe("REQUEST_TIMEOUT_MS", () => {
  it("is 15 seconds", () => {
    expect(REQUEST_TIMEOUT_MS).toBe(15000);
  });
});
