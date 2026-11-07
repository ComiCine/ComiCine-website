/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Unit tests for the read-only MCP endpoint (`functions/mcp.ts`).
 *
 * Everything runs in-process: the handler is called directly, `ASSETS` is a
 * synchronous stub keyed by the path derived from `pageAsset`, and no network,
 * worker, global `fetch` mock, or `secrets/` file is involved.
 *
 * The access-policy block at the end pins the "not public" decision: `/llms.txt`
 * and `/robots.txt` must not advertise `/mcp` (locked by
 * `tests/test_build.py`), and the gate itself must keep answering an
 * unverified POST with the challenge page instead of MCP JSON.
 */

import { describe, expect, it } from "vitest";
import { onRequest } from "./mcp";
import { handleOnRequest } from "./_middleware";
import { isExemptPath, isPublicAssetPath, pageAsset } from "./_lib/routing";
import { ROOT_DOMAIN } from "./_lib/config";
import type { Env } from "./_lib/env";

const ENDPOINT = "https://comicine.com/mcp";
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";
const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";

interface RpcBody {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function baseEnv(assets?: Env["ASSETS"]): Env {
  return {
    TURNSTILE_SITEKEY: "site-key",
    TURNSTILE_SECRET: "turnstile-secret",
    GATE_HMAC_KEY: "g".repeat(64),
    SESSION_HMAC_KEY: "s".repeat(64),
    ...(assets ? { ASSETS: assets } : {}),
  } as Env;
}

function post(body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}): Request {
  return new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

function rpc(body: RpcBody | Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return post(JSON.stringify(body), headers);
}

async function call(request: Request, env: Env = baseEnv()): Promise<Response> {
  return onRequest({ request, env } as never);
}

async function bodyOf(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

function modernHeaders(method: string, name?: string): Record<string, string> {
  return {
    "MCP-Protocol-Version": MODERN_VERSION,
    "Mcp-Method": method,
    ...(name === undefined ? {} : { "Mcp-Name": name }),
  };
}

function modernMeta(): Record<string, string> {
  return { [PROTOCOL_VERSION_META]: MODERN_VERSION };
}

/** `ASSETS` stub: one HTML document per path, recording every requested path. */
function assetsFrom(
  pages: Record<string, string>,
  seen: string[] = [],
): Env["ASSETS"] {
  return {
    async fetch(input: RequestInfo | URL): Promise<Response> {
      const url = input instanceof Request ? new URL(input.url) : new URL(String(input));
      seen.push(url.pathname);
      const html = pages[url.pathname];
      if (html === undefined) return new Response("missing", { status: 404 });
      return new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    },
  };
}

function pageHtml(title: string, body: string): string {
  return [
    "<!doctype html><html><head>",
    `<title> ${title} </title>`,
    "<style>.hidden{display:none}</style>",
    "</head><body>",
    body,
    "<script>alert('should not be exposed')</script>",
    "</body></html>",
  ].join("");
}

/** Metadata and copy for the three searchable pages; titles double as result headings. */
function searchableAssets(pages: Record<string, { title: string; text: string }>): Env["ASSETS"] {
  const assets: Record<string, string> = {};
  for (const [path, page] of Object.entries(pages)) {
    assets[pageAsset(ROOT_DOMAIN, path, "en-us") as string] = pageHtml(page.title, `<p>${page.text}</p>`);
  }
  return assetsFrom(assets);
}

const SEARCH_PAGES = {
  "/": { title: "Home", text: "alpha beta beta cinema" },
  "/services": { title: "Services", text: "alpha cinema gamma" },
  "/contact": { title: "Contact", text: "alpha delta" },
};

function searchCall(query: string, env: Env): Promise<Response> {
  return call(
    rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "search_public_pages", arguments: { query } },
    }),
    env,
  );
}

