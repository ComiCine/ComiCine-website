# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Consistency tests for security response headers.

ops/check_security_headers.py guards security headers, but it was previously run only
manually or during deployment. A CSP drift between ops/security-headers.json and
functions/_lib/security.ts (connect-src missing challenges.cloudflare.com) went
unnoticed and prevented the gate page's Turnstile widget from receiving a token,
leaving visitors in an endless verification loop.

The negative cases here patch **both** the JSON and the TypeScript copy. Patching only
the JSON still returns exit 1, but the guard fails at its earlier "JSON != TS"
comparison, whose message quotes both policies and therefore contains whatever
substring the assertion looks for. Asserting `JSON=` is absent from stderr keeps that
false pass from coming back.

Run the guard through pytest so this drift fails before commit instead of after user reports.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ops"))

import check_security_headers as guard  # noqa: E402

TURNSTILE = "https://challenges.cloudflare.com"


def _csp_from_json() -> str:
    return json.loads(
        (ROOT / "ops" / "security-headers.json").read_text(encoding="utf-8")
    )["Content-Security-Policy"]


def _origins(csp: str, section: str) -> set[str]:
    match = re.search(rf"{section} ([^;]+)", csp)
    if not match:
        return set()
    return {
        token
        for token in match.group(1).split()
        if token.startswith(("http://", "https://"))
    }


def broken_both(tmp_path, monkeypatch, mutate) -> tuple[Path, Path]:
    """Write the same mutation into both copies so the guard reaches the rules themselves.

    The guard compares the JSON with the TypeScript table first. A mutation applied to
    only one side therefore fails there, not in the rule under test. Both copies are
    produced by replacing text inside the real files, never by rewriting them by hand.
    """
    json_text = (ROOT / "ops" / "security-headers.json").read_text(encoding="utf-8")
    ts_text = (ROOT / "functions" / "_lib" / "security.ts").read_text(encoding="utf-8")

    broken_json = mutate(json_text)
    broken_ts = mutate(ts_text)
    assert broken_json != json_text, "test precondition failed: mutation did not change security-headers.json"
    assert broken_ts != ts_text, "test precondition failed: mutation did not change security.ts"

    json_path = tmp_path / "security-headers.json"
    ts_path = tmp_path / "security.ts"
    json_path.write_text(broken_json, encoding="utf-8")
    ts_path.write_text(broken_ts, encoding="utf-8")
    monkeypatch.setattr(guard, "JSON_PATH", json_path)
    monkeypatch.setattr(guard, "TS_PATH", ts_path)
    return json_path, ts_path


def test_security_headers_guard_passes():
    """The guard passes against the real repository: both CSP definitions match and third-party origins are consistent."""
    assert guard.main() == 0


def test_turnstile_origin_allowed_for_script_frame_and_connect():
    """Turnstile needs script-src, frame-src, and connect-src to all allow its origin.

    If any directive is missing, the widget can appear but never receive a token,
    leaving the visitor in an endless verification loop.
    """
    csp = _csp_from_json()
    for section in ("script-src", "frame-src", "connect-src"):
        assert TURNSTILE in _origins(csp, section), (
            f"CSP {section} is missing {TURNSTILE}; Turnstile verification will fail"
        )


def test_guard_rejects_connect_src_missing_third_party_origin(tmp_path, monkeypatch, capsys):
    """Regression guard: removing the Turnstile origin from connect-src must fail.

    This protects the cause of the endless verification loop and prevents connect-src
    from being tightened again. Both copies lose the origin, so the failure must come
    from the connect-src rule rather than from the JSON/TypeScript comparison.
    """

    def mutate(text: str) -> str:
        # Remove Turnstile only from connect-src and leave the script-src entry in place to verify that the guard
        # fails specifically because of connect-src.
        return text.replace(
            f" {TURNSTILE} http://cloudflareinsights.com", " http://cloudflareinsights.com"
        )

    broken_both(tmp_path, monkeypatch, mutate)

    assert guard.main() == 1
    err = capsys.readouterr().err
    assert "add " + TURNSTILE + " to connect-src" in err
    assert "but connect-src lacks it" in err
    assert "JSON=" not in err, "the guard failed at the JSON!=TS comparison instead of the connect-src rule"


