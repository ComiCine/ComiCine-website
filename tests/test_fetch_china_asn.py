# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026 Limooo <https://limooo.cn/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""`ops/fetch_china_asn.py` 的离线回归（tasks/22 之后的名单目录改造）。

这个脚本每次部署都会跑，而它**联网**，所以测试只覆盖三块不依赖网络的部分：

1. 生成物的**格式**必须能被 `ops/check_gate_trust.py` 解析（否则部署时 CI 才炸）；
2. 手工条目 `own-ips.txt` 被正确剥离注释、原样保留；
3. **源不可达时的容错语义**：非 strict 只警告（部署不该被源抽风挡住），
   strict 与 `--check` 必须非 0。

网络本身不在测试里打真请求 —— 那会让 CI 依赖外网可用性。
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ops"))

import fetch_china_asn as fetcher  # noqa: E402  (path is set above)


def test_rendered_whitelist_is_parseable_by_the_generator(tmp_path, monkeypatch):
    """生成的 whitelist.txt 必须能被 check_gate_trust.load_whitelist 解析。

    这是这条链最关键的一条：名单格式错的话，失败点会出现在部署中途的 CI 里，
    而不是这里。
    """
    import check_gate_trust

    target = tmp_path / "whitelist.txt"
    manual = ["IP-CIDR/97.64.18.11/32", "ASN/64500"]
    target.write_text(fetcher.render_whitelist([4134, 4809, 4809], manual), encoding="utf-8")

    asns, networks = check_gate_trust.load_whitelist(target)

    # ASN 去重且排序；手工段的 ASN 也被算进去。
    assert asns == [4134, 4809, 64500]
    assert networks == [("97.64.18.11", 32)]


def test_render_keeps_manual_entries_verbatim(tmp_path):
    """手工条目原样落在文件末尾，且带说明段头（人要知道改哪个文件）。"""
    text = fetcher.render_whitelist([4134], ["IP-CIDR/198.51.100.0/24"])

    assert "IP-CIDR/198.51.100.0/24" in text
    assert "own-ips.txt" in text, "生成物必须告诉读者去改 own-ips.txt，而不是它自己"
    assert text.rstrip().endswith("IP-CIDR/198.51.100.0/24")


def test_render_group_file_stays_within_the_asn_syntax():
    """china-asn.txt 只允许出现 `ASN/<数字>` 行（别的行会让生成器报错）。"""
    text = fetcher.render_asn_file({"chinanet": [4134, 4809], "cmcc": [9808]})

    body = [ln for ln in text.splitlines() if ln and not ln.startswith("#")]
    assert body == ["ASN/4134", "ASN/4809", "ASN/9808"]
    assert all(ln.startswith("ASN/") for ln in body)


def test_manual_entries_strips_comments_and_blanks(tmp_path):
    p = tmp_path / "own-ips.txt"
    p.write_text(
        "# 头部注释\n"
        "\n"
        "IP-CIDR/97.64.18.11/32   # 行尾注释\n"
        "ASN/64500\n"
        "   \n",
        encoding="utf-8",
    )

    assert fetcher.manual_entries(p) == ["IP-CIDR/97.64.18.11/32", "ASN/64500"]


def test_manual_entries_is_empty_when_file_is_missing(tmp_path):
    """缺少 own-ips.txt 不该炸 —— 只有 ASN 段的白名单是合法的。"""
    assert fetcher.manual_entries(tmp_path / "nope.txt") == []


def test_parse_asn_file_ignores_comments_and_manual_lines(tmp_path):
    p = tmp_path / "whitelist.txt"
    p.write_text(
        "# ASN/99999 是注释里的，不该被算进去\n"
        "ASN/4134\n"
        "IP-CIDR/10.0.0.1/32\n"
        "ASN/4809\n",
        encoding="utf-8",
    )

    assert fetcher.parse_asn_file(p) == [4134, 4809]


def test_unreachable_source_keeps_the_existing_list_and_exits_zero(monkeypatch, tmp_path, capsys):
    """非 strict：源不可达 → 退出 0（部署继续），且**不写文件**（保留上一次的名单）。

    这条语义是刻意的：源临时抽风不该让代码发不出去。反过来，如果这里静默写出一份
    空名单，门禁信任配置就会退化成"谁都不信任" —— 那才是真正的事故。
    """
    monkeypatch.setattr(fetcher, "LISTS_DIR", tmp_path)
    monkeypatch.setattr(fetcher, "ASN_CACHE", tmp_path / "china-asn.txt")
    monkeypatch.setattr(fetcher, "WHITELIST", tmp_path / "whitelist.txt")
    monkeypatch.setattr(fetcher, "OWN_IPS", tmp_path / "own-ips.txt")

    def boom(_name: str) -> list[int]:
        raise OSError("network is down")

    monkeypatch.setattr(fetcher, "fetch_group", boom)
    monkeypatch.setattr(sys, "argv", ["fetch_china_asn.py"])

    assert fetcher.main() == 0
    assert not (tmp_path / "whitelist.txt").exists(), "源不可达时不得写出名单"
    assert "WARN" in capsys.readouterr().err


