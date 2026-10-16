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
 * Canonical IP/CIDR normalization and matching implementation for Pages Functions.
 *
 * Keep behavior aligned with `src/cidr.py`:
 * - normalizeIp(): canonical form of a single IP
 * - parseCidr(): any valid CIDR or bare IP -> { network, prefix, cidr }
 * - networkAddress(): IP and prefix -> network address
 * - contains(): check whether an IP is in a CIDR
 */

type IpVersion = 4 | 6;

export interface ParsedCidr {
  network: string;
  prefix: number;
  cidr: string;
  version: IpVersion;
}

interface ParsedIp {
  version: IpVersion;
  bytes: number[];
  ip: string;
}

function parseIpv4(raw: string): number[] | null {
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

function ipv4BytesToIp(bytes: number[]): string {
  return bytes.join(".");
}

/**
 * Dotted-quad form of IPv4-mapped IPv6 addresses (`::ffff:a.b.c.d`).
 *
 * Use the same detection rule as CPython
 * `ipaddress.IPv6Address.ipv4_mapped`: the first 80 bits must be zero and the
 * sixth group must be `ffff`. For `::ffff:0:1.2.3.4`, the bytes are
 * `…:0000:ffff:0000:0102:0304`, so the sixth group is not `ffff` and the
 * address is **not** mapped. CPython also renders it as `::ffff:0:102:304`.
 * Convert only actual mapped addresses to dotted-quad notation.
 */
function ipv4MappedString(bytes: number[]): string | null {
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return `::ffff:${ipv4BytesToIp(bytes.slice(12, 16))}`;
}

function ipv6BytesToIp(bytes: number[]): string {
// Normalize IPv4-mapped addresses first. Python `src/cidr.py` uses
// `ipaddress.ip_address(...).compressed` and emits `::ffff:1.2.3.4` for mapped
// addresses. This code previously emitted `::ffff:102:304`, so values Python
// wrote to `blocked_ips` never matched Worker candidates. Blocking silently
// failed open, as did the allowlist. Both sides must produce identical strings.
  const mapped = ipv4MappedString(bytes);
  if (mapped) return mapped;

  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16));
  }

  let bestStart = -1;
  let bestLength = 0;
  let currentStart = -1;
  let currentLength = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (currentStart < 0) currentStart = i;
      currentLength++;
      if (currentLength > bestLength) {
        bestLength = currentLength;
        bestStart = currentStart;
      }
      continue;
    }
    currentStart = -1;
    currentLength = 0;
  }

  if (bestLength < 2) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

function parseIpv6Bytes(raw: string): number[] | null {
  let value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  if (!value || value.includes("%") || value.includes(":::")) return null;

  const compressed = value.includes("::");
  let left: string[] = [];
  let right: string[] = [];
  let plain: string[] = [];

  if (compressed) {
    const halves = value.split("::");
    if (halves.length !== 2) return null;
    left = halves[0] ? halves[0].split(":") : [];
    right = halves[1] ? halves[1].split(":") : [];
  } else {
    plain = value.split(":");
  }

  let ipv4Tail: number[] | null = null;
  if (!compressed) {
    if (plain[plain.length - 1]?.includes(".")) {
      ipv4Tail = parseIpv4(plain.pop() as string);
      if (!ipv4Tail) return null;
    }
  } else {
    if (right[right.length - 1]?.includes(".")) {
      ipv4Tail = parseIpv4(right.pop() as string);
      if (!ipv4Tail) return null;
    } else if (left[left.length - 1]?.includes(".")) {
      return null;
    }
  }

  const hexGroups = [...left, ...right, ...plain];
  for (const group of hexGroups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
  }

// The IPv4 tail occupies two 16-bit groups in IPv6 and remains four bytes when converted.
  const tailGroups = ipv4Tail ? 2 : 0;
  const totalGroups = hexGroups.length + tailGroups;
  if (compressed) {
    if (totalGroups > 8) return null;
    const zeroCount = 8 - hexGroups.length - tailGroups;
    const all = [
      ...left,
      ...Array.from({ length: zeroCount }, () => "0"),
      ...right,
      ...(ipv4Tail ?? []),
    ];
    const bytes: number[] = [];
    for (const group of all) {
      if (typeof group === "number") {
        bytes.push(group);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
      const value16 = Number.parseInt(group, 16);
      bytes.push(value16 >> 8, value16 & 0xff);
    }
    return bytes;
  }

  if (totalGroups !== 8) return null;
  const all = [...plain, ...(ipv4Tail ?? [])];
  const bytes: number[] = [];
  for (const group of all) {
    if (typeof group === "number") {
      bytes.push(group);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const value16 = Number.parseInt(group, 16);
    bytes.push(value16 >> 8, value16 & 0xff);
  }
  return bytes;
}

function parseIp(raw: string): ParsedIp | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes(":")) {
    const bytes = parseIpv6Bytes(value);
    if (!bytes) return null;
    return { version: 6, bytes, ip: ipv6BytesToIp(bytes) };
  }
  const bytes = parseIpv4(value);
  if (!bytes) return null;
  return { version: 4, bytes, ip: ipv4BytesToIp(bytes) };
}

