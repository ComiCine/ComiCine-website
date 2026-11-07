# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""D1 query-plan guards for the hot read paths (tasks/22 W7-9, migration 017, tasks/2026-11-07/22).

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

Two guard families live here and must be kept apart:

- Plan guards (`test_*_uses_*`) run real SQL against the migrated schema. They assert
  index names only. They never assert whole plan strings and never assert "no SCAN" on
  a window aggregation: `WHERE ts >= ?` may legitimately plan as `SCAN <table> USING
  INDEX ...` on some sqlite versions, so a SEARCH-only rule would be a false red. The
  index choices asserted here were checked against sqlite 3.38 through 3.54 (3.38 is the
  floor: `unixepoch()`, used by 009_probes.sql, does not exist before it); only tokens
  (index name, `SEARCH`/`SCAN`, presence of `TEMP B-TREE`) are asserted, never a whole plan line.
- Source guards (`test_no_query_*`) read the tree as one whitespace-collapsed string
  per file with comments removed and match bounded windows inside a statement. A
  line-by-line scan could not see a predicate that a formatter moved to its own line.
  Every literal used by a plan guard also gets a drift assertion against the file it
  claims to come from, so a renamed or rewritten query fails immediately instead of
  testing SQL that no longer ships.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from typing import NamedTuple

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "ops" / "migrations"

# The index created by migration 017; its name and column order are part of the contract, including explicit DESC ordering.
RAY_INDEX = "idx_ray_log_v2_ip_hash_ts"
RAY_INDEX_MIGRATION = "017_ray_log_v2_ip_hash_index.sql"

# This index was created in 005 and deliberately removed in 008; it must not be recreated.
DROPPED_RAY_INDEX = "idx_ray_log_v2_host_ts"

# The source trees read by the text guards. Migrations are `.sql` and deliberately not scanned:
# 005/008 must keep their historical text, and their index behavior is covered by the plan guards.
SCANNED_DIRS = ("functions", "ops", "src")
SCANNED_SUFFIXES = (".ts", ".py", ".js")
EXCLUDED_PARTS = frozenset({"node_modules", "__pycache__", "__mocks__"})

# Query bounds used by the plan guards. The planner shape of these queries does not depend on the
# bound values, so one fixed window keeps the assertions deterministic: 2026-05-31T00:00:00Z, the
# current UTC day in the visitor fixture, with the thirty preceding whole UTC days behind it.
WINDOW_START = 1_780_185_600
WINDOW_END = WINDOW_START + 86_400
SINCE_DAY = WINDOW_START
# `visitors_daily.day` is a YYYY-MM-DD TEXT column, not an epoch integer; the end bound is exclusive.
DAY_START = "2026-05-01"
DAY_END = "2026-05-31"
STATUS_FILTER = 200

VISITORS_TS = ROOT / "functions" / "api" / "visitors.ts"
STATUS_WORKER_TS = ROOT / "ops" / "status-worker" / "src" / "index.ts"
D1_ARCHIVE_TS = ROOT / "ops" / "d1-archive" / "src" / "index.ts"

# A `/*` after a word character, a star, a quote or a slash is data, not a comment: a route glob
# (`/api/*`), a CSP wildcard (`https://*`), `**/*.ts`, or a string that opens with `/*`. Treated as a
# comment start, one such string swallows every following line up to the next real `*/` (in
# `functions/_middleware.test.ts` a single `"/api/*"` used to hide ~66 lines) and can hide a query
# from the guards while also erasing statement boundaries.
_BLOCK_COMMENT = re.compile(r"""(?<![\w*"'`/])/\*.*?\*/""", re.DOTALL)
# `//` starts a line comment unless it is the `//` of a URL scheme. The lookbehind keeps template
# strings such as `https://comicine.com/_health` intact while still removing `// ...` comments.
_LINE_COMMENT = re.compile(r"(?<!:)//[^\n]*")
# `#` is a comment only in Python sources; in TypeScript it is a CSS/hex-color character.
_PYTHON_LINE_COMMENT = re.compile(r"#[^\n]*")
_WHITESPACE = re.compile(r"\s+")

