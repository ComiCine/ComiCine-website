# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""`requirements.lock` must stay in step with `ops/requirements.txt`.

This guards against a concrete dependency drift: a pinned version in
`ops/requirements.txt` must also be present in the lock that `ops/build.sh` installs.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ops"))

import check_requirements_lock as guard  # noqa: E402  (path is set above)


def test_the_real_repository_is_consistent() -> None:
    """The committed pair must agree; this is the assertion CI relies on."""
    txt = guard.read_pins(guard.TXT)
    lock = guard.read_pins(guard.LOCK)

    assert txt, "ops/requirements.txt parsed to nothing"
    assert lock, "requirements.lock parsed to nothing"
    assert guard.check_pins(txt, lock) == []


def test_no_dev_only_tool_leaks_into_the_lock() -> None:
    """ruff/mypy/pytest-cov must never be pinned in the lock.

    Note the direction: this does NOT assert that the two sets are equal, because the
    lock legitimately carries transitive dependencies (Flask pulls Werkzeug, Jinja2,
    MarkupSafe, ...). The lock may therefore be a superset of requirements.txt; what it
    may never contain is one of the gate tools.
    """
    txt = guard.read_pins(guard.TXT)
    lock = guard.read_pins(guard.LOCK)

    assert not (set(lock) & guard.DEV_ONLY), "a dev-only gate tool leaked into the lock"
    # The extra entries must all be known transitive dependencies, not stray typos.
    # Verified on 2026-10-27: the lockfile has these 12 transitive dependencies beyond requirements.txt.
    # They are brought in by cryptography, Flask, Pillow, or requests.
    expected_extra = {
        "blinker", "certifi", "cffi", "charset-normalizer", "click",
        "idna", "itsdangerous", "jinja2", "markupsafe", "pycparser", "urllib3", "werkzeug",
    }
    assert set(lock) - set(txt) == expected_extra, (
        "the lock gained a package that is neither declared nor a known transitive dep"
    )


def test_a_version_mismatch_is_reported() -> None:
    """A declared dependency version differs from the one in the build lock."""
    problems = guard.check_pins({"pillow": "13.0.0"}, {"pillow": "12.0.0"})

    assert len(problems) == 1
    assert "13.0.0" in problems[0] and "12.0.0" in problems[0]
    # The error must say that build.sh installs from the lockfile, so readers know which file is authoritative.
    assert "build.sh" in problems[0]


def test_a_missing_runtime_pin_is_reported() -> None:
    problems = guard.check_pins({"pillow": "13.0.0"}, {})

    assert len(problems) == 1
    assert "missing from" in problems[0]


def test_dev_only_tools_are_allowed_only_in_requirements_txt() -> None:
    """ruff/mypy/pytest-cov belong in ops/requirements.txt and nowhere else."""
    assert guard.check_pins({"ruff": "0.17.0"}, {}) == []

    problems = guard.check_pins({"ruff": "0.17.0"}, {"ruff": "0.17.0"})
    assert len(problems) == 1
    assert "must not be pinned" in problems[0]


def test_read_pins_ignores_comments_and_blank_lines(tmp_path: Path) -> None:
    """The lock carries a long explanatory header; parsing must not trip on it."""
    target = tmp_path / "requirements.lock"
    target.write_text(
        "# a comment with == inside\n"
        "\n"
        "Pillow==13.0.0\n"
        "  # indented comment\n"
        "Werkzeug==3.1.9\n",
        encoding="utf-8",
    )

    assert guard.read_pins(target) == {"pillow": "13.0.0", "werkzeug": "3.1.9"}
