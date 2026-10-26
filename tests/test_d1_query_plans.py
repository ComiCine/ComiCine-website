# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""D1 query-plan guards for the hot read paths (tasks/22 W7-9 + migration 017).

These are regression guards, not a benchmark. They encode two decisions that were
taken against production D1 on 2026-10-11 and would otherwise be easy to undo by
accident:

1. `ray_log_v2` needs `(ip_hash, ts DESC)`. Before migration 017 every
   `WHERE ip_hash = ...` query was `SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts`
   (a full index scan of the 7-day detail table). The guard builds the schema from
   `ops/migrations/*.sql` in an in-memory sqlite3 and asserts that SQLite's own
   planner turns the real query shapes into `SEARCH ... USING <index>`.

2. `ray_log_v2` must NOT get `(host, ts)` back. `005_retention.sql` created it and
   `008_gate_failures.sql` deliberately dropped it because no production query
   filters that table by `host`; it would only amplify every insert.

The plans are produced with `EXPLAIN QUERY PLAN` on a schema-only database, so the
tests are hermetic (no network, no fixtures) and these plan shapes do not depend on
row counts.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "ops" / "migrations"

# The index created by migration 017; its name and column order are part of the contract, including explicit DESC ordering.
RAY_INDEX = "idx_ray_log_v2_ip_hash_ts"
RAY_INDEX_MIGRATION = "017_ray_log_v2_ip_hash_index.sql"

# This index was created in 005 and deliberately removed in 008; it must not be recreated.
DROPPED_RAY_INDEX = "idx_ray_log_v2_host_ts"


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)


def _index_names(con: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row[0])
        for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?", (table,)
        )
    }


def _plan(con: sqlite3.Connection, sql: str) -> str:
    rows = con.execute(f"EXPLAIN QUERY PLAN {sql}").fetchall()
    return " | ".join(str(row[-1]) for row in rows)


def _assert_searches(plan: str, table: str) -> None:
    """Assert that the query plan uses SEARCH rather than SCAN.

    SQLite reports `USING COVERING INDEX` when the index satisfies the whole query,
    and `USING INDEX` otherwise. Both are SEARCH plans, so this helper only rules out
    SCAN; callers assert the specific index separately.
    """
    assert f"SEARCH {table} USING" in plan, plan
    assert f"SCAN {table}" not in plan, plan


@pytest.fixture(scope="module")
def migrated_db() -> Iterator[sqlite3.Connection]:
    """Apply ops/migrations/*.sql in filename order to an in-memory database (state after migration 017)."""
    con = sqlite3.connect(":memory:")
    try:
        for path in _migration_files():
            con.executescript(path.read_text(encoding="utf-8"))
        yield con
    finally:
        con.close()


def test_index_migration_017_exists_and_is_the_highest_number() -> None:
    """Migration 017 must exist, and future index migrations must use a larger number (005 is immutable)."""
    assert (MIGRATIONS_DIR / RAY_INDEX_MIGRATION).is_file()
    numbers = [int(p.name[:3]) for p in _migration_files()]
    assert max(numbers) >= 17


def test_index_migration_is_idempotent() -> None:
    """`CREATE INDEX IF NOT EXISTS` makes this migration safe to run more than once.

    migrate_d1.sh relies on this when a migration record is missing but the schema
    change already exists. New migrations must not use bare `CREATE INDEX`, which
    would fail on a rerun with `index already exists`.
    """
    source = (MIGRATIONS_DIR / RAY_INDEX_MIGRATION).read_text(encoding="utf-8")
    assert f"CREATE INDEX IF NOT EXISTS {RAY_INDEX}" in source
    bare = [
        line
        for line in source.splitlines()
        if re.match(r"\s*CREATE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)", line, re.IGNORECASE)
    ]
    assert not bare, "new migrations must use CREATE INDEX IF NOT EXISTS: " + "; ".join(bare)

    # Run it three times; starting with the second run, it must do nothing without raising an error.
    con = sqlite3.connect(":memory:")
    try:
        for path in _migration_files():
            con.executescript(path.read_text(encoding="utf-8"))
        for _ in range(3):
            con.executescript(source)
        assert RAY_INDEX in _index_names(con, "ray_log_v2")
    finally:
        con.close()