# A host filter on `ray_log_v2` is what migration 008 removed the `(host, ts)` index for. The window
# is bounded in characters and in statements so the predicate cannot hide by moving to another line,
# while an unrelated `host =` later in the same file cannot produce a false positive.
_RAY_HOST_FILTER = re.compile(
    r"\bray_log_v2\b[^;]{0,300}?\bhost\s*(?:=|IN\b|LIKE\b|GLOB\b|>=|<=|<|>)",
    re.IGNORECASE,
)
# A `LIKE` prefix lookup on the ray columns cannot use the primary key, so it must stay a range.
# LIKE must be followed by a SQL literal or a bind parameter; that keeps prose ("not a LIKE scan")
# and regex literals (`/ray\s+LIKE/i`) in test sources from tripping the guard.
_PREFIX_LIKE = re.compile(
    r"\b(?:ray|request_id)\b[^;]{0,200}?\bLIKE\s*['\"?@:$]",
    re.IGNORECASE,
)


def _normalized_text(path: Path) -> str:
    """Return the file as one whitespace-collapsed string with comments removed.

    One file maps to one string, so a query's shape no longer depends on line breaks. Statements are
    still separated by `;` (see `_statements`) and the guard patterns refuse to cross that boundary.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    text = _BLOCK_COMMENT.sub(" ", text)
    text = _LINE_COMMENT.sub(" ", text)
    if path.suffix == ".py":
        text = _PYTHON_LINE_COMMENT.sub(" ", text)
    return _WHITESPACE.sub(" ", text).strip()


def _statements(text: str) -> list[tuple[int, str]]:
    """Split normalized text on `;`, returning each statement with its offset in the normalized text."""
    return [(match.start(), match.group(0)) for match in re.finditer(r"[^;]+", text)]


def _iter_source_files(*directories: str) -> Iterator[Path]:
    for directory in directories:
        base = ROOT / directory
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if path.suffix not in SCANNED_SUFFIXES or not path.is_file():
                continue
            if any(part in EXCLUDED_PARTS for part in path.parts):
                continue
            yield path


def _find_source_matches(pattern: re.Pattern[str], *directories: str) -> list[str]:
    """Return `relative/path@offset: snippet` for every bounded-window match in the scanned trees."""
    offenders: list[str] = []
    for path in _iter_source_files(*directories):
        text = _normalized_text(path)
        if not pattern.search(text):
            continue
        relative = path.relative_to(ROOT).as_posix()
        for offset, statement in _statements(text):
            for match in pattern.finditer(statement):
                snippet = match.group(0)[:120]
                offenders.append(f"{relative}@{offset + match.start()}: {snippet}")
    return offenders


def _squash(text: str) -> str:
    """Collapse whitespace the same way `_normalized_text` does, for drift comparisons."""
    return _WHITESPACE.sub(" ", text).strip()


def _assert_anchors_present(label: str, path: Path, anchors: tuple[str, ...]) -> None:
    """Assert that hardcoded test SQL still exists in the source file it claims to mirror.

    Without this, a renamed table or a rewritten query would leave the plan guards testing a query
    that no longer ships. Anchors are literal substrings of the source file, so an interpolation
    placeholder such as `${statusFilter}` is anchored exactly as it appears in the source and the
    surrounding SQL is split into the segments around it.
    """
    text = _normalized_text(path)
    missing = [anchor for anchor in anchors if _squash(anchor) not in text]
    assert not missing, (
        f"{label}: the hardcoded SQL no longer appears in {path.relative_to(ROOT).as_posix()}; "
        "update the literal, its file:line anchor comment, and the plan assertion together:\n  "
        + "\n  ".join(missing)
    )


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)


def _apply_migrations(con: sqlite3.Connection) -> None:
    """Replay `ops/migrations/*.sql` in filename order the way `ops/migrate_d1.sh` does.

    The runner applies one complete statement at a time and skips a statement that fails with
    `duplicate column name:`. `004_blocklist_sync.sql` depends on that when it is replayed over a
    database that already has the post-004 schema: a single `executescript` would abort the file and
    leave `blocked_ips` half-built, so the plan guards could not run at all. Every other error is
    raised, exactly like the runner.
    """
    for path in _migration_files():
        pending = ""
        for line in path.read_text(encoding="utf-8").splitlines(keepends=True):
            pending += line
            if not sqlite3.complete_statement(pending):
                continue
            statement, pending = pending.strip(), ""
            try:
                con.execute(statement)
            except sqlite3.OperationalError as exc:
                if "duplicate column name" not in str(exc):
                    raise
        leftover = [
            line
            for line in pending.splitlines()
            if line.strip() and not line.lstrip().startswith("--")
        ]
        assert not leftover, f"incomplete SQL statement at the end of {path.name}: {' '.join(leftover)[:80]}"


def _index_names(con: sqlite3.Connection, table: str) -> set[str]:
    return {
        str(row[0])
        for row in con.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?", (table,)
        )
    }


def _plan(con: sqlite3.Connection, sql: str, params: tuple[object, ...] = ()) -> str:
    rows = con.execute(f"EXPLAIN QUERY PLAN {sql}", params).fetchall()
    return " | ".join(str(row[-1]) for row in rows)


def _plan_has_index(plan: str, index: str) -> bool:
    """Match an index name as a whole token.

    `idx_visitors_v2_ts` is a prefix of `idx_visitors_v2_ts_cover`, so a plain substring check would
    report the covering index as a hit for the narrower one (and vice versa for absence checks).
    """
    return re.search(rf"(?<!\w){re.escape(index)}(?!\w)", plan) is not None


def _assert_uses_index(plan: str, index: str) -> None:
    assert _plan_has_index(plan, index), f"expected the plan to use {index}: {plan}"


def _assert_index_absent(plan: str, index: str) -> None:
    assert not _plan_has_index(plan, index), f"the plan must not use {index}: {plan}"


def _assert_searches(plan: str, table: str) -> None:
    """Assert that the query plan uses SEARCH rather than SCAN.

    SQLite reports `USING COVERING INDEX` when the index satisfies the whole query,
    and `USING INDEX` otherwise. Both are SEARCH plans, so this helper only rules out
    SCAN; callers assert the specific index separately.

    Reserved for point lookups. Window aggregations must use `_assert_uses_index`: a
    `WHERE ts >= ?` range is allowed to plan as `SCAN <table> USING INDEX ...`.
    """
    assert f"SEARCH {table} USING" in plan, plan
    assert f"SCAN {table}" not in plan, plan


@pytest.fixture(scope="module")
def migrated_db() -> Iterator[sqlite3.Connection]:
    """Apply ops/migrations/*.sql in filename order to an in-memory database (the schema the Worker sees)."""
    con = sqlite3.connect(":memory:")
    try:
        _apply_migrations(con)
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
        _apply_migrations(con)
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
    _assert_uses_index(plan, RAY_INDEX)
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
    _assert_uses_index(plan, RAY_INDEX)


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


def test_no_query_filters_ray_log_v2_by_host() -> None:
    """The reason index 008 dropped the `host` index was that no query filters `ray_log_v2` by `host`.

    This assertion locks down that assumption: if a host-filtered query appears, the test fails and prompts a reassessment of whether a `(host, ts)` index is needed, rather than silently leaving the query unindexed.

    The guard runs on normalized statements, so a `WHERE` clause split across lines (the 2026-11-07 bypass) is still caught. Each offending match reports its relative path and offset inside the normalized file text.
    """
    offenders = _find_source_matches(_RAY_HOST_FILTER, "functions", "ops", "src")
    assert not offenders, (
        "a query now filters ray_log_v2 by host; re-evaluate idx_ray_log_v2_host_ts "
        "(dropped on purpose by 008_gate_failures.sql):\n  " + "\n  ".join(offenders)
    )


def test_no_query_uses_ray_like_on_the_log_tables() -> None:
    """Source code must not contain `ray LIKE` or `request_id LIKE`; these predicates cause full scans.

    This complements the plan guard, which locks down the SQL shape in an in-memory database. This one scans repository source to prevent a new `LIKE` lookup in `functions/` or `ops/` from reintroducing full scans, including the multi-line spelling that a line-based scan missed.
    """
    offenders = _find_source_matches(_PREFIX_LIKE, "functions", "ops")
    assert not offenders, "prefix lookups must use a range, not LIKE:\n" + "\n".join(offenders)


def test_host_guard_sees_a_predicate_split_across_lines(tmp_path: Path) -> None:
    """The 2026-11-07 gap: one predicate per line made the line-based guard blind.

    The comment at the top mentions the same predicate, and it must be stripped rather than counted.
    """
    demo = tmp_path / "gap_demo.ts"
    demo.write_text(
        "// prose mentioning ray_log_v2 WHERE host = ? must not count\n"
        "export const SQL = `\n"
        "  SELECT ray, ts\n"
        "  FROM ray_log_v2\n"
        "  WHERE\n"
        "    host = ?\n"
        "`;\n",
        encoding="utf-8",
    )
    text = _normalized_text(demo)
    assert "prose mentioning" not in text
    assert _RAY_HOST_FILTER.search(text)


def test_prefix_like_guard_sees_a_predicate_split_across_lines(tmp_path: Path) -> None:
    """A `LIKE` moved to its own line is still a prefix lookup, but a regex literal about it is not."""
    demo = tmp_path / "gap_demo.ts"
    demo.write_text(
        "db.prepare(`SELECT ray FROM ray_log_v2 WHERE ray\n  LIKE 'abc%'`);\n"
        "expect(sql).not.toMatch(/ray\\s+LIKE/i);\n",
        encoding="utf-8",
    )
    text = _normalized_text(demo)
    assert len(_PREFIX_LIKE.findall(text)) == 1


def test_guard_windows_do_not_cross_a_statement(tmp_path: Path) -> None:
    """A `host = ...` assignment after the SQL statement must not be read as part of the query."""
    demo = tmp_path / "gap_demo.ts"
    demo.write_text(
        "const a = `SELECT ts FROM ray_log_v2 WHERE ts > ?`;\nconst host = 2;\n",
        encoding="utf-8",
    )
    text = _normalized_text(demo)
    assert len(_statements(text)) >= 2
    assert not _RAY_HOST_FILTER.search(text)


def test_normalized_text_does_not_treat_a_route_glob_as_a_block_comment(tmp_path: Path) -> None:
    """`/api/*` is a route glob inside a string, not the start of a block comment."""
    demo = tmp_path / "glob.ts"
    demo.write_text(
        'const route = "/api/*";\n'
        "const sql = `SELECT ray FROM ray_log_v2\n"
        "  WHERE host = ?`;\n"
        "/** a real block comment */\n",
        encoding="utf-8",
    )
    text = _normalized_text(demo)
    assert "/api/*" in text
    assert "a real block comment" not in text
    assert _RAY_HOST_FILTER.search(text)


