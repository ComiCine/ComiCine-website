#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Render a `backup/YYYY_MM_DD/` disaster-recovery snapshot back into SQL.

Why this exists: the snapshot stores rows as gzip-compressed JSONL (exact types,
one object per line) because that is what round-trips 0/1 flags, epoch integers
and the NULL-versus-empty-string distinction. `wrangler d1 execute` wants SQL, so
something has to do the conversion; making that "something" a script in the repo
means the restore path is tested instead of improvised at 3am.

A snapshot is rendered only after it proves itself: manifest.json must declare
`complete: true` and every object must match its recorded size, SHA-256 and (for
tables) row count. Anything else is a mid-download or mid-upload artifact, and
restoring half a snapshot is worse than refusing it.

Usage:
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --out restore.sql
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --data-only --out data.sql
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --replace --out restore.sql
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --allow-incomplete --out rescue.sql

Get a snapshot out of R2 first (the Worker only ever writes it):
    wrangler r2 object get comicine-analytics/backup/2026_10_11/ddl.sql --file ddl.sql
    for f in manifest.json schema.jsonl.gz blocked_ips.jsonl.gz ...; do ...; done

Then:
    wrangler d1 execute <database> --remote --file restore.sql

--allow-incomplete is a manual-rescue escape hatch: integrity metadata is not
enforced, but parsing and security checks still are. Legacy snapshots (written
before the manifest recorded completeness) are rejected unless that flag is set.

Exit codes: 0 = SQL rendered, 1 = the snapshot is unusable or incomplete (missing
or corrupt manifest, missing object, hash mismatch, row-count mismatch, missing
ddl.sql, unreadable gzip, inconsistent columns), 2 = bad arguments.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import stat
import sys
import zlib
from typing import Any, TextIO

# Number of rows per INSERT batch; too many rows in one SQL statement can exceed D1's per-statement limit.
BATCH_ROWS = 100
MANIFEST_NAME = "manifest.json"
DDL_OBJECT = "ddl.sql"
SCHEMA_OBJECT = "schema.jsonl.gz"
TABLE_SUFFIX = ".jsonl.gz"
# Non-table objects from sqlite_master, stored as-is in addition to table data in manifest.json.
NON_TABLE_OBJECTS = {SCHEMA_OBJECT}
# One MiB chunks keep hashing a large object bounded in memory.
HASH_CHUNK_BYTES = 1024 * 1024
SQL_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")
SHA256_HEX = re.compile(r"[0-9a-f]{64}\Z")
INTEGRITY_FAILURE = (
    "snapshot integrity check failed; refusing to restore "
    "(use --allow-incomplete only for manual rescue)"
)
RESCUE_WARNING = (
    "--allow-incomplete: integrity checks are not enforced; this is for manual rescue only"
)


class UnsafeSnapshotError(ValueError):
    """A security check failed; --allow-incomplete never relaxes these checks."""


def validate_identifier(value: Any, label: str) -> str:
    """Accept only plain SQLite identifiers from snapshot metadata and row keys."""
    if not isinstance(value, str) or not SQL_IDENTIFIER.fullmatch(value):
        raise ValueError(f"invalid {label}: {value!r}")
    return value


def sql_identifier(value: Any, label: str) -> str:
    return f'"{validate_identifier(value, label)}"'


def is_non_negative_int(value: Any) -> bool:
    # bool is a subclass of int, but `bytes: true` is not a length.
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def is_sha256_hex(value: Any) -> bool:
    return isinstance(value, str) and SHA256_HEX.fullmatch(value) is not None


def is_object_name(value: Any) -> bool:
    """Accept ddl.sql, schema.jsonl.gz or <identifier>.jsonl.gz, nothing else."""
    if not isinstance(value, str):
        return False
    if value in (DDL_OBJECT, SCHEMA_OBJECT):
        return True
    if not value.endswith(TABLE_SUFFIX):
        return False
    return SQL_IDENTIFIER.fullmatch(value[: -len(TABLE_SUFFIX)]) is not None


