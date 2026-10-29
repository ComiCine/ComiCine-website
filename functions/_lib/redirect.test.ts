/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Tests for the shared redirect page `renderRedirectPage` (tasks/22 W5-11).
 *
 * This code injects the **request-controlled** `?to=` value into generated
 * HTML, with `escapeHtml` as its only defense, but previously had no tests.
 * Use the real routing, language-cookie, and escaping logic while stubbing
 * `env.ASSETS` with fixed HTML. W1-4 removed the `{{lang}}` placeholder from
 * templates and output because the build renders `<html lang="{{ g.lang }}">`;
 * assert only the three runtime placeholders here.
 */

import { describe, expect, it, vi } from "vitest";
import { isRedirectHost, renderRedirectPage } from "./redirect";
import { BASE_URL, LANG_COOKIE, REDIRECT_HOSTNAME } from "./config";
import type { Env } from "./env";

const TEMPLATE = [
  "<!doctype html>",
  '<html lang="en-us">',
  "<head>",
  '  <link rel="preload" as="image" href="{{preload_links}}">',
  '  <script id="redirect-data" type="application/json">{"to":"{{to}}","preload":{{preload}}}</script>',
  "</head>",
  "<body></body>",
  "</html>",
].join("\n");

function assets(html = TEMPLATE, ok = true) {
  const fetch = vi.fn(async () => new Response(html, { status: ok ? 200 : 404 }));
  return { fetch } as unknown as Env["ASSETS"];
}

function context(url: string, env: Env) {
  return {
    request: new Request(url),
    env,
    next: async () => new Response("next"),
    waitUntil: vi.fn(),
  };
}

async function render(url: string, env: Env) {
  const resp = await renderRedirectPage(context(url, env) as never);
  return { resp, html: await resp.text() };
}

describe("renderRedirectPage", () => {
  it("injects an escaped to and leaves no placeholder behind", async () => {
    const payload = 'https://evil.example.com/"><script>alert(1)</script>';
    const { resp, html } = await render(
      `https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(payload)}`,
      { ASSETS: assets() } as Env,
    );

    expect(resp.status).toBe(200);
    expect(resp.headers.get("Content-Type")).toContain("text/html");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
// This remains within the allowed HTTPS scope, so preserve it after escaping.
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
// Escape quotes so the data attribute cannot be closed early.
    expect(html).not.toContain('https://evil.example.com/">');
    expect(html).not.toContain('{"to":"https://evil.example.com/"');
// Replace all three placeholders.
    expect(html).not.toContain("{{");
  });

  it("falls back to the main site for anything that is not an https URL", async () => {
    for (const raw of [
      "",
      "http://comicine.com/",
      "javascript:alert(1)",
      "//evil.example.com/",
      "/portfolio",
    ]) {
      const url = `https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(raw)}`;
      const { html } = await render(url, { ASSETS: assets() } as Env);
      expect(html).toContain(`"to":"${BASE_URL}/"`);
    }
  });

  it("only preloads portfolio images when the target stays on the main site", async () => {
    const internal = await render(`https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(`${BASE_URL}/portfolio`)}`, {
      ASSETS: assets(),
    } as Env);
    expect(internal.html).toContain('<link rel="preload" as="image" href="https://images.comicine.com/');
    expect(internal.html).not.toContain('"preload":[]');

    const external = await render(`https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent("https://example.com/x")}`, {
      ASSETS: assets(),
    } as Env);
    expect(external.html).not.toContain('<link rel="preload" as="image" href="https://images.comicine.com/');
    expect(external.html).toContain('"preload":[]');
  });

  it("writes the language cookie on first visit and stays quiet afterwards", async () => {
    const url = `https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(`${BASE_URL}/`)}`;

    const first = await render(url, { ASSETS: assets() } as Env);
    expect(first.resp.headers.getSetCookie()).toHaveLength(1);
    expect(first.resp.headers.get("Set-Cookie")).toContain(`${LANG_COOKIE}=`);

// When a language cookie exists, do not set it again and use its language for the page.
    const router = assets();
    const withCookie = await renderRedirectPage({
      request: new Request(url, { headers: { Cookie: `${LANG_COOKIE}=ko-kr` } }),
      env: { ASSETS: router } as Env,
      next: async () => new Response("next"),
      waitUntil: vi.fn(),
    } as never);
    expect(withCookie.headers.getSetCookie()).toHaveLength(0);
    expect(String(vi.mocked(router.fetch).mock.calls[0][0])).toBe(
      `${BASE_URL}/ko-kr/redirect.html`,
    );
  });

  it("fetches the generated page for the detected language", async () => {
    const router = assets();
    await render(`https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(`${BASE_URL}/`)}`, {
      ASSETS: router,
    } as Env);
    const requested = String(vi.mocked(router.fetch).mock.calls[0][0]);
    expect(requested).toBe(`${BASE_URL}/en-us/redirect.html`);
  });

  it("503s instead of rendering a half-injected page", async () => {
    const missing = await render(`https://${REDIRECT_HOSTNAME}/`, {} as Env);
    expect(missing.resp.status).toBe(503);
    expect(missing.html).not.toContain("{{");

    const broken = await render(`https://${REDIRECT_HOSTNAME}/`, {
      ASSETS: assets(TEMPLATE, false),
    } as Env);
    expect(broken.resp.status).toBe(503);
  });
});