def test_normalized_text_keeps_url_scheme_double_slashes(tmp_path: Path) -> None:
    """Comment stripping must not truncate a URL string at its `//`."""
    demo = tmp_path / "keep_url.ts"
    demo.write_text(
        'const u = "https://comicine.com/_health"; // trailing note\n',
        encoding="utf-8",
    )
    text = _normalized_text(demo)
    assert "https://comicine.com/_health" in text
    assert "trailing note" not in text


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
    _assert_uses_index(plan, "idx_visitor_rollups_ip_hash")


# `statsSql()` in `functions/api/visitors.ts:199` (30-day statistics), with `includeLegacy = true`,
# line numbers are a snapshot; the drift assertion matches normalized content.
# which `visitors_include_legacy` defaults to in `config-contract.json`. The source assembles this
# from a `legacyTail` interpolation, so the drift anchors below are the literal segments.
VISITOR_STATS_SQL = """
WITH tail AS (
    SELECT ip_hash, country, status, 1 AS requests
    FROM visitors_v2
    WHERE ts >= ?
    UNION ALL
    SELECT ip_hash, country, status, requests
    FROM visitor_rollups
    WHERE last_ts >= ?
  ),
  tail_groups AS (
    SELECT country, status, COUNT(DISTINCT ip_hash) AS unique_ips, SUM(requests) AS requests
    FROM tail
    GROUP BY country, status
  ),
  scoped AS (
    SELECT country, status, unique_ips, requests
    FROM visitors_daily
    WHERE day >= ? AND day < ?
    UNION ALL
    SELECT country, status, unique_ips, requests
    FROM tail_groups
  )
  SELECT
    COUNT(DISTINCT country) AS countries,
    COALESCE(SUM(unique_ips), 0) AS ips,
    COALESCE(SUM(requests), 0) AS requests,
    (SELECT GROUP_CONCAT(status || ':' || n, ',') FROM (
       SELECT status, SUM(requests) AS n FROM scoped GROUP BY status ORDER BY status
    )) AS status_series
  FROM scoped
"""