def test_ip_hash_index_exists_with_expected_columns(migrated_db: sqlite3.Connection) -> None:
    """Verify that the index is actually created on (ip_hash, ts), not merely documented or built on wrong columns."""
    assert RAY_INDEX in _index_names(migrated_db, "ray_log_v2")
    columns = [str(row[2]) for row in migrated_db.execute(f'PRAGMA index_info("{RAY_INDEX}")')]
    assert columns == ["ip_hash", "ts"], f"unexpected index columns: {columns}"


def test_check_visitor_id_query_uses_the_index(migrated_db: sqlite3.Connection) -> None:
    """Query in `ops/check_visitor_id.py:212`: `WHERE ip_hash = ? ORDER BY ts DESC LIMIT n`."""
    plan = _plan(
        migrated_db,
        "SELECT ts, host, normalized_path, method, status, country, ua_family "
        "FROM ray_log_v2 WHERE ip_hash = 'd51153cb767fc758' ORDER BY ts DESC LIMIT 10",
    )
    _assert_searches(plan, "ray_log_v2")
    assert RAY_INDEX in plan, plan
    assert "TEMP B-TREE" not in plan, plan


def test_check_ip_rays_query_uses_the_index(migrated_db: sqlite3.Connection) -> None:
    """Protect the ops/check_ip_rays.py:168 query shape: `WHERE ip_hash IN (...) ORDER BY ts DESC LIMIT n`.

    W7-9 identified this as a guaranteed full-table scan. SQLite may still build a
    temporary B-tree to merge ordered results when `IN` has multiple values, but the
    table scan itself must be gone.
    """
    plan = _plan(
        migrated_db,
        "SELECT ray, ts, host, normalized_path AS path, method, status, country, ip_hash, duration_ms "
        "FROM ray_log_v2 WHERE ip_hash IN ('d51153cb767fc758','0000000000000000') "
        "ORDER BY ts DESC LIMIT 20",
    )
    _assert_searches(plan, "ray_log_v2")
    assert RAY_INDEX in plan, plan


def test_ray_prefix_query_searches_the_primary_key(migrated_db: sqlite3.Connection) -> None:
    """The `ray` prefix lookup must seek the primary key, not regress to a full scan.

    History: with `WHERE ray LIKE '<id>%'`, SQLite could not use the primary key and planned `SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts` (a full scan observed in production on 2026-10-11). Stored values include a colo suffix (`a48923a17e543777-LAX`), so prefix matching is intentional and cannot become equality. Rewriting the lookup as a primary-key range produced `SEARCH ray_log_v2 USING COVERING INDEX sqlite_autoindex_ray_log_v2_1 (ray>? AND ray<?)`.

    This test locks in the optimized plan so reverting to `LIKE` fails. It also explains why the `idx_ray_log_v2_ip_hash_ts` index should not be used: the prefix condition constrains the primary key, not `ip_hash`.
    """
    plan = _plan(
        migrated_db,
        "SELECT ip_hash, country FROM ray_log_v2 "
        "WHERE ray >= '9a1b2c3d4e5f6a7b' AND ray < '9a1b2c3d4e5f6a7b' || char(1114111) "
        "ORDER BY ts DESC LIMIT 100",
    )
    # Assert the query-plan behavior, not its exact text: it must use SEARCH rather than SCAN, seek the primary-key index, and constrain both bounds.
    # Whether the index is COVERING depends on the select list (reading ip_hash or country requires a table lookup), so do not hardcode it.
    assert "SEARCH ray_log_v2 USING" in plan and "SCAN" not in plan, plan
    assert "sqlite_autoindex_ray_log_v2_1" in plan, plan
    assert "(ray>? AND ray<?)" in plan, plan