export function normalizeIp(value: string): string | null {
  return parseIp(value)?.ip ?? null;
}

export function parseCidr(value: string): ParsedCidr | null {
  const raw = (value.split("#")[0] ?? "").trim();
  if (!raw) return null;

// Support the legacy blocklist.txt format: 1.2.3 -> 1.2.3.0/24
  if (!raw.includes(":") && /^\d{1,3}(?:\.\d{1,3}){2}$/.test(raw)) {
    return parseCidr(`${raw}.0/24`);
  }

  const slash = raw.indexOf("/");
  const ipPart = slash >= 0 ? raw.slice(0, slash) : raw;
  const prefixPart = slash >= 0 ? raw.slice(slash + 1) : null;
  if (prefixPart !== null && !/^\d+$/.test(prefixPart)) return null;

  const parsed = parseIp(ipPart);
  if (!parsed) return null;
  const max = parsed.version === 4 ? 32 : 128;
  const prefix = prefixPart === null ? max : Number(prefixPart);
  if (prefix < 0 || prefix > max) return null;

  const networkBytes = maskBytes(parsed.bytes, prefix);
  const network = parsed.version === 4 ? ipv4BytesToIp(networkBytes) : ipv6BytesToIp(networkBytes);
  return {
    network,
    prefix,
    cidr: `${network}/${prefix}`,
    version: parsed.version,
  };
}

export function canonicalCidr(value: string): string | null {
  return parseCidr(value)?.cidr ?? null;
}

function maskBytes(bytes: number[], prefix: number): number[] {
  const out = bytes.map((byte) => byte);
  const fullBytes = Math.floor(prefix / 8);
  const remainder = prefix % 8;
  for (let i = 0; i < out.length; i++) {
    if (i < fullBytes) continue;
    if (i === fullBytes) {
      out[i] = remainder === 0 ? 0 : out[i] & ((0xff << (8 - remainder)) & 0xff);
      continue;
    }
    out[i] = 0;
  }
  return out;
}

export function networkAddress(ip: string, prefix: number): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  const max = parsed.version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > max) return null;
  const bytes = maskBytes(parsed.bytes, prefix);
  return parsed.version === 4 ? ipv4BytesToIp(bytes) : ipv6BytesToIp(bytes);
}

export function contains(network: string, prefix: number, ip: string): boolean {
  const parsedIp = parseIp(ip);
  const parsedNetwork = parseIp(network);
  if (!parsedIp || !parsedNetwork || parsedIp.version !== parsedNetwork.version) return false;
  const max = parsedIp.version === 4 ? 32 : 128;
  if (prefix < 0 || prefix > max) return false;
  const networkBytes = maskBytes(parsedNetwork.bytes, prefix);
  const ipBytes = maskBytes(parsedIp.bytes, prefix);
  return networkBytes.every((value, i) => value === ipBytes[i]);
}