# Anchors for `statsSql()`: `${legacyTail}` sits between the first two, so the literal is split the
# same way the source is.
VISITOR_STATS_ANCHORS = (
    "SELECT ip_hash, country, status, 1 AS requests FROM visitors_v2 WHERE ts >= ? UNION ALL",
    "SELECT ip_hash, country, status, requests FROM visitor_rollups WHERE last_ts >= ? ), tail_groups AS (",
    "FROM visitors_daily WHERE day >= ? AND day < ?",
    "SELECT COUNT(DISTINCT country) AS countries, COALESCE(SUM(unique_ips), 0) AS ips, COALESCE(SUM(requests), 0) AS requests, (SELECT GROUP_CONCAT(status || ':' || n, ',') FROM ( SELECT status, SUM(requests) AS n FROM scoped GROUP BY status ORDER BY status )) AS status_series FROM scoped",
)

# `markerSql()` in `functions/api/visitors.ts:260` (top markers). The source interpolates
# `${MAX_VISITOR_MARKERS}`, copied here as 500, and `${statusFilter}` for the filtered variant.
VISITOR_MARKERS_SQL = """
WITH scoped AS (
    SELECT ip_hash, country, status, ts, 1 AS requests
    FROM visitors_v2
    WHERE ts >= ?
    UNION ALL
    SELECT ip_hash, country, status, last_ts AS ts, requests
    FROM visitor_rollups
    WHERE last_ts >= ?
  ),
  top AS (
    SELECT ip_hash, MAX(ts) AS last_ts
    FROM scoped
    GROUP BY ip_hash
    ORDER BY last_ts DESC
    LIMIT 500
  ),
  latest AS (
    SELECT t.ip_hash, MAX(s.country) AS country
    FROM top t
    JOIN scoped s ON s.ip_hash = t.ip_hash AND s.ts = t.last_ts
    GROUP BY t.ip_hash
  )
  SELECT v.ip_hash, l.country, v.status,
         SUM(v.requests) AS n,
         MAX(v.ts) AS last_ts
  FROM scoped v
  JOIN top t ON t.ip_hash = v.ip_hash
  JOIN latest l ON l.ip_hash = v.ip_hash
  GROUP BY v.ip_hash, v.status
  ORDER BY MAX(v.ts) DESC, v.status
"""

