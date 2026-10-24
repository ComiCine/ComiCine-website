#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.


"""Look up request records by Cloudflare Ray ID using edge analytics and D1 sources.

Data sources:
    1. Cloudflare GraphQL Analytics API provides edge records, including the real client IP.
       The per-request httpRequestsAdaptive dataset (the only one with rayName) requires
       Logpush/Enterprise-level field access. This zone cannot query `rayname`, so on permission
       errors the script falls back to httpRequestsAdaptiveGroups (available on the free plan) and
       correlates the same request by time window, host, path, status, and client IP. It does not
       fall back for other failures such as network errors or timeouts: the aggregated dataset has
       no Ray ID and cannot provide this record, so the error is reported for retry.
    2. D1 ray_log_v2 / ray_log / events contain site-side details recorded from CF-Ray. These are
       produced only on the Pages side and are removed by retention policies, so they supplement
       the edge data.

Usage:
    python3 ops/check_ray_id.py a334352fe9806564-AMS
    RAYID=a334352fe9806564-AMS python3 ops/check_ray_id.py
    python3 ops/check_ray_id.py <rayid> --minutes 60   # widen the edge search window

Exit codes: 0 if found; 1 if not found or query failed; 2 for an invalid Ray ID.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("LIMOOO_ROOT") or Path(__file__).resolve().parents[1])
sys.path.insert(0, str(ROOT))

from ops import d1_client  # noqa: E402

GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql"
ZONE_NAME = "limooo.cn"
DEFAULT_WINDOW_MINUTES = 30


def normalize_ray(raw: str) -> tuple[str, str]:
    """Return (16 lowercase hex characters, uppercase colo suffix or empty string)."""
    value = (raw or "").strip()
    if not value:
        raise ValueError("invalid Ray ID")
    parts = value.split("-", 1)
    hexpart = parts[0].lower()
    colo = parts[1].upper() if len(parts) > 1 else ""
    hexpart = "".join(ch for ch in hexpart if ch in "0123456789abcdef")
    if not re.fullmatch(r"[0-9a-f]{16}", hexpart):
        raise ValueError("invalid Ray ID")
    return hexpart, colo


def cf_request(cfg: dict[str, str], url: str, body: object | None = None) -> dict:
    """Call the Cloudflare API with backoff retries (local connections to CF can reset occasionally)."""
    headers = {"Authorization": f"Bearer {cfg['token']}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - Retry transient network failures uniformly.
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Cloudflare API request failed: {last}")


def gql(cfg: dict[str, str], query: str) -> dict:
    payload = cf_request(cfg, GRAPHQL_URL, {"query": query})
    if payload.get("errors"):
        message = "; ".join(str(e.get("message")) for e in payload["errors"])
        raise RuntimeError(message)
    return payload.get("data") or {}


def zone_id(cfg: dict[str, str]) -> str | None:
    data = cf_request(cfg, f"https://api.cloudflare.com/client/v4/zones?name={ZONE_NAME}")
    for zone in data.get("result") or []:
        if zone.get("name") == ZONE_NAME:
            return zone.get("id")
    return None


def d1_lookup(cfg: dict[str, str], ray: str) -> tuple[list[str], str | None]:
    """Search three D1 tables and return (formatted rows, error message)."""
    # Prefix matching is **intentional**: stored ray values include a colo suffix (for example, `a48923a17e543777-LAX`),
    # while `normalize_ray()` returns only 16 hexadecimal characters, so the value assembled below contains only [0-9a-f].
    # Use a range comparison instead of `LIKE '<id>%'`: `ray` is a primary key or indexed in all three tables. Query plans changed
    # from `SCAN` (a full index scan) to `SEARCH (col>? AND col<?)`. A lookup previously scanned about
    # 59,000 index entries across ray_log (29,332), ray_log_v2 (2,351), and events (26,884).
    # Use `ray + U+10FFFF` as the upper bound; it exceeds any possible suffix and matches `-LAX`, `-SIN`, or no suffix.
    upper = f"{ray}{chr(0x10FFFF)}"
    queries = (
        (
            "ray_log_v2",
            "SELECT ray, ts, host, normalized_path AS path, method, status, "
            f"ip_hash, country FROM ray_log_v2 WHERE ray >= '{ray}' AND ray < '{upper}' ORDER BY ts DESC LIMIT 100",
        ),
        (
            "ray_log",
            "SELECT ray, ts, host, path, method, status, ip, country "
            f"FROM ray_log WHERE ray >= '{ray}' AND ray < '{upper}' ORDER BY ts DESC LIMIT 100",
        ),
        (
            "events",
            "SELECT event, ts, request_id AS ray, host, path, method, status, "
            f"outcome, ip_hash, country FROM events WHERE request_id >= '{ray}' AND request_id < '{upper}' ORDER BY ts DESC LIMIT 100",
        ),
    )
    lines: list[str] = []
    errors: list[str] = []
    for source, sql in queries:
        rows = d1_query_retry(cfg, sql)
        if rows is None:
            # Distinguish network/API failures from a confirmed missing record, or a failed lookup could be
            # incorrectly reported as no record.
            errors.append(source)
            continue
        for row in rows:
            lines.append(render_d1_row(source, row))
    error = (
        f"these tables failed to query (network/API flake; this does NOT mean there are no records): "
        f"{', '.join(errors)}"
        if errors
        else None
    )
    return lines, error


d1_query_retry = d1_client.d1_query_retry


def render_d1_row(source: str, row: dict[str, object]) -> str:
    ts = row.get("ts")
    stamp = dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if isinstance(ts, (int, float)) else ""
    host = row.get("host", "")
    method = row.get("method", "")
    path = row.get("path") or row.get("normalized_path") or ""
    status = row.get("status", "")
    identifier = row.get("ip_hash") or row.get("ip") or "-"
    country = row.get("country", "")
    return f"{stamp} {host} {method} {path} {status} ip={identifier} country={country} [{source}]"


def edge_lookup(
    cfg: dict[str, str],
    zone: str,
    ray: str,
    colo: str,
    minutes: int,
) -> tuple[list[str], str | None]:
    """Look up a request at the edge.

    The per-request dataset includes rayName but this zone cannot access it. Fall back to the
    aggregate dataset only for this permission error, correlating candidates by time window.
    Do not treat network, timeout, or GraphQL errors as eligible for fallback: the aggregate
    dataset has no Ray ID and cannot return this request's record. Report the error so the caller
    can retry. Return (formatted rows, explanation).
    """
    since = (dt.datetime.now(dt.UTC) - dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")
    exact = f'''{{
      viewer {{ zones(filter: {{zoneTag: "{zone}"}}) {{
        httpRequestsAdaptive(limit: 10, filter: {{rayName: "{ray}", datetime_geq: "{since}"}}) {{
          rayName datetime clientRequestHTTPHost clientRequestHTTPMethodName clientRequestPath
          edgeResponseStatus clientIP clientCountryName clientASNDescription userAgent
        }}
      }} }}
    }}'''
    try:
        data = gql(cfg, exact)
        groups = (data.get("viewer", {}).get("zones") or [{}])[0].get("httpRequestsAdaptive") or []
        if groups:
            return [render_edge_row(r) for r in groups], None
        return [], None
    except RuntimeError as exc:
        detail = str(exc).lower()
        if "rayname" not in detail and "access to the field" not in detail:
            # The old message claimed a fallback to aggregated data, but the code returned directly.
            # The message and behavior did not match (tasks/22 W7-12); state accurately that no fallback occurred.
            return [], (
                f"edge per-request query failed ({exc}); this is not a permission error, "
                "so no aggregated fallback was attempted (the aggregated dataset has no Ray ID "
                "and cannot answer this lookup). Retry, or check the Ray ID again later."
            )

    # Aggregated fallback: without a Ray ID, provide candidates by time window and colo only.
    agg = f'''{{
      viewer {{ zones(filter: {{zoneTag: "{zone}"}}) {{
        httpRequestsAdaptiveGroups(
          limit: 20,
          filter: {{datetime_geq: "{since}"}},
          orderBy: [datetime_DESC]
        ) {{
          count
          dimensions {{
            datetime clientIP clientRequestHTTPHost clientRequestPath clientRequestHTTPMethodName
            edgeResponseStatus clientCountryName coloCode
          }}
        }}
      }} }}
    }}'''
    data = gql(cfg, agg)
    groups = (data.get("viewer", {}).get("zones") or [{}])[0].get("httpRequestsAdaptiveGroups") or []
    # The Ray ID's colo suffix applies only to **that request**, while candidates come from other requests.
    # Do not filter by colo or the result will almost always be empty; show colo as a reference only.
    rows = [
        render_edge_row(item.get("dimensions") or {}, aggregated=True, count=item.get("count"))
        for item in groups
    ]
    note = (
        f"this account cannot read the per-request dataset httpRequestsAdaptive.rayName, "
        f"so the Ray ID cannot be pinpointed; below are edge request candidates from the last "
        f"{minutes} minutes (newest first, for cross-checking, NOT records of this Ray ID)."
    )
    return rows, note


def render_edge_row(row: dict[str, object], aggregated: bool = False, count: object = None) -> str:
    raw_ts = row.get("datetime")
    stamp = str(raw_ts).replace("T", " ").replace("Z", "")[:19] if raw_ts else ""
    host = row.get("clientRequestHTTPHost", "")
    method = row.get("clientRequestHTTPMethodName", "")
    path = row.get("clientRequestPath", "")
    status = row.get("edgeResponseStatus", "")
    ip = row.get("clientIP", "-")
    country = row.get("clientCountryName", "")
    asn = row.get("clientASNDescription", "")
    colo = row.get("coloCode", "")
    suffix = f" colo={colo}" if colo else ""
    count_part = f" count={count}" if aggregated and count else ""
    asn_part = f" asn={asn}" if asn else ""
    return f"{stamp} {host} {method} {path} {status} ip={ip} country={country}{asn_part}{suffix}{count_part} [edge]"


def main() -> int:
    parser = argparse.ArgumentParser(description="Look up request records by Cloudflare Ray ID")
    parser.add_argument("rayid", nargs="?", help="Cloudflare Ray ID, e.g. a334352fe9806564-AMS")
    parser.add_argument("--minutes", type=int, default=DEFAULT_WINDOW_MINUTES, help="edge search window in minutes")
    parser.add_argument(
        "--edge-candidates",
        action="store_true",
        help="also print degraded edge candidates even when D1 hits (by default only shown on a miss)",
    )
    args = parser.parse_args()

    raw = args.rayid or os.environ.get("RAYID") or ""
    try:
        ray, colo = normalize_ray(raw)
    except ValueError:
        print("invalid Ray ID", file=sys.stderr)
        return 2

    cfg = d1_client.cloudflare_config(d1_client.load_env(ROOT / "secrets" / "webauthn.env"))
    found = False

    # Unbuffered stderr can interleave with stdout; flush stdout before writing to stderr.
    def warn(message: str) -> None:
        sys.stdout.flush()
        print(message, file=sys.stderr)
        sys.stderr.flush()

    # 1) Edge
    print("Cloudflare edge", flush=True)
    degraded = False
    edge_error = False
    try:
        zone = zone_id(cfg)
        if not zone:
            edge_error = True
            warn(f"  could not resolve zone: {ZONE_NAME}")
        else:
            rows, note = edge_lookup(cfg, zone, ray, colo, args.minutes)
            if note:
                degraded = True
                edge_rows = rows
                print(f"  {note}")
                # Candidates are not records for this Ray ID and do not count as found. Keep them hidden by default;
                # show them when D1 also has no match or when --edge-candidates is specified.
                if args.edge_candidates:
                    for line in rows:
                        print("  " + line)
                    edge_rows = []
            else:
                edge_rows = rows
                for line in rows:
                    print("  " + line)
                found = found or bool(rows)
    except Exception as exc:  # noqa: BLE001 - Use the common error handling for operations scripts.
        warn(f"  edge query failed: {exc}")
        edge_error, edge_rows = True, []

    # 2) D1 (additional source)
    print("D1 site logs", flush=True)
    d1_error = False
    try:
        rows, err = d1_lookup(cfg, ray)
        for line in rows:
            print("  " + line)
        found = found or bool(rows)
        if err:
            d1_error = True
            warn(f"  {err}")
    except Exception as exc:  # noqa: BLE001
        d1_error = True
        warn(f"  D1 query failed: {exc}")

    # If neither exact source matches but fallback candidates exist, show them for manual comparison.
    if degraded and not found and edge_rows:
        print("edge candidates (degraded, not an exact match)", flush=True)
        for line in edge_rows:
            print("  " + line)

    if not found:
        if edge_error or d1_error:
            # A query failure does not mean the record is missing; distinguish it from a complete miss.
            failed_sources = ", ".join(
                source for source, failed in (("Edge", edge_error), ("D1", d1_error)) if failed
            )
            warn(f"\nquery incomplete: {ray} ({failed_sources} query failed; please retry)")
            return 1
        hint = " (no permission for an exact edge match; candidates listed for comparison)" if degraded else ""
        warn(f"\nno records found: {ray}" + (f"-{colo}" if colo else "") + hint)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
