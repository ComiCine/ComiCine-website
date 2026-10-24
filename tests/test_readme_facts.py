# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Directory-tree checks for ops/readme_facts.py; they must pass in a clean checkout.

CI failed on 2026-10-11 because README listed secrets/, which existed locally but was
excluded by .gitignore and absent from a clean checkout. A filesystem-only check
passed locally and failed in CI. Use Git status as the criterion (ignored means not
tracked and therefore not drift), rather than the local filesystem.
"""

import shutil
import subprocess

import pytest

import ops.readme_facts as readme_facts

requires_git = pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")


@pytest.fixture
def clean_repo(tmp_path):
    """Create a temporary Git repository containing only .gitignore to simulate a clean checkout."""
    (tmp_path / ".gitignore").write_text("secrets/\n", encoding="utf-8")
    (tmp_path / "src").mkdir()
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    return tmp_path


@requires_git
def test_git_ignored_detects_local_only_paths(clean_repo):
    assert readme_facts.git_ignored("secrets", str(clean_repo)) is True
    assert readme_facts.git_ignored("secrets/webauthn.env", str(clean_repo)) is True
    assert readme_facts.git_ignored("src/config.py", str(clean_repo)) is False


@requires_git
def test_tree_problems_skips_gitignored_but_keeps_real_drift(clean_repo):
    # secrets/ is absent from this checkout but ignored, so it is not drift; CI behaves the same way.
    # If src/config.py is absent and not ignored, that is still drift; the check remains strict.
    problems = readme_facts.tree_problems(str(clean_repo), ["src", "secrets", "src/config.py"])

    assert problems == ["tree lists a path that does not exist: src/config.py"]


@requires_git
def test_tree_problems_accepts_missing_parent_chain(clean_repo):
    """Do not report missing descendants repeatedly when their parent directory is absent (such as entries under secrets/)."""
    assert readme_facts.tree_problems(str(clean_repo), ["secrets/webauthn.env"]) == []


def test_readme_tree_check_has_no_drift():
    """The README directory tree in the real repository matches the current commit."""
    assert readme_facts.tree_problems(readme_facts.BASE_DIR, readme_facts.tree_paths()) == []
