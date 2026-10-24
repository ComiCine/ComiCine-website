# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Tests for blocklist parsing and D1 sync (Nginx scanning was removed with the VPS)."""

import auto_block


def test_normalize_cidr():
    assert auto_block._normalize_cidr("1.2.3") == "1.2.3.0/24"
    assert auto_block._normalize_cidr("1.2.3.0/24") == "1.2.3.0/24"
    assert auto_block._normalize_cidr("1.2.3.4") == "1.2.3.4/32"
    assert auto_block._normalize_cidr("2001:db8::1/64") == "2001:db8::/64"
    assert auto_block._normalize_cidr("# comment") is None


def test_read_blocklist_txt(tmp_path):
    p = tmp_path / "blocklist.txt"
    p.write_text(
        "# header\n\n"
        "1.2.3.0/24\n"
        "4.5.6.7/32\n",
        encoding="utf-8",
    )
    static, prefixes = auto_block.read_blocklist_txt(str(p))
    assert static == ["# header", "", "4.5.6.7/32"]
    assert prefixes == {"1.2.3"}


def test_read_blocklist_returns_canonical_cidrs(tmp_path):
    p = tmp_path / "blocklist.txt"
    p.write_text(
        "# header\n1.2.3.4\n1.2.3.0/24\n2001:db8::1/64\nbad\n",
        encoding="utf-8",
    )
    assert auto_block.read_blocklist(str(p)) == [
        "1.2.3.4/32",
        "1.2.3.0/24",
        "2001:db8::/64",
    ]


def _fake_d1_call(calls):
    def fake_call(token, method, url, body=None):
        calls.append((method, url, body))
        sql = (body or {}).get("sql", "")
        if sql.startswith("SELECT"):
            return {
                "result": [
                    {
                        "results": [
                            {
                                "cidr": "1.2.3.0/24",
                                "network": "1.2.3.0",
                                "prefix": 24,
                                "source": "auto_block",
                                "active": 1,
                            },
                            {
                                "cidr": "4.5.6.0/24",
                                "network": "4.5.6.0",
                                "prefix": 24,
                                "source": "auto_block",
                                "active": 1,
                            },
                        ],
                        "meta": {"changes": 0},
                    }
                ]
            }
        return {"result": [{"meta": {"changes": 1}}]}

    return fake_call


def test_sync_d1_dry_run_does_not_write(monkeypatch, tmp_path):
    p = tmp_path / "blocklist.txt"
    p.write_text("1.2.3.0/24\n2001:db8::/64\n", encoding="utf-8")
    monkeypatch.setattr(auto_block, "BLOCKLIST_TXT", str(p))
    monkeypatch.setattr(auto_block, "load_env", lambda path: {
        "CLOUDFLARE_API_TOKEN": "token",
        "CLOUDFLARE_ACCOUNT_ID": "account",
        "D1_DATABASE_ID": "db",
    })
    calls = []
    monkeypatch.setattr(auto_block, "_call", _fake_d1_call(calls))
    assert auto_block.sync_d1(dry_run=True) == 0
    assert not any("INSERT" in body["sql"] or "DELETE" in body["sql"] for _, _, body in calls)


# Write back the result of bidirectional reconciliation (2026-10-11: reconcile).

def test_write_pulled_section_keeps_the_hand_written_area(tmp_path):
    """Rewrite the managed section while preserving the manually maintained section exactly.

    This is the riskiest part of the feature because it writes a user-maintained file.
    Losing the manual section would silently remove user-added block entries.
    """
    p = tmp_path / "blocklist.txt"
    p.write_text(
        "# 自定义封禁列表\n"
        "# 一行一个 IP 或 CIDR\n"
        "1.2.3.4\n"
        "5.6.7.0/24   # 我的备注\n",
        encoding="utf-8",
    )

    auto_block._write_pulled_section(str(p), {"10.0.0.0/8": "cli/add"}, ["10.0.0.0/8"])

    text = p.read_text(encoding="utf-8")
    head, sep, managed = text.partition(auto_block.MANAGED_MARKER)
    assert sep, "必须写出受管段标记"
    # Preserve all four hand-maintained lines exactly, including trailing comments.
    assert "# 自定义封禁列表" in head
    assert "1.2.3.4" in head
    assert "5.6.7.0/24   # 我的备注" in head
    # Include the source marker in the managed section.
    assert "10.0.0.0/8" in managed and "source=cli/add" in managed


def test_write_pulled_section_is_idempotent(tmp_path):
    """Writing the section twice does not append duplicate entries."""
    p = tmp_path / "blocklist.txt"
    p.write_text("# 手写\n1.2.3.4\n", encoding="utf-8")
    rows = {"10.0.0.0/8": "admin", "10.1.0.0/16": "auto_block"}

    auto_block._write_pulled_section(str(p), rows, [])
    first = p.read_text(encoding="utf-8")
    auto_block._write_pulled_section(str(p), rows, [])
    second = p.read_text(encoding="utf-8")

    assert first == second, "同样的输入必须产出同样的文件"
    assert second.count("10.0.0.0/8") == 1, "不得重复追加"


def test_pulled_section_survives_being_read_back(tmp_path):
    """The written file remains parseable by read_blocklist for the next reconciliation."""
    p = tmp_path / "blocklist.txt"
    p.write_text("# 手写\n1.2.3.4\n", encoding="utf-8")

    auto_block._write_pulled_section(str(p), {"58.222.33.0/24": "cli/add"}, ["58.222.33.0/24"])

    got = auto_block.read_blocklist(str(p))
    assert "1.2.3.4/32" in got, "手写项要仍能读出来"
    assert "58.222.33.0/24" in got, "拉回的项要能读出来"


def test_managed_section_starts_empty_and_grows(tmp_path):
    """Both an empty managed section and one with added rows must remain valid."""
    p = tmp_path / "blocklist.txt"
    p.write_text("# 只有手写区\n", encoding="utf-8")

    auto_block._write_pulled_section(str(p), {}, [])
    assert "只有手写区" in p.read_text(encoding="utf-8")
    assert auto_block.read_blocklist(str(p)) == []

    auto_block._write_pulled_section(str(p), {"9.9.9.9": "cli/add"}, ["9.9.9.9"])
    assert auto_block.read_blocklist(str(p)) == ["9.9.9.9/32"]
