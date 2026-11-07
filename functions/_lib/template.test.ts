/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Tests for the single-pass `{{key}}` substitution used by the gate and redirect pages.
 *
 * Values are injected verbatim (callers escape or JSON-encode them), so the key
 * behaviors are that listed keys are literal, missing values become empty, and a
 * substituted value is never rescanned for another placeholder.
 */

import { describe, expect, it } from "vitest";
import { inject } from "./template";

describe("inject", () => {
  it("replaces all listed placeholders", () => {
    expect(
      inject("<p>{{host}}{{next}}</p>", ["host", "next"], { host: "a", next: "/b" }),
    ).toBe("<p>a/b</p>");
  });

  it("does not rescan a replacement value that contains a placeholder", () => {
    expect(
      inject("{{next}}|{{error}}", ["next", "error"], { next: "{{error}}", error: "boom" }),
    ).toBe("{{error}}|boom");
  });

  it("renders a listed key missing from values as an empty string", () => {
    expect(inject("[{{error}}]", ["error"], {})).toBe("[]");
  });

  it("leaves a placeholder that is not listed in keys untouched", () => {
    expect(inject("{{unknown}} {{to}}", ["to"], { to: "x" })).toBe("{{unknown}} x");
  });

  it("matches keys containing regex metacharacters literally", () => {
    expect(inject("{{a.b}} {{axb}}", ["a.b"], { "a.b": "dot" })).toBe("dot {{axb}}");
  });

  it("replaces every occurrence of one placeholder", () => {
    expect(inject("{{to}}-{{to}}-{{to}}", ["to"], { to: "x" })).toBe("x-x-x");
  });

  it("returns the source unchanged when no keys are listed", () => {
    expect(inject("{{to}}", [], { to: "x" })).toBe("{{to}}");
  });
});