# Same shape with `AND status = ?` appended to both branches of the union, as the source does when
# `?status=` is passed. Values must line up with the four `?` placeholders.
VISITOR_MARKERS_STATUS_SQL = VISITOR_MARKERS_SQL.replace(
    "WHERE ts >= ?", "WHERE ts >= ? AND status = ?"
).replace("WHERE last_ts >= ?", "WHERE last_ts >= ? AND status = ?")

# `runAll()` in `ops/status-worker/src/index.ts:1119` (line numbers are a snapshot; the drift
# assertion matches normalized content, so a moved statement still passes).
PROBE_SELECT_SQL = """
SELECT p.id, p.name, p.type, p.target, p.group_key, p.interval_s, s.checked_at
  FROM probes p LEFT JOIN probe_state s ON s.probe_id = p.id
 WHERE p.active = 1 ORDER BY p.id
"""

# `statusPayload()` in `ops/status-worker/src/index.ts:1201`; both `?1` placeholders take the same day.
STATUS_PAYLOAD_SQL = """
SELECT p.id, p.name, p.type, p.target, p.group_key, p.active, p.label_key,
       s.last_status AS status, s.checked_at,
       h.latency_ms AS latency_ms, h.msg AS msg,
       COALESCE((SELECT SUM(d.total) FROM probe_uptime_daily d
         WHERE d.probe_id = p.id AND d.day >= ?1), 0) AS total,
       COALESCE((SELECT SUM(d.up) FROM probe_uptime_daily d
         WHERE d.probe_id = p.id AND d.day >= ?1), 0) AS up
  FROM probes p
  LEFT JOIN probe_state s ON s.probe_id = p.id
  LEFT JOIN heartbeats h
         ON h.id = (SELECT hb.id FROM heartbeats hb
                     WHERE hb.probe_id = p.id ORDER BY hb.ts DESC LIMIT 1)
 WHERE p.active = 1
 ORDER BY p.id
"""

