# Limooo - shared IP/CIDR normalization and matching utilities
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

"""Canonical IP/CIDR normalization implementation for the former VPS side.

The Pages Functions counterpart is ``functions/_lib/cidr.ts``; function names and
semantics are kept consistent between the two implementations. All CIDRs written
to the database must pass through this module and use the ``<network>/<prefix>`` form:

* IPv4: ``1.2.3.4/32``, ``1.2.3.0/24``
* IPv6: ``2001:db8::1/128``, ``2001:db8::/64``
"""

from __future__ import annotations

import ipaddress
import re


def normalize_ip(value: str) -> str | None:
    """Convert one IP address to its canonical string, or return ``None`` if invalid."""
    try:
        return ipaddress.ip_address(value.strip()).compressed
    except ValueError:
        return None


def parse_cidr(value: str) -> tuple[str, int] | None:
    """Parse a CIDR or bare IP and return ``(network_address, prefixlen)``.

    * ``1.2.3`` is treated as ``1.2.3.0/24`` (legacy auto_block format).
    * ``1.2.3.4`` is treated as ``1.2.3.4/32``.
    * ``2001:db8::1`` is treated as ``2001:db8::1/128``.
    * A trailing ``#`` comment is ignored.
    """
    raw = re.sub(r"#.*$", "", value).strip()
    if not raw:
        return None
    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){2}", raw):
        raw = f"{raw}.0/24"
    try:
        network = ipaddress.ip_network(raw, strict=False)
    except ValueError:
        return None
    return str(network.network_address), network.prefixlen


def normalize_cidr(value: str) -> str | None:
    """Normalize a valid CIDR or bare IP to ``<network>/<prefix>``."""
    parsed = parse_cidr(value)
    if parsed is None:
        return None
    return f"{parsed[0]}/{parsed[1]}"


def network_address(ip: str, prefix: int) -> str | None:
    """Return the canonical network address for an IP and prefix length."""
    try:
        address = ipaddress.ip_address(ip.strip())
    except ValueError:
        return None
    if prefix < 0 or prefix > address.max_prefixlen:
        return None
    return str(
        ipaddress.ip_network(f"{address}/{prefix}", strict=False).network_address
    )


def cidr_contains(cidr: str, ip: str) -> bool:
    """Check whether an IP belongs to a CIDR; return False if either input is invalid."""
    try:
        network = ipaddress.ip_network(cidr, strict=False)
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return address in network