describe("isRedirectHost", () => {
  it("only claims the redirect hostname", () => {
    expect(isRedirectHost(REDIRECT_HOSTNAME)).toBe(true);
    expect(isRedirectHost("comicine.com")).toBe(false);
    expect(isRedirectHost(`evil.${REDIRECT_HOSTNAME}`)).toBe(false);
  });
});

/**
 * Template-text cache (tasks/22 increment 3): fetch each language template
 * from ASSETS once, but perform injection per request. Keep languages
 * separate and do not cache failed fetches.
 */
describe("renderRedirectPage template cache", () => {
  it("fetches the template once for repeated renders of the same language", async () => {
    const router = assets();
    const url = `https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(`${BASE_URL}/portfolio`)}`;
    const first = await render(url, { ASSETS: router } as Env);
    const second = await render(url, { ASSETS: router } as Env);

    expect(vi.mocked(router.fetch)).toHaveBeenCalledTimes(1);
    expect(first.html).toBe(second.html);
    expect(first.html).toContain('<link rel="preload" as="image" href="https://images.comicine.com/');
    expect(first.html).not.toContain("{{");
  });

  it("keeps one template per language", async () => {
    const router = assets();
    const url = `https://${REDIRECT_HOSTNAME}/?to=${encodeURIComponent(`${BASE_URL}/`)}`;
    await render(url, { ASSETS: router } as Env);
    await renderRedirectPage({
      request: new Request(url, { headers: { Cookie: `${LANG_COOKIE}=ko-kr` } }),
      env: { ASSETS: router } as Env,
      next: async () => new Response("next"),
      waitUntil: vi.fn(),
    } as never);

    expect(vi.mocked(router.fetch).mock.calls.map((call) => String(call[0]))).toEqual([
      `${BASE_URL}/en-us/redirect.html`,
      `${BASE_URL}/ko-kr/redirect.html`,
    ]);
  });

  it("does not cache a failed template fetch", async () => {
    const router = assets(TEMPLATE, false);
    expect((await render(`https://${REDIRECT_HOSTNAME}/`, { ASSETS: router } as Env)).resp.status).toBe(503);
    expect((await render(`https://${REDIRECT_HOSTNAME}/`, { ASSETS: router } as Env)).resp.status).toBe(503);
    expect(vi.mocked(router.fetch)).toHaveBeenCalledTimes(2);
  });
});
