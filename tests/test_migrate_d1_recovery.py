# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Recovery tests for the D1 migration entry point (task 15).

All cases run offline. A Python fake Wrangler executes `d1 execute <db> --remote --command <sql>`
against a temporary SQLite database, so nothing contacts Cloudflare or production D1, and no case
writes inside the repository.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASH = "/bin/bash"
MIGRATE = ROOT / "ops" / "migrate_d1.sh"
MIGRATIONS = ROOT / "ops" / "migrations"
REPAIR_SQL = MIGRATIONS / "repair" / "004_blocklist_sync_post004.sql"

LEGACY_ROWS = (
    ("203.0.113.7/32", "manual block", "2026-01-01 00:00:00"),
    ("198.51.100.0/24", "range block", "2026-01-02 00:00:00"),
    ("2001:db8::1", "", "2026-01-03 00:00:00"),
)

LEGACY_TABLE_SQL = """CREATE TABLE {table} (
    cidr     TEXT PRIMARY KEY,
    note     TEXT DEFAULT '',
    added_at TEXT DEFAULT (datetime('now'))
)"""

POST004_TABLE_SQL = """CREATE TABLE {table} (
    cidr       TEXT PRIMARY KEY,
    network    TEXT NOT NULL,
    prefix     INTEGER NOT NULL,
    reason     TEXT DEFAULT '',
    source     TEXT NOT NULL DEFAULT 'auto_block',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL DEFAULT '',
    active     INTEGER NOT NULL DEFAULT 1
)"""

SCHEMA_VERSION_SQL = """CREATE TABLE schema_version (
    version    INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)"""

# Offline stand-in for `wrangler d1 execute`: every command runs against FAKE_D1_DB, commands are
# appended to FAKE_WRANGLER_LOG as JSON lines, and FAKE_FAIL_BEFORE / FAKE_FAIL_AFTER interrupt a
# run around a matching statement. `--json` emits the payload shape Wrangler produces.
FAKE_WRANGLER = '''#!/usr/bin/env python3
"""Offline fake Wrangler for tests/test_migrate_d1_recovery.py."""

import json
import os
import sqlite3
import sys


def main() -> int:
    arguments = sys.argv[1:]
    if len(arguments) < 3 or arguments[0] != "d1" or arguments[1] != "execute":
        print("fake wrangler: unsupported command: " + " ".join(arguments), file=sys.stderr)
        return 2
    database_name = arguments[2]
    command = None
    emit_json = False
    index = 3
    while index < len(arguments):
        argument = arguments[index]
        if argument == "--command":
            if index + 1 >= len(arguments):
                print("fake wrangler: --command needs a value", file=sys.stderr)
                return 2
            command = arguments[index + 1]
            index += 2
            continue
        if argument.startswith("--command="):
            command = argument.split("=", 1)[1]
        elif argument == "--json":
            emit_json = True
        index += 1
    if command is None:
        print("fake wrangler: missing --command", file=sys.stderr)
        return 2

    log_path = os.environ.get("FAKE_WRANGLER_LOG", "")
    if log_path:
        with open(log_path, "a", encoding="utf-8") as handle:
            print(json.dumps({"database": database_name, "sql": command, "json": emit_json}), file=handle)

    fail_before = os.environ.get("FAKE_FAIL_BEFORE", "")
    if fail_before and fail_before in command:
        print("FAKE_INTERRUPTED_BEFORE: " + command, file=sys.stderr)
        return 1

    rows = []
    connection = sqlite3.connect(os.environ["FAKE_D1_DB"])
    try:
        try:
            cursor = connection.execute(command)
        except sqlite3.ProgrammingError:
            connection.executescript(command)
        else:
            if cursor.description is not None:
                columns = [column[0] for column in cursor.description]
                rows = [{name: row[position] for position, name in enumerate(columns)} for row in cursor.fetchall()]
        connection.commit()
    except sqlite3.Error as error:
        print("D1_ERROR: " + str(error), file=sys.stderr)
        return 1
    finally:
        connection.close()

    if emit_json:
        payload = [{"results": rows, "success": True, "meta": {"rows_read": len(rows)}}]
        print(json.dumps(payload))
    else:
        print("ok")

    fail_after = os.environ.get("FAKE_FAIL_AFTER", "")
    if fail_after and fail_after in command:
        print("FAKE_INTERRUPTED_AFTER: " + command, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'''


