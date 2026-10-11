#!/usr/bin/env python3

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

"""从 docs/lists/whitelist.txt 与 config-contract.json 生成门禁信任配置（tasks/14）。

输出：
  - 校验白名单格式（ASN 与 IP-CIDR 两段都校验）；
  - `--emit` 时生成 functions/_data/gateTrust.ts：只含运行时真正消费的
    verified_bot / ua_allowlist_enabled / ip_cidrs（ASN 是 WAF 的输入，不进
    isolate，见 W4-4），外加 docs/lists/crawlers.txt 的爬虫 UA 名单；
  - ASN 与爬虫 UA 计数仍出现在 stdout 的 --json 摘要里，供审计与 readme 核对；
  - 不读取任何密钥。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_PATH = ROOT / "config-contract.json"
# 白名单放在 docs/lists/（与封禁名单同目录，便于手工维护）；
# 生成物 china-asn.txt 由 ops/fetch_china_asn.py 刷新。见 docs/lists/README.md。
WHITELIST_PATH = ROOT / "docs" / "lists" / "whitelist.txt"
# 爬虫/AI UA 名单（2026-10-12）：手工维护，语义与前提见该文件头部注释。
CRAWLERS_PATH = ROOT / "docs" / "lists" / "crawlers.txt"
OUTPUT_PATH = ROOT / "functions" / "_data" / "gateTrust.ts"

ASN_RE = re.compile(r"^ASN/(\d{1,10})$", re.I)
IP_CIDR_RE = re.compile(
    r"^IP-CIDR/([0-9A-Fa-f:.]+)/(\d{1,3})$",
    re.I,
)

# UA 片段允许的字符：产品名 + 版本号 + 厂商 URL 片段（如 "Slack-ImgProxy"）。
# 收紧字符集是为了不让 `"` / `\` / 换行之类的东西进生成物（那会写坏 TS 字面量）。
CRAWLER_TOKEN_RE = re.compile(r"^[A-Za-z0-9 ._/+\-()@:]+$")
# 太短的片段会变成过宽的匹配（`bo`、`ai` 之类几乎命中一切），直接拒绝。
MIN_CRAWLER_TOKEN_LENGTH = 3

# 生成物顶部的 AGPL 头（tasks/22 W8-7）。措辞与 src/config.py 等手写文件里的
# 头逐字一致，只把注释符号换成 TS 的块注释；src/build.py 生成
# functions/_lib/config.ts 与 functions/_data/*.ts 时有一份同文副本，
# 改这里请一并改那边。
LICENSE_HEADER_TS = """\
/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
"""


def load_whitelist(path: Path) -> tuple[list[int], list[tuple[str, int]]]:
    asns: list[int] = []
    networks: list[tuple[str, int]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RuntimeError(f"cannot read whitelist {path}: {exc}") from exc

    for raw in lines:
        line = re.sub(r"#.*$", "", raw).strip()
        if not line:
            continue
        asn = ASN_RE.match(line)
        if asn:
            asns.append(int(asn.group(1)))
            continue
        cidr = IP_CIDR_RE.match(line)
        if cidr:
            prefix = int(cidr.group(2))
            if prefix < 0 or prefix > 128:
                raise RuntimeError(f"invalid CIDR prefix: {line}")
            networks.append((cidr.group(1), prefix))
            continue
        raise RuntimeError(f"cannot parse whitelist line: {line}")

    return sorted(set(asns)), networks


def load_crawlers(path: Path) -> list[str]:
    """读取爬虫 UA 名单：一行一个片段，去注释、去空行、去重（大小写不敏感）。

    返回**保留原大小写、保留文件顺序**的列表（生成时统一转小写）：匹配是
    「先命中先返回」，分组与排序对排查有意义，所以这里不排序。
    格式错（字符非法、片段过短、重复）直接抛错 —— 门禁名单写错比构建失败严重。
    """
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise RuntimeError(f"cannot read crawler list {path}: {exc}") from exc

    tokens: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = re.sub(r"#.*$", "", raw).strip()
        if not line:
            continue
        if len(line) < MIN_CRAWLER_TOKEN_LENGTH:
            raise RuntimeError(f"crawler token too short: {line!r}")
        if not CRAWLER_TOKEN_RE.match(line):
            raise RuntimeError(f"crawler token has unsupported characters: {line!r}")
        key = line.lower()
        if key in seen:
            raise RuntimeError(f"duplicate crawler token: {line}")
        seen.add(key)
        tokens.append(line)
    return tokens


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--emit", action="store_true", help="write gateTrust.ts")
    args = parser.parse_args()

    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    gate_trust = contract.get("gate_trust", {})
    # ASN 仍要解析、仍要校验格式：WAF 的 js_challenge 规则从 data/whitelist.txt
    # 的 ASN 段生成。但运行时（functions/_middleware.ts）只读 verified_bot /
    # ip_cidrs，所以下面的 runtime payload 不带 low_risk_asns —— 320 条 ASN
    # 打进 isolate 只是死数据，真实消费方是 WAF（W4-4）。
    asns, networks = load_whitelist(WHITELIST_PATH)
    crawlers = load_crawlers(CRAWLERS_PATH)

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
            + " and docs/lists/crawlers.txt; do not edit by hand.\n"
            f"export const GATE_TRUST = {json.dumps(payload, ensure_ascii=False)} as const;\n"
            f"export const GATE_TRUST_IPS: Set<string> = new Set({json.dumps([ip for ip, _ in networks])});\n"
            f"export const GATE_TRUST_NETWORKS: [string, number][] = {json.dumps(networks)};\n"
            "\n// 爬虫/AI UA 片段（已转小写，子串匹配；语义见 functions/_lib/bots.ts）。\n"
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
