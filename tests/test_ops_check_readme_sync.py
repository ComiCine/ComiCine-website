# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for ops/check_readme_sync.py.

The docs-site README copies are maintained by hand. These tests build a temporary
repository containing the root README and all four copies, mutate exactly one thing
per test, and assert both the in-process failure lines and the CLI exit code. The
integration test at the end intentionally targets the real repository so CI keeps
the manual copy sync honest.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import ops.check_readme_sync as check_readme_sync

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = Path(check_readme_sync.__file__)
LANGUAGES = ("zh-cn", "en-us", "ja-jp", "ko-kr")
REPOSITORY = "https://github.com/ComiCine/ComiCine-website"

ROOT_BODY = """\
<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# ComiCine

A fully serverless personal website and admin system.

## Features

- Public pages, the gate, and the visitor panel run on Cloudflare.
- Architecture notes live in [project/ARCHITECTURE.md](project/ARCHITECTURE.md).
- Trusted sources live under [docs lists](docs/lists/).

```bash
# This line starts with a hash but is inside a fence, so it is not a heading.
python3 src/build.py
```

| Layer | Technology |
| --- | --- |
| Pages | Cloudflare |

## License

Licensed under the GNU AGPL v3; see [LICENSE.txt](LICENSE.txt).
"""

# The source stays ASCII; the escaped strings are the Chinese headings a zh-cn copy
# would carry. They exist to prove that translated heading text is never compared.
TRANSLATED_HEADINGS = (
    ("# ComiCine", "# \u9879\u76ee\u8bf4\u660e"),
    ("## Features", "## \u529f\u80fd"),
    ("## License", "## \u8bb8\u53ef\u8bc1"),
)


def localize_links(body: str) -> str:
    """Rewrite the root README's relative repository links into the docs-site protocol."""
    return (
        body.replace("](project/ARCHITECTURE.md)", f"]({REPOSITORY}/blob/main/project/ARCHITECTURE.md)")
        .replace("](LICENSE.txt)", f"]({REPOSITORY}/blob/main/LICENSE.txt)")
        .replace("](docs/lists/)", f"]({REPOSITORY}/tree/main/docs/lists/)")
    )


def copy_text(body: str, language: str, aside: bool = True) -> str:
    """Build a valid docs copy: five-line frontmatter, body, absolute repository links."""
    frontmatter = ["---"]
    if aside:
        frontmatter.append("aside: false")
    frontmatter.extend(
        [
            f"title: Project README ({language})",
            'description: "Test copy of the root README"',
            "---",
        ]
    )
    return "\n".join(frontmatter) + "\n" + localize_links(body)


def write_copy(root: Path, language: str, body: str = ROOT_BODY, aside: bool = True) -> Path:
    path = root / "docs" / "docs" / language / "README.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(copy_text(body, language, aside), encoding="utf-8")
    return path