def _write_fake_wrangler(tmp_path: Path) -> Path:
    path = tmp_path / "wrangler"
    path.write_text(FAKE_WRANGLER, encoding="utf-8")
    path.chmod(0o755)
    return path


def _run_migrate(
    migrate: Path,
    tmp_path: Path,
    *arguments: str,
    database: Path | None = None,
    log: Path | None = None,
    state: Path | None = None,
    fail_before: str | None = None,
    fail_after: str | None = None,
) -> subprocess.CompletedProcess[str]:
    database = database if database is not None else tmp_path / "d1.sqlite3"
    log = log if log is not None else tmp_path / "wrangler.log"
    state = state if state is not None else tmp_path / "applied"
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("FAKE_") and key not in {"WRANGLER_BIN", "D1_DATABASE_NAME"}
    }
    environment.update(
        {
            "WRANGLER_BIN": str(tmp_path / "wrangler"),
            "FAKE_D1_DB": str(database),
            "FAKE_WRANGLER_LOG": str(log),
            "D1_STATE_FILE": str(state),
            "D1_DATABASE_NAME": "comicine",
        }
    )
    if fail_before is not None:
        environment["FAKE_FAIL_BEFORE"] = fail_before
    if fail_after is not None:
        environment["FAKE_FAIL_AFTER"] = fail_after
    return subprocess.run(
        [BASH, str(migrate), *arguments],
        cwd=str(ROOT),
        env=environment,
        capture_output=True,
        text=True,
        timeout=300,
    )


def _run_offline(*arguments: str, state: Path) -> subprocess.CompletedProcess[str]:
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("FAKE_") and key not in {"WRANGLER_BIN", "D1_DATABASE_NAME"}
    }
    environment.update({"WRANGLER_BIN": "/nonexistent/wrangler", "D1_STATE_FILE": str(state)})
    return subprocess.run(
        [BASH, str(MIGRATE), *arguments],
        cwd=str(ROOT),
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )


def _commands(log: Path) -> list[dict]:
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


