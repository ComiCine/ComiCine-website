/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * SHA-256 over the exact bytes written to R2, for the snapshot manifest's integrity index.
 *
 * Why streaming: Cloudflare Workers add a non-standard `crypto.DigestStream`; hashing through it
 * consumes the payload as a stream instead of handing a second full-size copy to
 * `crypto.subtle.digest`. Node (vitest) and legacy runtimes have no DigestStream, so the helper
 * falls back to SubtleCrypto there. Both paths return the same lowercase hex digest.
 */

const SHA256 = "SHA-256";

/**
 * Workers exposes `crypto.DigestStream`, which neither the DOM lib nor Node's typings declare.
 * Declare only the shape used here rather than widening to `any`.
 */
interface DigestStreamLike extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>;
}

type DigestStreamConstructor = new (algorithm: AlgorithmIdentifier) => DigestStreamLike;

interface CryptoWithDigestStream extends Crypto {
  DigestStream?: DigestStreamConstructor;
}

/** Manifest metadata for one R2 object: enough for restore.py to verify a download before using it. */
export interface SnapshotObject {
  name: string;
  bytes: number;
  sha256: string;
}

/**
 * Exact payload forms the snapshot writes. Exclude shared-memory views (`Uint8Array<ArrayBuffer>`):
 * Blob and SubtleCrypto accept them without a cast, and R2 never receives one anyway.
 */
export type SnapshotBytes = ArrayBuffer | Uint8Array<ArrayBuffer>;

/** UTF-8 bytes of a string; R2 stores a string payload exactly as UTF-8. */
export function utf8Bytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

/** Byte length as stored, accepting both payload forms the snapshot writes. */
export function byteLengthOf(data: SnapshotBytes): number {
  return data.byteLength;
}

function toHex(buffer: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Hash either exact payload form the snapshot writes (a gzip ArrayBuffer, or UTF-8 bytes).
 *
 * Prefer the Workers streaming digest; `subtle.digest` remains the test/legacy path.
 */
export async function sha256Hex(data: SnapshotBytes): Promise<string> {
  const runtime = globalThis.crypto as CryptoWithDigestStream;
  if (runtime.DigestStream) {
    const sink = new runtime.DigestStream(SHA256);
    await new Blob([data]).stream().pipeTo(sink);
    return toHex(await sink.digest);
  }
  return toHex(await globalThis.crypto.subtle.digest(SHA256, data));
}

/** Hash one object exactly as it will be stored, so the manifest entry and the upload cannot drift. */
export async function describeObject(name: string, data: SnapshotBytes): Promise<SnapshotObject> {
  return { name, bytes: byteLengthOf(data), sha256: await sha256Hex(data) };
}

/** Sort by code unit, not locale, so the manifest order is stable across runtimes. */
export function sortByName<T extends { name: string }>(objects: readonly T[]): T[] {
  return [...objects].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
