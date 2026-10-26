#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.


"""Manage ComiCine D1 retention and daily aggregation (tasks/11).

This script is read-only by default. Pass --apply explicitly to aggregate or delete data.
Examples below perform production actions and must be recorded in docs/parallel-actions.md first:

    python3 ops/prune_d1.py --mode all                 # read-only: report counts and plan
    python3 ops/prune_d1.py --mode aggregate --apply   # aggregate visitors_daily
    python3 ops/prune_d1.py --mode prune --apply       # delete old data by retention policy

The authoritative retention policy is owned by `ops/status-worker/src/retention.ts`, scheduled
daily at 03:47 by the Worker cron; readme_facts.py also reads only that file. This module compares
its values with the owner on import and fails on any difference. Before 2026-10-11, this file had
a separate four-table policy that drifted from the owner's eight tables (tasks/22 W7-8). The two
copies are no longer allowed to coexist:

    ray_log_v2  7 days
    visitors_v2 / visitor_rollups / heartbeats 30 days
    auth_sessions 60 days
    identity_handoffs 1 day
    events / probe_uptime_daily 90 days
    visitors_daily permanent (daily aggregation over complete UTC days only)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "ops"))
sys.path.insert(0, str(ROOT / "src"))

from d1_client import cloudflare_config, d1_query, load_env  # noqa: E402

from config import ENV_FILE  # noqa: E402

DAY_SECONDS = 86400
RETENTION_TS = ROOT / "ops" / "status-worker" / "src" / "retention.ts"
# Aggregation window: include only **complete UTC days**; the current day is still in progress.
AGGREGATE_COMPLETE_DAYS = 7

# The table below must match the owner's retention.ts entry by entry. verify_retention_matches_owner() enforces this at import time.
# Keep the values literal so the retention windows are easy to inspect and tests/test_d1_schema.py can read table names from
# the source. The owner remains authoritative for the values; any drift fails validation.
BUCKETS: dict[str, int] = {
    "ray_log_v2": 7 * DAY_SECONDS,
    "visitors_v2": 30 * DAY_SECONDS,
    "visitor_rollups": 30 * DAY_SECONDS,
    "events": 90 * DAY_SECONDS,
    "heartbeats": 30 * DAY_SECONDS,
    "probe_uptime_daily": 90 * DAY_SECONDS,
    "auth_sessions": 60 * DAY_SECONDS,
    "identity_handoffs": DAY_SECONDS,
}
RETENTION_TIMESTAMP_COLUMNS: dict[str, str] = {
    "visitor_rollups": "last_ts",
    "probe_uptime_daily": "day",
    "auth_sessions": "exp",
    "identity_handoffs": "expires_at",
}


def parse_retention_source(path: Path | str = RETENTION_TS) -> tuple[dict[str, int], dict[str, str]]:
    """Read (table -> retention seconds, table -> timestamp column) from the owner's TS source.

    Raise an error if parsing fails instead of falling back to a duplicate policy in this file.
    """
    source = Path(path)
    text = source.read_text(encoding="utf-8")
    block = re.search(r"export const BUCKETS[^=]*=\s*\{(.*?)\n\};", text, re.S)
    if not block:
        raise RuntimeError(f"cannot read BUCKETS out of {source}")
    buckets = {
        name: int(days) * DAY_SECONDS
        for name, days in re.findall(r"(\w+):\s*(\d+)\s*\*\s*DAY_SECONDS", block.group(1))
    }
    if not buckets:
        raise RuntimeError(f"parsed an empty BUCKETS out of {source}")
    columns_block = re.search(r"export const TIMESTAMP_COLUMNS[^=]*=\s*\{(.*?)\n\};", text, re.S)
    columns = (
        dict(re.findall(r"(\w+):\s*\"(\w+)\"", columns_block.group(1))) if columns_block else {}
    )
    return buckets, columns


def verify_retention_matches_owner(path: Path | str = RETENTION_TS) -> None:
    """Fail immediately if the owner changes, preventing two conflicting retention policies."""
    buckets, columns = parse_retention_source(path)
    if BUCKETS != buckets:
        raise RuntimeError(
            "retention policy drifted from ops/status-worker/src/retention.ts "
            f"(owner): python={BUCKETS} owner={buckets}"
        )
    if RETENTION_TIMESTAMP_COLUMNS != columns:
        raise RuntimeError(
            "retention timestamp columns drifted from ops/status-worker/src/retention.ts "
            f"(owner): python={RETENTION_TIMESTAMP_COLUMNS} owner={columns}"
        )


verify_retention_matches_owner()


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _count_rows(cfg: dict[str, str], table: str, cutoff: int) -> int:
    timestamp_column = RETENTION_TIMESTAMP_COLUMNS.get(table, "ts")
    rows = d1_query(
        cfg,
        f"SELECT COUNT(*) AS count FROM {table} WHERE {timestamp_column} < {cutoff}",
    )
    return int(rows[0].get("count") or 0) if rows else 0


def _day_start_expr() -> str:
    """Return the current UTC midnight by flooring unixepoch() to a multiple of 86400."""
    return f"(unixepoch() / {DAY_SECONDS}) * {DAY_SECONDS}"


def _aggregate_window(days: int = AGGREGATE_COMPLETE_DAYS) -> tuple[str, str]:
    """Return (window start, window end), covering complete UTC days only and excluding today."""
    return f"{_day_start_expr()} - {int(days) * DAY_SECONDS}", _day_start_expr()


def _aggregate_sql(days: int = AGGREGATE_COMPLETE_DAYS) -> str:
    """Combine legacy detail and hourly rollups into visitors_daily (safe to rerun).

    Two requirements (tasks/22 W7-5):

    1. Aggregate complete UTC days only: `[day_start - days*86400, day_start)`. A rolling 24-hour
       window previously recalculated yesterday's row from only a partial day's data.
    2. Use `ON CONFLICT ... DO UPDATE SET x = MAX(x, excluded.x)`, matching
       ops/migrations/013_backfill_probe_uptime.sql. SQLite's `INSERT OR REPLACE` deletes a
       conflicting row before inserting, permanently overwriting earlier hourly totals. MAX makes
       reruns monotonic and never reduces a previously recorded count.
    """
    start, end = _aggregate_window(days)
    return (
        "INSERT INTO visitors_daily "
        "(day, country, page_slug, status, unique_ips, requests) "
        "WITH combined AS ("
        "SELECT ts, ip_hash, country, page_slug, status, 1 AS requests, "
        "'v:' || id AS fallback_id FROM visitors_v2 "
        f"WHERE ts >= {start} AND ts < {end} UNION ALL "
        "SELECT last_ts AS ts, ip_hash, country, page_slug, status, requests, "
        "'r:' || bucket_hour || ':' || country || ':' || status || ':' || page_slug AS fallback_id "
        "FROM visitor_rollups "
        f"WHERE last_ts >= {start} AND last_ts < {end}) "
        "SELECT strftime('%Y-%m-%d', ts, 'unixepoch'), country, page_slug, status, "
        "COUNT(DISTINCT CASE WHEN ip_hash <> '' THEN ip_hash ELSE fallback_id END), SUM(requests) "
        "FROM combined "
        "GROUP BY strftime('%Y-%m-%d', ts, 'unixepoch'), country, page_slug, status "
        "ON CONFLICT (day, country, page_slug, status) DO UPDATE SET "
        "unique_ips = MAX(unique_ips, excluded.unique_ips), "
        "requests = MAX(requests, excluded.requests)"
    )


def _aggregate_count_sql(days: int = AGGREGATE_COMPLETE_DAYS) -> str:
    start, end = _aggregate_window(days)
    return (
        "SELECT COUNT(*) AS count FROM ("
        "SELECT strftime('%Y-%m-%d', ts, 'unixepoch') AS day, country, page_slug, status "
        "FROM (SELECT ts, country, page_slug, status FROM visitors_v2 "
        f"WHERE ts >= {start} AND ts < {end} UNION ALL "
        "SELECT last_ts AS ts, country, page_slug, status FROM visitor_rollups "
        f"WHERE last_ts >= {start} AND last_ts < {end}) "
        "GROUP BY day, country, page_slug, status)"
    )


def _write_retention_state(
    cfg: dict[str, str],
    name: str,
    *,
    success: bool,
    deleted: int = 0,
    error: str = "",
) -> None:
    message = f"bucket={name};deleted={deleted}" if success else f"bucket={name};error={error}"
    now = "unixepoch()"
    state = (
        "INSERT OR REPLACE INTO retention_state "
        "(name, last_run_at, last_success_at, last_error) "
        f"VALUES ({_quote(name)}, {now}, "
        f"{now if success else 0}, {_quote(error)})"
    )
    d1_query(cfg, state)
    event = (
        "INSERT INTO events "
        "(event, ts, request_id, host, path, method, status, outcome, ip_hash, "
        "country, duration_ms, message) "
        f"VALUES ('prune_result', {now}, '', 'ops', '/retention', 'run', "
        f"{200 if success else 500}, '{'ok' if success else 'failed'}', '', '', 0, "
        f"{_quote(message)})"
    )
    d1_query(cfg, event)


def aggregate_daily(cfg: dict[str, str], days: int = AGGREGATE_COMPLETE_DAYS) -> dict[str, Any]:
    """Reaggregate recent complete UTC days into visitors_daily (idempotent and monotonic).

    The Worker `retention.ts` owns the daily cron policy. This is the manual operations entry point;
    both use the same window definition (see the module docstring).
    """
    d1_query(cfg, _aggregate_sql(days))
    _write_retention_state(cfg, "visitors_daily", success=True)
    return {"visitors_daily": "updated"}


def prune_buckets(cfg: dict[str, str]) -> dict[str, Any]:
    """Prune v2 tables, probe details, sessions, and events by retention policy; record retention_state."""
    result: dict[str, int] = {}
    now = "unixepoch()"
    for table, seconds in BUCKETS.items():
        cutoff_expr = f"{now} - {seconds}"
        timestamp_column = RETENTION_TIMESTAMP_COLUMNS.get(table, "ts")
        rows = d1_query(
            cfg,
            f"SELECT COUNT(*) AS count FROM {table} "
            f"WHERE {timestamp_column} < {cutoff_expr}",
        )
        count = int(rows[0].get("count") or 0) if rows else 0
        d1_query(cfg, f"DELETE FROM {table} WHERE {timestamp_column} < {cutoff_expr}")
        _write_retention_state(cfg, table, success=True, deleted=count)
        result[table] = count
    return result


def dry_run(cfg: dict[str, str], mode: str, days: int = AGGREGATE_COMPLETE_DAYS) -> dict[str, Any]:
    """Read-only counts: create no tables, write no state, and delete no data."""
    plan: dict[str, Any] = {"mode": mode, "buckets": {}}
    if mode in ("all", "prune"):
        for table, seconds in BUCKETS.items():
            timestamp_column = RETENTION_TIMESTAMP_COLUMNS.get(table, "ts")
            rows = d1_query(
                cfg,
                f"SELECT COUNT(*) AS count FROM {table} "
                f"WHERE {timestamp_column} < unixepoch() - {seconds}",
            )
            plan["buckets"][table] = int(rows[0].get("count") or 0) if rows else 0
    if mode in ("all", "aggregate"):
        rows = d1_query(cfg, _aggregate_count_sql(days))
        plan["aggregate_rows"] = int(rows[0].get("count") or 0) if rows else 0
        plan["aggregate_complete_days"] = int(days)
    return plan


def main() -> int:
    parser = argparse.ArgumentParser(description="D1 retention and daily aggregation")
    parser.add_argument(
        "--mode",
        choices=("all", "aggregate", "prune"),
        default="all",
        help="all=aggregate+prune; aggregate=aggregate only; prune=prune only",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="perform real writes/deletes; without it this is always a dry run.",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=AGGREGATE_COMPLETE_DAYS,
        metavar="N",
        help=(
            "how many complete UTC days the aggregation window covers "
            f"(default {AGGREGATE_COMPLETE_DAYS}); the current day is never included"
        ),
    )
    args = parser.parse_args()
    days = max(1, int(args.days))

    try:
        env = load_env(ENV_FILE)
        cfg = cloudflare_config(env)
        if not cfg["token"] or not cfg["account_id"] or not cfg["database_id"]:
            raise RuntimeError("Cloudflare / D1 config missing")
        if args.apply:
            if args.mode in ("all", "aggregate"):
                print(json.dumps(aggregate_daily(cfg, days), ensure_ascii=False, indent=2))
            if args.mode in ("all", "prune"):
                print(json.dumps(prune_buckets(cfg), ensure_ascii=False, indent=2))
        else:
            print(
                json.dumps(
                    {"dry_run": True, **dry_run(cfg, args.mode, days)},
                    ensure_ascii=False,
                    indent=2,
                )
            )
            print("note: --apply not passed; no writes or deletes were performed.")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
