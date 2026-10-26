# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Pure-function tests for ops/check_ip_rays.py (IP normalization, hash lookup, and rendering)."""

import ast
import re
from pathlib import Path

import pytest

import ops.check_ip_rays as cir

HAN = re.compile(r"[\u4e00-\u9fff]")


def test_terminal_output_is_english():
    """Command-line output must be entirely English, as required by AGENTS.md.

    Any Chinese in print, help, or error text fails this check. Use the AST to inspect
    actual string literals, so comments and docstrings are not mistaken for output.
    """
    tree = ast.parse(Path(cir.__file__).read_text(encoding="utf-8"))

    # Module, function, and class docstrings are not terminal output and are excluded.
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            doc = ast.get_docstring(node, clean=False)
            if doc is not None:
                docstrings.add(doc)

    offenders = [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value not in docstrings
        and HAN.search(node.value)
    ]
    assert not offenders, "terminal-facing text must be English:\n" + "\n".join(offenders)


def test_default_limit_is_five():
    """The default result limit is five (specified on 2026-09-27)."""
    assert cir.DEFAULT_LIMIT == 5


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("176.122.161.108", "176.122.161.108"),
        (" 176.122.161.108 ", "176.122.161.108"),
        ("[240e:404::1]", "240e:404::1"),
        ("240e:404:9210:1d78:7c62:faff:fef9:34b5", "240e:404:9210:1d78:7c62:faff:fef9:34b5"),
        # Common host:port format found in logs.
        ("1.2.3.4:52344", "1.2.3.4"),
    ],
)
def test_normalize_ip_accepts_valid(raw, expected):
    assert cir.normalize_ip(raw) == expected


@pytest.mark.parametrize("raw", ["", "notanip", "999.1.1.1", "1.2.3.4.5"])
def test_normalize_ip_rejects_invalid(raw):
    with pytest.raises(ValueError):
        cir.normalize_ip(raw)


def test_looks_like_hash():
    assert cir.looks_like_hash("d51153cb767fc758")
    assert cir.looks_like_hash("D51153CB767FC758")
    assert not cir.looks_like_hash("d51153cb767fc75")  # 15 characters.
    assert not cir.looks_like_hash("d51153cb767fc758a")  # 17 characters.
    assert not cir.looks_like_hash("z1153cb767fc758")  # Not hexadecimal.


def test_render_v2_renders_fields():
    line = cir.render_v2(
        {
            "ray": "a4162d53fc471732-SJC",
            "ts": 1790466693,
            "host": "visitor.comicine.com",
            "path": "/",
            "method": "GET",
            "status": 200,
            "country": "US",
            "duration_ms": 386,
        }
    )
    assert "a4162d53fc471732-SJC" in line
    assert "visitor.comicine.com/" in line
    assert "386ms" in line
    # No decorative symbols (AGENTS.md: terminal output must be plain English).
    assert "==" not in line and "--" not in line


def test_render_v2_columns_align():
    """Fixed-width alignment keeps the right-aligned status and left-aligned ray columns consistent across rows."""
    base = {"ts": 1790466693, "method": "GET", "country": "US", "path": "/"}
    short = cir.render_v2({**base, "ray": "a4162d53fc471732-SJC", "status": 200, "duration_ms": 5})
    long = cir.render_v2({**base, "ray": "a4158dde3e649f60-AMS", "status": 301, "duration_ms": 1234})
    assert short.index("200") == long.index("301")
    assert short.index("GET") == long.index("GET")


def test_render_legacy_marks_source_and_fills_gap():
    line = cir.render_legacy({"ray": "a40468eaedd2a158", "ts": 1790280389, "host": "x", "ip": "1.2.3.4"})
    assert "a40468eaedd2a158" in line
    assert line.endswith("[legacy]")
    # The legacy table has no duration; use `-` as a placeholder rather than leaving a gap.
    assert " - " in line


def test_no_decorative_banner_in_source():
    """Source code must not contain decorative == title == banners (AGENTS.md)."""
    source = Path(cir.__file__).read_text(encoding="utf-8")
    assert "print(f\"== " not in source
    assert 'print("==' not in source


def test_resolve_hashes_requires_key(monkeypatch):
    """Warn when the key is missing instead of silently reporting no records."""
    hashes, warn = cir.resolve_hashes({"token": "t"}, {}, "1.2.3.4")
    assert hashes == []
    assert "VISITOR_IP_KEY" in warn


def test_resolve_hashes_roundtrip(monkeypatch):
    """Decrypt each row to its IP and map it to the ip_hash from that same row."""
    if cir.Fernet is None:  # pragma: no cover - Depends on the Python interpreter.
        pytest.skip("cryptography not installed")

    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()
    token = Fernet(key.encode()).encrypt(b"176.122.161.108").decode()
    other = Fernet(key.encode()).encrypt(b"8.8.8.8").decode()

    monkeypatch.setattr(
        cir,
        "d1_query_retry",
        lambda cfg, sql, tries=4: [
            {"ip_hash": "d51153cb767fc758", "ip_enc": token},
            {"ip_hash": "aaaaaaaaaaaaaaaa", "ip_enc": other},
            {"ip_hash": "bbbbbbbbbbbbbbbb", "ip_enc": "not-a-valid-token"},
            {"ip_hash": "cccccccccccccccc", "ip_enc": ""},
        ],
    )

    hashes, warn = cir.resolve_hashes({}, {"VISITOR_IP_KEY": key}, "176.122.161.108")
    assert hashes == ["d51153cb767fc758"]
    assert warn is None
