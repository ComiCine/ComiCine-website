# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Tests for ops/d1-archive/restore.py: disaster-recovery snapshots must restore D1 exactly.

The value of a snapshot is that the restored database matches the original. Assertions
are exact: compare 0/1, NULL versus empty strings, epoch integers, single quotes,
newlines, and NUL bytes value by value.
"""

from __future__ import annotations

import gzip
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RESTORE_PATH = ROOT / "ops" / "d1-archive" / "restore.py"

SPEC = importlib.util.spec_from_file_location("d1_archive_restore", RESTORE_PATH)
assert SPEC and SPEC.loader
restore = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore)


DDL = """-- Limooo D1 configuration & schema snapshot
-- generated_at: 2026-10-10T22:00:00.000Z  (unix 1791671165)
-- scope: DDL only. This file recreates the empty skeleton, never the rows.

CREATE TABLE "blocked_ips" (
    cidr        TEXT PRIMARY KEY,
    network     TEXT NOT NULL,
    prefix      INTEGER NOT NULL,
    reason      TEXT DEFAULT '',
    updated_by  TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE apple_accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    notes       TEXT    DEFAULT '',
    sort_order  INTEGER DEFAULT 0
);

CREATE INDEX idx_blocked_ips_active
    ON blocked_ips (active, updated_at);
