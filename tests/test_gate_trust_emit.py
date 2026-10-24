# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Regression tests for tasks/22 W4-4: generated gate-trust data contains only runtime fields.

`functions/_data/gateTrust.ts` previously included an ASN list (unused at runtime;
the actual consumer is the WAF js_challenge rule) and two fully trusted IPs. These
tests require:
  - Generated data contains only verified_bot and ip_cidrs.
  - ASN data from docs/lists/whitelist.txt continues to be parsed and counted for WAF.
  - ops/readme_facts.py reads ASN counts from whitelist.txt.
"""

from __future__ import annotations

import json

import pytest

import ops.readme_facts as readme_facts
from ops import check_gate_trust


@pytest.fixture
def fake_repo(tmp_path, monkeypatch):
    """Redirect check_gate_trust inputs and outputs to tmp_path."""
    whitelist = tmp_path / "whitelist.txt"
    whitelist.write_text(
        "# 注释行\n"
        "ASN/64500\n"
        "ASN/64501\n"
        "ASN/64500\n"  # Count duplicate entries only once.
        "IP-CIDR/97.64.18.11/32\n"
        "IP-CIDR/2001:db8::/64\n",
        encoding="utf-8",
    )
    # Since 2026-10-12, the crawler list uses standard robots.txt instead of the custom crawlers.txt:
    # explicit User-agent entries, excluding `*`, form the gate allowlist.
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
    # Crawler entries sent to the isolate include only explicit User-agent values (excluding `*`), all lowercased.
    assert (
        'export const GATE_TRUST_CRAWLER_UAS: readonly string[] = '
        '["gptbot", "claudebot", "screaming frog seo spider"];'
    ) in emitted
    assert '"*"' not in emitted
    # Keep ASN counts in the stdout summary for auditing, but omit them from the isolate.
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
    """Preserve the order and case from robots.txt, except for `*`; generated copies are lowercase."""
    agents = check_gate_trust.load_crawler_agents(check_gate_trust.ROBOTS_PATH)

    assert agents == ["GPTBot", "ClaudeBot", "Screaming Frog SEO Spider"]


def test_robots_agents_reject_bad_input(tmp_path):
    """Reject malformed crawler allowlist input; a broken gate-trust list must fail the build."""
    cases = {
        # A `*` group means everyone; using it as an allowlist would disable the gate.
        "star-only": "User-agent: *\nAllow: /\n",
        # No User-agent lines at all.
        "no-agents": "Allow: /\nDisallow: /api/\n",
        # Duplicate entries are case-insensitive.
        "duplicate": "User-agent: GPTBot\nUser-agent: gptbot\n",
        # Fragment is too short or contains invalid characters.
        "too-short": "User-agent: ai\n",
        "bad-chars": 'User-agent: GPT"Bot\n',
    }
    for name, body in cases.items():
        path = tmp_path / f"{name}.txt"
        path.write_text(body, encoding="utf-8")
        with pytest.raises(RuntimeError, match="robots|agent"):
            check_gate_trust.load_crawler_agents(path)


def test_readme_facts_counts_asns_from_whitelist(monkeypatch, tmp_path):
    """Read README ASN counts from docs/lists/whitelist.txt instead of using a regex on generated output."""
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

    # Count unique ASNs (entries 1 and 2); CIDRs and crawler UAs come from generated output.
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
        # Count zero when generated output contains no crawler UA entries; this is not a parse failure.
        "crawler_uas": 0,
    }


def test_repo_whitelist_and_generated_file_agree():
    """In the real repository, generated output matches the whitelist and crawler counts from robots.txt.

    Do not hard-code the exact ASN count (changed 2026-10-11). It is determined by
    manual entries in own-ips.txt; this test protects consistency between the source
    list and generated output.
    """
    asns, networks = check_gate_trust.load_whitelist(check_gate_trust.WHITELIST_PATH)
    agents = check_gate_trust.load_crawler_agents(check_gate_trust.ROBOTS_PATH)
    # The ASN section **may be empty** (ASN allowlisting was disabled by default on 2026-10-11), so do not require entries.
    # Enforce that the loader matches the source list by requiring the counts to be equal.
    assert len(networks) == 2, "两个固定 IP 仍应在名单里（own-ips.txt）"
    assert len(agents) > 20, "robots.txt 里的显式爬虫不该被清空"

    emitted = check_gate_trust.OUTPUT_PATH.read_text(encoding="utf-8")
    assert "asns" not in emitted

    facts = readme_facts.gate_trust_facts()
    assert facts["asns"] == len(asns)
    assert facts["ip_cidrs"] == len(networks)
    assert facts["crawler_uas"] == len(agents)
