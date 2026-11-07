/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Cookie header parsing and Set-Cookie builders shared by the session and gate layers.
 *
 * These helpers were previously copied into `routing.ts`, `gate.ts`, and
 * `session.ts`; the session and gate layers will import them in follow-up task
 * books, so keep the one implementation here.
 *
 * A Cookie header is client input, so `decodeURIComponent` can throw on a
 * malformed percent sequence such as `%zz`. Both readers therefore fall back to
 * the raw value: a broken cookie must not turn the whole request into a 500.
 */

/** Return the first cookie whose name matches exactly, decoded, or undefined when absent. */
export function getCookie(name: string, header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        // Client-supplied malformed percent-encoding must not become an uncaught 500.
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Return every value for cookies with the same name, in header order.
 *
 * Browsers allow same-name cookies in **different scopes** (host-only,
 * Domain=, or different Path values) and send them all in one Cookie header.
 * Checking only the first may select an older value and cause a visitor who
 * just passed verification to be blocked on the next request. Validate each
 * value.
 */
export function allCookieValues(name: string, header: string | null): string[] {
  if (!header) return [];
  const out: string[] = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      out.push(decodeURIComponent(raw));
    } catch {
      out.push(raw);
    }
  }
  return out;
}

/** Build a session-style Set-Cookie value: host-only, HttpOnly, Secure, SameSite=Lax, Path=/. */
export function cookieHeader(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/**
 * Build an expired Set-Cookie value, optionally scoped to `Domain=.<rootDomain>`.
 *
 * The spacing is part of the existing session cookie output; keep it unchanged
 * so clear headers stay byte-identical.
 */
export function clearCookieHeader(name: string, rootDomain?: string): string {
  const domain = rootDomain ? ` Domain=.${rootDomain};` : "";
  return `${name}=;${domain} Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
