# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

from __future__ import annotations

import io
import urllib.error

import pytest

from ops import check_ray_id, d1_client


def test_d1_query_retry_does_not_retry_permanent_query_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    sleeps: list[float] = []

    def fail(*_args: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        raise RuntimeError("D1 query failed: no such table")

    monkeypatch.setattr(d1_client, "d1_query", fail)
    monkeypatch.setattr(d1_client.time, "sleep", sleeps.append)

    assert d1_client.d1_query_retry({}, "SELECT * FROM missing") is None
    assert calls == 1
    assert sleeps == []


def test_d1_query_retry_retries_transient_connection_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    sleeps: list[float] = []

    def query(*_args: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise urllib.error.URLError("connection reset")
        return [{"ok": True}]

    monkeypatch.setattr(d1_client, "d1_query", query)
    monkeypatch.setattr(d1_client.time, "sleep", sleeps.append)

    assert d1_client.d1_query_retry({}, "SELECT 1") == [{"ok": True}]
    assert calls == 2
    assert sleeps == [1.5]


@pytest.mark.parametrize("status, expected_calls", [(400, 1), (503, 2)])
def test_d1_http_retry_classifies_status_codes(
    status: int,
    expected_calls: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0
    sleeps: list[float] = []

    def query(*_args: object) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise d1_client.D1HTTPError(status, "API response")
        return [{"ok": True}]

    monkeypatch.setattr(d1_client, "d1_query", query)
    monkeypatch.setattr(d1_client.time, "sleep", sleeps.append)

    result = d1_client.d1_query_retry({}, "SELECT 1")

    assert calls == expected_calls
    assert result == ([{"ok": True}] if expected_calls == 2 else None)
    assert len(sleeps) == expected_calls - 1


def test_ray_id_api_does_not_retry_client_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    sleeps: list[float] = []
    url = "https://api.cloudflare.com/client/v4/zones"

    def fail(*_args: object, **_kwargs: object) -> None:
        nonlocal calls
        calls += 1
        raise urllib.error.HTTPError(url, 403, "Forbidden", {}, io.BytesIO(b"denied"))

    monkeypatch.setattr(check_ray_id.urllib.request, "urlopen", fail)
    monkeypatch.setattr(check_ray_id.time, "sleep", sleeps.append)

    with pytest.raises(RuntimeError, match="HTTP Error 403"):
        check_ray_id.cf_request({"token": "test"}, url)

    assert calls == 1
    assert sleeps == []
