# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for ops/d1-archive/restore.py: disaster-recovery snapshots must restore D1 exactly.

The value of a snapshot is that the restored database matches the original. Assertions
are exact: compare 0/1, NULL versus empty strings, epoch integers, single quotes,
newlines, and NUL bytes value by value.

The manifest is the integrity contract: a snapshot is rendered only when it says
`complete: true` and every object matches its recorded size, SHA-256 and row count.
The tests below cover the happy path, the strict rejections, and the manual rescue
flag that relaxes completeness/integrity metadata but never parsing or security.
"""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import os
import sqlite3
import stat
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RESTORE_PATH = ROOT / "ops" / "d1-archive" / "restore.py"

SPEC = importlib.util.spec_from_file_location("d1_archive_restore", RESTORE_PATH)
assert SPEC and SPEC.loader
restore = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(restore)


DDL = """-- ComiCine D1 configuration & schema snapshot
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

# One valid sqlite_master JSON line, as the producer writes into schema.jsonl.gz.
SCHEMA_ROWS = [
    {
        "type": "table",
        "name": "blocked_ips",
        "tbl_name": "blocked_ips",
        "sql": 'CREATE TABLE "blocked_ips" (cidr TEXT PRIMARY KEY, network TEXT NOT NULL)',
    }
]

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

DEFAULT_MANIFEST = object()


def write_gzip_jsonl(path: Path, rows: list[dict]) -> None:
    payload = "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        handle.write(payload)


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def snapshot_manifest(
    directory: Path,
    table_rows: dict[str, int],
    *,
    complete: bool = True,
    table_errors: dict[str, str] | None = None,
) -> dict:
    """Build a v2 manifest from the bytes that are actually on disk."""
    objects = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name):
        if not path.is_file() or path.name == "manifest.json":
            continue
        objects.append(
            {"name": path.name, "bytes": path.stat().st_size, "sha256": sha256_of(path)}
        )

    rows_by_table = dict(table_rows)
    for name in table_errors or {}:
        rows_by_table.setdefault(name, 0)
    tables = []
    for name in sorted(rows_by_table):
        path = directory / f"{name}.jsonl.gz"
        if path.exists():
            tables.append(
                {
                    "name": name,
                    "rows": rows_by_table[name],
                    "bytes": path.stat().st_size,
                    "sha256": sha256_of(path),
                    "error": (table_errors or {}).get(name),
                }
            )
        else:
            # A failed export leaves no object; the producer records 0 bytes and a null hash.
            tables.append(
                {
                    "name": name,
                    "rows": rows_by_table[name],
                    "bytes": 0,
                    "sha256": None,
                    "error": (table_errors or {}).get(name),
                }
            )
    return {
        "job": "config-backup",
        "day": "2026_10_11",
        "generated_at": 1791671165,
        "complete": complete,
        "objects": objects,
        "tables": tables,
    }