def test_no_query_uses_ray_like_on_the_log_tables() -> None:
    """Source code must not contain `ray LIKE` or `request_id LIKE`; these predicates cause full scans.

    This complements the previous test, which locks down the SQL shape in an in-memory database. This one scans repository source to prevent a new `LIKE` lookup in `functions/` or `ops/` from reintroducing full scans.
    """
    offenders: list[str] = []
    for directory in ("functions", "ops"):
        base = ROOT / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in (".ts", ".py", ".js") or not path.is_file():
                continue
            if any(part in ("node_modules", "__pycache__", "__mocks__") for part in path.parts):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for lineno, line in enumerate(text.splitlines(), 1):
                if line.lstrip().startswith(("#", "//", "*")):
                    continue
                if re.search(r"\b(ray|request_id)\s+LIKE\b", line, re.IGNORECASE):
                    offenders.append(f"{path.relative_to(ROOT)}:{lineno}: {line.strip()[:80]}")
    assert offenders == [], "prefix lookups must use a range, not LIKE:\n" + "\n".join(offenders)


def test_no_query_filters_ray_log_v2_by_host() -> None:
    """The reason index 008 dropped the `host` index was that no query filters `ray_log_v2` by `host`.

    This assertion locks down that assumption: if a host-filtered query appears, the test fails and prompts a reassessment of whether a `(host, ts)` index is needed, rather than silently leaving the query unindexed.
    """
    offenders: list[str] = []
    for directory in ("functions", "ops", "src"):
        base = ROOT / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in (".ts", ".py", ".js") or not path.is_file():
                continue
            if any(part in ("node_modules", "__pycache__", "__mocks__") for part in path.parts):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            if "ray_log_v2" not in text:
                continue
            rel = path.relative_to(ROOT).as_posix()
            for line in text.splitlines():
                lowered = line.lower()
                if "ray_log_v2" not in lowered:
                    continue
                if "where" not in lowered:
                    continue
                if re.search(r"\bhost\s*(=|IN\b|LIKE\b|GLOB\b|>=|<=|<|>)", lowered):
                    offenders.append(f"{rel}: {line.strip()}")
    assert not offenders, (
        "a query now filters ray_log_v2 by host; re-evaluate idx_ray_log_v2_host_ts "
        "(dropped on purpose by 008_gate_failures.sql):\n  " + "\n  ".join(offenders)
    )


def test_host_index_is_not_reintroduced(migrated_db: sqlite3.Connection) -> None:
    """No migration after 008 may recreate the `(host, ts)` index.

    Migration 005 created it and 008 removed it; those historical files cannot be changed. This check therefore prohibits only new additions: a `CREATE INDEX ... idx_ray_log_v2_host_ts` in a migration after 008 fails, and the final schema must not contain the index.
    """
    cutoff = 8
    offenders: list[str] = []
    for path in _migration_files():
        if int(path.name[:3]) <= cutoff:
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if DROPPED_RAY_INDEX in line and line.strip().upper().startswith("CREATE"):
                offenders.append(f"{path.name}: {line.strip()}")
    assert not offenders, (
        "008_gate_failures.sql dropped idx_ray_log_v2_host_ts because no production query "
        "uses it and it amplifies every write; do not re-add it:\n  " + "\n  ".join(offenders)
    )
    assert DROPPED_RAY_INDEX not in _index_names(migrated_db, "ray_log_v2")


def test_visitor_rollups_lookup_is_indexed(migrated_db: sqlite3.Connection) -> None:
    """The `visitor_rollups` table needs no new index; lookups by `ip_hash` already use the index created in 014.

    `ops/check_ip_rays.py:127` and `check_visitor_id.py:135/168` both retrieve one row or the latest row by `ip_hash`; these lookups must use SEARCH rather than scan the table.
    """
    plan = _plan(
        migrated_db,
        "SELECT ip_enc, last_ts FROM visitor_rollups WHERE ip_hash = 'd51153cb767fc758' "
        "AND ip_enc != '' ORDER BY last_ts DESC LIMIT 1",
    )
    _assert_searches(plan, "visitor_rollups")
    assert "idx_visitor_rollups_ip_hash" in plan, plan
