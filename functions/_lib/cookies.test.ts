/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Tests for the shared cookie helpers used by the session and gate layers.
 *
 * Cookie headers are client supplied, so these cases pin the raw-value fallback
 * for malformed percent-encoding and the exact Set-Cookie attributes that live
 * sessions depend on.
 */

import { describe, expect, it } from "vitest";
import { allCookieValues, clearCookieHeader, cookieHeader, getCookie } from "./cookies";

describe("getCookie", () => {
  it("decodes a percent-encoded value", () => {
    expect(getCookie("lang", "lang=zh%2Dcn")).toBe("zh-cn");
  });

  it("returns the raw value for invalid percent-encoding without throwing", () => {
    expect(() => getCookie("lang", "lang=%zz")).not.toThrow();
    expect(getCookie("lang", "lang=%zz")).toBe("%zz");
  });

  it("returns undefined when the Cookie header is missing", () => {
    expect(getCookie("lang", null)).toBeUndefined();
  });

  it("requires an exact name match", () => {
    expect(getCookie("x", "xg=1; x=2")).toBe("2");
    expect(getCookie("x", "xg=1")).toBeUndefined();
  });

  it("trims whitespace around names and values", () => {
    expect(getCookie("lang", "  lang =  zh-cn  ; theme=dark")).toBe("zh-cn");
  });
});

describe("allCookieValues", () => {
  it("returns same-name values in header order and decodes each", () => {
    expect(allCookieValues("__gate", "__gate=a%2Db; other=1; __gate=%zz")).toEqual([
      "a-b",
      "%zz",
    ]);
  });

  it("returns an empty array when the Cookie header is missing", () => {
    expect(allCookieValues("__gate", null)).toEqual([]);
  });

  it("requires an exact name match and trims names and values", () => {
    expect(allCookieValues("__gate", "x__gate=1;  __gate =  a  ; __gate= b")).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("Set-Cookie builders", () => {
  it("writes the session cookie attributes and the given Max-Age", () => {
    const header = cookieHeader("comicine_session", "token", 3600);
    expect(header).toBe(
      "comicine_session=token; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600",
    );
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Max-Age=3600");
  });

  it("expires a host-only cookie without a Domain attribute", () => {
    const header = clearCookieHeader("comicine_session");
    expect(header).toBe(
      "comicine_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
    expect(header).toContain("Max-Age=0");
    expect(header).not.toContain("Domain=");
  });

  it("adds the root-domain scope only when rootDomain is passed", () => {
    expect(clearCookieHeader("comicine_session", "comicine.com")).toBe(
      "comicine_session=; Domain=.comicine.com; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
    );
  });
});
