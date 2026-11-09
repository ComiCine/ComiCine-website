/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { describe, expect, it } from "vitest";
import { onRequest as handleDocs404 } from "../../functions/_middleware.js";

const invoke = handleDocs404 as unknown as (input: {
  request: Request;
  next: () => Promise<Response>;
}) => Promise<Response>;

describe("docs 404 middleware", () => {
  it("keeps the VitePress 404 page inline and uncached", async () => {
    const html = "<!doctype html><html><head><title>404</title></head><body>Not found</body></html>";
    const response = await invoke({
      request: new Request("https://docs.comicine.com/missing"),
      next: async () => new Response(html, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(html);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Refresh")).toBeNull();
  });

  it("returns a bodyless 404 for HEAD without consuming the upstream page", async () => {
    const html = "<!doctype html><html><body>Not found</body></html>";
    const response = await invoke({
      request: new Request("https://docs.comicine.com/missing", { method: "HEAD" }),
      next: async () => new Response(html, {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    });

    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("leaves non-HTML 404 responses unchanged", async () => {
    const upstream = new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    const response = await invoke({
      request: new Request("https://docs.comicine.com/api/missing"),
      next: async () => upstream,
    });

    expect(response).toBe(upstream);
  });
});
