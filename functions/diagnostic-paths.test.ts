/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * The four diagnostic request paths (middleware challenge, gate verify, logout,
 * identity login start) share the sampling policy in `_lib/sampling.ts`: each
 * source keeps only the first diagnostic event per 60 s window. A malformed form
 * body opens its own window, and a dropped event is reported through the Pages
 * log without a second logEvent() write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logEvent } from "./_lib/logging";
import { resetDiagnosticSampling } from "./_lib/sampling";
import { handleOnRequest } from "./_middleware";
import { handleVerify } from "./_lib/gate";
import { onRequestGet } from "./logout";
import { buildIdentityLoginStart } from "./_lib/identity-login";
import { createSessionCookie } from "./_lib/session";
import type { Env } from "./_lib/env";
import type { RequestContext } from "./_lib/routing";

vi.mock("./_lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_lib/logging")>();
  return { ...actual, logEvent: vi.fn(async () => undefined) };
});

const keys = {
  TURNSTILE_SECRET: "turnstile-secret",
  GATE_HMAC_KEY: "a".repeat(64),
  SESSION_HMAC_KEY: "b".repeat(64),
};

function env(extra: Partial<Env> = {}): Env {
  return { ...keys, ...extra } as Env;
}

function context(request: Request, extra: Partial<Env> = {}): RequestContext {
  return {
    request,
    env: env(extra),
    next: async () => new Response("next", { status: 200 }),
    waitUntil: async () => undefined,
  };
}

function loggedEvents(): string[] {
  return vi.mocked(logEvent).mock.calls.map((call) => call[1]);
}

beforeEach(() => {
  resetDiagnosticSampling();
  vi.mocked(logEvent).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shared diagnostic sampling across request paths", () => {
  it("middleware keeps one gate_redirect per source per window", async () => {
    const request = new Request("https://comicine.com/?challenge=1", {
      headers: { "CF-Connecting-IP": "203.0.113.10" },
    });

    await handleOnRequest(context(request));
    await handleOnRequest(context(request));
    expect(loggedEvents()).toEqual(["gate_redirect"]);

    vi.setSystemTime(1_700_000_060_000);
    await handleOnRequest(context(request));
    expect(loggedEvents()).toEqual(["gate_redirect", "gate_redirect"]);
  });

  it("gate verify failures keep one event per source per window, and a malformed form has its own window", async () => {
    const url = "https://comicine.com/__gate/verify";
    const ip = "203.0.113.11";
    const failingRequest = () =>
      new Request(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": ip,
        },
        // No Turnstile token, so the path skips siteverify and logs a 403 failure.
        body: new URLSearchParams({ next: "/", host: "comicine.com" }).toString(),
      });
    const malformedFormRequest = () =>
      new Request(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "CF-Connecting-IP": ip,
        },
        body: "{}",
      });

    await handleVerify(context(failingRequest()));
    await handleVerify(context(failingRequest()));
    expect(loggedEvents()).toEqual(["gate_verify"]);

    await handleVerify(context(malformedFormRequest()));
    await handleVerify(context(malformedFormRequest()));
    expect(loggedEvents()).toEqual(["gate_verify", "gate_verify"]);
    expect(vi.mocked(logEvent).mock.calls.map((call) => call[3]?.message)).toEqual([
      "missing_token",
      "invalid_form",
    ]);

    vi.setSystemTime(1_700_000_060_000);
    await handleVerify(context(failingRequest()));
    expect(loggedEvents()).toEqual(["gate_verify", "gate_verify", "gate_verify"]);
  });

  it("logout keeps one event per source per window", async () => {
    const request = new Request("https://comicine.com/logout", {
      headers: { "CF-Connecting-IP": "203.0.113.12" },
    });

    await onRequestGet(context(request) as never);
    await onRequestGet(context(request) as never);
    expect(loggedEvents()).toEqual(["logout"]);

    vi.setSystemTime(1_700_000_060_000);
    await onRequestGet(context(request) as never);
    expect(loggedEvents()).toEqual(["logout", "logout"]);
  });

  it("identity login start is sampled as login_start, not the audit login_attempt", async () => {
    const source = new URL("https://visitor.comicine.com/");
    const request = new Request("https://visitor.comicine.com/", {
      headers: { "CF-Connecting-IP": "203.0.113.13" },
    });

    const start = await buildIdentityLoginStart(env(), request, source, "/", 302);
    expect(start).not.toBeNull();
    const secondStart = await buildIdentityLoginStart(env(), request, source, "/", 302);
    expect(secondStart).not.toBeNull();
    expect(loggedEvents()).toEqual(["login_start"]);
    expect(loggedEvents()).not.toContain("login_attempt");

    vi.setSystemTime(1_700_000_060_000);
    await buildIdentityLoginStart(env(), request, source, "/", 302);
    expect(loggedEvents()).toEqual(["login_start", "login_start"]);
  });

  it("suppression is reported to the Pages log without another logEvent write", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = new Request("https://comicine.com/?challenge=1", {
      headers: { "CF-Connecting-IP": "203.0.113.14" },
    });

    await handleOnRequest(context(request));
    await handleOnRequest(context(request));
    await handleOnRequest(context(request));
    expect(vi.mocked(logEvent)).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_700_000_060_000);
    await handleOnRequest(context(request));

    expect(vi.mocked(logEvent)).toHaveBeenCalledTimes(2);
    const summaries = logSpy.mock.calls
      .map((call) => {
        try {
          const parsed: unknown = JSON.parse(String(call[0]));
          return parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry?.outcome === "suppressed");

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      event: "gate_redirect",
      suppressed: 2,
      window_ms: 60_000,
      reason: "window_end",
    });
    expect(JSON.stringify(summaries)).not.toContain("203.0.113.14");
  });

  it("writes a successful gate verification in full within one window", async () => {
    // Each success requires a solved Turnstile challenge, so the success row is a
    // conversion record rather than an amplification vector and must never be sampled.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, hostname: "comicine.com", action: "gate" }),
      ),
    );
    const ip = "203.0.113.15";
    const okRequest = () =>
      new Request("https://comicine.com/__gate/verify", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "CF-Connecting-IP": ip,
        },
        body: new URLSearchParams({
          "cf-turnstile-response": "solved-token",
          next: "/",
          host: "comicine.com",
        }).toString(),
      });

    expect((await handleVerify(context(okRequest()))).status).toBe(204);
    expect((await handleVerify(context(okRequest()))).status).toBe(204);
    expect(vi.mocked(logEvent).mock.calls.map((call) => call[3]?.outcome)).toEqual([
      "success",
      "success",
    ]);
  });

  it("writes a failed session revocation in full within one window", async () => {
    // The revoke failure is the audit-relevant row: it must never be sampled, while
    // the success row below it in logout.ts is a diagnostic.
    const ip = "203.0.113.16";
    const cookie = await createSessionCookie(env(), {
      sid: "sid-revoke-test",
      sub: "user-sub",
      user: { email: "admin@example.com", name: "Admin" },
      role: "viewer",
      authAt: 1_700_000_000,
    });
    const request = () =>
      new Request("https://comicine.com/logout", {
        headers: { "CF-Connecting-IP": ip, Cookie: cookie.split(";")[0] },
      });

    // No DB binding: revokeAuthSession fails closed, so logout returns 503.
    expect((await onRequestGet(context(request()) as never)).status).toBe(503);
    expect((await onRequestGet(context(request()) as never)).status).toBe(503);
    expect(vi.mocked(logEvent).mock.calls.map((call) => call[3]?.outcome)).toEqual([
      "failed",
      "failed",
    ]);
  });
});
