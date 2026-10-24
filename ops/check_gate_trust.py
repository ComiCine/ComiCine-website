#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Generate gate trust configuration from whitelist.txt, robots.txt, and config-contract.json (tasks/14).

Output:
  - Validate both ASN and IP-CIDR whitelist entries.
  - With `--emit`, generate functions/_data/gateTrust.ts containing only runtime values actually
    consumed: verified_bot, ua_allowlist_enabled, ip_cidrs, and crawler UAs parsed from robots.txt.
    ASNs are input to the WAF and are not sent to the isolate (see W4-4).
  - Include ASN and crawler-UA counts in the stdout --json summary for audits and README checks.
  - Read no secrets.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "config-contract.json"
# The allowlist lives in docs/lists/ alongside the blocklist for easier manual maintenance.
# ops/sync_whitelist.py refreshes the generated whitelist.txt from own-ips.txt.
# See docs/lists/README.md.
WHITELIST_PATH = ROOT / "docs" / "lists" / "whitelist.txt"
# robots.txt has been the **only** crawler-list source since 2026-10-12. It also supplies the live
# https://limooo.cn/robots.txt rules (the builder adds the Sitemap line), and this module extracts
# each explicit User-agent as a gate allowlist entry. See docs/lists/README.md for the semantics.
ROBOTS_PATH = ROOT / "docs" / "lists" / "robots.txt"
OUTPUT_PATH = ROOT / "functions" / "_data" / "gateTrust.ts"

ASN_RE = re.compile(r"^ASN/(\d{1,10})$", re.I)
IP_CIDR_RE = re.compile(
    r"^IP-CIDR/([0-9A-Fa-f:.]+)/(\d{1,3})$",
    re.I,
)
# IP-CIDR entries bypass both the gate and application-level blocking, so limit them to common single-egress network ranges.
ASN_MIN = 1
ASN_MAX = 4_294_967_295
MIN_CIDR_PREFIX = {4: 24, 6: 64}

# A robots.txt User-agent line looks like `User-agent: GPTBot`; matching is case-insensitive and whitespace after the colon is allowed.
ROBOTS_USER_AGENT_RE = re.compile(r"^\s*user-agent\s*:\s*(.+?)\s*$", re.I)

# Allowed UA fragment characters: product names, version numbers, and vendor URL fragments (for example, "Slack-ImgProxy").
# Restrict the character set so quotes, backslashes, and newlines cannot break generated TypeScript literals.
CRAWLER_TOKEN_RE = re.compile(r"^[A-Za-z0-9 ._/+\-()@:]+$")
# Reject fragments that are too short because they match too broadly (`bo` or `ai` would match almost everything).
MIN_CRAWLER_TOKEN_LENGTH = 3

# AGPL header for generated files (tasks/22 W8-7). Its wording matches the headers in handwritten files such as src/config.py,
# with only the comment syntax changed to a TypeScript block comment. src/build.py has a copy used for
# functions/_lib/config.ts and functions/_data/*.ts;
# update both locations.
LICENSE_HEADER_TS = """\
/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */
"""


def parse_whitelist(lines: list[str]) -> tuple[list[int], list[tuple[str, int]]]:
    """Parse and validate whitelist entries before emitting any runtime data."""
    asns: list[int] = []
    networks: list[tuple[str, int]] = []
    for raw in lines:
        line = re.sub(r"#.*$", "", raw).strip()
        if not line:
            continue
        asn = ASN_RE.match(line)
        if asn:
            number = int(asn.group(1))
            if not ASN_MIN <= number <= ASN_MAX:
                raise RuntimeError(f"invalid ASN: {line}")
            asns.append(number)
            continue
        cidr = IP_CIDR_RE.match(line)
        if cidr:
            prefix = int(cidr.group(2))
            try:
                network = ipaddress.ip_network(
                    f"{cidr.group(1)}/{prefix}", strict=False
                )
            except ValueError as exc:
                raise RuntimeError(f"invalid IP-CIDR entry: {line}") from exc
            minimum = MIN_CIDR_PREFIX[network.version]
            if network.prefixlen < minimum:
                raise RuntimeError(
                    f"CIDR is too broad: {line}; minimum prefix is /{minimum}"
                )
            networks.append((network.network_address.compressed, network.prefixlen))
            continue
        raise RuntimeError(f"cannot parse whitelist line: {line}")

    return sorted(set(asns)), networks


