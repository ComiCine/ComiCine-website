#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.


"""Look up recent Ray IDs by client IP across D1 tables for administrator troubleshooting.

Why not query directly by IP:
    D1 stores IP data in redacted form, with each table containing only part of the information:
      1. `ray_log_v2` (seven-day retention) stores ray, time, host, path, and status, but only the
         `ip_hash` (the first 16 characters of an HMAC-SHA256 using OBSERVABILITY_HMAC_KEY).
         This is a write-only Pages secret, so it is unavailable locally and cannot be computed.
      2. `visitor_rollups.ip_enc` is Fernet ciphertext encrypted with the locally available
         `VISITOR_IP_KEY`; it can be decrypted to the plaintext IP and includes the matching ip_hash.
    The lookup flow is: plaintext IP -> find matching ip_enc rows -> get ip_hash -> query the most
    recent N rays in ray_log_v2 by ip_hash. Migration 017 added an (ip_hash, ts DESC) index, turning
    this into an indexed lookup rather than a table scan.

    The legacy `ray_log` table stores plaintext IP and can be queried directly, but writes stopped
    on 2026-09-25, so it is used only as a historical fallback.

Usage:
    python3 ops/check_ip_rays.py 176.122.161.108          # most recent 5 by default
    python3 ops/check_ip_rays.py 176.122.161.108 --limit 10
    python3 ops/check_ip_rays.py --hash d51153cb767fc758   # skip decryption when ip_hash is known
    python3 ops/check_ip_rays.py 8.8.8.8 --json

Exit codes: 0 if found; 1 if not found or query failed; 2 for invalid arguments.
"""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
import sys
from pathlib import Path

ROOT = Path(
    os.environ.get("COMICINE_ROOT")
    or os.environ.get("LIMOOO_ROOT")
    or Path(__file__).resolve().parents[1]
)
sys.path.insert(0, str(ROOT))

from ops import d1_client  # noqa: E402

DEFAULT_LIMIT = 5

# ip_enc requires cryptography. If it is unavailable, only the IP-to-hash step is skipped; --hash remains available.
try:
    from cryptography.fernet import Fernet, InvalidToken  # noqa: E402
except ImportError:  # pragma: no cover - Depends on the Python interpreter.
    Fernet = None  # type: ignore[assignment]

    class InvalidToken(Exception):  # type: ignore[no-redef]
        """Placeholder that is unused when cryptography is missing."""


def normalize_ip(raw: str) -> str:
    """Validate and normalize an IPv4 or IPv6 address; raise ValueError if invalid."""
    value = (raw or "").strip()
    if not value:
        raise ValueError("empty IP")
    # Remove brackets and ports commonly found in curl output and logs: [::1]:443 / 1.2.3.4:80
    if value.startswith("["):
        value = value[1:].split("]", 1)[0]
    else:
        try:
            return str(ipaddress.ip_address(value))
        except ValueError:
            pass
        if value.count(":") == 1 and "." in value:
            value = value.split(":", 1)[0]
    try:
        return str(ipaddress.ip_address(value))
    except ValueError as exc:
        raise ValueError(f"invalid IP: {raw}") from exc


def looks_like_hash(raw: str) -> bool:
    value = (raw or "").strip().lower()
    return len(value) == 16 and all(ch in "0123456789abcdef" for ch in value)


d1_query_retry = d1_client.d1_query_retry


def warn(message: str) -> None:
    """Flush stdout before writing to stderr to avoid interleaved output."""
    sys.stdout.flush()
    print(message, file=sys.stderr)
    sys.stderr.flush()


scan_cost_note = d1_client.scan_note


def visitor_key(env: dict[str, str]) -> str:
    return d1_client.env_value(env, "VISITOR_IP_KEY")