"""

BLOCKED_ROWS = [
    {
        "cidr": "203.0.113.0/24",
        "network": "203.0.113.0",
        "prefix": 24,
        "reason": "",
        "updated_by": "admin",
        "active": 1,
    },
    {
        "cidr": "198.51.100.7/32",
        "network": "198.51.100.7",
        "prefix": 32,
        "reason": "it's a flood",
        "updated_by": "",
        "active": 0,
    },
    {
        "cidr": "2001:db8::/48",
        "network": "2001:db8::",
        "prefix": 48,
        "reason": "line one\nline two",
        "updated_by": "ops",
        "active": 0,
    },
]

APPLE_ROWS = [
    {
        "id": 1,
        "email": "a@example.test",
        "password": "enc:v1:AAAA",
        "notes": None,
        "sort_order": 0,
    },
    {
        "id": 2,
        "email": "b@example.test",
        "password": "enc:v1:BBBB",
        "notes": "日本語のメモ",
        "sort_order": 7,
    },
]


def write_snapshot(
    directory: Path,
    tables: dict[str, list[dict]],
    *,
    ddl: str | None = DDL,
    manifest: dict | None = None,
) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    if ddl is not None:
        (directory / "ddl.sql").write_text(ddl, encoding="utf-8")
    for name, rows in tables.items():
        payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
        with gzip.open(directory / f"{name}.jsonl.gz", "wt", encoding="utf-8") as handle:
            handle.write(payload)
    if manifest is not None:
        (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return directory


def run_restore(tmp_path: Path, directory: Path, *extra: str) -> tuple[int, str, str]:
    out = tmp_path / "restore.sql"
    argv = ["--dir", str(directory), "--out", str(out), *extra]
    import contextlib
    import io

    stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr):
        code = restore.main(argv)
    return code, (out.read_text(encoding="utf-8") if out.exists() else ""), stderr.getvalue()


def test_round_trip_preserves_every_value_and_type(tmp_path):
    directory = write_snapshot(
        tmp_path / "backup",
        {"blocked_ips": BLOCKED_ROWS, "apple_accounts": APPLE_ROWS},
        manifest={"tables": [{"name": "blocked_ips"}, {"name": "apple_accounts"}]},
    )

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    con = sqlite3.connect(":memory:")
    con.executescript(sql)
    assert [dict(zip(("cidr", "network", "prefix", "reason", "updated_by", "active"), row, strict=True))
            for row in con.execute(
                "SELECT cidr, network, prefix, reason, updated_by, active FROM blocked_ips ORDER BY cidr"
            )] == sorted(BLOCKED_ROWS, key=lambda row: row["cidr"])
    assert [dict(zip(("id", "email", "password", "notes", "sort_order"), row, strict=True))
            for row in con.execute(
                "SELECT id, email, password, notes, sort_order FROM apple_accounts ORDER BY id"
            )] == APPLE_ROWS
    # Check each column type: active is integer 0/1, not a string or boolean; distinguish NULL from an empty notes value.
    assert con.execute("SELECT typeof(active) FROM blocked_ips").fetchone()[0] == "integer"
    assert con.execute("SELECT typeof(prefix) FROM blocked_ips WHERE prefix = 24").fetchone()[0] == "integer"
    assert con.execute("SELECT notes FROM apple_accounts WHERE id = 1").fetchone()[0] is None
    assert con.execute("SELECT reason FROM blocked_ips WHERE prefix = 24").fetchone()[0] == ""
    # DDL is included too, including indexes and autoincrement tables.
    objects = {row[0] for row in con.execute("SELECT name FROM sqlite_master")}
    assert {"blocked_ips", "apple_accounts", "idx_blocked_ips_active"} <= objects


def test_batches_large_tables_into_several_inserts(tmp_path):
    rows = [
        {"id": index, "email": f"user{index}@example.test", "password": "x", "notes": "", "sort_order": 0}
        for index in range(1, restore.BATCH_ROWS * 2 + 3)
    ]
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": rows})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert sql.count('INSERT INTO "apple_accounts"') == 3
    con = sqlite3.connect(":memory:")
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM apple_accounts").fetchone()[0] == len(rows)
    assert con.execute("SELECT MAX(id) FROM apple_accounts").fetchone()[0] == len(rows)


def test_nul_byte_survives_the_round_trip(tmp_path):
    rows = [{"id": 1, "email": "nul@example.test", "password": "a\x00b", "notes": None, "sort_order": 0}]
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": rows})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert "CAST(x'" in sql  # Text literals cannot store NUL, so cast through a blob.
    con = sqlite3.connect(":memory:")
    con.executescript(sql)
    assert con.execute("SELECT password FROM apple_accounts").fetchone()[0] == "a\x00b"


def test_reads_a_plain_jsonl_file_too(tmp_path):
    # Some download paths (R2 REST API / wrangler r2 object get) silently decompress content-encoding
    # as a transport detail, so a downloaded .jsonl.gz may actually be plaintext. Check the magic bytes.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    plain = (directory / "apple_accounts.jsonl.gz").read_bytes()
    with gzip.open(directory / "apple_accounts.jsonl.gz", "rb") as handle:
        plain = handle.read()
    (directory / "apple_accounts.jsonl.gz").write_bytes(plain)

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    con = sqlite3.connect(":memory:")
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM apple_accounts").fetchone()[0] == len(APPLE_ROWS)


def test_data_only_omits_the_schema(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})

    code, sql, _ = run_restore(tmp_path, directory, "--data-only")

    assert code == 0
    assert "CREATE TABLE" not in sql
    assert 'INSERT INTO "apple_accounts"' in sql


def test_replace_mode_is_rerunnable(tmp_path):
    # Create the database with the full script, then replay with --data-only --replace; the second run must neither fail nor duplicate rows.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    assert run_restore(tmp_path, directory)[0] == 0
    code, sql, _ = run_restore(tmp_path, directory, "--data-only", "--replace")

    assert code == 0
    assert 'INSERT OR REPLACE INTO "apple_accounts"' in sql
    con = sqlite3.connect(":memory:")
    con.executescript(DDL)
    con.executescript(sql)
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM apple_accounts").fetchone()[0] == len(APPLE_ROWS)
    assert [tuple(row) for row in con.execute("SELECT id, email, notes FROM apple_accounts ORDER BY id")] == [
        (row["id"], row["email"], row["notes"]) for row in APPLE_ROWS
    ]


def test_missing_table_object_fails_without_writing_partial_restore(tmp_path):
    directory = write_snapshot(
        tmp_path / "backup",
        {"apple_accounts": APPLE_ROWS},
        manifest={"tables": [{"name": "apple_accounts"}, {"name": "blocked_ips"}]},
    )

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "FATAL: missing object: blocked_ips.jsonl.gz" in stderr
    assert sql == ""


def test_without_a_manifest_it_falls_back_to_scanning_the_directory(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert 'INSERT INTO "apple_accounts"' in sql


def test_inconsistent_columns_fail_loudly(tmp_path):
    # Inconsistent columns within one file indicate a corrupt snapshot; reject the restore instead of writing partial data.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    with gzip.open(directory / "apple_accounts.jsonl.gz", "wt", encoding="utf-8") as handle:
        handle.write(json.dumps({"id": 1, "email": "a@example.test"}) + "\n")
        handle.write(json.dumps({"id": 2, "email": "b@example.test", "extra": 1}) + "\n")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert sql == ""
    assert "expected" in stderr


def test_missing_ddl_is_fatal(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS}, ddl=None)

    code, _, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "ddl.sql is missing" in stderr


def test_missing_directory_is_a_usage_error(tmp_path):
    code, _, stderr = run_restore(tmp_path, tmp_path / "nope")

    assert code == 2
    assert "not a directory" in stderr


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, "NULL"),
        (True, "1"),
        (False, "0"),
        (0, "0"),
        (1786000000, "1786000000"),
        ("", "''"),
        ("O'Brien", "'O''Brien'"),
        (1.5, "1.5"),
    ],
)
def test_sql_literal_rendering(value, expected):
    assert restore.sql_literal(value) == expected
