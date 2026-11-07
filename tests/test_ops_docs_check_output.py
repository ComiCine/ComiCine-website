# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for ops/docs_check_output.py route, language, and generated output checks.

Each case builds a minimal VitePress-like tree under tmp_path: language-grouped markdown
sources, a .vitepress/rewrites.json, a two-language mini contract, and a docs dist tree
with _routes.json, fonts.css, the Delius font file, and generated HTML. CONTRACT_PATH is
redirected to the temporary contract and main() is driven through sys.argv, so these tests
never read the real config-contract.json or the repository's build output, and never write
inside the repository or touch the network.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from ops import docs_check_output

ROUTES = {"version": 1, "include": ["/*"], "exclude": ["/fonts.css", "/fonts/*"]}
SUMMARY = (
    "[docs-check] 2 markdown file(s), 0 missing HTML, 0 invalid routes, "
    "0 duplicate routes, 0 missing translations, 0 outside a language directory, "
    "0 hreflang errors"
)
DELIUS_CSS = "body { font-family: 'Delius Swash Caps', serif; }\n"
FONT_FILE = Path("fonts") / "delius-swash-caps" / "delius-swash-caps-copyright.woff2"


@pytest.fixture(name="checker")
def checker_fixture():
    """Return the loaded ops module so tests can patch CONTRACT_PATH."""
    return docs_check_output


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, payload: object) -> None:
    _write(path, json.dumps(payload))


def _html(title: str, route: str = "page") -> str:
    """One generated content page, with the hreflang alternates VitePress would inject."""
    alternates = "".join(
        f'<link rel="alternate" hreflang="{tag}" href="https://docs.comicine.com/{route}/{code}">'
        for code, tag in (("zh-cn", "zh-CN"), ("en-us", "en-US"))
    )
    alternates += f'<link rel="alternate" hreflang="x-default" href="https://docs.comicine.com/{route}/en-us">'
    return (
        f"<!doctype html><html><head><title>{title}</title>{alternates}</head>"
        "<body></body></html>\n"
    )


def _valid_tree(tmp_path: Path) -> tuple[Path, Path]:
    """Write a minimal tree that passes the check and return its (docs, dist) paths."""
    _write_json(
        tmp_path / "contract.json",
        {"supported_langs": ["zh-cn", "en-us"], "default_lang": "en-us"},
    )

    docs = tmp_path / "docs"
    _write_json(docs / "public" / "_routes.json", ROUTES)
    _write_json(
        docs / ".vitepress" / "rewrites.json",
        {"zh-cn/page.md": "page/zh-cn.md", "en-us/page.md": "page/en-us.md"},
    )
    _write(docs / "zh-cn" / "page.md", "# Page\n")
    _write(docs / "en-us" / "page.md", "# Page\n")

    dist = tmp_path / "dist"
    _write_json(dist / "_routes.json", ROUTES)
    _write(dist / "fonts.css", DELIUS_CSS)
    _write(dist / FONT_FILE, "")
    _write(dist / "page" / "zh-cn.html", _html("Page"))
    _write(dist / "page" / "en-us.html", _html("Page"))
    return docs, dist