def load_manifest(directory: str) -> dict[str, Any] | None:
    """Read manifest.json; only a missing file is tolerated.

    Refusing symlinks here matters because the manifest decides which files are
    hashed and which tables are rendered.
    """
    manifest_path = os.path.join(directory, MANIFEST_NAME)
    try:
        info = os.lstat(manifest_path)
    except FileNotFoundError:
        return None
    if stat.S_ISLNK(info.st_mode):
        raise UnsafeSnapshotError("manifest.json is a symlink; refusing to read it")
    if not stat.S_ISREG(info.st_mode):
        raise UnsafeSnapshotError("manifest.json is not a regular file; refusing to read it")
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must contain a JSON object")
    return manifest


def file_sha256(path: str) -> str:
    """Hash the exact stored bytes, streaming in chunks so large objects stay cheap."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(HASH_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def has_gzip_magic(path: str) -> bool:
    try:
        with open(path, "rb") as handle:
            return handle.read(2) == b"\x1f\x8b"
    except OSError:
        return False


def count_jsonl_rows(path: str) -> int:
    """Count non-empty JSONL records using the same gzip sniffing as the renderer."""
    rows = 0
    with open_jsonl(path) as handle:
        for line in handle:
            if line.rstrip("\n"):
                rows += 1
    return rows


def output_entry_name(directory: str, output_path: str | None) -> str | None:
    """Name of --out when it already sits inside the snapshot directory.

    The documented workflow writes restore.sql into the downloaded snapshot and on
    a retry that file is already there. Exclude exactly that path, never any other
    entry, from the strict "directory matches the manifest" check.
    """
    if output_path is None:
        return None
    output_abs = os.path.abspath(output_path)
    if os.path.realpath(os.path.dirname(output_abs)) != os.path.realpath(directory):
        return None
    return os.path.basename(output_abs)


def output_collides_with_snapshot(directory: str, output_path: str | None) -> str | None:
    """Return the snapshot object name --out would overwrite, if any.

    Writing the restore script over ddl.sql, manifest.json or a table export would
    silently destroy the very data the script is being rendered from, so refuse it
    as a usage error instead of excluding it from the directory-set check.
    """
    name = output_entry_name(directory, output_path)
    if name is None:
        return None
    if name == MANIFEST_NAME or is_object_name(name):
        return name
    return None


def verify_snapshot(
    directory: str, manifest: dict[str, Any] | None, *, output_path: str | None = None
) -> list[str]:
    """Return every integrity problem in the snapshot; does not print or write.

    This is deliberately strict: the directory must be exactly the downloaded R2
    prefix (plus, at most, the --out file being rewritten), every object must match
    its recorded metadata, and table reports must agree with their objects.
    """
    issues: list[str] = []
    if manifest is None:
        issues.append(
            "manifest.json is missing; this snapshot has no completeness manifest "
            "(legacy or incomplete archive). Re-run the backup, or pass "
            "--allow-incomplete for a manual rescue"
        )
        return issues

    complete = manifest.get("complete")
    if complete is not True:
        if "complete" not in manifest:
            issues.append(
                "manifest.json: complete field is missing; this is a legacy or incomplete "
                "snapshot. Only complete: true snapshots can be restored; pass "
                "--allow-incomplete only for a manual rescue"
            )
        else:
            issues.append(
                f"manifest.json: complete is {complete!r}, not the boolean true; this is an "
                "incomplete snapshot. Only complete snapshots can be restored; pass "
                "--allow-incomplete only for a manual rescue"
            )

    object_entries: dict[str, dict[str, Any]] = {}
    objects_value = manifest.get("objects")
    if not isinstance(objects_value, list):
        issues.append("manifest.json: objects field is missing or is not a list")
    else:
        if not objects_value:
            issues.append(
                "manifest.json: objects list is empty; a complete snapshot lists ddl.sql, "
                "schema.jsonl.gz and every table object"
            )
        for index, entry in enumerate(objects_value):
            label = f"objects[{index}]"
            if not isinstance(entry, dict):
                issues.append(f"{label}: expected an object with name, bytes and sha256")
                continue
            name = entry.get("name")
            if not is_object_name(name):
                issues.append(
                    f"{label}: unsafe or unsupported object name {name!r}; expected ddl.sql, "
                    "schema.jsonl.gz or <table>.jsonl.gz"
                )
                continue
            if name in object_entries:
                issues.append(f"{label}: duplicate object name {name}")
                continue
            object_entries[name] = entry
            if "bytes" not in entry:
                issues.append(f"{label} ({name}): bytes field is missing")
            elif not is_non_negative_int(entry["bytes"]):
                issues.append(
                    f"{label} ({name}): bytes must be a non-negative integer, "
                    f"got {entry['bytes']!r}"
                )
            if "sha256" not in entry:
                issues.append(f"{label} ({name}): sha256 field is missing")
            elif not is_sha256_hex(entry["sha256"]):
                issues.append(
                    f"{label} ({name}): sha256 must be 64 lowercase hex characters, "
                    f"got {entry['sha256']!r}"
                )
        for required in (DDL_OBJECT, SCHEMA_OBJECT):
            if required not in object_entries:
                issues.append(
                    f"manifest.json: objects is missing {required}; a complete snapshot must "
                    "list ddl.sql and schema.jsonl.gz"
                )

        expected_entries = set(object_entries) | {MANIFEST_NAME}
        try:
            actual_entries = set(os.listdir(directory))
        except OSError as exc:
            issues.append(f"cannot list the snapshot directory: {exc}")
        else:
            out_name = output_entry_name(directory, output_path)
            if out_name is not None and out_name not in expected_entries:
                actual_entries.discard(out_name)
            for name in sorted(expected_entries - actual_entries):
                issues.append(f"missing object: {name} (listed in manifest.json)")
            for name in sorted(actual_entries - expected_entries):
                issues.append(
                    f"unexpected entry in the snapshot directory: {name} "
                    "(not listed in manifest.json)"
                )

        for name in sorted(object_entries):
            entry = object_entries[name]
            path = os.path.join(directory, name)
            try:
                info = os.lstat(path)
            except FileNotFoundError:
                # Already reported by the directory-set comparison above.
                continue
            except OSError as exc:
                issues.append(f"cannot inspect {name}: {exc}")
                continue
            if stat.S_ISLNK(info.st_mode):
                issues.append(
                    f"object {name} is a symlink; snapshot objects must be regular files"
                )
                continue
            if not stat.S_ISREG(info.st_mode):
                issues.append(f"object {name} is not a regular file")
                continue
            expected_size = entry.get("bytes")
            if is_non_negative_int(expected_size) and info.st_size != expected_size:
                issues.append(
                    f"size mismatch for {name}: manifest.json says {expected_size} bytes, "
                    f"the file is {info.st_size} bytes"
                )
            expected_sha = entry.get("sha256")
            if not is_sha256_hex(expected_sha):
                # Already reported as invalid metadata above.
                continue
            try:
                actual_sha = file_sha256(path)
            except OSError as exc:
                issues.append(f"cannot read {name} to verify its sha256: {exc}")
                continue
            if actual_sha != expected_sha:
                issues.append(
                    f"sha256 mismatch for {name}: manifest.json says {expected_sha}, "
                    f"the file has {actual_sha}"
                )
                if name.endswith(TABLE_SUFFIX) and not has_gzip_magic(path):
                    issues.append(
                        f"{name} is not gzip-compressed (magic bytes are not 1f 8b); a download "
                        "client may have decompressed it. Download the stored bytes unchanged "
                        "and run the restore again"
                    )

    table_entries: dict[str, dict[str, Any]] = {}
    tables_value = manifest.get("tables")
    if not isinstance(tables_value, list):
        issues.append("manifest.json: tables field is missing or is not a list")
    else:
        for index, entry in enumerate(tables_value):
            label = f"tables[{index}]"
            if not isinstance(entry, dict):
                issues.append(f"{label}: expected an object with name, rows, bytes, sha256, error")
                continue
            name = entry.get("name")
            if not isinstance(name, str) or not SQL_IDENTIFIER.fullmatch(name):
                issues.append(
                    f"{label}: name field is missing or is not a valid table identifier: {name!r}"
                )
                continue
            if name in table_entries:
                issues.append(f"{label}: duplicate table name {name}")
                continue
            table_entries[name] = entry
            if "rows" not in entry:
                issues.append(f"{label} ({name}): rows field is missing")
            elif not is_non_negative_int(entry["rows"]):
                issues.append(
                    f"{label} ({name}): rows must be a non-negative integer, got {entry['rows']!r}"
                )
            if "bytes" not in entry:
                issues.append(f"{label} ({name}): bytes field is missing")
            elif not is_non_negative_int(entry["bytes"]):
                issues.append(
                    f"{label} ({name}): bytes must be a non-negative integer, "
                    f"got {entry['bytes']!r}"
                )
            if "sha256" not in entry:
                issues.append(f"{label} ({name}): sha256 field is missing")
            elif entry["sha256"] is None:
                if complete is True:
                    issues.append(f"{label} ({name}): sha256 is null in a complete snapshot")
            elif not is_sha256_hex(entry["sha256"]):
                issues.append(
                    f"{label} ({name}): sha256 must be 64 lowercase hex characters or null, "
                    f"got {entry['sha256']!r}"
                )
            if "error" not in entry:
                issues.append(
                    f"{label} ({name}): error field is missing (it must be null in a "
                    "complete snapshot)"
                )
            elif entry["error"] is not None:
                issues.append(f"{label} ({name}): table export failed: {entry['error']}")

        listed_objects = {f"{name}{TABLE_SUFFIX}" for name in table_entries}
        table_objects = {name for name in object_entries if name not in (DDL_OBJECT, SCHEMA_OBJECT)}
        for name in sorted(table_entries):
            object_name = f"{name}{TABLE_SUFFIX}"
            object_entry = object_entries.get(object_name)
            if object_entry is None:
                issues.append(
                    f"table {name} is listed in manifest.json tables but {object_name} is not "
                    "listed in objects"
                )
                continue
            table_size = table_entries[name].get("bytes")
            object_size = object_entry.get("bytes")
            if (
                is_non_negative_int(table_size)
                and is_non_negative_int(object_size)
                and table_size != object_size
            ):
                issues.append(
                    f"table {name}: bytes {table_size} do not match object {object_name} "
                    f"bytes {object_size}"
                )
            table_sha = table_entries[name].get("sha256")
            object_sha = object_entry.get("sha256")
            if is_sha256_hex(table_sha) and is_sha256_hex(object_sha) and table_sha != object_sha:
                issues.append(
                    f"table {name}: sha256 does not match object {object_name}"
                )
        for object_name in sorted(table_objects - listed_objects):
            issues.append(
                f"object {object_name} is a table export but it is not listed in "
                "manifest.json tables"
            )

        for name in sorted(table_entries):
            rows = table_entries[name].get("rows")
            if not is_non_negative_int(rows):
                continue
            object_name = f"{name}{TABLE_SUFFIX}"
            path = os.path.join(directory, object_name)
            try:
                info = os.lstat(path)
            except OSError:
                continue
            if not stat.S_ISREG(info.st_mode):
                # Missing or non-regular objects were reported above.
                continue
            try:
                actual_rows = count_jsonl_rows(path)
            except (OSError, EOFError, UnicodeDecodeError, zlib.error) as exc:
                issues.append(f"cannot count rows in {object_name}: {exc}")
                continue
            if actual_rows != rows:
                issues.append(
                    f"row-count mismatch for {name}: manifest.json says {rows} rows, "
                    f"{object_name} has {actual_rows}"
                )

    return issues


def sql_literal(value: Any) -> str:
    """Render a JSON value as an exact SQL literal.

    Exactness is the point: snapshot types are preserved only if restoration is exact.
      - None  -> NULL (not the string 'NULL' or an empty string)
      - bool  -> 1/0 (SQLite has no boolean type)
      - int   -> unchanged decimal form (epoch seconds must not become floats)
      - float -> repr(), so the read value is written back as-is
      - str   -> single-quoted with embedded quotes doubled; strings containing NUL use
                 CAST(x'..' AS TEXT), because SQL text literals cannot contain \\x00
      - bytes -> x'..' (not present in real snapshots, kept as a fallback)
    """
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, bytes):
        return f"x'{value.hex()}'"
    if isinstance(value, str):
        if "\x00" in value:
            return f"CAST(x'{value.encode('utf-8').hex()}' AS TEXT)"
        return "'" + value.replace("'", "''") + "'"
    raise TypeError(f"cannot render {type(value).__name__} as SQL")


def open_jsonl(path: str):
    """Decide whether to decompress by content, not by filename extension.

    Snapshot objects declare application/gzip, so downloads normally contain gzip bytes. However,
    clients that treat content-encoding as a transport detail (including the R2 REST API and
    `wrangler r2 object get`) may silently decompress the content while leaving its .jsonl.gz name
    unchanged. Detect the magic bytes instead: 1f 8b means gzip; otherwise read UTF-8 text.
    """
    with open(path, "rb") as probe:
        magic = probe.read(2)
    if magic == b"\x1f\x8b":
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, encoding="utf-8")


def open_private(path: str) -> TextIO:
    """Create or replace a restore script without exposing account data to other users."""
    flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.ftruncate(fd, 0)
        return os.fdopen(fd, "w", encoding="utf-8")
    except BaseException:
        os.close(fd)
        raise


def read_jsonl_gz(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with open_jsonl(path) as handle:
        for lineno, line in enumerate(handle, start=1):
            stripped = line.rstrip("\n")
            if not stripped:
                continue
            row = json.loads(stripped)
            if not isinstance(row, dict):
                raise ValueError(f"{path}:{lineno}: expected a JSON object per line")
            rows.append(row)
    return rows


def insert_statements(table: str, rows: list[dict[str, Any]], replace: bool) -> list[str]:
    """Render rows as multi-value INSERT statements; row keys define the columns and must stay in the same order."""
    table_sql = sql_identifier(table, "table name")
    if not rows:
        return [f"-- {table}: no rows in this snapshot"]
    columns = [validate_identifier(column, "column name") for column in rows[0].keys()]
    for index, row in enumerate(rows[1:], start=2):
        if list(row.keys()) != columns:
            raise ValueError(
                f"{table}: line {index} has columns {list(row.keys())}, expected {list(rows[0].keys())}"
            )
    verb = "INSERT OR REPLACE INTO" if replace else "INSERT INTO"
    col_sql = ", ".join(f'"{column}"' for column in columns)
    statements: list[str] = []
    for start in range(0, len(rows), BATCH_ROWS):
        chunk = rows[start : start + BATCH_ROWS]
        values = ",\n  ".join(
            "(" + ", ".join(sql_literal(row[column]) for column in columns) + ")" for row in chunk
        )
        statements.append(f"{verb} {table_sql} ({col_sql}) VALUES\n  {values};")
    return statements


def table_names(directory: str, manifest: dict[str, Any] | None) -> list[str]:
    """Return the table list from manifest.json when available, otherwise scan the directory."""
    names: list[str] = []
    if manifest is not None:
        entries = manifest.get("tables")
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name")
                if isinstance(name, str) and SQL_IDENTIFIER.fullmatch(name):
                    names.append(name)
    if names:
        return names
    for name in sorted(os.listdir(directory)):
        if name.endswith(TABLE_SUFFIX) and name not in NON_TABLE_OBJECTS:
            names.append(validate_identifier(name[: -len(TABLE_SUFFIX)], "table name"))
    return names


def idempotent_schema(ddl: str) -> str:
    """Make supported SQLite schema declarations safe to replay without rewriting their bodies."""
    create_prefix = re.compile(
        r"(?im)^(\s*CREATE\s+(?:(?:TEMP|TEMPORARY|UNIQUE|VIRTUAL)\s+)*"
        r"(?:TABLE|INDEX|TRIGGER|VIEW)\s+)(?!IF\s+NOT\s+EXISTS\b)"
    )
    return create_prefix.sub(r"\1IF NOT EXISTS ", ddl)


def render(
    directory: str,
    data_only: bool,
    replace: bool,
    manifest: dict[str, Any] | None,
    *,
    allow_incomplete: bool = False,
) -> tuple[str, list[str]]:
    root = os.path.realpath(directory)
    ddl_path = os.path.join(directory, DDL_OBJECT)
    try:
        ddl_info = os.lstat(ddl_path)
    except FileNotFoundError:
        raise FileNotFoundError(f"{ddl_path} is missing; this is not a backup/ snapshot") from None
    if stat.S_ISLNK(ddl_info.st_mode):
        raise UnsafeSnapshotError("ddl.sql is a symlink; refusing to read it")
    if not stat.S_ISREG(ddl_info.st_mode):
        raise UnsafeSnapshotError("ddl.sql is not a regular file; refusing to read it")
    if os.path.commonpath((root, os.path.realpath(ddl_path))) != root:
        raise UnsafeSnapshotError("ddl.sql escapes the snapshot directory")
    with open(ddl_path, encoding="utf-8") as handle:
        ddl = handle.read()

    notes: list[str] = []
    parts: list[str] = []
    if not data_only:
        schema = idempotent_schema(ddl) if replace else ddl
        parts.append("-- schema (from ddl.sql)\n" + schema.rstrip("\n") + "\n")

    failed_tables: set[str] = set()
    if manifest is not None:
        entries = manifest.get("tables")
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name")
                if isinstance(name, str) and entry.get("error") is not None:
                    failed_tables.add(name)
                    notes.append(f"table export failed: {name}: {entry['error']}")

    rendered_tables = 0
    rendered_rows = 0
    for table in table_names(directory, manifest):
        path = os.path.join(directory, f"{table}{TABLE_SUFFIX}")
        resolved_path = os.path.realpath(path)
        if os.path.islink(path) or os.path.commonpath((root, resolved_path)) != root:
            raise ValueError(f"table object escapes the snapshot directory: {table}")
        if not os.path.exists(path):
            # A partially failed snapshot did not export this table; report it instead of silently skipping it.
            notes.append(f"missing object: {table}{TABLE_SUFFIX} (that table was not captured)")
            continue
        if table in failed_tables:
            # The manifest already explains why this table has no usable rows; skip it on rescue.
            if allow_incomplete:
                continue
        rows = read_jsonl_gz(path)
        statements = insert_statements(table, rows, replace)
        parts.append("\n".join(statements))
        rendered_tables += 1
        rendered_rows += len(rows)

    header = [
        "-- ComiCine D1 restore script, rendered by ops/d1-archive/restore.py",
        f"-- source directory: {directory}",
        f"-- tables: {rendered_tables}  rows: {rendered_rows}  mode: "
        + ("data only" if data_only else "schema + data")
        + ("  replace" if replace else ""),
        "-- target must be a FRESH database unless --replace was used.",
        "",
    ]
    return "\n".join(header) + "\n" + "\n\n".join(parts) + "\n", notes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render a backup/YYYY_MM_DD/ snapshot back into replayable SQL.",
    )
    parser.add_argument("--dir", required=True, help="directory holding ddl.sql and *.jsonl.gz")
    parser.add_argument("--out", default="-", help="output SQL file ('-' = stdout)")
    parser.add_argument("--data-only", action="store_true", help="emit INSERTs only, no DDL")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="use INSERT OR REPLACE so the script can be re-run against a populated database",
    )
    parser.add_argument(
        "--allow-incomplete",
        action="store_true",
        help="rescue only: render despite incomplete or unverifiable snapshot metadata",
    )
    args = parser.parse_args(argv)

    if not os.path.isdir(args.dir):
        print(f"FATAL: not a directory: {args.dir}", file=sys.stderr)
        return 2

    output_path = None if args.out == "-" else os.path.abspath(args.out)
    collision = output_collides_with_snapshot(args.dir, output_path)
    if collision is not None:
        print(
            f"FATAL: refusing to overwrite snapshot object: {args.out} "
            f"({collision} is part of the snapshot; choose an --out path outside it)",
            file=sys.stderr,
        )
        return 2

    if args.allow_incomplete:
        print(f"WARNING: {RESCUE_WARNING}", file=sys.stderr)

    try:
        manifest = load_manifest(args.dir)
    except UnsafeSnapshotError as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as exc:
        # A manifest that cannot even be parsed is a parsing failure: rescue does not bypass it.
        print(f"FATAL: manifest.json is unreadable or is not a JSON object: {exc}", file=sys.stderr)
        return 1

    issues = verify_snapshot(args.dir, manifest, output_path=output_path)
    if issues:
        if not args.allow_incomplete:
            print(f"FATAL: {INTEGRITY_FAILURE}", file=sys.stderr)
            for issue in issues:
                print(f"FATAL: {issue}", file=sys.stderr)
            return 1
        for issue in issues:
            print(f"WARNING: {issue}", file=sys.stderr)

    try:
        sql, notes = render(
            args.dir,
            args.data_only,
            args.replace,
            manifest,
            allow_incomplete=args.allow_incomplete,
        )
    except (OSError, ValueError, KeyError, json.JSONDecodeError, zlib.error) as exc:
        print(f"FATAL: cannot render the snapshot: {exc}", file=sys.stderr)
        return 1

    if notes:
        if not args.allow_incomplete:
            for note in notes:
                print(f"FATAL: {note}", file=sys.stderr)
            return 1
        for note in notes:
            print(f"WARNING: {note}", file=sys.stderr)

    if args.out == "-":
        sys.stdout.write(sql)
    else:
        with open_private(args.out) as handle:
            handle.write(sql)
        print(f"wrote {args.out} ({len(sql.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