def test_cloudflare_insights_origins_allowed():
    """Cloudflare Web Analytics loads scripts from static.cloudflareinsights.com and sends RUM events to
    cloudflareinsights.com. Both origins need http and https for deployments that use http.
    """
    csp = _csp_from_json()
    for section in ("script-src",):
        origins = _origins(csp, section)
        for origin in (
            "http://static.cloudflareinsights.com",
            "https://static.cloudflareinsights.com",
        ):
            assert origin in origins, f"CSP {section} is missing {origin}"
    connect_origins = _origins(csp, "connect-src")
    for origin in ("http://cloudflareinsights.com", "https://cloudflareinsights.com"):
        assert origin in connect_origins, f"CSP connect-src is missing {origin}"


def test_guard_rejects_insight_script_without_connect_pair(tmp_path, monkeypatch, capsys):
    """The beacon exception is conditional: if connect-src no longer allows cloudflareinsights.com,
    the guard must reject static.cloudflareinsights.com in script-src.
    """

    def mutate(text: str) -> str:
        return text.replace(" http://cloudflareinsights.com https://cloudflareinsights.com", "")

    broken_both(tmp_path, monkeypatch, mutate)

    assert guard.main() == 1
    err = capsys.readouterr().err
    assert "static.cloudflareinsights.com" in err
    assert "but connect-src lacks it" in err
    assert "JSON=" not in err, "the guard failed at the JSON!=TS comparison instead of the beacon rule"


def test_guard_rejects_header_defined_only_in_ts(tmp_path, monkeypatch, capsys):
    """A header that exists only in the runtime table must fail: the JSON is the only source."""
    assert guard.main() == 0, "the real repository must pass before a header is injected"
    capsys.readouterr()

    ts_text = (ROOT / "functions" / "_lib" / "security.ts").read_text(encoding="utf-8")
    anchor = '  "X-Frame-Options": "SAMEORIGIN",\n'
    assert anchor in ts_text
    broken = ts_text.replace(anchor, anchor + '  "X-Comicine-Only-In-Ts": "1",\n')
    assert broken != ts_text, "test precondition failed: expected security.ts anchor was not found"

    ts_path = tmp_path / "security.ts"
    ts_path.write_text(broken, encoding="utf-8")
    monkeypatch.setattr(guard, "TS_PATH", ts_path)

    assert guard.main() == 1
    err = capsys.readouterr().err
    assert "X-Comicine-Only-In-Ts" in err
    assert "the JSON is the only source" in err


def test_guard_rejects_report_only_policy_looser_than_enforced(tmp_path, monkeypatch, capsys):
    """Report-Only may only tighten the enforced policy; a looser source must fail.

    Without this check a Report-Only policy that allows more than the enforced one would
    silently collect nothing, while looking like a valid tightening experiment.
    """

    def mutate(text: str) -> str:
        return text.replace(
            "form-action 'self' https://*.comicine.com; report-to csp",
            "form-action *; report-to csp",
        )

    broken_both(tmp_path, monkeypatch, mutate)

    assert guard.main() == 1
    err = capsys.readouterr().err
    assert "Report-Only" in err
    assert "form-action" in err
    assert "JSON=" not in err


def test_guard_rejects_report_only_without_reporting_channel(tmp_path, monkeypatch, capsys):
    """The Report-Only policy must name both the Reporting API group and the legacy report-uri."""

    def mutate(text: str) -> str:
        return text.replace("; report-to csp; report-uri /api/csp-report", "")

    broken_both(tmp_path, monkeypatch, mutate)

    assert guard.main() == 1
    err = capsys.readouterr().err
    assert "report-to" in err
    assert "report-uri" in err
    assert "/api/csp-report" in err
    assert "JSON=" not in err


def test_report_only_channel_is_wired():
    """Pin the reporting channel: header, group, endpoint path, and a real handler for that path."""
    headers = json.loads(
        (ROOT / "ops" / "security-headers.json").read_text(encoding="utf-8")
    )
    assert headers["Reporting-Endpoints"] == 'csp="/api/csp-report"'
    report_only = headers["Content-Security-Policy-Report-Only"]
    assert "report-to csp" in report_only
    assert "report-uri /api/csp-report" in report_only
    assert (ROOT / "functions" / "api" / "csp-report.ts").is_file()


def test_docs_csp_allows_cloudflare_insights():
    """The CSP for docs.comicine.com is generated by ops/docs_headers.py and must also allow the beacon."""
    import docs_headers

    header = docs_headers.csp([], [])
    script_src = _origins(header, "script-src")
    connect_src = _origins(header, "connect-src")
    for origin in (
        "http://static.cloudflareinsights.com",
        "https://static.cloudflareinsights.com",
    ):
        assert origin in script_src, f"docs CSP script-src is missing {origin}"
    for origin in ("http://cloudflareinsights.com", "https://cloudflareinsights.com"):
        assert origin in connect_src, f"docs CSP connect-src is missing {origin}"