def _run(
    checker,
    monkeypatch,
    capsys,
    tmp_path: Path,
    docs: Path,
    dist: Path,
) -> tuple[int, str, str]:
    """Invoke main() with patched argv and contract path, returning (code, stdout, stderr)."""
    monkeypatch.setattr(checker, "CONTRACT_PATH", tmp_path / "contract.json")
    monkeypatch.setattr(sys, "argv", ["docs_check_output.py", str(docs), str(dist)])
    code = checker.main()
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_valid_tree_passes(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    code, out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 0
    assert SUMMARY in out
    assert err == ""


def test_wrong_argument_count_fails(checker, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["docs_check_output.py"])
    assert checker.main() == 2
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "usage: docs_check_output.py" in captured.err


@pytest.mark.parametrize("missing", ["docs", "dist"])
def test_missing_docs_or_dist_dir_fails(checker, monkeypatch, capsys, tmp_path, missing):
    docs, dist = _valid_tree(tmp_path)
    if missing == "docs":
        docs = tmp_path / "missing-docs"
    else:
        dist = tmp_path / "missing-dist"
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "FATAL: docs-dir or dist-dir not found" in err


def test_unreadable_public_routes_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    routes_path = docs / "public" / "_routes.json"
    routes_path.unlink()
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "FATAL: could not read Pages routes file" in err
    assert str(routes_path) in err


def test_public_routes_must_exclude_fonts_css(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write_json(
        docs / "public" / "_routes.json",
        {"version": 1, "include": ["/*"], "exclude": ["/fonts/*"]},
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "must exclude /fonts.css from Pages Functions" in err


def test_unexcluded_root_asset_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write(dist / "hashmap.json", "{}")
    _write_json(
        docs / "public" / "_routes.json",
        {"version": 1, "include": ["/*"], "exclude": ["/fonts.css", "/fonts/*", "/hashmap.json"]},
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert (
        f"FATAL: {dist / '_routes.json'} does not exclude root assets from Pages Functions: "
        "/hashmap.json"
    ) in err


def test_missing_delius_font_output_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    (dist / "fonts.css").unlink()
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "FATAL: Delius brand stylesheet or font file is missing from docs output" in err


def test_fonts_css_must_define_delius(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write(dist / "fonts.css", "body { font-family: sans-serif; }\n")
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "FATAL: docs fonts.css does not define Delius Swash Caps" in err


def test_missing_language_copy_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    (docs / "en-us" / "page.md").unlink()
    (dist / "page" / "en-us.html").unlink()
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "has no en-us source copy" in err


def test_duplicate_route_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write_json(
        docs / ".vitepress" / "rewrites.json",
        {"zh-cn/page.md": "page/zh-cn.md", "en-us/page.md": "page/zh-cn.md"},
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "maps to a route already produced by another source" in err


def test_route_must_end_in_its_own_language(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write_json(
        docs / ".vitepress" / "rewrites.json",
        {"zh-cn/page.md": "page/zh-cn.md", "en-us/page.md": "page/zh-cn.md"},
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "route does not end in its own language code: /page/zh-cn" in err


def test_markdown_outside_language_directory_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write(docs / "loose.md", "# Loose\n")
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "is not inside a language directory (zh-cn, en-us)" in err


def test_missing_generated_html_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    (dist / "page" / "zh-cn.html").unlink()
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "produced no /page/zh-cn.html" in err


def test_title_suffix_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    _write(dist / "page" / "zh-cn.html", _html("Page | Docs"))
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "appends a localized docs site name to its title: Page | Docs" in err


def test_missing_hreflang_alternate_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    html = (dist / "page" / "zh-cn.html").read_text(encoding="utf-8")
    _write(
        dist / "page" / "zh-cn.html",
        html.replace(
            '<link rel="alternate" hreflang="en-US" href="https://docs.comicine.com/page/en-us">',
            "",
        ),
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "must have exactly one hreflang=en-US alternate, found 0" in err


def test_x_default_must_point_to_default_lang(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    html = (dist / "page" / "zh-cn.html").read_text(encoding="utf-8")
    _write(
        dist / "page" / "zh-cn.html",
        html.replace(
            '<link rel="alternate" hreflang="x-default" href="https://docs.comicine.com/page/en-us">',
            '<link rel="alternate" hreflang="x-default" href="https://docs.comicine.com/page/zh-cn">',
        ),
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "hreflang=x-default points to https://docs.comicine.com/page/zh-cn" in err


def test_extra_hreflang_alternate_fails(checker, monkeypatch, capsys, tmp_path):
    docs, dist = _valid_tree(tmp_path)
    html = (dist / "page" / "zh-cn.html").read_text(encoding="utf-8")
    _write(
        dist / "page" / "zh-cn.html",
        html.replace(
            "</head>",
            '<link rel="alternate" hreflang="fr-FR" href="https://docs.comicine.com/page/fr-fr">'
            "</head>",
        ),
    )
    code, _out, err = _run(checker, monkeypatch, capsys, tmp_path, docs, dist)
    assert code == 1
    assert "unexpected hreflang=fr-FR alternate" in err
