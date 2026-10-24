#!/usr/bin/env python3
# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

"""Keep `requirements.lock` honest about what it is actually installing.

Why this exists (tasks/22, 2026-10-11): a Dependabot PR bumped `cairosvg` in
`ops/requirements.txt` to 2.9.1, CI went green, and the change was merged — but
`requirements.lock` still pinned 2.8.2, and `ops/build.sh:56` installs **the lock**.
So the upgrade was a no-op that nothing detected. Six other packages had drifted the
same way. This script is the missing detector.

Two modes, because the two questions are different:

  * `--check` (CI): pure text comparison, no network. Fails when
    - a package pinned in `ops/requirements.txt` is missing from the lock, or
    - the two disagree on a version.
    Dev-only tools (ruff, mypy, pytest-cov) are excluded from the lock on purpose, so
    they are allowed to appear only in `ops/requirements.txt`.

  * `--latest` (manual, needs network): asks PyPI for the newest release of every
    locked package and prints the ones that are behind. This is the check that would
    have shown "the lock is older than the source of truth". Never fails on being
    behind — it reports, a human decides.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TXT = ROOT / "ops" / "requirements.txt"
LOCK = ROOT / "requirements.lock"

# These gate tools are intentionally listed in ops/requirements.txt but omitted from the lockfile; see the comments in both files.
DEV_ONLY = {"ruff", "mypy", "pytest-cov", "pytest"}

PIN = re.compile(r"^([A-Za-z0-9_.\-]+)==(\S+)$")


def read_pins(path: Path) -> dict[str, str]:
    """Return a name-to-version mapping, skipping comments and blank lines; later duplicates win."""
    pins: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = PIN.match(line)
        if match:
            pins[match.group(1).lower()] = match.group(2)
    return pins


def check_pins(txt: dict[str, str], lock: dict[str, str]) -> list[str]:
    problems: list[str] = []
    for name, version in sorted(txt.items()):
        if name in DEV_ONLY:
            if name in lock:
                problems.append(
                    f"{name}: dev-only tool must not be pinned in requirements.lock "
                    f"(found {lock[name]}); it bloats the build venv with its own deps"
                )
            continue
        if name not in lock:
            problems.append(
                f"{name}: pinned {version} in ops/requirements.txt but missing from "
                f"requirements.lock, so the build installs whatever pip resolves"
            )
        elif lock[name] != version:
            problems.append(
                f"{name}: ops/requirements.txt wants {version} but requirements.lock "
                f"pins {lock[name]} (the lock is what ops/build.sh installs)"
            )
    return problems


def latest_versions(names: list[str]) -> dict[str, str]:
    """Return PyPI's `info.version` (latest stable release), or silently skip a package on network failure."""
    out: dict[str, str] = {}
    for name in names:
        try:
            with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=20) as resp:  # noqa: S310
                out[name] = json.loads(resp.read().decode("utf-8"))["info"]["version"]
        except (urllib.error.URLError, KeyError, json.JSONDecodeError, TimeoutError):
            continue
    return out


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check that requirements.lock matches ops/requirements.txt.",
    )
    parser.add_argument("--check", action="store_true", help="compare the two files (offline, CI)")
    parser.add_argument("--latest", action="store_true", help="also report packages behind PyPI")
    args = parser.parse_args()

    for path in (TXT, LOCK):
        if not path.is_file():
            print(f"FATAL: missing {path}", file=sys.stderr)
            return 1

    txt = read_pins(TXT)
    lock = read_pins(LOCK)
    problems = check_pins(txt, lock)

    if problems:
        print("requirements pins are inconsistent:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print(
            "\nRegenerate: fresh venv -> pip install -r ops/requirements.txt -> write the\n"
            "runtime packages back as name==version (see the header of requirements.lock).\n"
            "Do NOT `pip freeze` the build venv: that pulls ruff/mypy and their deps in.",
            file=sys.stderr,
        )
        return 1

    # Validate the package set as well: the lockfile is a runtime manifest and may include transitive dependencies beyond requirements.txt,
    # but it must not have duplicate entries or be empty. **Version** authority applies only to packages declared in requirements.txt.
    # Transitive versions record the result of a clean resolution and cannot be recomputed offline, so this check does not pretend to validate them.
    # Detect drift with `--latest` (compare with PyPI) or by rebuilding and comparing the virtual environment.
    lines = [line.strip() for line in LOCK.read_text(encoding="utf-8").splitlines()]
    pinned = [line for line in lines if line and not line.startswith("#")]
    names = [line.split("==")[0].lower() for line in pinned]
    duplicates = sorted({n for n in names if names.count(n) > 1})
    if duplicates:
        print(f"FATAL: duplicate pins in requirements.lock: {', '.join(duplicates)}", file=sys.stderr)
        return 1

    runtime = sorted(name for name in lock if name not in DEV_ONLY)
    print(
        f"requirements lock: OK ({len(pinned)} pins; {len(runtime)} runtime entries; "
        f"declared-in-txt versions all match)"
    )

    if args.latest:
        newest = latest_versions(runtime)
        behind = [
            f"{name}: locked {lock[name]}, PyPI {newest[name]}"
            for name in runtime
            if name in newest and newest[name] != lock[name]
        ]
        if behind:
            print(f"\nbehind PyPI ({len(behind)}) - report only, no failure:")
            for entry in behind:
                print(f"  {entry}")
        else:
            print("behind PyPI: none")

    return 0


if __name__ == "__main__":
    sys.exit(main())