# The four export windows in `ops/d1-archive/src/index.ts:59-90`, copied verbatim from TABLES.
ARCHIVE_SQL = {
    # ops/d1-archive/src/index.ts:62-65
    "visitor_rollups": """
        SELECT bucket_hour, ip_hash, country, status, page_slug, requests, last_ts
        FROM visitor_rollups
        WHERE bucket_hour >= ? AND bucket_hour < ?
        ORDER BY bucket_hour, ip_hash, country, status, page_slug
    """,
    # ops/d1-archive/src/index.ts:69-72
    "visitors_v2": """
        SELECT id, ip_hash, country, status, ts, page_slug
        FROM visitors_v2
        WHERE ts >= ? AND ts < ?
        ORDER BY ts, id
    """,
    # ops/d1-archive/src/index.ts:76-80
    "ray_log_v2": """
        SELECT ray, ts, host, normalized_path, method, status, duration_ms,
               ip_hash, country, ua_family
        FROM ray_log_v2
        WHERE ts >= ? AND ts < ?
        ORDER BY ts, ray
    """,
    # ops/d1-archive/src/index.ts:84-88
    "events": """
        SELECT id, event, ts, request_id, host, path, method, status, outcome,
               ip_hash, country, duration_ms, message, account_id, actor_sub
        FROM events
        WHERE ts >= ? AND ts < ?
        ORDER BY ts, id
    """,
}