def resolve_hashes(cfg: dict[str, str], env: dict[str, str], ip: str) -> tuple[list[str], str | None]:
    """Map a plaintext IP to ip_hash values by decrypting and comparing all ip_enc rows.

    Return (hash list, warning). A non-empty warning means the lookup is degraded or incomplete;
    callers must report it accurately and must not describe a decryption failure as no record.
    """
    key = visitor_key(env)
    if not key:
        return [], "VISITOR_IP_KEY is missing; cannot decrypt ip_enc (use --hash, or the legacy ray_log table)"
    if Fernet is None:
        return [], "this python has no cryptography module; cannot decrypt ip_enc (use an interpreter that has it)"

    rows = d1_query_retry(cfg, "SELECT ip_hash, ip_enc, last_ts FROM visitor_rollups WHERE ip_enc IS NOT NULL AND ip_enc != ''")
    if rows is None:
        return [], "visitor_rollups query failed (network/API flake; this does not mean there is no record)"

    try:
        fernet = Fernet(key.encode())
    except Exception:  # noqa: BLE001
        return [], "VISITOR_IP_KEY is not a valid Fernet key"

    target = ipaddress.ip_address(ip)
    hashes: list[str] = []
    for row in rows:
        token = row.get("ip_enc") or ""
        if not token:
            continue
        try:
            candidate = fernet.decrypt(str(token).encode()).decode()
        except (InvalidToken, ValueError, TypeError):
            continue  # Skip historical rows that cannot be decrypted with the current key.
        try:
            if ipaddress.ip_address(candidate) != target:
                continue
        except ValueError:
            continue
        row_hash = str(row.get("ip_hash") or "").strip()
        if row_hash and row_hash not in hashes:
            hashes.append(row_hash)

    if not hashes:
        # ip_enc covers only rows written after this feature was enabled; an empty result does not mean the IP was never seen.
        return [], "this IP is not present in ip_enc (that column only covers records written after encryption was enabled; it may be an older visit)"
    return hashes, None


def rays_by_hash(cfg: dict[str, str], hashes: list[str], limit: int) -> tuple[list[dict], str | None]:
    """Fetch the most recent limit rows from ray_log_v2 by ip_hash using migration 017's index."""
    if not hashes:
        return [], None
    quoted = ", ".join("'" + h.replace("'", "''") + "'" for h in hashes)
    sql = (
        "SELECT ray, ts, host, normalized_path AS path, method, status, country, ip_hash, duration_ms "
        f"FROM ray_log_v2 WHERE ip_hash IN ({quoted}) ORDER BY ts DESC LIMIT {int(limit)}"
    )
    rows = d1_query_retry(cfg, sql)
    if rows is None:
        return [], "ray_log_v2 query failed (network/API flake; this does not mean there is no record)"
    return rows, None


def rays_legacy(cfg: dict[str, str], ip: str, limit: int) -> tuple[list[dict], str | None]:
    """Match plaintext IP exactly in the legacy ray_log table (writes stopped 2026-09-25; historical fallback only)."""
    sql = (
        "SELECT ray, ts, host, path, method, status, country, ip "
        f"FROM ray_log WHERE ip = '{ip.replace(chr(39), chr(39) * 2)}' ORDER BY ts DESC LIMIT {int(limit)}"
    )
    rows = d1_query_retry(cfg, sql)
    if rows is None:
        return [], "ray_log query failed (network/API flake; this does not mean there is no record)"
    return rows, None


def render_v2(row: dict) -> str:
    ts = row.get("ts")
    stamp = dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if isinstance(ts, (int, float)) else ""
    host = str(row.get("host", ""))
    method = str(row.get("method", ""))
    path = str(row.get("path", ""))
    status = str(row.get("status", ""))
    country = str(row.get("country", ""))
    duration = row.get("duration_ms")
    ms = f"{int(duration)}ms" if isinstance(duration, (int, float)) and duration else ""
    # Use fixed-width columns for time, ray, status, method, country, and duration; put host and path last because their lengths are unbounded.
    return f"{stamp} {row.get('ray',''):<22} {status:>3} {method:<4} {country:<2} {ms:>7}  {host}{path}"


