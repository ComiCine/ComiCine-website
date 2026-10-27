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

Usage:
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --out restore.sql
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --data-only --out data.sql
    python3 ops/d1-archive/restore.py --dir <snapshot dir> --replace --out restore.sql

Get a snapshot out of R2 first (the Worker only ever writes it):
    wrangler r2 object get comicine-analytics/backup/2026_10_11/ddl.sql --file ddl.sql
    for f in manifest.json schema.jsonl.gz blocked_ips.jsonl.gz ...; do ...; done

Then:
    wrangler d1 execute <database> --remote --file restore.sql

Exit codes: 0 = SQL rendered, 1 = the snapshot is unusable (missing ddl.sql,
unreadable gzip, inconsistent columns), 2 = bad arguments.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
from typing import Any

# Number of rows per INSERT batch; too many rows in one SQL statement can exceed D1's per-statement limit.
BATCH_ROWS = 100
# Non-table objects from sqlite_master, stored as-is in addition to table data in manifest.json.
NON_TABLE_OBJECTS = {"schema.jsonl.gz"}
SQL_IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def validate_identifier(value: Any, label: str) -> str:
    """Accept only plain SQLite identifiers from snapshot metadata and row keys."""
    if not isinstance(value, str) or not SQL_IDENTIFIER.fullmatch(value):
        raise ValueError(f"invalid {label}: {value!r}")
    return value


def sql_identifier(value: Any, label: str) -> str:
    return f'"{validate_identifier(value, label)}"'


def load_manifest(directory: str) -> dict[str, Any] | None:
    manifest_path = os.path.join(directory, "manifest.json")
    if not os.path.exists(manifest_path):
        return None
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be an object")
    entries = manifest.get("tables") or []
    if not isinstance(entries, list):
        raise ValueError("manifest tables must be a list")
    return manifest


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


def table_names(directory: str) -> list[str]:
    """Return the table list from manifest.json when available, otherwise scan the directory."""
    names: list[str] = []
    manifest = load_manifest(directory)
    if manifest is not None:
        for entry in manifest.get("tables") or []:
            if not isinstance(entry, dict):
                raise ValueError("manifest tables must contain objects")
            name = entry.get("name")
            names.append(validate_identifier(name, "table name"))
    if names:
        return names
    for name in sorted(os.listdir(directory)):
        if name.endswith(".jsonl.gz") and name not in NON_TABLE_OBJECTS:
            names.append(validate_identifier(name[: -len(".jsonl.gz")], "table name"))
    return names


def idempotent_schema(ddl: str) -> str:
    """Make supported SQLite schema declarations safe to replay without rewriting their bodies."""
    create_prefix = re.compile(
        r"(?im)^(\s*CREATE\s+(?:(?:TEMP|TEMPORARY|UNIQUE|VIRTUAL)\s+)*"
        r"(?:TABLE|INDEX|TRIGGER|VIEW)\s+)(?!IF\s+NOT\s+EXISTS\b)"
    )
    return create_prefix.sub(r"\1IF NOT EXISTS ", ddl)


def render(directory: str, data_only: bool, replace: bool) -> tuple[str, list[str]]:
    ddl_path = os.path.join(directory, "ddl.sql")
    if not os.path.exists(ddl_path):
        raise FileNotFoundError(f"{ddl_path} is missing; this is not a backup/ snapshot")
    with open(ddl_path, encoding="utf-8") as handle:
        ddl = handle.read()

    notes: list[str] = []
    parts: list[str] = []
    if not data_only:
        schema = idempotent_schema(ddl) if replace else ddl
        parts.append("-- schema (from ddl.sql)\n" + schema.rstrip("\n") + "\n")

    manifest = load_manifest(directory)
    if manifest is not None:
        for entry in manifest.get("tables") or []:
            if isinstance(entry, dict) and entry.get("error"):
                name = validate_identifier(entry.get("name"), "table name")
                notes.append(f"table export failed: {name}: {entry['error']}")

    rendered_tables = 0
    rendered_rows = 0
    root = os.path.realpath(directory)
    for table in table_names(directory):
        path = os.path.join(directory, f"{table}.jsonl.gz")
        resolved_path = os.path.realpath(path)
        if os.path.islink(path) or os.path.commonpath((root, resolved_path)) != root:
            raise ValueError(f"table object escapes the snapshot directory: {table}")
        if not os.path.exists(path):
            # A partially failed snapshot did not export this table; report it instead of silently skipping it.
            notes.append(f"missing object: {table}.jsonl.gz (that table was not captured)")
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
    args = parser.parse_args(argv)

    if not os.path.isdir(args.dir):
        print(f"FATAL: not a directory: {args.dir}", file=sys.stderr)
        return 2

    try:
        sql, notes = render(args.dir, args.data_only, args.replace)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"FATAL: cannot render the snapshot: {exc}", file=sys.stderr)
        return 1

    if notes:
        for note in notes:
            print(f"FATAL: {note}", file=sys.stderr)
        return 1

    if args.out == "-":
        sys.stdout.write(sql)
    else:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(sql)
        print(f"wrote {args.out} ({len(sql.encode('utf-8'))} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
