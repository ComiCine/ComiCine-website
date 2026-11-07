/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Global Pages Functions types, avoiding a dependency on @cloudflare/workers-types. */

declare interface PagesContext<Env = unknown> {
  request: Request;
  env: Env;
  params: Record<string, string>;
  next(): Promise<Response>;
  waitUntil?(promise: Promise<unknown>): void;
}

declare type PagesFunction<Env = unknown> = (context: PagesContext<Env>) => Promise<Response>;

/**
 * Browser ESM modules under src/static/js imported directly by unit tests.
 *
 * Those files ship to the browser without a build step, so they are deliberately plain
 * JavaScript. The tests still get real types here instead of an implicit `any`; the module
 * declarations stay in this test-only program (tsconfig.tests.json) and never reach the
 * Functions bundle.
 */
declare module "*/visitor-filter.js" {
  export interface VisitorMarker {
    ip_hash?: string;
    statuses?: Record<string, number>;
  }

  export function filterMarkers(markers: unknown, status: unknown): VisitorMarker[];
}

declare module "*/visitor-request.js" {
  export type FailureReason = "timeout" | "auth" | "forbidden" | "server" | "network" | "unknown";

  export const REQUEST_TIMEOUT_MS: number;

  // Deliberately `unknown`: the JavaScript helper accepts anything, including null, a string, or
  // a non-object, so callers cannot fail while reporting a failure.
  export function classifyFailure(failure?: unknown): FailureReason;
}