def write_manifest(
    directory: Path,
    table_rows: dict[str, int],
    *,
    complete: bool = True,
    table_errors: dict[str, str] | None = None,
) -> dict:
    manifest = snapshot_manifest(
        directory, table_rows, complete=complete, table_errors=table_errors
    )
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def write_snapshot(
    directory: Path,
    tables: dict[str, list[dict]],
    *,
    ddl: str | None = DDL,
    schema_rows: list[dict] | None = SCHEMA_ROWS,
    manifest: dict | None | object = DEFAULT_MANIFEST,
    complete: bool = True,
    table_errors: dict[str, str] | None = None,
) -> Path:
    """Write a snapshot; by default with the complete v2 manifest the producer would write.

    `manifest` overrides the generated document: pass a dict for a hand-crafted
    manifest, or None to test a legacy archive with no manifest at all.
    """
    directory.mkdir(parents=True, exist_ok=True)
    if ddl is not None:
        (directory / "ddl.sql").write_text(ddl, encoding="utf-8")
    if schema_rows is not None:
        write_gzip_jsonl(directory / "schema.jsonl.gz", schema_rows)
    for name, rows in tables.items():
        write_gzip_jsonl(directory / f"{name}.jsonl.gz", rows)
    if manifest is DEFAULT_MANIFEST:
        manifest = snapshot_manifest(
            directory,
            {name: len(rows) for name, rows in tables.items()},
            complete=complete,
            table_errors=table_errors,
        )
    if manifest is not None:
        (directory / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
    return directory


def run_restore(
    tmp_path: Path,
    directory: Path,
    *extra: str,
    out: Path | None = None,
    read_output: bool = True,
) -> tuple[int, str, str]:
    out = out if out is not None else tmp_path / "restore.sql"
    argv = ["--dir", str(directory), "--out", str(out), *extra]
    import contextlib
    import io

    stderr = io.StringIO()
    with contextlib.redirect_stderr(stderr):
        code = restore.main(argv)
    sql = out.read_text(encoding="utf-8") if read_output and out.exists() else ""
    return code, sql, stderr.getvalue()


def test_round_trip_preserves_every_value_and_type(tmp_path, request):
    directory = write_snapshot(
        tmp_path / "backup",
        {"blocked_ips": BLOCKED_ROWS, "apple_accounts": APPLE_ROWS},
    )

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 0
    assert "FATAL" not in stderr
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
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


def test_complete_snapshot_restores_normally(tmp_path, request):
    directory = write_snapshot(tmp_path / "backup", {"blocked_ips": BLOCKED_ROWS})

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 0
    assert "FATAL" not in stderr
    assert "WARNING" not in stderr
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert [tuple(row) for row in con.execute(
        "SELECT cidr, network, prefix, reason, updated_by, active FROM blocked_ips ORDER BY cidr"
    )] == [tuple(row.values()) for row in sorted(BLOCKED_ROWS, key=lambda row: row["cidr"])]


def test_restore_sql_is_private_before_overwriting_existing_file(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    out = tmp_path / "restore.sql"
    out.write_text("old data", encoding="utf-8")
    out.chmod(0o644)

    code, _, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert stat.S_IMODE(out.stat().st_mode) == 0o600


@pytest.mark.skipif(not hasattr(os, "O_NOFOLLOW"), reason="O_NOFOLLOW is not available")
def test_restore_sql_refuses_to_follow_symlinks(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    protected = tmp_path / "protected.sql"
    protected.write_text("keep this data", encoding="utf-8")
    out = tmp_path / "restore.sql"
    out.symlink_to(protected)

    with pytest.raises(OSError):
        restore.main(["--dir", str(directory), "--out", str(out)])

    assert protected.read_text(encoding="utf-8") == "keep this data"


def test_pre_existing_output_inside_the_snapshot_directory_is_ignored(tmp_path):
    # The documented command is `--dir "$DEST" --out "$DEST/restore.sql"`; a retry
    # finds that file already there, and only that exact path is exempt from the
    # strict "directory equals manifest entries" check.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    out = directory / "restore.sql"
    out.write_text("stale restore from an earlier attempt", encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory, out=out)

    assert code == 0
    assert "FATAL" not in stderr
    assert 'INSERT INTO "apple_accounts"' in sql
    assert stat.S_IMODE(out.stat().st_mode) == 0o600


@pytest.mark.parametrize(
    "name", ["ddl.sql", "schema.jsonl.gz", "manifest.json", "apple_accounts.jsonl.gz"]
)
def test_out_path_refuses_to_overwrite_a_snapshot_object(tmp_path, name):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    target = directory / name
    before = target.read_bytes()

    code, _, stderr = run_restore(tmp_path, directory, out=target, read_output=False)

    assert code == 2
    assert "FATAL: refusing to overwrite snapshot object" in stderr
    assert name in stderr
    assert target.read_bytes() == before


def test_out_collision_is_not_bypassed_by_rescue(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    target = directory / "ddl.sql"
    before = target.read_bytes()

    code, _, stderr = run_restore(
        tmp_path, directory, "--allow-incomplete", out=target, read_output=False
    )

    assert code == 2
    assert "refusing to overwrite snapshot object" in stderr
    assert target.read_bytes() == before


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlink is not available")
def test_symlinked_ddl_is_rejected_even_on_rescue(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    target = tmp_path / "outside.sql"
    secret = DDL + "-- SECRET_MARKER\n"
    target.write_text(secret, encoding="utf-8")
    ddl_path = directory / "ddl.sql"
    ddl_path.unlink()
    ddl_path.symlink_to(target)

    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 1
    assert "ddl.sql is a symlink" in stderr
    assert sql == ""
    assert target.read_text(encoding="utf-8") == secret


def test_batches_large_tables_into_several_inserts(tmp_path, request):
    rows = [
        {"id": index, "email": f"user{index}@example.test", "password": "x", "notes": "", "sort_order": 0}
        for index in range(1, restore.BATCH_ROWS * 2 + 3)
    ]
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": rows})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert sql.count('INSERT INTO "apple_accounts"') == 3
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM apple_accounts").fetchone()[0] == len(rows)
    assert con.execute("SELECT MAX(id) FROM apple_accounts").fetchone()[0] == len(rows)


def test_nul_byte_survives_the_round_trip(tmp_path, request):
    rows = [{"id": 1, "email": "nul@example.test", "password": "a\x00b", "notes": None, "sort_order": 0}]
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": rows})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    assert "CAST(x'" in sql  # Text literals cannot store NUL, so cast through a blob.
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert con.execute("SELECT password FROM apple_accounts").fetchone()[0] == "a\x00b"


def test_reads_a_plain_jsonl_file_too(tmp_path, request):
    # Some download paths (R2 REST API / wrangler r2 object get) silently decompress content-encoding
    # as a transport detail, so a downloaded .jsonl.gz may actually be plaintext. Check the magic bytes.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    with gzip.open(directory / "apple_accounts.jsonl.gz", "rb") as handle:
        plain = handle.read()
    (directory / "apple_accounts.jsonl.gz").write_bytes(plain)
    # The bytes changed, so a correct manifest must describe the plaintext file.
    write_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})

    code, sql, _ = run_restore(tmp_path, directory)

    assert code == 0
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM apple_accounts").fetchone()[0] == len(APPLE_ROWS)


def test_decompressed_object_is_rejected_with_a_download_hint(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    target = directory / "apple_accounts.jsonl.gz"
    with gzip.open(target, "rb") as handle:
        plain = handle.read()
    target.write_bytes(plain)

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "sha256 mismatch for apple_accounts.jsonl.gz" in stderr
    assert "decompressed" in stderr
    assert "stored bytes unchanged" in stderr
    assert sql == ""


def test_data_only_omits_the_schema(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})

    code, sql, _ = run_restore(tmp_path, directory, "--data-only")

    assert code == 0
    assert "CREATE TABLE" not in sql
    assert 'INSERT INTO "apple_accounts"' in sql


def test_replace_mode_is_rerunnable(tmp_path, request):
    # Create the database with the full script, then replay with --data-only --replace; the second run must neither fail nor duplicate rows.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    assert run_restore(tmp_path, directory)[0] == 0
    code, sql, _ = run_restore(tmp_path, directory, "--data-only", "--replace")

    assert code == 0
    assert 'INSERT OR REPLACE INTO "apple_accounts"' in sql
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
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
        {"blocked_ips": BLOCKED_ROWS, "apple_accounts": APPLE_ROWS},
    )
    (directory / "blocked_ips.jsonl.gz").unlink()

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "FATAL: snapshot integrity check failed; refusing to restore" in stderr
    assert "missing object: blocked_ips.jsonl.gz" in stderr
    assert sql == ""


def test_archive_with_only_ddl_is_rejected(tmp_path):
    # Requirement: no manifest at all, only ddl.sql. Default behavior must refuse and
    # write no output file instead of silently producing a schema-only restore.
    directory = tmp_path / "backup"
    directory.mkdir()
    (directory / "ddl.sql").write_text(DDL, encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "FATAL: snapshot integrity check failed; refusing to restore" in stderr
    assert "manifest.json is missing" in stderr
    assert "--allow-incomplete" in stderr
    assert sql == ""


def test_without_a_manifest_default_rejects_and_rescue_scans_the_directory(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS}, manifest=None)

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "manifest.json is missing" in stderr
    assert sql == ""

    # The rescue flag keeps the old directory-scan behavior for legacy archives.
    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 0
    assert "WARNING: --allow-incomplete: integrity checks are not enforced" in stderr
    assert 'INSERT INTO "apple_accounts"' in sql


def test_legacy_manifest_without_complete_is_rejected_by_default(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    manifest = snapshot_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})
    del manifest["complete"]
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "complete field is missing" in stderr
    assert "legacy" in stderr
    assert "--allow-incomplete" in stderr
    assert sql == ""

    # Legacy archives remain renderable only through the explicit rescue flag.
    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 0
    assert "WARNING: manifest.json: complete field is missing" in stderr
    assert 'INSERT INTO "apple_accounts"' in sql


def test_manifest_object_entry_without_sha256_is_rejected(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    manifest = snapshot_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})
    del manifest["objects"][0]["sha256"]
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "sha256 field is missing" in stderr
    assert "apple_accounts.jsonl.gz" in stderr
    assert sql == ""


def test_manifest_table_entry_without_rows_is_rejected(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    manifest = snapshot_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})
    del manifest["tables"][0]["rows"]
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "rows field is missing" in stderr
    assert "apple_accounts" in stderr
    assert sql == ""