def render_legacy(row: dict) -> str:
    ts = row.get("ts")
    stamp = dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if isinstance(ts, (int, float)) else ""
    host = str(row.get("host", ""))
    method = str(row.get("method", ""))
    path = str(row.get("path", ""))
    status = str(row.get("status", ""))
    country = str(row.get("country", ""))
    return f"{stamp} {row.get('ray',''):<22} {status:>3} {method:<4} {country:<2} {'-':>7}  {host}{path} [legacy]"


def main() -> int:
    parser = argparse.ArgumentParser(description="Look up the most recent Ray IDs for a client IP")
    parser.add_argument("target", nargs="?", help="client IP, e.g. 176.122.161.108 / 240e:404::1")
    parser.add_argument("--hash", dest="hash_value", help="known ip_hash (16 hex chars); skips IP decryption")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help=f"number of rows to return (default {DEFAULT_LIMIT})")
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = parser.parse_args()

    limit = max(1, args.limit)
    env = d1_client.load_env(ROOT / "secrets" / "webauthn.env")
    cfg = d1_client.cloudflare_config(env)

    warnings: list[str] = []
    hashes: list[str] = []
    ip = ""

    if args.hash_value:
        raw_hash = args.hash_value.strip().lower()
        if not looks_like_hash(raw_hash):
            print("invalid ip_hash (expect 16 hex chars)", file=sys.stderr)
            return 2
        hashes = [raw_hash]
    else:
        try:
            ip = normalize_ip(args.target or "")
        except ValueError:
            print("invalid IP", file=sys.stderr)
            return 2
        # Report the cost before scanning: mapping plaintext IPs to ip_hash requires decrypting every ip_enc row.
        warn(
            scan_cost_note(
                cfg,
                "visitor_rollups",
                "ip_enc IS NOT NULL AND ip_enc != ''",
                "no index on ip_enc; every ciphertext row is decrypted locally",
                "Pass --hash <ip_hash> to skip this step when the hash is already known.",
            )
        )
        hashes, warn_msg = resolve_hashes(cfg, env, ip)
        if warn_msg:
            warnings.append(warn_msg)

    warn(
        scan_cost_note(
            cfg,
            "ray_log_v2",
            "",
            "indexed by (ip_hash, ts DESC) since migration 017; only the matching hashes' rows are read",
            "Pass --hash <ip_hash> to also skip the ip_enc scan on the plaintext-IP path.",
        )
    )
    rows, warn_msg = rays_by_hash(cfg, hashes, limit)
    if warn_msg:
        warnings.append(warn_msg)

    legacy: list[dict] = []
    if ip and len(rows) < limit:
        # Fill in missing v2 matches from the legacy table, which stores plaintext IPs.
        extra, warn2 = rays_legacy(cfg, ip, limit - len(rows))
        if warn2:
            warnings.append(warn2)
        legacy = [r for r in extra if r.get("ray") not in {x.get("ray") for x in rows}]

    if args.json:
        print(json.dumps(
            {
                "ip": ip or None,
                "ip_hashes": hashes,
                "rays": rows,
                "legacy_rays": legacy,
                "warnings": warnings,
            },
            ensure_ascii=False,
            indent=2,
            default=str,
        ))
        return 0 if (rows or legacy) else 1

    label = ip or f"hash:{hashes[0]}"
    print(f"{label} latest {limit} Ray ID(s)", flush=True)
    if hashes:
        print(f"  ip_hash {', '.join(hashes)}")
    for row in rows:
        print("  " + render_v2(row))
    for row in legacy:
        print("  " + render_legacy(row))

    for note in dict.fromkeys(warnings):
        print(f"  note: {note}", file=sys.stderr)

    if not rows and not legacy:
        print(f"\nno records found: {label}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
