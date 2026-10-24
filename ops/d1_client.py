#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.


"""Shared client for Limooo and the Cloudflare D1 API.

Handles environment-variable loading and HTTP queries only; never echoes token/value pairs.
Reused by operations scripts such as prune_d1.py, check_visitor_id.py, check_ray_id.py, and
check_ip_rays.py.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from config import CLOUDFLARE_API_BASE, D1_DATABASE_ID  # noqa: E402


def load_env(*paths: str | Path) -> dict[str, str]:
    """Read env files; return an empty mapping when a file is missing and never echo values."""
    result: dict[str, str] = {}
    for raw_path in paths:
        path = Path(raw_path)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
    return result


def env_value(env: dict[str, str], *names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
        value = env.get(name)
        if value:
            return value
    return default


def cloudflare_config(env: dict[str, str]) -> dict[str, str]:
    return {
        "token": env_value(env, "CLOUDFLARE_API_TOKEN"),
        "account_id": env_value(env, "CLOUDFLARE_ACCOUNT_ID"),
        "database_id": env_value(env, "D1_DATABASE_ID", default=D1_DATABASE_ID),
    }


def d1_query(cfg: dict[str, str], sql: str) -> list[dict[str, Any]]:
    """Send one SQL statement to the D1 API; write operations use the same query endpoint."""
    token = cfg["token"]
    account_id = cfg["account_id"]
    database_id = cfg["database_id"]
    if not token or not account_id or not database_id:
        raise RuntimeError("Cloudflare / D1 config missing")
    url = f"{CLOUDFLARE_API_BASE}/accounts/{account_id}/d1/database/{database_id}/query"
    body = json.dumps({"sql": sql}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"D1 HTTP {exc.code}: {detail}") from exc
    if not data.get("success"):
        raise RuntimeError(f"D1 API returned a failure: {str(data)[:300]}")
    results = data.get("result") or []
    if not results:
        return []
    first = results[0] or {}
    if not first.get("success"):
        raise RuntimeError(f"D1 query failed: {str(first)[:300]}")
    return first.get("results") or []


def d1_query_retry(
    cfg: dict[str, str],
    sql: str,
    tries: int = 4,
    *,
    raise_on_failure: bool = False,
) -> list[dict[str, Any]] | None:
    """Retry d1_query with backoff for occasional local-to-Cloudflare connection resets.

    This logic used to be duplicated in check_ip_rays.py, check_ray_id.py, and
    check_visitor_id.py. The first two returned None while the last raised RuntimeError;
    raise_on_failure now makes the failure behavior consistent.

    Failure semantics matter: None means the query failed, which must be distinguished from a
    confirmed absence of records. Callers must not report network instability as missing data.
    """
    last: Exception | None = None
    for attempt in range(tries):
        try:
            return d1_query(cfg, sql)
        except Exception as exc:  # noqa: BLE001 - Handle transient network failures uniformly.
            last = exc
            if attempt < tries - 1:
                time.sleep(1.5 * (attempt + 1))
    if raise_on_failure:
        raise RuntimeError(str(last))
    return None


SCAN_PROBE_CAP = 50_000


def bounded_row_count(
    cfg: dict[str, str],
    table: str,
    where: str = "",
    cap: int = SCAN_PROBE_CAP,
) -> tuple[int, bool] | None:
    """Probe a bounded row count; return (row count, reached cap), or None on failure.

    Diagnostic scripts should report how many rows a query will scan (tasks/22 W7-9), but
    COUNT(*) itself reads the table. Use `SELECT COUNT(*) FROM (SELECT 1 FROM t WHERE ... LIMIT cap)`
    to read at most cap rows. When the cap is reached, report "at least cap rows" accurately.
    """
    clause = f" WHERE {where}" if where else ""
    sql = f"SELECT COUNT(*) AS count FROM (SELECT 1 FROM {table}{clause} LIMIT {int(cap)})"
    rows = d1_query_retry(cfg, sql)
    if rows is None:
        return None
    count = int(rows[0].get("count") or 0) if rows else 0
    return count, count >= int(cap)


def scan_note(
    cfg: dict[str, str],
    table: str,
    where: str,
    reason: str,
    hint: str,
) -> str:
    """Describe the cost of a query accurately (tasks/22 W7-9).

    The caller's where clause determines how many rows are read. Since migration 017,
    ray_log_v2 has an (ip_hash, ts DESC) index, so looking up an ip_hash is no longer a full scan;
    the row count still depends on the data and may range from none to thousands within seven days.
    visitor_rollups.ip_enc is still unindexed and must be decrypted row by row. Diagnostic scripts
    must not cause another D1 read incident, so explain the approximate scan size before querying
    and provide a cheaper alternative.
    """
    probe = bounded_row_count(cfg, table, where)
    if probe is None:
        return (
            f"note: this run scans {table} ({reason}); the row count probe failed, "
            f"so the scan size is unknown. {hint}"
        )
    count, capped = probe
    sized = f"at least {count}" if capped else str(count)
    return f"note: this run scans {sized} rows of {table} ({reason}). {hint}"
