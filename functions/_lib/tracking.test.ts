/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/** Tests for minimal tracking fields and noise reduction; mock D1 and use no real database or network. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./d1";
import type { Env } from "./env";
import {
  pageSlug,
  recordRay,
  recordVisit,
  shouldTrackRay,
  shouldTrackVisit,
  uaFamily,
} from "./tracking";
import { decryptVisitorIp } from "./visitor-ip";

vi.mock("./d1", () => ({ execute: vi.fn(), executeBatch: vi.fn() }));
vi.mock("cloudflare:sockets", () => ({}));

// Fixed test-only Fernet key, not a production secret. Without it ip_enc is
// always empty, making the no-IP-leak assertion vacuous because nothing was written.
const VISITOR_IP_KEY = "bShtbuGO2EDEej4Wl7eWpmiZkYsnX8s7GkShvTMFp5s=";

const env = {
  DB: {},
  OBSERVABILITY_HMAC_KEY: "obs-key-for-tests",
  VISITOR_IP_KEY,
} as unknown as Env;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(execute).mockResolvedValue(true);
});

function request(url: string, headers: HeadersInit = {}) {
  return new Request(url, { headers });
}

describe("tracking", () => {
  it("normalizes paths and user agents", () => {
    expect(pageSlug("/portfolio?id=1")).toBe("portfolio");
    expect(pageSlug("/")).toBe("home");
    expect(uaFamily("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("googlebot");
    expect(uaFamily("Mozilla/5.0 (Macintosh; Safari)")).toBe("safari");
  });

  it("skips static, API, image and redirect requests", () => {
    const page = request("https://limooo.cn/", { "CF-Connecting-IP": "1.1.1.1" });
    expect(shouldTrackVisit(page, new URL("https://limooo.cn/"))).toBe(true);
    expect(shouldTrackVisit(page, new URL("https://limooo.cn/static/a.css"))).toBe(false);
    expect(shouldTrackVisit(page, new URL("https://limooo.cn/api/x"))).toBe(false);
    expect(shouldTrackVisit(page, new URL("https://images.limooo.cn/x.webp"))).toBe(false);
    expect(shouldTrackRay(page, new URL("https://limooo.cn/static/a.css"))).toBe(false);
    expect(shouldTrackRay(page, new URL("https://limooo.cn/api/x"))).toBe(false);
    expect(shouldTrackRay(page, new URL("https://limooo.cn/"))).toBe(true);
  });

  it("records the gate diagnostic request so displayed Ray IDs are traceable", () => {
    const page = request("https://auth.limooo.cn/gate/diag", { "CF-Connecting-IP": "1.1.1.1" });
// The Ray ID displayed on the gate page must be searchable in Ray logs; this is the only /gate endpoint included.
    expect(shouldTrackRay(page, new URL("https://auth.limooo.cn/gate/diag"))).toBe(true);
    expect(shouldTrackRay(page, new URL("https://auth.limooo.cn/__gate/diag"))).toBe(true);
  });

  it("does not write D1 rows for the gate page's own config/diag/verify endpoints", () => {
// Each gate-page render requests /gate/config and /gate/diag, and each form
// submission posts to /gate/verify. These paths were **missing** from the
// exclusion list, which covered only the old /__gate prefix. Each unverified
// page view therefore caused one or two D1 writes, allowing anonymous write
// amplification (tasks/22 additional W9 finding).
    const page = request("https://auth.limooo.cn/gate/config", { "CF-Connecting-IP": "1.1.1.1" });
    for (const path of [
      "/gate/config",
      "/gate/diag",
      "/gate/verify",
      "/__gate/config",
      "/__gate/diag",
      "/__gate/verify",
    ]) {
      const url = new URL(`https://auth.limooo.cn${path}`);
      expect(shouldTrackVisit(page, url), `visit ${path}`).toBe(false);
// diag is the only endpoint allowed to record a Ray ID.
      const expectedRay = path.endsWith("/diag");
      expect(shouldTrackRay(page, url), `ray ${path}`).toBe(expectedRay);
    }
// The gate page itself (/gate) is still recorded as a regular page.
    expect(shouldTrackRay(page, new URL("https://auth.limooo.cn/gate"))).toBe(true);
    expect(shouldTrackVisit(page, new URL("https://auth.limooo.cn/gate"))).toBe(true);
  });

  it("records visitors without full IP/UA/query", async () => {
    await recordVisit(
      env,
      request("https://limooo.cn/portfolio?secret=1", {
        "CF-Connecting-IP": "8.8.8.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
      }),
      200,
    );
    const calls = vi.mocked(execute).mock.calls;
    const insert = calls.find((call) => String(call[1]).includes("INSERT INTO visitor_rollups"));
    expect(insert).toBeDefined();
    expect(String(insert![1])).toContain("ON CONFLICT");
    const values = insert!.slice(2).map(String);
    expect(values).toContain("portfolio");
    expect(values.some((value) => value.includes("8.8.8.8") || value.includes("secret=1"))).toBe(false);
    expect(values.some((value) => value.includes("Macintosh"))).toBe(false);
  });

  it("stores an encrypted visitor IP that decryptVisitorIp can recover", async () => {
    await recordVisit(
      env,
      request("https://limooo.cn/portfolio", { "CF-Connecting-IP": "8.8.8.8" }),
      200,
    );
    const calls = vi.mocked(execute).mock.calls;
    const insert = calls.find((call) => String(call[1]).includes("INSERT INTO visitor_rollups"));
    expect(insert).toBeDefined();
    const values = insert!.slice(2).map(String);

// ip_enc must be **real encryption**: decrypt the stored ciphertext to recover the original IP.
    const decrypted = await Promise.all(values.map((value) => decryptVisitorIp(value, env)));
    expect(decrypted).toContain("8.8.8.8");
// Do not include plaintext IP in the same parameter set; both the list endpoint and logs use these values.
    expect(values.some((value) => value.includes("8.8.8.8"))).toBe(false);
    await expect(decryptVisitorIp("", env)).resolves.toBeNull();
  });

  it("records ray requests without full IP/UA/query", async () => {
    await recordRay(
      env,
      request("https://limooo.cn/login/callback?code=topsecret", {
        "CF-Ray": "abc123",
        "CF-Connecting-IP": "8.8.8.8",
        "User-Agent": "Mozilla/5.0 (compatible; GPTBot/1.0)",
      }),
      200,
      12,
    );
    const calls = vi.mocked(execute).mock.calls;
    const insert = calls.find((call) => String(call[1]).includes("INSERT OR IGNORE INTO ray_log_v2"));
    expect(insert).toBeDefined();
    const values = insert!.slice(2).map(String);
    expect(values).toContain("/login/callback");
    expect(values.some((value) => value.includes("8.8.8.8") || value.includes("topsecret"))).toBe(false);
    expect(values.some((value) => value.includes("GPTBot"))).toBe(false);
  });

  /**
   * W9-19: during a D1 failure, do not send a batch of table-creation
   * statements that will fail for every request. Verify one attempt per
   * cooldown window and one batch round trip.
   */
  it("attempts the visitor schema once per cooldown and in a single batch", async () => {
    vi.resetModules();
    const mod = await import("./tracking");
    const { executeBatch: batchMock } = await import("./d1");
    vi.mocked(batchMock).mockResolvedValue(false); // D1 keeps failing.
    vi.mocked(execute).mockResolvedValue(false);

    const failing = {
      batch: () => undefined,
      prepare: () => ({ bind: () => ({ run: async () => ({ success: false }) }) }),
    } as unknown as Env;
    const localEnv = { ...env, DB: failing } as Env;

    for (let i = 0; i < 4; i++) {
      await mod.recordVisit(localEnv, request("https://limooo.cn/"), 200);
    }
    expect(vi.mocked(batchMock)).toHaveBeenCalledTimes(1);
    // Do not run DDL statement by statement during cooldown. INSERT persistence
    // still calls execute; this assertion covers DDL only.
    const ddl = vi
      .mocked(execute)
      .mock.calls.filter((call) => String(call[1]).startsWith("CREATE TABLE"));
    expect(ddl).toHaveLength(0);
  });
});
