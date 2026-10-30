# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Zone-settings snapshot: what the review note fires on, and what it must not.

The first draft of `ops/zone_settings.py` flagged `always_use_https=on` and
`tls_1_3=zrt` — the *desired* values — which is how a review note becomes noise
nobody reads. These tests pin the corrected rule: a note only appears when the live
value is the unwanted one.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ops"))

import zone_settings  # noqa: E402  (path is set above)


def values(**overrides: object) -> dict[str, dict[str, object]]:
    """A full setting map with the production values, then apply overrides."""
    base = {
        "always_use_https": "on",
        "automatic_https_rewrites": "on",
        "min_tls_version": "1.2",
        "ssl": "full",
        "tls_1_3": "zrt",
        "security_level": "essentially_off",
        "browser_check": "on",
        "challenge_ttl": 1800,
        "development_mode": "off",
        "hotlink_protection": "on",
        "rocket_loader": "off",
    }
    base.update(overrides)
    return {key: {"value": value, "editable": True} for key, value in base.items()}


def test_only_security_level_is_flagged_in_production(capsys: pytest.CaptureFixture[str]) -> None:
    """Production values produce exactly one note, and it is Security Level."""
    notes = zone_settings.describe(values())

    assert notes == 1, "production settings should raise exactly one review note"
    out = capsys.readouterr().out
    assert "security_level            essentially_off  <- review" in out
    # The desired values must never be flagged: that was the first draft's bug.
    for benign in ("always_use_https", "tls_1_3", "ssl", "browser_check", "hotlink_protection"):
        assert f"{benign}" in out
    assert out.count("<- review") == 1


def test_hardening_a_setting_silences_its_note() -> None:
    """Changing Security Level to a real level removes the only note."""
    assert zone_settings.describe(values(security_level="medium")) == 0


@pytest.mark.parametrize(
    ("key", "bad"),
    [
        ("ssl", "flexible"),
        ("tls_1_3", "off"),
        ("always_use_https", "off"),
        ("development_mode", "on"),
        ("rocket_loader", "on"),
        ("hotlink_protection", "off"),
        ("browser_check", "off"),
    ],
)
def test_each_guarded_setting_fires_on_its_bad_value(
    key: str,
    bad: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    notes = zone_settings.describe(values(security_level="medium", **{key: bad}))

    assert notes == 1
    assert f"  {key} = {bad}:" in capsys.readouterr().out


def snapshot_settings() -> dict[str, dict[str, object]]:
    """Return a complete synthetic settings map without relying on an archived file."""
    return {key: {"value": "test", "editable": True} for key in zone_settings.SNAPSHOT_KEYS}


def test_snapshot_contract_covers_every_guarded_key() -> None:
    """Generated snapshots keep every review key even when no archive is checked in."""
    settings = snapshot_settings()
    missing = [key for key, _bad, _why in zone_settings.NOTEWORTHY if key not in settings]
    assert missing == []

    snapshot = zone_settings.render(settings, "test-zone-id")
    assert snapshot["zone"] == "comicine.com"
    assert set(snapshot["settings"]) == set(zone_settings.SNAPSHOT_KEYS)


def test_rendered_snapshot_holds_no_credentials() -> None:
    """The snapshot serializer only records zone settings, never credentials."""
    raw = json.dumps(zone_settings.render(snapshot_settings(), "test-zone-id")).lower()

    for needle in ("token", "secret", "bearer", "authorization"):
        assert needle not in raw, f"snapshot mentions {needle!r}"
