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

"""tasks/14 门禁信任白名单解析测试。"""

from pathlib import Path

import pytest

from ops import check_gate_trust


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


def test_rejects_unknown_line(tmp_path: Path):
    path = tmp_path / "whitelist.txt"
    path.write_text("BOGUS/1\n", encoding="utf-8")
    with pytest.raises(RuntimeError):
        check_gate_trust.load_whitelist(path)
