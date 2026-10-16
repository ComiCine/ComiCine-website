#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026 Limooo <https://limooo.cn/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
    wrangler r2 object get limooo-analytics/backup/2026_10_11/ddl.sql --file ddl.sql
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
import sys
from typing import Any

# Number of rows per INSERT batch; too many rows in one SQL statement can exceed D1's per-statement limit.
BATCH_ROWS = 100
# Non-table objects from sqlite_master, stored as-is in addition to table data in manifest.json.
NON_TABLE_OBJECTS = {"schema.jsonl.gz"}


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
    if not rows:
        return [f"-- {table}: no rows in this snapshot"]
    columns = list(rows[0].keys())
    for index, row in enumerate(rows[1:], start=2):
        if list(row.keys()) != columns:
            raise ValueError(
                f"{table}: line {index} has columns {list(row.keys())}, expected {columns}"
            )
    verb = "INSERT OR REPLACE INTO" if replace else "INSERT INTO"
    col_sql = ", ".join(columns)
    statements: list[str] = []
    for start in range(0, len(rows), BATCH_ROWS):
        chunk = rows[start : start + BATCH_ROWS]
        values = ",\n  ".join(
            "(" + ", ".join(sql_literal(row[column]) for column in columns) + ")" for row in chunk
        )
        statements.append(f"{verb} {table} ({col_sql}) VALUES\n  {values};")
    return statements


def table_names(directory: str) -> list[str]:
    """Return the table list from manifest.json when available, otherwise scan the directory."""
    manifest_path = os.path.join(directory, "manifest.json")
    names: list[str] = []
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
        for entry in manifest.get("tables") or []:
            name = entry.get("name")
            if isinstance(name, str) and name:
                names.append(name)
    if names:
        return names
    for name in sorted(os.listdir(directory)):
        if name.endswith(".jsonl.gz") and name not in NON_TABLE_OBJECTS:
            names.append(name[: -len(".jsonl.gz")])
    return names


def render(directory: str, data_only: bool, replace: bool) -> tuple[str, list[str]]:
    ddl_path = os.path.join(directory, "ddl.sql")
    if not os.path.exists(ddl_path):
        raise FileNotFoundError(f"{ddl_path} is missing; this is not a backup/ snapshot")
    with open(ddl_path, encoding="utf-8") as handle:
        ddl = handle.read()

    notes: list[str] = []
    parts: list[str] = []
    if not data_only:
        parts.append("-- schema (from ddl.sql)\n" + ddl.rstrip("\n") + "\n")

    rendered_tables = 0
    rendered_rows = 0
    for table in table_names(directory):
        path = os.path.join(directory, f"{table}.jsonl.gz")
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
        "-- Limooo D1 restore script, rendered by ops/d1-archive/restore.py",
        f"-- source directory: {directory}",
        f"-- tables: {rendered_tables}  rows: {rendered_rows}  mode: "
        + ("data only" if data_only else "schema + data")
        + ("  replace" if replace else ""),
        "-- target must be a FRESH database (plain INSERT); re-runs need --replace.",
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

    if args.out == "-":
        sys.stdout.write(sql)
    else:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(sql)
        print(f"wrote {args.out} ({len(sql.encode('utf-8'))} bytes)")
    for note in notes:
        print(f"note: {note}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
