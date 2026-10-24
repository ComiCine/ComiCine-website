#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Require AGPL headers in first-party source files (GNU Affero or AGPL in the first 25 lines).

Why this check exists: the AGPL header is a per-file requirement. Previously, the repository had
only an ad hoc command that counted missing headers, not a gate. As a result, eight `ops/*.sh`
files were all missed until a later manual audit found them. Counting is not a safeguard; a gate is.

The constants below define the rules and exclusions. Output, comments, and help text are in
English. Usage, checked paths, and exit codes are documented in USAGE, which `--help` prints.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Inspect only the opening lines: scanning too few can miss a wrapped header, while scanning the whole file can mistake
# an AGPL mention in the body for a license header.
SCAN_LINES = 25
HEADER_MARKER = re.compile(r"GNU Affero|AGPL")

# First-party source files that require a header: (directory, extensions, recursive).
#
# Do not construct pathspecs here. List all Git files, then filter by directory and extension.
# Git's `dir/**/*.ts` does not match top-level files in `dir` (verified: functions/*.ts matched 65 files,
# while functions/**/*.ts matched 58 with no overlap). Using only the `**/` form would miss every top-level file,
# as happened when a previous count of 64 was mistakenly treated as complete. Filtering the full file list avoids this gap.
RULES: tuple[tuple[str, tuple[str, ...], bool], ...] = (
    ("functions", (".ts",), True),
    ("ops", (".ts", ".js", ".py", ".sh", ".html", ".sql"), True),
    ("src", (".py",), False),
    ("tests", (".py",), False),
    ("src/static", (".css", ".js"), True),
    ("src/templates", (".html",), True),
    ("docs/docs/.vitepress", (".ts", ".mts", ".css"), True),
)

# Browser assets are included because the repository-wide licensing policy now requires per-file
# notices even when comments are shipped to clients. Third-party data files remain excluded below.

# Explicitly excluded: third-party files, generated output, and non-source files. These paths are already outside RULES;
# this safeguard prevents false positives or casually adding headers if RULES is broadened later.
# Adding a project header to third-party license text would pollute the license.
NOT_REQUIRED = re.compile(
    r"^(?:"
    r"src/static/fonts/.+\.txt$"  # Third-party font licenses (OFL.txt / LICENSE.txt)
    r"|src/static/js/currency-data\.js$"  # Unicode CLDR data retains its upstream notice and license
    r"|ops/fonts/.+\.txt$"
    r"|(?:.*/)?LICENSE[^/]*\.md$"  # The project's license text
    r"|locales/.+\.json$"
    r"|.+\.(?:csv|toml|json)$"
    r"|docs/(?!docs/\.vitepress/).*$"
    r")"
)

USAGE = """License header gate: every first-party source file must carry the AGPL header.

Checked (the header must appear in the first 25 lines, as 'GNU Affero' or 'AGPL'):
  functions/**/*.ts
  ops/**/*.ts, ops/**/*.js, ops/**/*.py, ops/**/*.sh, ops/**/*.html, ops/**/*.sql
  src/*.py
  tests/*.py
  src/static/**/*.{css,js} except third-party currency data
  src/templates/**/*.html
  docs/docs/.vitepress/**/*.{ts,mts,css}

Never checked (third-party or generated; adding a header there would be wrong):
  src/static/fonts/**.txt, ops/fonts/**.txt   (third-party OFL.txt / LICENSE.txt)
  LICENSE*.md, src/static/js/currency-data.js, locales/*.json
  *.csv, *.toml, *.json, docs/** except docs/docs/.vitepress source

Tracked files and untracked-but-not-ignored files are both checked, so a new file is
caught before its first commit instead of by CI after the push.

Usage:
  python3 ops/check_license_headers.py           # verify; exit 1 when a header is missing
  python3 ops/check_license_headers.py --list    # print the checked set, grouped by rule
  python3 ops/check_license_headers.py --help

Exit code 0 = every checked file carries the header."""


def git_paths() -> list[str]:
    """Return tracked and non-ignored untracked files; fail if Git is unavailable instead of skipping the gate."""
    try:
        completed = subprocess.run(
            ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
            cwd=ROOT,
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"FATAL: cannot list repository files with git ({exc})", file=sys.stderr)
        raise SystemExit(2) from exc
    return sorted(name for name in completed.stdout.decode("utf-8", "replace").split("\0") if name)


def rule_of(path: str) -> str | None:
    """Return the matched rule group for reporting, or None if the file is out of scope."""
    if NOT_REQUIRED.match(path):
        return None
    for directory, suffixes, recursive in RULES:
        prefix = f"{directory}/"
        if not path.startswith(prefix):
            continue
        rest = path[len(prefix) :]
        if not recursive and "/" in rest:
            continue
        if rest.endswith(suffixes):
            return directory
    return None


def read_head(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return [handle.readline() for _ in range(SCAN_LINES)]


def hint_for(path: str) -> str:
    if path.endswith((".sh", ".py")):
        return "insert it after the shebang on line 1"
    return "insert it as the file header comment"


def check(names: list[str]) -> tuple[list[str], list[str]]:
    """Return (files missing a header, shell files whose shebang is not on line 1)."""
    missing: list[str] = []
    bad_shebang: list[str] = []
    for name in names:
        head = read_head(ROOT / name)
        # The header must follow the shebang. A script with a commented-out shebang can still pass `bash -n`
        # but can no longer be executed directly, so report this condition separately.
        if name.endswith(".sh") and not (head and head[0].startswith("#!")):
            bad_shebang.append(name)
        if not HEADER_MARKER.search("".join(head)):
            missing.append(name)
    return missing, bad_shebang


def report(missing: list[str], bad_shebang: list[str]) -> int:
    print("FATAL: license header check failed", file=sys.stderr)
    if missing:
        width = max(len(name) for name in missing)
        print(f"  missing the AGPL header in the first {SCAN_LINES} lines:", file=sys.stderr)
        for name in missing:
            print(f"    {name:<{width}}  {hint_for(name)}", file=sys.stderr)
    if bad_shebang:
        width = max(len(name) for name in bad_shebang)
        print("  the shebang must stay on line 1 (the header goes after it):", file=sys.stderr)
        for name in bad_shebang:
            print(f"    {name:<{width}}  restore '#!/usr/bin/env bash' as the first line", file=sys.stderr)
    print("  header text reference: ops/ci_check.sh lines 3-18", file=sys.stderr)
    return 1


def main(argv: list[str]) -> int:
    args = argv[1:]
    for arg in args:
        if arg in ("--help", "-h"):
            print(USAGE)
            return 0
        if arg != "--list":
            print(f"FATAL: unknown argument {arg}", file=sys.stderr)
            print("       supported: --list / --help", file=sys.stderr)
            return 2

    checked: dict[str, list[str]] = {directory: [] for directory, _, _ in RULES}
    for name in git_paths():
        directory = rule_of(name)
        if directory is not None:
            checked[directory].append(name)
    total = sum(len(names) for names in checked.values())

    if "--list" in args:
        print(f"license headers: {total} files in scope")
        for directory, _, _ in RULES:
            names = checked[directory]
            print(f"  {directory:<12}{len(names):>4}")
            for name in names:
                print(f"    {name}")
        return 0

    names = [name for directory, _, _ in RULES for name in checked[directory]]
    try:
        missing, bad_shebang = check(names)
    except OSError as exc:
        print(f"FATAL: cannot read a source file ({exc})", file=sys.stderr)
        return 2

    if missing or bad_shebang:
        return report(missing, bad_shebang)
    print(f"license headers: OK ({total} files checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