describe("MCP transport and framing", () => {
  it("answers GET with 405 and advertises POST/OPTIONS", async () => {
    const response = await call(new Request(ENDPOINT));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  it("answers OPTIONS with 204 and the allowed methods", async () => {
    const response = await call(new Request(ENDPOINT, { method: "OPTIONS" }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });

  it("rejects a cross-origin request with -32000", async () => {
    const response = await call(
      rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { Origin: "https://evil.example" }),
    );

    expect(response.status).toBe(403);
    expect((await bodyOf(response)).error).toMatchObject({ code: -32000 });
  });

  it("rejects a non-JSON content type with 415", async () => {
    const response = await call(post("{}", { "Content-Type": "text/plain" }));

    expect(response.status).toBe(415);
    await expect(response.text()).resolves.toBe("Content-Type must be application/json.");
  });

  it("rejects malformed JSON with -32700", async () => {
    const response = await call(post("{not json"));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatchObject({ code: -32700, message: "Parse error." });
  });

  it("rejects a JSON body without jsonrpc/method with -32600", async () => {
    const response = await call(rpc({ jsonrpc: "2.0" }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatchObject({ code: -32600 });
  });

  it("rejects a body one byte over the 64 KiB cap with 413", async () => {
    const response = await call(post("x".repeat(64 * 1024 + 1)));

    expect(response.status).toBe(413);
    expect((await bodyOf(response)).error).toMatchObject({
      code: -32700,
      message: "Request body is too large.",
    });
  });
});

describe("MCP protocol negotiation", () => {
  it("echoes a supported legacy version from initialize", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }));

    expect(response.status).toBe(200);
    const result = (await bodyOf(response)).result;
    expect(result.protocolVersion).toBe("2025-06-18");
    expect(result.capabilities?.tools?.listChanged).toBe(false);
  });

  it("falls back to the newest legacy version for an unknown initialize version", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }));

    expect((await bodyOf(response)).result.protocolVersion).toBe(LEGACY_VERSION);
  });

  it("accepts notifications/initialized with 202 and no body", async () => {
    const response = await call(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }));

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("");
  });

  it("requires an id on non-notification requests", async () => {
    const response = await call(rpc({ jsonrpc: "2.0", method: "tools/list" }));

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({ id: null, error: { code: -32600 } });
  });

  it("answers an unknown method with 404 and -32601", async () => {
    const response = await call(rpc({ jsonrpc: "2.0", id: 1, method: "resources/list" }));

    expect(response.status).toBe(404);
    expect((await bodyOf(response)).error).toMatchObject({ code: -32601 });
  });

  it("returns plain tool definitions for legacy tools/list", async () => {
    const response = await call(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));

    expect(response.status).toBe(200);
    const result = (await bodyOf(response)).result;
    expect(result._meta).toBeUndefined();
    expect(result.ttlMs).toBeUndefined();
    expect(result.tools.map((tool: { name: string }) => tool.name))
      .toEqual(["get_public_page", "search_public_pages"]);
  });

  it("adds server metadata and ttlMs for modern tools/list", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: modernMeta() },
    }, modernHeaders("tools/list")));

    expect(response.status).toBe(200);
    const result = (await bodyOf(response)).result;
    expect(result.ttlMs).toBe(300000);
    expect(result.cacheScope).toBe("public");
    expect(result._meta[SERVER_INFO_META]).toMatchObject({ name: "ComiCine Site MCP" });
  });

  it("describes modern discovery without legacy versions", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: { _meta: modernMeta() },
    }, modernHeaders("server/discover")));

    expect(response.status).toBe(200);
    const result = (await bodyOf(response)).result;
    expect(result.supportedVersions).toEqual([MODERN_VERSION]);
    expect(result.ttlMs).toBe(300000);
  });
});

describe("MCP modern header validation", () => {
  it("rejects a header/body version mismatch with -32020", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [PROTOCOL_VERSION_META]: LEGACY_VERSION } },
    }, modernHeaders("tools/list")));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error.code).toBe(-32020);
  });

  it("rejects Mcp-Method that does not match the body method", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: modernMeta() },
    }, modernHeaders("tools/call")));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error.code).toBe(-32020);
  });

  it("rejects Mcp-Name that does not match the requested tool", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "/" }, _meta: modernMeta() },
    }, modernHeaders("tools/call", "search_public_pages")));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).error).toMatchObject({
      code: -32020,
      message: "Mcp-Name does not match the requested tool.",
    });
  });

  it("rejects an unsupported version with -32022 and lists the supported ones", async () => {
    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [PROTOCOL_VERSION_META]: "2099-01-01" } },
    }));

    expect(response.status).toBe(400);
    const payload = await bodyOf(response);
    expect(payload.error.code).toBe(-32022);
    expect(payload.error.data.supportedVersions).toEqual([
      MODERN_VERSION,
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
    ]);
  });
});