# Anchors for the query the source assembles with interpolation. Each anchor is verbatim source
# text, including the `${legacyScope}` / `${statusFilter}` placeholders where they appear, so a
# renamed or repositioned interpolation fails the same way a changed predicate does.
VISITOR_MARKER_ANCHORS = (
    "SELECT ip_hash, country, status, ts, 1 AS requests FROM visitors_v2 WHERE ts >= ?${statusFilter} UNION ALL",
    "WITH scoped AS ( ${legacyScope}SELECT ip_hash, country, status, last_ts AS ts, requests FROM visitor_rollups WHERE last_ts >= ?${statusFilter} ), top AS (",
    "top AS ( SELECT ip_hash, MAX(ts) AS last_ts FROM scoped GROUP BY ip_hash ORDER BY last_ts DESC LIMIT",
    "latest AS ( SELECT t.ip_hash, MAX(s.country) AS country FROM top t JOIN scoped s ON s.ip_hash = t.ip_hash AND s.ts = t.last_ts GROUP BY t.ip_hash )",
    "SELECT v.ip_hash, l.country, v.status, SUM(v.requests) AS n, MAX(v.ts) AS last_ts FROM scoped v JOIN top t ON t.ip_hash = v.ip_hash JOIN latest l ON l.ip_hash = v.ip_hash GROUP BY v.ip_hash, v.status ORDER BY MAX(v.ts) DESC, v.status",
)


class DriftCase(NamedTuple):
    label: str
    path: Path
    anchors: tuple[str, ...]


DRIFT_CASES: tuple[DriftCase, ...] = (
    DriftCase("visitors stats", VISITORS_TS, VISITOR_STATS_ANCHORS),
    DriftCase("visitors markers", VISITORS_TS, VISITOR_MARKER_ANCHORS),
    DriftCase("probe selection", STATUS_WORKER_TS, (PROBE_SELECT_SQL,)),
    DriftCase("status payload", STATUS_WORKER_TS, (STATUS_PAYLOAD_SQL,)),
) + tuple(
    DriftCase(f"archive window {table}", D1_ARCHIVE_TS, (sql,))
    for table, sql in ARCHIVE_SQL.items()
)


@pytest.mark.parametrize("case", DRIFT_CASES, ids=[case.label for case in DRIFT_CASES])
def test_hot_query_sql_matches_the_source(case: DriftCase) -> None:
    """Every hardcoded query must still exist in the file it was copied from (`file:line` on the literal).

    This is the anti-drift half of the plan guards: without it a renamed table or a rewritten query
    would leave these tests asserting the plan of SQL that no longer ships.
    """
    _assert_anchors_present(case.label, case.path, case.anchors)


def test_visitor_stats_window_uses_the_expected_indexes(migrated_db: sqlite3.Connection) -> None:
    """The 30-day statistics query must read every source through its own range index.

    Complete days come from `visitors_daily` through `idx_visitors_daily_day` (011); the current-day
    tail comes from `visitors_v2` and `visitor_rollups` through the covering indexes 011 added for
    exactly this aggregation. A table scan here is what pushed production over the 5M rows/day limit
    on 2026-09-17, and a per-IP lookup index would mean the window is being probed per visitor again.
    """
    plan = _plan(
        migrated_db,
        VISITOR_STATS_SQL,
        (WINDOW_START, WINDOW_START, DAY_START, DAY_END),
    )
    _assert_uses_index(plan, "idx_visitors_daily_day")
    _assert_uses_index(plan, "idx_visitors_v2_ts_cover")
    _assert_uses_index(plan, "idx_visitor_rollups_last_ts_cover")
    _assert_index_absent(plan, "idx_visitors_v2_ip_hash_ts")


@pytest.mark.parametrize(
    ("sql", "params", "visitor_index"),
    [
        (VISITOR_MARKERS_SQL, (WINDOW_START, WINDOW_START), "idx_visitors_v2_ts_cover"),
        (
            VISITOR_MARKERS_STATUS_SQL,
            (WINDOW_START, STATUS_FILTER, WINDOW_START, STATUS_FILTER),
            # With `status = ?` equality plus a `ts >= ?` range, sqlite prefers the
            # (status, ts) index added in 007. That is the same range shape and the plan the
            # production query actually gets; forcing the covering index here would be a false red.
            "idx_visitors_v2_status_ts",
        ),
    ],
    ids=["all statuses", "one status"],
)
def test_visitor_marker_window_uses_the_range_indexes(
    migrated_db: sqlite3.Connection,
    sql: str,
    params: tuple[object, ...],
    visitor_index: str,
) -> None:
    """The top-500 marker query must range-read the 30-day window through an index.

    `visitor_rollups` keeps `idx_visitor_rollups_last_ts_cover` in both variants. Falling back to
    `idx_visitors_v2_ip_hash_ts` would mean the query is no longer a window scan.
    """
    plan = _plan(migrated_db, sql, params)
    _assert_uses_index(plan, visitor_index)
    _assert_uses_index(plan, "idx_visitor_rollups_last_ts_cover")
    _assert_index_absent(plan, "idx_visitors_v2_ip_hash_ts")