def _query(database: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(database)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def _scalar(database: Path, sql: str):
    return _query(database, sql)[0][0]


def _tables(database: Path) -> set[str]:
    return {row[0] for row in _query(database, "SELECT name FROM sqlite_master WHERE type = 'table'")}


def _columns(database: Path, table: str) -> set[str]:
    return {row[1] for row in _query(database, f"PRAGMA table_info({table})")}


def _versions(database: Path) -> set[int]:
    return {row[0] for row in _query(database, "SELECT version FROM schema_version")}


def _dump(database: Path) -> list[str]:
    connection = sqlite3.connect(database)
    try:
        return list(connection.iterdump())
    finally:
        connection.close()


def _executescript(database: Path, script: str) -> None:
    connection = sqlite3.connect(database)
    try:
        connection.executescript(script)
        connection.commit()
    finally:
        connection.close()


def _blocklist_snapshot(database: Path) -> list[tuple]:
    return _query(
        database,
        "SELECT cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active "
        "FROM blocked_ips ORDER BY cidr",
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _migration_names(migrations: Path = MIGRATIONS) -> list[str]:
    return sorted(path.name for path in migrations.glob("*.sql"))


def _migration_key(name: str, names: list[str]) -> int:
    prefix = name.split("_", 1)[0]
    sequence = [item for item in names if item.split("_", 1)[0] == prefix].index(name) + 1
    return int(prefix) * 1000 + sequence


def _seed_legacy_database(database: Path, versions: tuple[int, ...] = (1001, 2001, 3001)) -> None:
    connection = sqlite3.connect(database)
    try:
        connection.execute(LEGACY_TABLE_SQL.format(table="blocked_ips"))
        connection.execute(SCHEMA_VERSION_SQL)
        connection.executemany(
            "INSERT INTO blocked_ips (cidr, note, added_at) VALUES (?, ?, ?)", LEGACY_ROWS
        )
        for version in versions:
            connection.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
        connection.commit()
    finally:
        connection.close()


def _seed_post004_database(database: Path, versions: tuple[int, ...]) -> None:
    connection = sqlite3.connect(database)
    try:
        connection.execute(POST004_TABLE_SQL.format(table="blocked_ips"))
        connection.execute(SCHEMA_VERSION_SQL)
        connection.execute(
            "INSERT INTO blocked_ips "
            "(cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active) "
            "VALUES ('203.0.113.7', '203.0.113.7', 32, 'manual', 'admin_block', "
            "'2026-01-01 00:00:00', '2026-01-01 00:00:00', 'admin', 1)"
        )
        for version in versions:
            connection.execute("INSERT INTO schema_version (version) VALUES (?)", (version,))
        connection.commit()
    finally:
        connection.close()


def _write_commands_only(log: Path) -> None:
    for entry in _commands(log):
        assert not re.match(
            r"(?is)\s*(insert|update|delete|alter|drop)\b", entry["sql"]
        ), f"unexpected write during a refusal: {entry['sql']}"


def test_clean_replay_records_every_migration_and_is_idempotent(tmp_path: Path) -> None:
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    names = _migration_names()

    first = _run_migrate(MIGRATE, tmp_path, "--remote", database=database, log=log, state=state)

    assert first.returncode == 0, first.stdout + first.stderr
    assert f"[d1] done: applied={len(names)} skipped=0" in first.stdout
    assert "[d1] skip (column already exists)" not in first.stdout
    assert f"[d1] checksums: recorded {len(names)} sha256 rows" in first.stdout
    assert _scalar(database, "SELECT COUNT(*) FROM schema_version") == len(names)
    assert _versions(database) == {_migration_key(name, names) for name in names}
    checksums = _query(database, "SELECT version, filename, sha256 FROM migration_checksums")
    assert len(checksums) == len(names)
    expected = {
        (_migration_key(name, names), name, _sha256(MIGRATIONS / name)) for name in names
    }
    assert {(version, filename, digest) for version, filename, digest in checksums} == expected
    assert state.read_text().split() == names

    before = _dump(database)
    log.unlink()
    second = _run_migrate(MIGRATE, tmp_path, "--remote", database=database, log=log, state=state)

    assert second.returncode == 0, second.stdout + second.stderr
    assert second.stdout.count("[d1] skip (recorded): ") == len(names)
    assert f"[d1] done: applied=0 skipped={len(names)}" in second.stdout
    assert f"[d1] checksums: verified {len(names)} applied migrations" in second.stdout
    assert "checksums: recorded" not in second.stdout
    assert not re.search(r"^\[d1\] apply: \S+\.sql key=", second.stdout, re.MULTILINE)
    assert _dump(database) == before
    commands = _commands(log)
    assert commands
    for entry in commands:
        assert not re.match(
            r"(?is)\s*(insert|update|delete)\b", entry["sql"]
        ), f"second run wrote data: {entry['sql']}"


def test_interrupted_004_run_is_detected_repaired_and_safe_to_replay(tmp_path: Path) -> None:
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    state.write_text("POISON\n")
    _seed_legacy_database(database)

    interrupted = _run_migrate(
        MIGRATE,
        tmp_path,
        "--remote",
        database=database,
        log=log,
        state=state,
        fail_after="ALTER TABLE blocked_ips_new RENAME TO blocked_ips",
    )

    assert interrupted.returncode == 1, interrupted.stdout + interrupted.stderr
    assert "FATAL: migration failed: 004_blocklist_sync.sql" in interrupted.stderr
    assert "ALTER TABLE blocked_ips_new RENAME TO blocked_ips" in log.read_text(encoding="utf-8")
    assert "updated_by" in _columns(database, "blocked_ips")
    assert "blocked_ips_new" not in _tables(database)
    assert 4002 not in _versions(database)
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips") == len(LEGACY_ROWS)
    assert state.read_text() == "POISON\n"

    # A normal run must stop on the recoverable state and point the operator at --repair.
    log.unlink()
    detected = _run_migrate(MIGRATE, tmp_path, "--remote", database=database, log=log, state=state)

    assert detected.returncode == 1, detected.stdout + detected.stderr
    assert (
        "FATAL: interrupted blocklist migration detected: "
        "blocked_ips already has the post-004 schema" in detected.stderr
    )
    assert "run: bash ops/migrate_d1.sh --repair --remote" in detected.stderr
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips") == len(LEGACY_ROWS)
    _write_commands_only(log)

    # --repair applies the post-004 tail, keeps every row, and records key 4002.
    log.unlink()
    repaired = _run_migrate(
        MIGRATE, tmp_path, "--repair", "--remote", database=database, log=log, state=state
    )

    assert repaired.returncode == 0, repaired.stdout + repaired.stderr
    assert (
        "[d1] repair: replaying ops/migrations/repair/004_blocklist_sync_post004.sql "
        f"(rows before={len(LEGACY_ROWS)})" in repaired.stdout
    )
    assert "[d1] repair: recorded 004_blocklist_sync.sql key=4002" in repaired.stdout
    assert f"[d1] repair: done rows={len(LEGACY_ROWS)}" in repaired.stdout
    assert 4002 in _versions(database)
    assert _query(
        database, "SELECT filename, sha256 FROM migration_checksums WHERE version = 4002"
    ) == [("004_blocklist_sync.sql", _sha256(MIGRATIONS / "004_blocklist_sync.sql"))]
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips") == len(LEGACY_ROWS)
    assert {row[0] for row in _query(database, "SELECT cidr FROM blocked_ips")} == {
        row[0] for row in LEGACY_ROWS
    }
    assert state.read_text() == "POISON\n"

    log.unlink()
    refused = _run_migrate(
        MIGRATE, tmp_path, "--repair", "--remote", database=database, log=log, state=state
    )
    assert refused.returncode == 1, refused.stdout + refused.stderr
    assert (
        "FATAL: --repair refused: 004_blocklist_sync is already recorded "
        "(key=4002); nothing to repair" in refused.stderr
    )
    _write_commands_only(log)

    # The recovery tail is idempotent with plain sqlite executescript and preserves every row.
    snapshot = _blocklist_snapshot(database)
    repair_script = REPAIR_SQL.read_text(encoding="utf-8")
    for _ in range(2):
        _executescript(database, repair_script)
        assert _blocklist_snapshot(database) == snapshot
        assert "blocked_ips_new" not in _tables(database)

    # The main 004 file is the legacy path: in the post-004 state it aborts on `c.note` before
    # any DROP, so blocked_ips keeps every row (a failed replay cannot lose data).
    with pytest.raises(sqlite3.OperationalError, match=r"no such column: c\.note"):
        _executescript(database, (MIGRATIONS / "004_blocklist_sync.sql").read_text(encoding="utf-8"))
    assert _blocklist_snapshot(database) == snapshot
    assert "blocked_ips" in _tables(database)
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips_new") == 0


def test_repair_refuses_a_legacy_database_without_writing(tmp_path: Path) -> None:
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    _seed_legacy_database(database, versions=())

    result = _run_migrate(
        MIGRATE, tmp_path, "--repair", "--remote", database=database, log=log, state=state
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: --repair refused: blocked_ips does not have the post-004 schema (missing:" in result.stderr
    assert "updated_by" in result.stderr
    assert "normal migration plan" in result.stderr
    assert _columns(database, "blocked_ips") == {"cidr", "note", "added_at"}
    assert _versions(database) == set()
    commands = _commands(log)
    assert commands[0]["sql"].startswith("SELECT name FROM sqlite_master")
    _write_commands_only(log)


def test_repair_refuses_the_dangerous_state_without_writing(tmp_path: Path) -> None:
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    connection = sqlite3.connect(database)
    try:
        connection.execute(POST004_TABLE_SQL.format(table="blocked_ips_new"))
        connection.execute(SCHEMA_VERSION_SQL)
        connection.executemany(
            "INSERT INTO blocked_ips_new (cidr, network, prefix) VALUES (?, ?, ?)",
            [("203.0.113.7", "203.0.113.7", 32), ("198.51.100.0", "198.51.100.0", 24)],
        )
        connection.commit()
    finally:
        connection.close()

    result = _run_migrate(
        MIGRATE, tmp_path, "--repair", "--remote", database=database, log=log, state=state
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert "blocked_ips_new exists but blocked_ips is missing" in result.stderr
    assert (
        "blocked_ips_new contains the completed rebuild; verify its row count and schema, then run"
        in result.stderr
    )
    assert (
        "ALTER TABLE blocked_ips_new RENAME TO blocked_ips; and rerun --repair" in result.stderr
    )
    assert "blocked_ips" not in _tables(database)
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips_new") == 2
    assert _versions(database) == set()
    _write_commands_only(log)


@pytest.mark.parametrize("recorded_version", [4002, 4])
def test_repair_refuses_a_fully_migrated_database(
    tmp_path: Path, recorded_version: int
) -> None:
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    _seed_post004_database(database, versions=(recorded_version,))

    result = _run_migrate(
        MIGRATE, tmp_path, "--repair", "--remote", database=database, log=log, state=state
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert (
        "FATAL: --repair refused: 004_blocklist_sync is already recorded "
        "(key=4002); nothing to repair" in result.stderr
    )
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips") == 1
    _write_commands_only(log)


def test_checksum_mismatch_stops_before_applying_and_restore_recovers(tmp_path: Path) -> None:
    _write_fake_wrangler(tmp_path)
    repo = tmp_path / "repo"
    (repo / "ops").mkdir(parents=True)
    shutil.copy2(MIGRATE, repo / "ops" / "migrate_d1.sh")
    shutil.copytree(MIGRATIONS, repo / "ops" / "migrations")
    migrate = repo / "ops" / "migrate_d1.sh"
    migrations = repo / "ops" / "migrations"
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    names = _migration_names(migrations)

    first = _run_migrate(migrate, tmp_path, "--remote", database=database, log=log, state=state)
    assert first.returncode == 0, first.stdout + first.stderr
    assert f"[d1] done: applied={len(names)} skipped=0" in first.stdout

    edited = migrations / "005_retention.sql"
    original = edited.read_text(encoding="utf-8")
    original_digest = _sha256(edited)
    edited.write_text(original + "\n-- edited by the checksum mismatch test\n", encoding="utf-8")
    edited_digest = _sha256(edited)
    new_migration = migrations / "025_checksum_probe.sql"
    new_migration.write_text(
        "CREATE TABLE IF NOT EXISTS checksum_probe_marker (id INTEGER PRIMARY KEY);\n",
        encoding="utf-8",
    )

    log.unlink()
    mismatched = _run_migrate(
        migrate, tmp_path, "--remote", database=database, log=log, state=state
    )

    assert mismatched.returncode == 1, mismatched.stdout + mismatched.stderr
    assert "FATAL: migration checksum mismatch: 005_retention.sql (key=5001)" in mismatched.stderr
    assert f"recorded sha256: {original_digest}" in mismatched.stderr
    assert f"current  sha256: {edited_digest}" in mismatched.stderr
    assert "An applied migration must not be edited. Restore it from Git:" in mismatched.stderr
    assert "git checkout -- ops/migrations/005_retention.sql" in mismatched.stderr
    assert "checksum_probe_marker" not in _tables(database)
    assert 25001 not in _versions(database)
    assert "checksum_probe_marker" not in log.read_text(encoding="utf-8")
    _write_commands_only(log)

    edited.write_text(original, encoding="utf-8")
    log.unlink()
    recovered = _run_migrate(
        migrate, tmp_path, "--remote", database=database, log=log, state=state
    )

    assert recovered.returncode == 0, recovered.stdout + recovered.stderr
    assert "[d1] apply: 025_checksum_probe.sql key=25001" in recovered.stdout
    assert "[d1] recorded: 025_checksum_probe.sql key=25001" in recovered.stdout
    assert "[d1] checksums: recorded 1 sha256 rows" in recovered.stdout
    assert "checksum_probe_marker" in _tables(database)
    assert _query(
        database,
        "SELECT filename, sha256 FROM migration_checksums WHERE version = 25001",
    ) == [("025_checksum_probe.sql", _sha256(new_migration))]


def test_repair_argument_validation_and_offline_dry_run(tmp_path: Path) -> None:
    state = tmp_path / "applied"

    missing_remote = _run_offline("--repair", state=state)
    assert missing_remote.returncode == 2, missing_remote.stdout + missing_remote.stderr
    assert "FATAL: --remote is required for --repair" in missing_remote.stderr
    assert "unbound variable" not in missing_remote.stderr

    combined = _run_offline("--repair", "--check-schema", state=state)
    assert combined.returncode == 2, combined.stdout + combined.stderr
    assert "FATAL: --repair cannot be combined with --check-schema" in combined.stderr
    assert "unbound variable" not in combined.stderr

    dry_run = _run_offline("--repair", "--dry-run", state=state)
    assert dry_run.returncode == 0, dry_run.stdout + dry_run.stderr
    repair_lines = [
        line for line in dry_run.stdout.splitlines() if line.startswith("[d1] repair dry-run:")
    ]
    assert len(repair_lines) == 1, dry_run.stdout
    assert "blocked_ips" in repair_lines[0]
    assert "not contacted" in repair_lines[0]
    assert not state.exists()

    unknown = _run_offline("--repair", "--bogus", state=state)
    assert unknown.returncode == 2, unknown.stdout + unknown.stderr
    assert "FATAL: unknown argument --bogus" in unknown.stderr


def test_legacy_null_cidr_is_refused_before_004_drops_data(tmp_path: Path) -> None:
    """A NULL cidr cannot satisfy network NOT NULL; INSERT OR IGNORE would drop the row silently."""
    _write_fake_wrangler(tmp_path)
    database = tmp_path / "d1.sqlite3"
    log = tmp_path / "wrangler.log"
    state = tmp_path / "applied"
    _seed_legacy_database(database)
    connection = sqlite3.connect(database)
    try:
        connection.execute(
            "INSERT INTO blocked_ips (cidr, note, added_at) VALUES (NULL, 'broken', '2026-01-04 00:00:00')"
        )
        connection.commit()
    finally:
        connection.close()

    result = _run_migrate(
        MIGRATE, tmp_path, "--remote", database=database, log=log, state=state
    )

    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: legacy blocked_ips contains 1 row(s) with a NULL cidr" in result.stderr
    assert "no migration statement was executed" in result.stderr
    assert _scalar(database, "SELECT COUNT(*) FROM blocked_ips") == len(LEGACY_ROWS) + 1
    assert 4002 not in _versions(database)
    assert "updated_by" not in _columns(database, "blocked_ips")
    _write_commands_only(log)


def test_004_keeps_a_surviving_copy_and_drops_stale_only_rows() -> None:
    """The post-copy cleanup must not delete the only copy when the source is empty.

    Two retry states share the staging table: an empty legacy stub can sit next to the only
    surviving copy (keep it), while a stale-only row from an earlier copy must not survive
    (drop it). `NOT IN (SELECT ...)` fails the first case; the guarded NOT EXISTS keeps both.
    """
    migration = (MIGRATIONS / "004_blocklist_sync.sql").read_text(encoding="utf-8")
    legacy = (MIGRATIONS / "001_init.sql").read_text(encoding="utf-8")

    empty_source = sqlite3.connect(":memory:")
    try:
        empty_source.executescript(legacy)
        empty_source.executescript(POST004_TABLE_SQL.format(table="blocked_ips_new"))
        empty_source.execute(
            "INSERT INTO blocked_ips_new (cidr, network, prefix, reason) "
            "VALUES ('203.0.113.1', '203.0.113.1', 32, 'only copy')"
        )
        empty_source.commit()
        empty_source.executescript(migration)
        assert [row[0] for row in empty_source.execute("SELECT cidr FROM blocked_ips")] == [
            "203.0.113.1"
        ]
    finally:
        empty_source.close()

    stale_copy = sqlite3.connect(":memory:")
    try:
        stale_copy.executescript(legacy)
        stale_copy.executescript(POST004_TABLE_SQL.format(table="blocked_ips_new"))
        stale_copy.execute(
            "INSERT INTO blocked_ips (cidr, note, added_at) "
            "VALUES ('203.0.113.1', 'fresh', '2026-01-01 00:00:00')"
        )
        stale_copy.execute(
            "INSERT INTO blocked_ips_new (cidr, network, prefix, reason) "
            "VALUES ('10.9.9.9', '10.9.9.9', 32, 'stale only')"
        )
        stale_copy.commit()
        stale_copy.executescript(migration)
        assert [row[0] for row in stale_copy.execute("SELECT cidr FROM blocked_ips ORDER BY cidr")] == [
            "203.0.113.1"
        ]
    finally:
        stale_copy.close()
