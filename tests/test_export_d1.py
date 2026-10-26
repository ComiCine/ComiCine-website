# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for blocklist export in ops/export_d1.py (tasks/10)."""

import ops.export_d1 as export_d1


def test_export_blocklist_uses_new_schema(tmp_path, monkeypatch):
    source = tmp_path / "blocklist.txt"
    source.write_text("1.2.3.4\n2001:db8::1/64\n", encoding="utf-8")
    out_dir = tmp_path / "out"
    monkeypatch.setattr(export_d1, "OUT_DIR", str(out_dir))

    assert export_d1.export_blocklist(str(source)) == 0
    sql = (out_dir / "blocklist.sql").read_text(encoding="utf-8")
    assert "INSERT OR IGNORE INTO blocked_ips" in sql
    assert "network" in sql and "prefix" in sql
    assert "1.2.3.4/32" in sql
    assert "2001:db8::/64" in sql
    assert "active" in sql
