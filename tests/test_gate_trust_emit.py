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

`functions/_data/gateTrust.ts` 曾经同时带 ASN 列表（运行时零消费，
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
        "ASN/64500\n"
        "ASN/64501\n"
        "ASN/64500\n"  # 重复项只算一次
        "IP-CIDR/97.64.18.11/32\n"
        "IP-CIDR/2001:db8::/64\n",
        encoding="utf-8",
    )
    # 2026-10-12 起爬虫名单不再是自造的 crawlers.txt，而是标准格式的 robots.txt：
    # 显式 User-agent（`*` 除外）就是门禁放行名单。
    robots = tmp_path / "robots.txt"
    robots.write_text(
        "# 注释行\n"
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        "\n"
        "User-agent: GPTBot\n"
        "User-agent: ClaudeBot\n"
        "User-agent: Screaming Frog SEO Spider  # 行尾注释也要能剥掉\n"
        "Allow: /\n"
        "Disallow: /api/\n",
        encoding="utf-8",
    )
    output = tmp_path / "gateTrust.ts"
    monkeypatch.setattr(check_gate_trust, "WHITELIST_PATH", whitelist)
    monkeypatch.setattr(check_gate_trust, "ROBOTS_PATH", robots)
    monkeypatch.setattr(check_gate_trust, "OUTPUT_PATH", output)
    return output


def test_emit_omits_asn_lists(fake_repo, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["check_gate_trust.py", "--emit"])

    assert check_gate_trust.main() == 0

    emitted = fake_repo.read_text(encoding="utf-8")
    assert "asns" not in emitted
    assert "ASNS" not in emitted
    assert '"ip_cidrs": [["97.64.18.11", 32], ["2001:db8::", 64]]' in emitted
    assert 'export const GATE_TRUST_IPS: Set<string> = new Set(["97.64.18.11", "2001:db8::"]);' in emitted
    # 爬虫名单进 isolate：只取显式 User-agent（`*` 不在里面）、一律小写
    assert (
        'export const GATE_TRUST_CRAWLER_UAS: readonly string[] = '
        '["gptbot", "claudebot", "screaming frog seo spider"];'
    ) in emitted
    assert '"*"' not in emitted
    # ASN 仍在 stdout 摘要里（审计用），只是不进 isolate
    summary = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert summary["asns"] == 2
    assert summary["ip_cidrs"] == 2
    assert summary["crawler_uas"] == 3


def test_whitelist_asns_are_still_parsed_and_validated(fake_repo, tmp_path):
    asns, networks = check_gate_trust.load_whitelist(check_gate_trust.WHITELIST_PATH)

    assert asns == [64500, 64501]
    assert networks == [("97.64.18.11", 32), ("2001:db8::", 64)]

    (tmp_path / "bad.txt").write_text("ASN/not-a-number\n", encoding="utf-8")
    with pytest.raises(RuntimeError):
        check_gate_trust.load_whitelist(tmp_path / "bad.txt")


def test_robots_agents_keep_file_order_and_case(fake_repo):
    """名单保留 robots.txt 里的顺序与大小写（`*` 除外；生成物里才是小写副本）。"""
    agents = check_gate_trust.load_crawler_agents(check_gate_trust.ROBOTS_PATH)

    assert agents == ["GPTBot", "ClaudeBot", "Screaming Frog SEO Spider"]


def test_robots_agents_reject_bad_input(tmp_path):
    """格式错直接抛错：门禁名单写坏比构建失败严重。"""
    cases = {
        # 只有 `*` 组：那是「所有人」，当放行名单等于关掉门禁
        "star-only": "User-agent: *\nAllow: /\n",
        # 完全没有 User-agent 行
        "no-agents": "Allow: /\nDisallow: /api/\n",
        # 重复（大小写不敏感）
        "duplicate": "User-agent: GPTBot\nUser-agent: gptbot\n",
        # 片段过短 / 非法字符
        "too-short": "User-agent: ai\n",
        "bad-chars": 'User-agent: GPT"Bot\n',
    }
    for name, body in cases.items():
        path = tmp_path / f"{name}.txt"
        path.write_text(body, encoding="utf-8")
        with pytest.raises(RuntimeError, match="robots|agent"):
            check_gate_trust.load_crawler_agents(path)


def test_readme_facts_counts_asns_from_whitelist(monkeypatch, tmp_path):
    """README 的 ASN 计数改读 docs/lists/whitelist.txt，不再对生成物做正则。"""
    (tmp_path / "docs" / "lists").mkdir(parents=True)
    (tmp_path / "docs" / "lists" / "whitelist.txt").write_text(
        "# 注释\nASN/1\nASN/2\nASN/2\nIP-CIDR/10.0.0.1/32\n",
        encoding="utf-8",
    )
    (tmp_path / "functions" / "_data").mkdir(parents=True)
    (tmp_path / "functions" / "_data" / "gateTrust.ts").write_text(
        'export const GATE_TRUST = {"verified_bot": true, "ip_cidrs": [["10.0.0.1", 32]]} as const;\n'
        'export const GATE_TRUST_CRAWLER_UAS: readonly string[] = ["gptbot", "claudebot"];\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(readme_facts, "BASE_DIR", str(tmp_path))

    facts = readme_facts.gate_trust_facts()

    # ASN 去重后计数（1、2 两条），CIDR 与爬虫 UA 来自生成物
    assert facts == {"verified_bot": True, "asns": 2, "ip_cidrs": 1, "crawler_uas": 2}


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
        # 生成物里没有爬虫 UA 行时按 0 计（不是解析失败）
        "crawler_uas": 0,
    }


def test_repo_whitelist_and_generated_file_agree():
    """真实仓库：生成物与两份名单（白名单、robots.txt 里的爬虫）的数量一致。

    ASN 的**具体条数刻意不写死**（2026-10-11 改）：那份名单由
    ASN 条数由 `own-ips.txt` 的手工条目决定；这里守的是「生成物与名单一致」这条关系。
    """
    asns, networks = check_gate_trust.load_whitelist(check_gate_trust.WHITELIST_PATH)
    agents = check_gate_trust.load_crawler_agents(check_gate_trust.ROBOTS_PATH)
    # ASN 段**可以合法为空**（2026-10-11 起默认不按 ASN 放行），所以这里不要求非空；
    # 要守的是「加载器与名单一致」——两边的计数必须相等。
    assert len(networks) == 2, "两个固定 IP 仍应在名单里（own-ips.txt）"
    assert len(agents) > 20, "robots.txt 里的显式爬虫不该被清空"

    emitted = check_gate_trust.OUTPUT_PATH.read_text(encoding="utf-8")
    assert "asns" not in emitted

    facts = readme_facts.gate_trust_facts()
    assert facts["asns"] == len(asns)
    assert facts["ip_cidrs"] == len(networks)
    assert facts["crawler_uas"] == len(agents)
