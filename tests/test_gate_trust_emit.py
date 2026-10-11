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

"""tasks/22 W4-4：门禁信任配置的「生成物只带运行时要用的部分」。

`functions/_data/gateTrust.ts` 曾经同时带 320 条低风险 ASN（运行时零消费，
真正消费方是 WAF 的 js_challenge 规则）与 2 个全放行 IP。这里钉住：
  - 生成物只含 verified_bot / ip_cidrs；
  - docs/lists/whitelist.txt 的 ASN 段仍然照旧解析与计数（WAF 的来源，不许删）；
  - ops/readme_facts.py 的 ASN 计数改为从 whitelist.txt 现读。
"""

from __future__ import annotations

import json

import pytest

import ops.readme_facts as readme_facts
from ops import check_gate_trust


@pytest.fixture
def fake_repo(tmp_path, monkeypatch):
    """把 check_gate_trust 的输入/输出都指到 tmp_path。"""
    whitelist = tmp_path / "whitelist.txt"
    whitelist.write_text(
        "# 注释行\n"
        "ASN/4134\n"
        "ASN/4808\n"
        "ASN/4134\n"  # 重复项只算一次
        "IP-CIDR/97.64.18.11/32\n"
        "IP-CIDR/2001:db8::/64\n",
        encoding="utf-8",
    )
    output = tmp_path / "gateTrust.ts"
    monkeypatch.setattr(check_gate_trust, "WHITELIST_PATH", whitelist)
    monkeypatch.setattr(check_gate_trust, "OUTPUT_PATH", output)
    return output


def test_emit_omits_low_risk_asns(fake_repo, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["check_gate_trust.py", "--emit"])

    assert check_gate_trust.main() == 0

    emitted = fake_repo.read_text(encoding="utf-8")
    assert "low_risk_asns" not in emitted
    assert "LOW_RISK_ASNS" not in emitted
    assert '"ip_cidrs": [["97.64.18.11", 32], ["2001:db8::", 64]]' in emitted
    assert 'export const GATE_TRUST_IPS: Set<string> = new Set(["97.64.18.11", "2001:db8::"]);' in emitted
    # ASN 仍在 stdout 摘要里（审计用），只是不进 isolate
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert summary["asns"] == 2
    assert summary["ip_cidrs"] == 2


def test_whitelist_asns_are_still_parsed_and_validated(fake_repo, tmp_path):
    asns, networks = check_gate_trust.load_whitelist(check_gate_trust.WHITELIST_PATH)

    assert asns == [4134, 4808]
    assert networks == [("97.64.18.11", 32), ("2001:db8::", 64)]

    (tmp_path / "bad.txt").write_text("ASN/not-a-number\n", encoding="utf-8")
    with pytest.raises(RuntimeError):
        check_gate_trust.load_whitelist(tmp_path / "bad.txt")


def test_readme_facts_counts_asns_from_whitelist(monkeypatch, tmp_path):
    """README 的 ASN 计数改读 docs/lists/whitelist.txt，不再对生成物做正则。"""
    (tmp_path / "docs" / "lists").mkdir(parents=True)
    (tmp_path / "docs" / "lists" / "whitelist.txt").write_text(
        "# 注释\nASN/1\nASN/2\nASN/2\nIP-CIDR/10.0.0.1/32\n",
        encoding="utf-8",
    )
    (tmp_path / "functions" / "_data").mkdir(parents=True)
    (tmp_path / "functions" / "_data" / "gateTrust.ts").write_text(
        'export const GATE_TRUST = {"verified_bot": true, "ip_cidrs": [["10.0.0.1", 32]]} as const;\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(readme_facts, "BASE_DIR", str(tmp_path))

    facts = readme_facts.gate_trust_facts()

    # ASN 去重后计数（1、2 两条），CIDR 来自生成物
    assert facts == {"verified_bot": True, "asns": 2, "ip_cidrs": 1}


def test_readme_facts_asn_count_is_zero_when_whitelist_has_none(monkeypatch, tmp_path):
    (tmp_path / "docs" / "lists").mkdir(parents=True)
    (tmp_path / "docs" / "lists" / "whitelist.txt").write_text(
        "IP-CIDR/10.0.0.1/32\n", encoding="utf-8"
    )
    (tmp_path / "functions" / "_data").mkdir(parents=True)
    (tmp_path / "functions" / "_data" / "gateTrust.ts").write_text(
        'export const GATE_TRUST = {"verified_bot": false, "ip_cidrs": [["10.0.0.1", 32]]} as const;\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(readme_facts, "BASE_DIR", str(tmp_path))

    assert readme_facts.gate_trust_facts() == {
        "verified_bot": False,
        "asns": 0,
        "ip_cidrs": 1,
    }


def test_repo_whitelist_and_generated_file_agree():
    """真实仓库：ASN 仍在白名单里，生成物里没有它，CIDR 数量两边一致。

    ASN 的**具体条数刻意不写死**（2026-10-11 改）：那份名单由
    `ops/fetch_china_asn.py` 在每次部署时从 china-mainland-asn 刷新，
    条数天然会变（当时 320 → 5231）。写死数字只会让测试在名单更新时变红，
    而它真正要守的是「生成物与名单一致」这条**关系**。
    """
    asns, networks = check_gate_trust.load_whitelist(check_gate_trust.WHITELIST_PATH)
    # 名单必须非空 —— 否则下面的"一致"会退化成两边都是 0 的假通过。
    assert asns, "whitelist has no ASN at all; the ASN feed or own-ips.txt is broken"
    assert len(networks) == 2

    emitted = check_gate_trust.OUTPUT_PATH.read_text(encoding="utf-8")
    assert "low_risk_asns" not in emitted

    facts = readme_facts.gate_trust_facts()
    assert facts["asns"] == len(asns)
    assert facts["ip_cidrs"] == len(networks)
