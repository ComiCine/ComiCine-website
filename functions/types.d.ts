/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
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
