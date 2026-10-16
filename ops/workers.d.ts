/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Worker-side runtime types for status-worker, d1-archive, and sync-worker.
 *
 * Why not @cloudflare/workers-types: like functions/types.d.ts and functions/_lib/d1.ts, this
 * project uses a small handwritten type set instead of depending on a package that changes with
 * Cloudflare releases. This file declares only the APIs used by the three Workers in ops/**
 * (D1, Durable Objects, cron, and cloudflare:sockets). Add new APIs here when needed; do not use
 * any as a fallback.
 *
 * Previously, status-worker was not included in tsconfig.json, so missing types went unnoticed
 * (tasks/22 W6-4).
 */

/** Cloudflare D1, structurally compatible with the matching types in functions/_lib/d1.ts. */
declare interface D1Meta {
  changes?: number;
  duration?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
}

declare interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: D1Meta;
}

declare interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

declare interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** D1 batch is always available; Workers call `await env.DB.batch([...])` directly. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
  exec?(sql: string): Promise<unknown>;
}

/** Durable Object。 */
declare interface DurableObjectId {
  toString(): string;
}

declare interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  getAlarm(): Promise<number | null>;
}

declare interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

declare interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

declare interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  idFromString(id: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

/** Interface implemented by Durable Object classes; only fetch is required. */
declare interface DurableObject {
  fetch(request: Request): Promise<Response>;
}

/** Input passed to the Cron Trigger scheduled() handler. */
declare interface ScheduledController {
  readonly cron: string;
  readonly scheduledTime: number;
  readonly type?: string;
}

/** cloudflare:sockets; declare only the APIs used here for implicit-TLS SMTP. */
declare module "cloudflare:sockets" {
  interface SocketOptions {
    secureTransport?: "off" | "on" | "starttls";
    allowHalfOpen?: boolean;
  }

  interface Socket {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;
    readonly opened: Promise<Socket>;
    readonly closed: Promise<void>;
    startTls(): Socket;
    close(): Promise<void>;
  }

  function connect(
    address: { hostname: string; port: number } | string,
    options?: SocketOptions,
  ): Socket;
}