describe("MCP tools/call", () => {
  it("reads a public page through the pageAsset route and strips markup", async () => {
    const expected = pageAsset(ROOT_DOMAIN, "/", "en-us") as string;
    const seen: string[] = [];
    const env = baseEnv(assetsFrom({
      [expected]: pageHtml("ComiCine Home", "<h1>Welcome</h1><p>Studio &amp; cinema</p>"),
    }, seen));

    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "/", language: "en-us" } },
    }), env);

    expect(response.status).toBe(200);
    const result = (await bodyOf(response)).result;
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text as string;
    expect(text.startsWith("# ComiCine Home")).toBe(true);
    expect(text).toContain("https://comicine.com/");
    expect(text).toContain("Language: en-us");
    expect(text).toContain("Welcome");
    expect(text).toContain("Studio & cinema");
    expect(text).not.toContain("<h1>");
    expect(text).not.toContain("should not be exposed");
    expect(seen).toEqual([expected]);
  });

  it("uses the language-specific asset and the canonical services URL", async () => {
    const expected = pageAsset(ROOT_DOMAIN, "/services", "ja-jp") as string;
    const seen: string[] = [];
    const env = baseEnv(assetsFrom({
      [expected]: pageHtml("サービス", "<p>撮影プラン</p>"),
    }, seen));

    const response = await call(rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "/services", language: "ja-jp" } },
    }), env);

    const text = (await bodyOf(response)).result.content[0].text as string;
    expect(text).toContain("https://services.comicine.com/");
    expect(text).toContain("Language: ja-jp");
    expect(seen).toEqual([expected]);
  });

  it("rejects an unsupported path or language with the existing copy", async () => {
    for (const args of [{ path: "/admin" }, { path: "/", language: "fr-fr" }]) {
      const response = await call(rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_public_page", arguments: args },
      }));
      const result = (await bodyOf(response)).result;
      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.content[0].text).toBe("Choose a supported public page path and language.");
    }
  });

  it("enforces the search query length boundaries at 1/2/160/161 characters", async () => {
    const env = baseEnv(searchableAssets(SEARCH_PAGES));

    const tooShort = (await bodyOf(await searchCall("a", env))).result;
    expect(tooShort.isError).toBe(true);
    expect(tooShort.content[0].text)
      .toBe("Provide a search query of 2 to 160 characters and a supported language.");

    const minimum = (await bodyOf(await searchCall("al", env))).result;
    expect(minimum.isError).toBeUndefined();
    expect(minimum.content[0].text).toContain("Search results for");

    const maximum = (await bodyOf(await searchCall("alpha " + "z".repeat(154), env))).result;
    expect(maximum.isError).toBeUndefined();

    const tooLong = (await bodyOf(await searchCall("alpha " + "z".repeat(155), env))).result;
    expect(tooLong.isError).toBe(true);
  });

  it("reports no match without an isError", async () => {
    const env = baseEnv(searchableAssets(SEARCH_PAGES));

    const result = (await bodyOf(await searchCall("zzzz", env))).result;

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No public page text matched");
  });

  it("orders hits by score and keeps only matching pages", async () => {
    const env = baseEnv(searchableAssets(SEARCH_PAGES));

    const text = (await bodyOf(await searchCall("alpha beta", env))).result.content[0].text as string;
    const headers = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

    // The tool searches three pages, so the five-result cap cannot be reached here;
    // the ordering assertion is the part that can be pinned.
    expect(headers.length).toBeLessThanOrEqual(5);
    expect(headers).toEqual(["Home", "Services", "Contact"]);
  });

  it("reports missing assets with the existing copy", async () => {
    const page = (await bodyOf(await call(rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "/" } },
    })))).result;
    expect(page.isError).toBe(true);
    expect(page.content[0].text).toBe("Public site assets are unavailable.");

    const search = (await bodyOf(await searchCall("alpha", baseEnv()))).result;
    expect(search.isError).toBe(true);
    expect(search.content[0].text).toBe("Public site pages could not be searched.");
  });

  it("reports a non-2xx asset response with the existing copy", async () => {
    const failing = baseEnv({ fetch: async () => new Response("boom", { status: 500 }) });

    const page = (await bodyOf(await call(rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "get_public_page", arguments: { path: "/" } },
    }), failing))).result;
    expect(page.isError).toBe(true);
    expect(page.content[0].text).toBe("The requested page could not be loaded.");

    const search = (await bodyOf(await searchCall("alpha", failing))).result;
    expect(search.isError).toBe(true);
    expect(search.content[0].text).toBe("Public site pages could not be searched.");
  });

  it("rejects an unknown tool", async () => {
    const result = (await bodyOf(await call(rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "delete_everything", arguments: {} },
    })))).result;

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Unknown ComiCine tool.");
  });
});

describe("MCP access policy", () => {
  it("keeps /mcp out of the gate exemptions and public asset paths", () => {
    expect(isExemptPath("/mcp")).toBe(false);
    expect(isPublicAssetPath("/mcp")).toBe(false);
  });

  it("answers an unverified POST with the gate page instead of MCP JSON", async () => {
    const response = await handleOnRequest({
      request: post(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), {
        "CF-Connecting-IP": "198.51.100.7",
      }),
      env: baseEnv({
        fetch: async () => new Response("<html><body>{{host}} {{next}} {{error}}</body></html>", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      }),
      params: {},
      next: async () => new Response("next"),
      waitUntil: async () => undefined,
    } as never);

    expect(response.status).toBe(403);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("comicine.com");
  });
});
