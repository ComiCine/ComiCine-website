# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Offline unit and end-to-end tests for ops/check_blocklist_sync.py (no D1 or Cloudflare access).

These tests protect three behaviors:
    1. Normalization matches normalizeListItem in ops/sync-worker; otherwise the
       script reports /32 and bare-IP spellings as drift and prompts needless work.
    2. Drift classification and exit codes (0 consistent / 1 drift / 2 unavailable)
       remain distinct.
    3. Terminal output stays English and contains no decorative symbols (AGENTS.md).
"""

import ast
import json
import re
from pathlib import Path

import pytest

import ops.check_blocklist_sync as cbs

HAN = re.compile(r"[\u4e00-\u9fff]")


def test_terminal_output_is_english():
    """Terminal-facing strings must remain English; this check inspects their source literals."""
    tree = ast.parse(Path(cbs.__file__).read_text(encoding="utf-8"))

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


def test_no_decorative_banner_in_source():
    source = Path(cbs.__file__).read_text(encoding="utf-8")
    assert 'print("==' not in source
    assert 'print(f"==' not in source


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1.2.3.4/32", "1.2.3.4"),
        ("2001:db8::1/128", "2001:db8::1"),
        ("1.2.3.0/24", "1.2.3.0/24"),
        ("2001:db8::/64", "2001:db8::/64"),
        ("1.2.3.4", "1.2.3.4"),
        ("  1.2.3.4/32  ", "1.2.3.4"),
        # An IPv4 address must not match a /128 rule, or vice versa.
        ("1.2.3.4/128", "1.2.3.4/128"),
        ("2001:db8::1/32", "2001:db8::1/32"),
        ("", ""),
    ],
)
def test_normalize_matches_worker(raw, expected):
    """Use the same normalization cases as normalizeListItem in ops/sync-worker/src/index.ts."""
    assert cbs.normalize_list_item(raw) == expected


def test_identical_sets_have_no_diff():
    to_add, to_remove = cbs.compute_diff(
        ["1.2.3.0/24"], {"1.2.3.0/24": "i1"}
    )
    assert (to_add, to_remove) == ([], [])


def test_slash32_and_bare_ip_are_not_drift():
    """D1's /32 and Cloudflare's bare-IP forms represent the same entry and are not drift."""
    to_add, to_remove = cbs.compute_diff(["1.2.3.4/32"], {"1.2.3.4": "i1"})
    assert (to_add, to_remove) == ([], [])


def test_drift_is_reported_on_both_sides():
    to_add, to_remove = cbs.compute_diff(
        ["1.2.3.0/24", "9.9.9.0/24"],
        {"1.2.3.0/24": "i1", "4.4.4.0/24": "i2"},
    )
    assert to_add == ["9.9.9.0/24"]
    assert to_remove == ["4.4.4.0/24"]


def test_to_add_keeps_the_d1_spelling():
    """to_add preserves the original D1 spelling because that is what the Worker uploads."""
    to_add, _ = cbs.compute_diff(["1.2.3.4/32"], {})
    assert to_add == ["1.2.3.4/32"]


def test_compute_diff_is_order_independent():
    a = cbs.compute_diff(["b/24", "a/24"], {})
    b = cbs.compute_diff(["a/24", "b/24"], {})
    assert a == b == (["a/24", "b/24"], [])


# End-to-end: stub D1 and Cloudflare while running all other code for real.

CFG = {"token": "t", "account_id": "acct", "database_id": "db"}


def _stub(monkeypatch, *, d1_rows, list_items, runs=None, d1_fails=False, run_history_fails=False):
    """Replace d1_query_retry and cf_get_json with in-memory implementations."""
    calls: dict[str, list] = {"d1": [], "cf": [], "writes": []}
    rows = list(d1_rows)

    def fake_d1_query_retry(cfg, sql, tries=4, raise_on_failure=False):
        calls["d1"].append(sql)
        if d1_fails:
            return None
        if "FROM blocked_ips" in sql:
            return [{"cidr": cidr} for cidr in rows]
        if "FROM worker_runs" in sql:
            if run_history_fails:
                return None
            job = sql.split("job = '", 1)[1].split("'", 1)[0]
            return [runs[job]] if runs and runs.get(job) else []
        raise AssertionError(f"unexpected SQL: {sql}")

    def fake_d1_query(cfg, sql):
        calls["writes"].append(sql)
        return []

    def fake_cf_get_json(token, url, attempts=4):
        calls["cf"].append(url)
        if "/rules/lists?" in url:
            return {"result": [{"name": cbs.LIST_NAME, "id": "list-1", "modified_on": "2026-10-11T00:00:00Z"}]}
        if "/items" in url:
            return {
                "result": [{"ip": ip, "id": f"id-{ip}"} for ip in list_items],
                "result_info": {},
            }
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(cbs.d1_client, "d1_query_retry", fake_d1_query_retry)
    monkeypatch.setattr(cbs.d1_client, "d1_query", fake_d1_query)
    monkeypatch.setattr(cbs, "cf_get_json", fake_cf_get_json)
    monkeypatch.setattr(cbs.d1_client, "load_env", lambda *a, **k: {})
    monkeypatch.setattr(cbs.d1_client, "cloudflare_config", lambda env: dict(CFG))
    monkeypatch.setattr(cbs, "install_ca_bundle", lambda: None)
    return calls


def _run(monkeypatch, argv, **kwargs):
    monkeypatch.setattr("sys.argv", ["check_blocklist_sync.py", *argv])
    return _stub(monkeypatch, **kwargs), cbs.main()


def test_main_reports_ok_and_exits_zero(monkeypatch, capsys):
    _, code = _run(
        monkeypatch,
        [],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
        runs={
            "blocklist_sync": {
                "job": "blocklist_sync",
                "started_at": 1791000000,
                "finished_at": 1791000001,
                "outcome": "ok",
                "added": 1,
                "removed": 0,
                "error": None,
            }
        },
    )
    out = capsys.readouterr().out
    assert code == 0
    assert "desired=1 actual=1 to_add=0 to_remove=0" in out
    assert "result: OK" in out
    assert "outcome=ok" in out


def test_main_exits_one_on_drift(monkeypatch, capsys):
    _, code = _run(
        monkeypatch,
        [],
        d1_rows=["1.2.3.0/24", "9.9.9.0/24"],
        list_items=["1.2.3.0/24"],
    )
    out = capsys.readouterr().out
    assert code == 1
    assert "desired=2 actual=1 to_add=1 to_remove=0" in out
    assert "+ 9.9.9.0/24" in out
    assert "result: DRIFT" in out


def test_main_exits_one_when_the_last_run_failed(monkeypatch, capsys):
    _, code = _run(
        monkeypatch,
        [],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
        runs={
            "blocklist_sync": {
                "job": "blocklist_sync",
                "started_at": 1791000000,
                "finished_at": 1791000001,
                "outcome": "failed",
                "added": None,
                "removed": None,
                "error": "CF API 403 https://api.cloudflare.com/...",
            }
        },
    )
    out = capsys.readouterr().out
    assert code == 1
    assert "outcome=failed" in out
    assert "CF API 403" in out
    assert "result: FAILED RUN" in out


@pytest.mark.parametrize("outcome", ["running", "unexpected"])
def test_main_exits_one_for_stale_or_unknown_run_outcomes(monkeypatch, capsys, outcome):
    _, code = _run(
        monkeypatch,
        [],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
        runs={
            "blocklist_sync": {
                "job": "blocklist_sync",
                "started_at": 1791000000,
                "finished_at": None,
                "outcome": outcome,
                "added": None,
                "removed": None,
            }
        },
    )
    out = capsys.readouterr().out
    assert code == 1
    assert "result: FAILED RUN" in out


def test_main_exits_two_when_worker_run_history_is_unavailable(monkeypatch, capsys):
    _, code = _run(
        monkeypatch,
        ["--json"],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
        run_history_fails=True,
    )
    body = json.loads(capsys.readouterr().out)
    assert code == 2
    assert body["ok"] is False
    assert body["run_history_error"]


def test_main_exits_two_when_the_check_cannot_complete(monkeypatch, capsys):
    _, code = _run(monkeypatch, [], d1_rows=["1.2.3.0/24"], list_items=[], d1_fails=True)
    out = capsys.readouterr().out
    assert code == 2
    assert "status=error" in out
    assert "NOT a statement about drift" in out


def test_main_json_shape(monkeypatch, capsys):
    _, code = _run(
        monkeypatch,
        ["--json"],
        d1_rows=["1.2.3.0/24", "9.9.9.0/24"],
        list_items=["1.2.3.0/24", "4.4.4.0/24"],
        runs={
            "blocklist_sync": {
                "job": "blocklist_sync",
                "started_at": 1791000000,
                "finished_at": 1791000001,
                "outcome": "ok",
                "added": 0,
                "removed": 0,
                "error": None,
            }
        },
    )
    body = json.loads(capsys.readouterr().out)
    assert code == 1
    assert body["ok"] is False
    assert body["status"] == "drift"
    assert (body["desired"], body["actual"]) == (2, 2)
    assert body["to_add"] == 1
    assert body["to_remove"] == 1
    assert body["to_add_sample"] == ["9.9.9.0/24"]
    assert body["last_runs"]["blocklist_sync"]["outcome"] == "ok"


def test_record_writes_one_worker_runs_row(monkeypatch, capsys):
    calls, code = _run(
        monkeypatch,
        ["--record"],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
    )
    out = capsys.readouterr().out
    assert code == 0
    assert len(calls["writes"]) == 1
    sql = calls["writes"][0]
    assert "INSERT INTO worker_runs" in sql
    assert f"'{cbs.CHECK_JOB}'" in sql
    assert "'ok'" in sql
    assert sql.rstrip().endswith("0)")  # dry_run=0: this is a real check, not a dry run.
    assert f"recorded this check as {cbs.CHECK_JOB} outcome=ok" in out


def test_script_never_writes_to_the_ip_list(monkeypatch):
    """Read-only probe: no Cloudflare call during the run may use a method other than GET."""
    calls, _ = _run(
        monkeypatch,
        [],
        d1_rows=["1.2.3.0/24"],
        list_items=["1.2.3.0/24"],
    )
    # cf_get_json performs only GET requests (its signature has no method parameter) and uses only the read-only lists and items endpoints.
    assert calls["cf"], "expected at least one Cloudflare read"
    assert all("/rules/lists" in url for url in calls["cf"])
