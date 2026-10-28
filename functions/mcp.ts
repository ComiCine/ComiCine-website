/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import type { Env } from "./_lib/env";
import { BASE_URL, ROOT_DOMAIN } from "./_lib/config";
import { pageAsset } from "./_lib/routing";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const LEGACY_PROTOCOL_VERSIONS = new Set([
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
]);
const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
const SERVER_INFO = { name: "ComiCine Site MCP", version: "1.0.0" };
const SERVER_INSTRUCTIONS =
  "Read-only tools for ComiCine's public pages. These tools do not submit forms, create bookings, or access account data.";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PAGE_TEXT = 12000;
const SUPPORTED_LANGUAGES = ["zh-cn", "en-us", "ja-jp", "ko-kr"] as const;
const PUBLIC_PAGE_PATHS = ["/", "/portfolio", "/services", "/contact"] as const;
const SEARCH_PAGE_PATHS = ["/", "/services", "/contact"] as const;

type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
type PublicPagePath = (typeof PUBLIC_PAGE_PATHS)[number];
type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

interface JsonRpcRequest extends JsonObject {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonObject;
}

interface PublicPage {
  path: PublicPagePath;
  language: SupportedLanguage;
  title: string;
  url: string;
  text: string;
}

const TOOLS = [
  {
    name: "get_public_page",
    title: "Read a ComiCine page",
    description:
      "Read the published text of a public ComiCine home, portfolio, services, or contact page in a selected language.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          enum: PUBLIC_PAGE_PATHS,
          description: "A supported public page path.",
        },
        language: {
          type: "string",
          enum: SUPPORTED_LANGUAGES,
          description: "Page language. Defaults to en-us.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "search_public_pages",
    title: "Search ComiCine pages",
    description:
      "Search the published home, services, and contact page text. Returns short snippets and canonical links.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 2,
          maxLength: 160,
          description: "Words or a phrase to find in the public site text.",
        },
        language: {
          type: "string",
          enum: SUPPORTED_LANGUAGES,
          description: "Page language. Defaults to en-us.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
] as const;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function rpcError(
  id: JsonRpcId | null,
  code: number,
  message: string,
  data?: unknown,
): JsonObject {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function modernResult(result: JsonObject): JsonObject {
  return {
    ...result,
    _meta: {
      ...(isRecord(result._meta) ? result._meta : {}),
      [SERVER_INFO_META]: SERVER_INFO,
    },
  };
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function sameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
    ndash: "–",
    mdash: "—",
    hellip: "…",
  };

  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const point = Number.parseInt(hex, 16);
      return point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const point = Number.parseInt(decimal, 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<(script|style|noscript|svg|head|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|section|article|header|footer|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlTitle(html: string): string {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return match ? htmlToText(match[1]) : "ComiCine";
}

function canonicalUrl(path: PublicPagePath): string {
  if (path === "/services") return `https://services.${ROOT_DOMAIN}/`;
  if (path === "/contact") return `https://contact.${ROOT_DOMAIN}/`;
  if (path === "/portfolio") return `${BASE_URL}/portfolio#portfolio`;
  return `${BASE_URL}/`;
}

async function loadPublicPage(
  env: Env,
  path: PublicPagePath,
  language: SupportedLanguage,
): Promise<PublicPage> {
  if (!env.ASSETS) throw new Error("Public site assets are unavailable.");
  const asset = pageAsset(ROOT_DOMAIN, path, language);
  if (!asset) throw new Error("The requested page is unavailable.");

  const response = await env.ASSETS.fetch(new URL(asset, BASE_URL));
  if (!response.ok) throw new Error("The requested page could not be loaded.");

  const html = await response.text();
  return {
    path,
    language,
    title: htmlTitle(html),
    url: canonicalUrl(path),
    text: htmlToText(html).slice(0, MAX_PAGE_TEXT),
  };
}

function selectedLanguage(value: unknown): SupportedLanguage | null {
  if (value === undefined) return "en-us";
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
    ? value as SupportedLanguage
    : null;
}

function toolText(text: string, isError = false): JsonObject {
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(env: Env, name: unknown, rawArgs: unknown): Promise<JsonObject> {
  if (typeof name !== "string" || !isRecord(rawArgs)) {
    return toolText("Tool name and arguments are required.", true);
  }

  if (name === "get_public_page") {
    const path = rawArgs.path;
    const language = selectedLanguage(rawArgs.language);
    if (
      typeof path !== "string" ||
      !PUBLIC_PAGE_PATHS.includes(path as PublicPagePath) ||
      !language
    ) {
      return toolText("Choose a supported public page path and language.", true);
    }

    try {
      const page = await loadPublicPage(env, path as PublicPagePath, language);
      return toolText(`# ${page.title}\n${page.url}\nLanguage: ${page.language}\n\n${page.text}`);
    } catch (error) {
      return toolText(error instanceof Error ? error.message : "The requested page could not be loaded.", true);
    }
  }

  if (name === "search_public_pages") {
    const query = typeof rawArgs.query === "string" ? rawArgs.query.trim() : "";
    const language = selectedLanguage(rawArgs.language);
    if (query.length < 2 || query.length > 160 || !language) {
      return toolText("Provide a search query of 2 to 160 characters and a supported language.", true);
    }

    try {
      const pages = await Promise.all(
        SEARCH_PAGE_PATHS.map((path) => loadPublicPage(env, path, language)),
      );
      const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matches = pages
        .map((page) => {
          const text = page.text.toLocaleLowerCase();
          const positions = terms.map((term) => text.indexOf(term)).filter((position) => position >= 0);
          return {
            page,
            score: positions.length,
            position: positions.length ? Math.min(...positions) : -1,
          };
        })
        .filter((match) => match.score > 0)
        .sort((left, right) => right.score - left.score || left.position - right.position)
        .slice(0, 5)
        .map(({ page, position }) => {
          const start = Math.max(0, position - 180);
          const end = Math.min(page.text.length, position + query.length + 260);
          return `## ${page.title}\n${page.url}\n${start > 0 ? "…" : ""}${page.text.slice(start, end)}${end < page.text.length ? "…" : ""}`;
        });

      return toolText(
        matches.length
          ? `Search results for “${query}” (${language}):\n\n${matches.join("\n\n")}`
          : `No public page text matched “${query}” (${language}).`,
      );
    } catch {
      return toolText("Public site pages could not be searched.", true);
    }
  }

  return toolText("Unknown ComiCine tool.", true);
}

function requestParams(message: JsonRpcRequest): JsonObject {
  return isRecord(message.params) ? message.params : {};
}

function requestId(message: JsonRpcRequest): JsonRpcId | null {
  return typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
}

function validateModernHeaders(
  request: Request,
  message: JsonRpcRequest,
  params: JsonObject,
): string | null {
  const version = isRecord(params._meta) ? params._meta[PROTOCOL_VERSION_META] : undefined;
  if (
    request.headers.get("MCP-Protocol-Version") !== MODERN_PROTOCOL_VERSION ||
    version !== MODERN_PROTOCOL_VERSION ||
    request.headers.get("Mcp-Method") !== message.method
  ) {
    return "Modern MCP protocol headers do not match the request body.";
  }

  if (message.method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string" || request.headers.get("Mcp-Name") !== name) {
      return "Mcp-Name does not match the requested tool.";
    }
  }
  return null;
}

function initializeResult(): JsonObject {
  return {
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
    instructions: SERVER_INSTRUCTIONS,
  };
}

function supportedLegacyVersion(value: unknown): string {
  return typeof value === "string" && LEGACY_PROTOCOL_VERSIONS.has(value)
    ? value
    : LEGACY_PROTOCOL_VERSION;
}

function unsupportedVersionResponse(id: JsonRpcId | null, version: string): Response {
  return jsonResponse(
    rpcError(id, -32022, `Unsupported protocol version: ${version}.`, {
      supportedVersions: [MODERN_PROTOCOL_VERSION, ...LEGACY_PROTOCOL_VERSIONS],
    }),
    400,
  );
}

function discoveryResult(): JsonObject {
  return {
    resultType: "complete",
    supportedVersions: [MODERN_PROTOCOL_VERSION],
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
    ttlMs: 300000,
    cacheScope: "public",
    _meta: { [SERVER_INFO_META]: SERVER_INFO },
  };
}

async function handleRequest(
  request: Request,
  env: Env,
  message: JsonRpcRequest,
): Promise<Response> {
  const id = requestId(message);
  const params = requestParams(message);
  const metadataVersion = isRecord(params._meta)
    ? params._meta[PROTOCOL_VERSION_META]
    : undefined;
  const headerVersion = request.headers.get("MCP-Protocol-Version");
  const modern = metadataVersion === MODERN_PROTOCOL_VERSION ||
    headerVersion === MODERN_PROTOCOL_VERSION;
  const notification = !Object.hasOwn(message, "id");

  const requestedVersion = typeof metadataVersion === "string"
    ? metadataVersion
    : headerVersion;
  if (
    requestedVersion &&
    requestedVersion !== MODERN_PROTOCOL_VERSION &&
    !LEGACY_PROTOCOL_VERSIONS.has(requestedVersion)
  ) {
    return unsupportedVersionResponse(id, requestedVersion);
  }

  if (modern) {
    const mismatch = validateModernHeaders(request, message, params);
    if (mismatch) return jsonResponse(rpcError(id, -32020, mismatch), 400);
  }

  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") {
    return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  if (notification) return jsonResponse(rpcError(null, -32600, "A request id is required."), 400);

  if (message.method === "initialize") {
    const result = initializeResult();
    result.protocolVersion = supportedLegacyVersion(params.protocolVersion);
    return jsonResponse({ jsonrpc: "2.0", id, result });
  }

  if (message.method === "server/discover" && modern) {
    return jsonResponse({ jsonrpc: "2.0", id, result: discoveryResult() });
  }

  if (message.method === "tools/list") {
    const result = modern
      ? modernResult({ tools: TOOLS, ttlMs: 300000, cacheScope: "public" })
      : { tools: TOOLS };
    return jsonResponse({ jsonrpc: "2.0", id, result });
  }

  if (message.method === "tools/call") {
    const result = await callTool(env, params.name, params.arguments ?? {});
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: modern ? modernResult(result) : result,
    });
  }

  return jsonResponse(rpcError(id, -32601, "Method not found."), 404);
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" },
    });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" },
    });
  }
  if (!sameOriginRequest(request)) {
    return jsonResponse(rpcError(null, -32000, "Cross-origin MCP requests are not allowed."), 403);
  }
  const contentType = (request.headers.get("Content-Type") ?? "").toLowerCase().split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    return new Response("Content-Type must be application/json.", {
      status: 415,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const raw = await readBoundedBody(request);
  if (raw === null) {
    return jsonResponse(rpcError(null, -32700, "Request body is too large."), 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error."), 400);
  }
  if (
    !isRecord(parsed) ||
    parsed.jsonrpc !== "2.0" ||
    typeof parsed.method !== "string"
  ) {
    return jsonResponse(rpcError(null, -32600, "Invalid JSON-RPC request."), 400);
  }

  return handleRequest(request, env, parsed as JsonRpcRequest);
};
