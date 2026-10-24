/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * `cloudflare:sockets` stub for Vitest. This built-in module exists only in the Workers runtime;
 * use this stub when running `ops/status-worker` tests locally to avoid import failures.
 */

export interface SocketStub {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  opened: Promise<unknown>;
  close(): Promise<void>;
}

export function connect(): SocketStub {
  throw new Error("cloudflare:sockets is only available in the Workers runtime");
}