def line_of(path: Path, text: str) -> int:
    return path.read_text(encoding="utf-8").splitlines().index(text) + 1


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A temporary repository whose root README and four copies are in sync."""
    root = tmp_path / "repo"
    root.mkdir()
    (root / "README.md").write_text(ROOT_BODY, encoding="utf-8")
    for language in LANGUAGES:
        write_copy(root, language)
    return root


def test_consistent_copies_pass(repo: Path, capsys) -> None:
    assert check_readme_sync.check(repo) == []
    assert check_readme_sync.main(["--root", str(repo)]) == 0
    output = capsys.readouterr().out
    assert output.strip() == "readme sync: OK (4 copies match README.md)"


def test_missing_heading_is_reported(repo: Path) -> None:
    body = ROOT_BODY.replace("## License\n\n", "")
    write_copy(repo, "ja-jp", body)
    problems = check_readme_sync.check(repo)
    assert (
        "FATAL: docs/docs/ja-jp/README.md:1: expected 3 headings like README.md, found 2"
        in problems
    )
    assert check_readme_sync.main(["--root", str(repo)]) == 1


def test_heading_level_mismatch_is_reported(repo: Path) -> None:
    write_copy(repo, "ja-jp", ROOT_BODY.replace("## Features", "### Features"))
    path = repo / "docs" / "docs" / "ja-jp" / "README.md"
    line = line_of(path, "### Features")
    problems = check_readme_sync.check(repo)
    assert any(
        f"FATAL: docs/docs/ja-jp/README.md:{line}: heading level 3 at this position, "
        "README.md has level 2" in problem
        for problem in problems
    ), problems
    assert check_readme_sync.main(["--root", str(repo)]) == 1


def test_en_us_body_drift_is_reported(repo: Path) -> None:
    outdated = "A completely different introduction."
    write_copy(
        repo,
        "en-us",
        ROOT_BODY.replace("A fully serverless personal website and admin system.", outdated),
    )
    path = repo / "docs" / "docs" / "en-us" / "README.md"
    copy_line = line_of(path, outdated)
    root_line = line_of(repo / "README.md", "A fully serverless personal website and admin system.")
    problems = check_readme_sync.check(repo)
    assert (
        f"FATAL: docs/docs/en-us/README.md:{copy_line}: body line differs from README.md:{root_line}"
        in problems
    )
    assert "  expected: A fully serverless personal website and admin system." in problems
    assert f"  found: {outdated}" in problems
    assert check_readme_sync.main(["--root", str(repo)]) == 1


def test_missing_aside_frontmatter_is_reported(repo: Path) -> None:
    write_copy(repo, "ko-kr", aside=False)
    problems = check_readme_sync.check(repo)
    assert "FATAL: docs/docs/ko-kr/README.md: frontmatter missing 'aside: false'" in problems
    assert check_readme_sync.main(["--root", str(repo)]) == 1


def test_translated_headings_pass_structural_check(repo: Path) -> None:
    body = ROOT_BODY
    for original, translated in TRANSLATED_HEADINGS:
        body = body.replace(original, translated)
    write_copy(repo, "zh-cn", body)
    assert check_readme_sync.check(repo) == []


def test_hash_line_inside_fence_is_not_a_heading(repo: Path) -> None:
    body = ROOT_BODY.replace(
        "# This line starts with a hash but is inside a fence, so it is not a heading.",
        "# A translated note inside the fence.\n# A second hash-prefixed fence line.",
    )
    write_copy(repo, "zh-cn", body)
    assert check_readme_sync.check(repo) == []


def test_cli_process_exit_codes(repo: Path) -> None:
    passed = subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(repo)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert passed.returncode == 0
    assert passed.stdout.strip() == "readme sync: OK (4 copies match README.md)"

    (repo / "docs" / "docs" / "zh-cn" / "README.md").unlink()
    failed = subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(repo)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert failed.returncode == 1
    assert "FATAL: docs/docs/zh-cn/README.md: missing file" in failed.stdout


def test_json_output_is_machine_readable(repo: Path, capsys) -> None:
    assert check_readme_sync.main(["--root", str(repo), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["ok"] is True
    assert payload["failure_count"] == 0
    assert payload["exit_code"] == 0


def test_cli_help_exits_zero(capsys) -> None:
    assert check_readme_sync.main(["--help"]) == 0
    assert "Usage:" in capsys.readouterr().out


def test_cli_rejects_unknown_arguments(capsys) -> None:
    assert check_readme_sync.main(["--bogus"]) == 2
    assert "FATAL: unknown argument --bogus" in capsys.readouterr().err


def test_real_repository_readme_copies_are_synchronized() -> None:
    """The real repository's four docs copies must match the root README.

    Kept as an integration test so a manual copy sync cannot silently rot again: the
    synthetic cases above prove the checker works, this one proves the repository is
    actually synchronized right now.
    """
    assert check_readme_sync.check(ROOT) == []
