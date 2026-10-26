# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for config utilities and geo_cache table creation."""

import sqlite3

from config import ensure_geo_cache, get_cached_geo, is_private_ip


def test_ip_ranges():
    assert is_private_ip("127.0.0.1") is True
    assert is_private_ip("192.168.1.1") is True
    assert is_private_ip("10.0.0.1") is True
    assert is_private_ip("::1") is True
    assert is_private_ip("fc00::1") is True
    assert is_private_ip("fe80::1") is True
    assert is_private_ip("8.8.8.8") is False
    assert is_private_ip("2001:4860:4860::8888") is False
    assert is_private_ip("not-an-ip") is False


def test_ensure_geo_cache_and_read(tmp_path):
    conn = sqlite3.connect(tmp_path / "geo.db")
    ensure_geo_cache(conn)
    conn.execute(
        "INSERT INTO geo_cache (ip, country, city, latitude, longitude, isp, asn) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("8.8.8.8", "US", "Mountain View", 37.4, -122.0, "Google", "AS15169"),
    )
    conn.commit()
    row = get_cached_geo(conn, "8.8.8.8")
    assert row and row["country"] == "US" and row["asn"] == "AS15169"
    conn.close()