def load_whitelist(path: Path) -> tuple[list[int], list[tuple[str, int]]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RuntimeError(f"cannot read whitelist {path}: {exc}") from exc
    return parse_whitelist(lines)


def load_crawler_agents(path: Path) -> list[str]:
    """Parse explicit `User-agent:` entries from robots.txt, excluding `*`.

    Preserve original case and file order in the returned list (the generator lowercases values).
    Matching uses first match wins, so group order matters and must not be sorted.

    Read only `User-agent:` lines. The `*` group means everyone and cannot be an allowlist entry,
    because that would disable the gate. Ignore `Allow`, `Disallow`, and comments. Raise an error for
    invalid characters, short fragments, duplicates, or no explicit entries; a broken gate allowlist
    is more serious than a failed build.
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RuntimeError(f"cannot read robots.txt {path}: {exc}") from exc

    agents: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        # Strip trailing comments too: everything after `#` in robots.txt is a comment. Repository files do not currently use
        # trailing comments, but stripping them avoids surprises if someone adds one.
        line = re.sub(r"#.*$", "", raw).strip()
        if not line:
            continue
        match = ROBOTS_USER_AGENT_RE.match(line)
        if not match:
            continue
        agent = match.group(1)
        if agent == "*":
            continue
        if len(agent) < MIN_CRAWLER_TOKEN_LENGTH:
            raise RuntimeError(f"crawler agent too short: {agent!r}")
        if not CRAWLER_TOKEN_RE.match(agent):
            raise RuntimeError(f"crawler agent has unsupported characters: {agent!r}")
        key = agent.lower()
        if key in seen:
            raise RuntimeError(f"duplicate crawler agent: {agent}")
        seen.add(key)
        agents.append(agent)
    if not agents:
        raise RuntimeError(
            f"{path} lists no explicit User-agent: the gate allow-list would be empty"
        )
    return agents


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit", action="store_true", help="write gateTrust.ts")
    args = parser.parse_args()

    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    gate_trust = contract.get("gate_trust", {})
    # Continue parsing and validating ASNs because WAF Access Rules are generated from the ASN entries in
    # docs/lists/whitelist.txt. Runtime code in functions/_middleware.ts reads only verified_bot and
    # ip_cidrs, so the runtime payload omits ASNs.
    # Sending them to the isolate would be dead data; WAF is the actual consumer (W4-4).
    asns, networks = load_whitelist(WHITELIST_PATH)
    crawlers = load_crawler_agents(ROBOTS_PATH)

    payload = {
        "verified_bot": gate_trust.get("verified_bot", True),
        "ua_allowlist_enabled": gate_trust.get("ua_allowlist_enabled", False),
        "ip_cidrs": networks,
    }

    if args.emit:
        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        ts = (
            LICENSE_HEADER_TS
            + "\n// Generated by ops/check_gate_trust.py from docs/lists/whitelist.txt"
            + " and docs/lists/robots.txt; do not edit by hand.\n"
            f"export const GATE_TRUST = {json.dumps(payload, ensure_ascii=False)} as const;\n"
            f"export const GATE_TRUST_IPS: Set<string> = new Set({json.dumps([ip for ip, _ in networks])});\n"
            f"export const GATE_TRUST_NETWORKS: [string, number][] = {json.dumps(networks)};\n"
            "\n// Crawler and AI allowlist from explicit User-agent entries in\n"
            "// docs/lists/robots.txt, excluding `*`. Values are lowercased and\n"
            "// matched as substrings; see functions/_lib/bots.ts for behavior and cost.\n"
            "export const GATE_TRUST_CRAWLER_UAS: readonly string[] = "
            f"{json.dumps([token.lower() for token in crawlers])};\n"
        )
        OUTPUT_PATH.write_text(ts, encoding="utf-8")

    print(
        json.dumps(
            {
                "ok": True,
                "verified_bot": payload["verified_bot"],
                "ua_allowlist_enabled": payload["ua_allowlist_enabled"],
                "asns": len(asns),
                "ip_cidrs": len(networks),
                "crawler_uas": len(crawlers),
                "emitted": str(OUTPUT_PATH) if args.emit else None,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