def test_unreachable_source_fails_under_strict(monkeypatch, tmp_path):
    """strict：源不可达 → 非 0（CI 与人工复核用）。"""
    monkeypatch.setattr(fetcher, "LISTS_DIR", tmp_path)
    monkeypatch.setattr(fetcher, "ASN_CACHE", tmp_path / "china-asn.txt")
    monkeypatch.setattr(fetcher, "WHITELIST", tmp_path / "whitelist.txt")
    monkeypatch.setattr(fetcher, "OWN_IPS", tmp_path / "own-ips.txt")

    def boom(_name: str) -> list[int]:
        raise OSError("network is down")

    monkeypatch.setattr(fetcher, "fetch_group", boom)
    monkeypatch.setattr(sys, "argv", ["fetch_china_asn.py", "--strict"])

    assert fetcher.main() == 1


def test_missing_manual_file_does_not_break_a_fetch(monkeypatch, tmp_path):
    """完整走一遍（源用桩替身）：own-ips.txt 不存在时仍应成功写出两份产物。"""
    monkeypatch.setattr(fetcher, "LISTS_DIR", tmp_path)
    monkeypatch.setattr(fetcher, "ASN_CACHE", tmp_path / "china-asn.txt")
    monkeypatch.setattr(fetcher, "WHITELIST", tmp_path / "whitelist.txt")
    monkeypatch.setattr(fetcher, "OWN_IPS", tmp_path / "own-ips.txt")
    monkeypatch.setattr(fetcher, "fetch_group", lambda name: [4134, 4809] if name == "chinanet" else [])
    monkeypatch.setattr(sys, "argv", ["fetch_china_asn.py"])

    assert fetcher.main() == 0

    whitelist = (tmp_path / "whitelist.txt").read_text(encoding="utf-8")
    # 白名单里**不该有 ASN**（默认不按 ASN 放行），但两份产物都必须写出来：
    # 缺 own-ips.txt 不该让整次抓取失败。
    assert not any(line.startswith("ASN/") for line in whitelist.splitlines())
    assert (tmp_path / "china-asn.txt").is_file(), "证据文件必须生成"
    # 证据文件里仍应留着抓到的 ASN。
    assert "ASN/4134" in (tmp_path / "china-asn.txt").read_text(encoding="utf-8")


@pytest.mark.parametrize("group_name", ["chinanet", "cmcc", "unicom", "cernet", "cstnet", "other"])
def test_every_configured_group_has_a_chinese_label(group_name):
    """每个要拉的分类都得有中文标签（生成物的段头靠它，缺了人读不懂）。"""
    labels = dict(fetcher.GROUPS)
    assert group_name in labels, f"{group_name} 没有登记"
    assert labels[group_name].strip(), f"{group_name} 的标签是空的"


# ── 白名单只取三家运营商（2026-10-11 用户定）────────────────────────────

def test_whitelist_trusts_no_asn_by_default():
    """默认**不按 ASN 放行任何运营商**（2026-10-11 用户决定）。

    历史：曾一度并三家运营商（319 个）；后来发现上游没有「家宽 / 蜂窝」维度，
    三家名单里混着 IDC 与企业专线，按 ASN 全量放行的面太大，于是收紧成
    「只放行 own-ips.txt 里的固定 IP」。

    这条同时钉住：想恢复放行**只需改这一个常量**（分组名仍在 GROUPS 里、
    数据照常抓取存证），以及**分组名不许拼错**（否则恢复时会静默什么都不放行）。
    """
    assert fetcher.WHITELIST_GROUPS == (), "默认不该按 ASN 放行；要开就显式改这个常量"
    # 想恢复时用到的分组名必须都真实存在于 GROUPS，否则静默失效。
    for name in ("chinanet", "cmcc", "unicom", "cernet", "cstnet", "other"):
        assert name in dict(fetcher.GROUPS), f"{name} 应在 GROUPS 里（恢复放行时要用）"


def test_whitelist_excludes_every_asn_group(monkeypatch, tmp_path):
    """端到端：所有分组的 ASN 都**不**进白名单，但都留在 china-asn.txt 存证。"""
    monkeypatch.setattr(fetcher, "LISTS_DIR", tmp_path)
    monkeypatch.setattr(fetcher, "ASN_CACHE", tmp_path / "china-asn.txt")
    monkeypatch.setattr(fetcher, "WHITELIST", tmp_path / "whitelist.txt")
    monkeypatch.setattr(fetcher, "OWN_IPS", tmp_path / "own-ips.txt")
    # 每个分组给一个可辨认的号段
    fake = {
        "chinanet": [4134],
        "cmcc": [9808],
        "unicom": [4837],
        "cernet": [4538],     # 必须被排除
        "cstnet": [7497],     # 必须被排除
        "other": [4611],      # 必须被排除
    }
    monkeypatch.setattr(fetcher, "fetch_group", lambda name: fake[name])
    monkeypatch.setattr(sys, "argv", ["fetch_china_asn.py"])

    assert fetcher.main() == 0

    whitelist = (tmp_path / "whitelist.txt").read_text(encoding="utf-8")
    for dropped in (4134, 9808, 4837, 4538, 7497, 4611):
        assert f"ASN/{dropped}" not in whitelist, f"ASN/{dropped} 不该进白名单"
    assert not any(line.startswith("ASN/") for line in whitelist.splitlines()), (
        "默认白名单里不该有任何 ASN 行"
    )

    # 全量证据文件仍然包含被排除的那些（存证用途）。
    evidence = (tmp_path / "china-asn.txt").read_text(encoding="utf-8")
    for dropped in (4538, 7497, 4611):
        assert f"ASN/{dropped}" in evidence, f"ASN/{dropped} 应留在 china-asn.txt 存证"