def test_probe_selection_joins_the_state_table_by_rowid(migrated_db: sqlite3.Connection) -> None:
    """`runAll()` reads the small `probes` table and must reach `probe_state` by rowid.

    `probes` has no index on `active` by design (a handful of rows), so a scan is the intended plan,
    and `ORDER BY p.id` rides that rowid order without a temp B-tree. `probe_state` is keyed by
    `probe_id`, so the left join must be an INTEGER PRIMARY KEY seek.
    """
    plan = _plan(migrated_db, PROBE_SELECT_SQL)
    assert "SCAN p" in plan, plan
    assert "SEARCH s USING INTEGER PRIMARY KEY (rowid=?)" in plan, plan
    # Only assert the presence/absence of a sort: sqlite renamed its wording in 3.46.
    assert "TEMP B-TREE" not in plan, plan


def test_status_payload_uses_the_heartbeat_and_uptime_indexes(migrated_db: sqlite3.Connection) -> None:
    """`statusPayload()` must not scan `heartbeats` or `probe_uptime_daily`.

    The latest heartbeat per probe is the `(probe_id, ts DESC)` covering index lookup added in 009;
    the seven-day uptime sums read at most seven rows each through the `(probe_id, day)` primary key
    added in 011. `idx_heartbeats_ts` exists only for retention deletes and must not serve the
    latest-heartbeat subquery.
    """
    plan = _plan(migrated_db, STATUS_PAYLOAD_SQL, (SINCE_DAY,))
    _assert_uses_index(plan, "idx_heartbeats_probe_ts")
    _assert_index_absent(plan, "idx_heartbeats_ts")
    _assert_uses_index(plan, "sqlite_autoindex_probe_uptime_daily_1")


ARCHIVE_INDEXES = {
    "visitor_rollups": "sqlite_autoindex_visitor_rollups_1",
    # The archive select list reads id/page_slug, so `idx_visitors_v2_ts_cover` cannot cover it, and
    # `ORDER BY ts, id` needs the narrow ts index: the cover index would add a sort. Verified on
    # sqlite 3.38-3.54, including a creation-order swap.
    "visitors_v2": "idx_visitors_v2_ts",
    "ray_log_v2": "idx_ray_log_v2_ts",
    "events": "idx_events_ts_event",
}


@pytest.mark.parametrize(("table", "index"), list(ARCHIVE_INDEXES.items()), ids=list(ARCHIVE_INDEXES))
def test_archive_export_window_uses_the_expected_index(
    migrated_db: sqlite3.Connection, table: str, index: str
) -> None:
    """The daily export window must be a timestamp range seek on the index that owns that range.

    `visitor_rollups` is keyed by `bucket_hour` first, so its export uses the primary-key prefix;
    the other three use their ts-leading index. Asserting the index name (not the plan text) keeps
    this stable across sqlite versions.
    """
    plan = _plan(migrated_db, ARCHIVE_SQL[table], (WINDOW_START, WINDOW_END))
    _assert_uses_index(plan, index)
    _assert_index_absent(plan, "idx_visitors_v2_ip_hash_ts")
    if table == "visitors_v2":
        _assert_index_absent(plan, "idx_visitors_v2_ts_cover")
        assert "TEMP B-TREE" not in plan, plan
