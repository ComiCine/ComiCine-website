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

"""Task 14: Tests for gate trust whitelist parsing."""

from pathlib import Path

import pytest

from ops import check_gate_trust, sync_whitelist


def test_load_whitelist(tmp_path: Path):
    path = tmp_path / "whitelist.txt"
    path.write_text(
        "# comment\n"
        "ASN/64500\n"
        "ASN/64501\n"
        "IP-CIDR/97.64.18.11/32\n"
        "IP-CIDR/2001:db8::/64\n",
        encoding="utf-8",
    )
    asns, networks = check_gate_trust.load_whitelist(path)
    assert asns == [64500, 64501]
    assert networks == [("97.64.18.11", 32), ("2001:db8::", 64)]


def test_normalizes_valid_networks_and_accepts_policy_boundaries():
    asns, networks = check_gate_trust.parse_whitelist(
        [
            "ASN/1",
            "ASN/4294967295",
            "IP-CIDR/198.51.100.27/24",
            "IP-CIDR/2001:db8:1::1/64",
            "IP-CIDR/2001:db8::1/128",
        ]
    )

    assert asns == [1, 4294967295]
    assert networks == [
        ("198.51.100.0", 24),
        ("2001:db8:1::", 64),
        ("2001:db8::1", 128),
    ]


@pytest.mark.parametrize(
    "entry",
    [
        "ASN/0",
        "ASN/4294967296",
        "IP-CIDR/not-an-ip/32",
        "IP-CIDR/97.64.18.11/33",
        "IP-CIDR/97.64.18.0/23",
        "IP-CIDR/0.0.0.0/0",
        "IP-CIDR/2001:db8::/63",
        "IP-CIDR/2001:db8::/129",
    ],
)
def test_rejects_invalid_or_overbroad_entries(entry: str):
    with pytest.raises(RuntimeError):
        check_gate_trust.parse_whitelist([entry])


def test_rejects_unknown_line(tmp_path: Path):
    path = tmp_path / "whitelist.txt"
    path.write_text("BOGUS/1\n", encoding="utf-8")
    with pytest.raises(RuntimeError):
        check_gate_trust.load_whitelist(path)


def test_sync_source_validation_prevents_overwriting_generated_list(
    tmp_path: Path, monkeypatch, capsys
):
    source = tmp_path / "own-ips.txt"
    target = tmp_path / "whitelist.txt"
    source.write_text("IP-CIDR/0.0.0.0/0\n", encoding="utf-8")
    target.write_text("keep existing output\n", encoding="utf-8")
    monkeypatch.setattr(sync_whitelist, "OWN_IPS", source)
    monkeypatch.setattr(sync_whitelist, "WHITELIST", target)

    assert sync_whitelist.main() == 1
    assert target.read_text(encoding="utf-8") == "keep existing output\n"
    assert "CIDR is too broad" in capsys.readouterr().err