def test_sha256_mismatch_is_rejected(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    target = directory / "ddl.sql"
    payload = bytearray(target.read_bytes())
    payload[len(payload) // 2] ^= 0x01
    target.write_bytes(bytes(payload))

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "sha256 mismatch for ddl.sql" in stderr
    # ddl.sql is intentionally plain UTF-8, so the decompression hint is only for .jsonl.gz objects.
    assert "not gzip-compressed" not in stderr
    assert "decompressed" not in stderr
    assert sql == ""


def test_unexpected_file_in_the_snapshot_directory_is_rejected(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    (directory / "notes.txt").write_text("not part of the R2 prefix", encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "unexpected entry in the snapshot directory: notes.txt" in stderr
    assert sql == ""


def test_table_row_count_mismatch_is_rejected(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    manifest = snapshot_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})
    manifest["tables"][0]["rows"] = len(APPLE_ROWS) + 1
    (directory / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "row-count mismatch for apple_accounts" in stderr
    assert f"has {len(APPLE_ROWS)}" in stderr
    assert sql == ""


def test_allow_incomplete_warns_and_restores_available_tables(tmp_path, request):
    directory = write_snapshot(
        tmp_path / "backup",
        {"blocked_ips": BLOCKED_ROWS},
        complete=False,
        table_errors={"apple_accounts": "D1_ERROR: query timed out"},
    )

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "incomplete snapshot" in stderr
    assert sql == ""

    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 0
    assert "WARNING: --allow-incomplete: integrity checks are not enforced" in stderr
    assert "WARNING: " in stderr
    assert "table export failed: apple_accounts" in stderr
    assert 'INSERT INTO "apple_accounts"' not in sql
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM blocked_ips").fetchone()[0] == len(BLOCKED_ROWS)


def test_allow_incomplete_skips_a_missing_table_object(tmp_path, request):
    directory = write_snapshot(
        tmp_path / "backup",
        {"blocked_ips": BLOCKED_ROWS, "apple_accounts": APPLE_ROWS},
    )
    (directory / "apple_accounts.jsonl.gz").unlink()

    code, _, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "missing object: apple_accounts.jsonl.gz" in stderr

    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 0
    assert "WARNING: missing object: apple_accounts.jsonl.gz" in stderr
    assert 'INSERT INTO "apple_accounts"' not in sql
    con = sqlite3.connect(":memory:")
    request.addfinalizer(con.close)
    con.executescript(sql)
    assert con.execute("SELECT COUNT(*) FROM blocked_ips").fetchone()[0] == len(BLOCKED_ROWS)


def test_inconsistent_columns_fail_loudly_even_on_rescue(tmp_path):
    # Inconsistent columns within one file indicate a corrupt snapshot; reject the restore
    # instead of writing partial data. The rescue flag does not relax parsing.
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS})
    with gzip.open(directory / "apple_accounts.jsonl.gz", "wt", encoding="utf-8") as handle:
        handle.write(json.dumps({"id": 1, "email": "a@example.test"}) + "\n")
        handle.write(json.dumps({"id": 2, "email": "b@example.test", "extra": 1}) + "\n")
    write_manifest(directory, {"apple_accounts": 2})

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert sql == ""
    assert "expected" in stderr

    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 1
    assert sql == ""
    assert "expected" in stderr


def test_missing_ddl_is_fatal(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS}, ddl=None)

    code, _, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "ddl.sql" in stderr


def test_missing_ddl_is_fatal_even_on_rescue(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS}, ddl=None)

    code, sql, stderr = run_restore(tmp_path, directory, "--allow-incomplete")

    assert code == 1
    assert "FATAL: cannot render the snapshot" in stderr
    assert "ddl.sql is missing" in stderr
    assert sql == ""


@pytest.mark.skipif(not hasattr(os, "symlink"), reason="symlink is not available")
def test_manifest_symlink_is_refused(tmp_path):
    directory = write_snapshot(tmp_path / "backup", {"apple_accounts": APPLE_ROWS}, manifest=None)
    real_manifest = tmp_path / "manifest.json"
    manifest = snapshot_manifest(directory, {"apple_accounts": len(APPLE_ROWS)})
    real_manifest.write_text(json.dumps(manifest), encoding="utf-8")
    (directory / "manifest.json").symlink_to(real_manifest)

    code, sql, stderr = run_restore(tmp_path, directory)

    assert code == 1
    assert "manifest.json is a symlink" in stderr
    assert sql == ""


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
