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

"""从 GitHub 拉取中国大陆 ASN 名单，合并成本地白名单（docs/lists/）。

数据源：<https://github.com/xingpingcn/china-mainland-asn>（每日更新，按运营商分类）。
产出（都在 `docs/lists/`）：

    china-asn.txt    纯生成物：只含 `ASN/<编号>`，来自上面那个源
    whitelist.txt    生成物：china-asn.txt + own-ips.txt 合并（保留段头注释）
    own-ips.txt      手写文件：**本脚本只读不写**（你自己的固定 IP 放这里）

为什么不写进 `data/`：白名单与封禁名单都要人手工维护，放在一起才好找；
`data/` 里是运行期数据库与 GeoIP，混着放容易误改。

## 容错（重要）

`--strict` 时网络失败一律非 0 退出（供 CI 用）；**不带 `--strict` 时失败不阻断** ——
部署脚本按这个语义调用：源临时抽风不该让代码发不出去。失败时会打印原因，
而 `whitelist.txt` 保持上一次的内容（生成物入库，git 里有每次变化的记录）。

## 用法

    bash ops/fetch_china_asn.py             # 拉取并合并（失败只警告）
    bash ops/fetch_china_asn.py --strict    # 失败即非 0（CI / 手工复核用）
    bash ops/fetch_china_asn.py --check     # 只读：白名单是否与「当前源」一致
    bash ops/fetch_china_asn.py --json      # 机器可读摘要
"""

from __future__ import annotations

import argparse
import http.client
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTS_DIR = ROOT / "docs" / "lists"
ASN_CACHE = LISTS_DIR / "china-asn.txt"
WHITELIST = LISTS_DIR / "whitelist.txt"
OWN_IPS = LISTS_DIR / "own-ips.txt"

REPO = "xingpingcn/china-mainland-asn"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/asn_txt"

# 源的 6 个分类文件 → 中文标签（写进生成物的段头，便于人读）
GROUPS: tuple[tuple[str, str], ...] = (
    ("chinanet", "中国电信"),
    ("cmcc", "中国移动（含铁通）"),
    ("unicom", "中国联通"),
    ("cernet", "中国教育网 CERNET"),
    ("cstnet", "中国科技网 CSTNET"),
    ("other", "其它中国大陆 ASN"),
)

# 哪些 ASN 分组进白名单（即：在边缘放行 / 不挑战）。
#
# **当前为空**（用户 2026-10-11 决定）：只放行 own-ips.txt 里那两个 /32，不再按 ASN
# 放行任何运营商。原因见 docs/lists/README.md —— 上游没有「家宽 / 蜂窝」维度，
# 三家运营商名单里混着 IDC 与企业专线，按 ASN 全量放行的面太大。
#
# 想恢复按运营商放行：把 ("chinanet", "cmcc", "unicom") 填回来即可 —— 分组名见
# 下面的 GROUPS，上游数据仍会照常拉取并存进 china-asn.txt（存证，不参与放行）。
WHITELIST_GROUPS: tuple[str, ...] = ()

TIMEOUT_S = 30
ASN_ONLY = re.compile(r"^\d{1,10}$")


def _read_full(resp) -> bytes:
    """按 Content-Length 读满响应体。

    2026-10-11：上游偶尔在传输中途断连（`IncompleteRead(N, M more expected)`），
    直接 `resp.read()` 会抛异常让整次抓取失败。按声明长度循环读满，读不到就返回
    已获得的部分（外层还有重试）。
    """
    length = resp.headers.get("Content-Length")
    if not length:
        return resp.read()
    want = int(length)
    buf = bytearray()
    while len(buf) < want:
        chunk = resp.read(want - len(buf))
        if not chunk:
            break
        buf.extend(chunk)
    return bytes(buf)


def fetch_group(name: str, attempts: int = 3) -> list[int]:
    """取一个分类文件；源是「单行逗号分隔 + 首行 `// Updated date:` 注释」。

    传输被截断时重试（见 `_read_full`）；重试用完仍失败才抛给调用方。
    """
    url = f"{RAW}/{name}.txt"
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as resp:  # noqa: S310
                body = _read_full(resp).decode("utf-8", errors="replace")
            break
        except (http.client.IncompleteRead, TimeoutError, urllib.error.URLError) as exc:
            last = exc
            if attempt < attempts:
                time.sleep(0.5 * attempt)
                continue
            raise
    else:  # pragma: no cover - 循环里必然 break 或 raise
        raise last if last else RuntimeError("unreachable")
    out: list[int] = []
    for token in body.replace("\n", ",").split(","):
        token = token.strip()
        if ASN_ONLY.match(token):
            out.append(int(token))
    if not out:
        raise RuntimeError(f"{name}.txt yielded no ASN (source format changed?)")
    return out


def render_asn_file(per_group: dict[str, list[int]]) -> str:
    lines = [
        "# 中国大陆 ASN 名单（**生成物，不要手改**）",
        "#",
        f"# 来源：https://github.com/{REPO}（每日更新）",
        "# 由 ops/fetch_china_asn.py 生成；部署时自动刷新。",
        "# 要额外放行某个 ASN/IP，请改同目录的 own-ips.txt。",
        "#",
    ]
    seen: set[int] = set()
    for name, label in GROUPS:
        asns = per_group.get(name) or []
        fresh = [a for a in asns if a not in seen]
        seen.update(fresh)
        lines.append(f"# ── {label}（{len(fresh)} 个，含重复已去）" + "─" * 20)
        lines.extend(f"ASN/{a}" for a in sorted(fresh))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def manual_entries(path: Path) -> list[str]:
    """读 own-ips.txt 里真正的条目（剥注释、去空行），原样保留其写法。"""
    if not path.is_file():
        return []
    out: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = re.sub(r"#.*$", "", raw).strip()
        if line:
            out.append(line)
    return out


def render_whitelist(asns: list[int], manual: list[str]) -> str:
    """白名单正文：段头 + ASN 段 + 手工段，全部是 check_gate_trust.py 能解析的行。"""
    lines = [
        "# Limooo 白名单（**生成物，不要手改**）",
        "#",
        "# 由 ops/fetch_china_asn.py 合并而成，来源两份：",
        f"#   china-asn.txt  中国大陆 ASN {len(asns)} 个，取自 https://github.com/{REPO}（每日更新）",
        "#   own-ips.txt    你自己的固定 IP / 额外条目（**手工维护，改那个文件**）",
        "#",
        "# 格式：ASN/<编号> 或 IP-CIDR/<IP>/<掩码>；行尾 # 注释会被剥离。",
        "#",
        "# 注意：ASN 段当前**不参与运行时判定** —— functions/_data/gateTrust.ts 只带",
        "# verified_bot 与 ip_cidrs；ASN 的消费方是 WAF 的 js_challenge 规则（尚未启用）。",
        "# 详见 docs/lists/README.md。",
        "",
        f"# ── 中国大陆 ASN（{len(asns)} 个）" + "─" * 24,
        *(f"ASN/{a}" for a in sorted(set(asns))),
        "",
        "# ── 手工条目（来自 own-ips.txt）" + "─" * 22,
        *manual,
    ]
    return "\n".join(lines).rstrip() + "\n"


def parse_asn_file(path: Path) -> list[int]:
    """从生成物里取回 ASN（用于 --check 与合并）。"""
    if not path.is_file():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^ASN/(\d{1,10})$", raw.strip(), re.I)
        if m:
            out.append(int(m.group(1)))
    return out


def write_whitelist(asns: list[int], manual: list[str]) -> str:
    """真正的白名单：ASN 段 + 手工段，都是可被 check_gate_trust.py 解析的行。"""
    lines = [
        render_whitelist({}, manual).split("# ── 中国大陆 ASN")[0].rstrip(),
        "",
        f"# ── 中国大陆 ASN（{len(asns)} 个，来自 china-asn.txt）" + "─" * 16,
        *(f"ASN/{a}" for a in sorted(set(asns))),
        "",
        "# ── 手工条目（来自 own-ips.txt）" + "─" * 20,
        *manual,
    ]
    return "\n".join(lines).rstrip() + "\n"


def _display(path: Path) -> str:
    """能算相对路径就相对，否则原样返回（测试在 tmp_path 下跑时会走到后者）。"""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the mainland-China ASN whitelist.")
    parser.add_argument("--strict", action="store_true", help="exit non-zero when the source is unreachable")
    parser.add_argument("--check", action="store_true", help="read-only: is the whitelist current?")
    parser.add_argument("--json", action="store_true", help="machine-readable summary")
    args = parser.parse_args()

    per_group: dict[str, list[int]] = {}
    errors: list[str] = []
    for name, _label in GROUPS:
        try:
            per_group[name] = fetch_group(name)
        except (urllib.error.URLError, OSError, RuntimeError, TimeoutError) as exc:
            errors.append(f"{name}: {exc}")

    manual = manual_entries(OWN_IPS)

    if errors:
        detail = "; ".join(errors)
        if args.check:
            print(f"fetch_china_asn: cannot verify (source unreachable): {detail}", file=sys.stderr)
            return 2
        if args.strict:
            print(f"fetch_china_asn: FAIL {detail}", file=sys.stderr)
            return 1
        # 非 strict：保留上一次的白名单，只警告 —— 源临时抽风不该挡住部署。
        print(f"fetch_china_asn: WARN source unreachable, keeping the existing whitelist: {detail}", file=sys.stderr)
        if args.json:
            print(json.dumps({"ok": False, "errors": errors, "kept": True}, ensure_ascii=False))
        return 0

    # china-asn.txt 存**全部**分组（存证用）；白名单只用 WHITELIST_GROUPS。
    all_asns = sorted({a for asns in per_group.values() for a in asns})
    white_asns = sorted({a for g in WHITELIST_GROUPS for a in per_group.get(g, [])})
    current = sorted(set(parse_asn_file(ASN_CACHE)))

    if args.check:
        same = current == white_asns
        print(
            f"fetch_china_asn: {'OK' if same else 'STALE'} "
            f"whitelist={len(white_asns)} local={len(current)} (all groups={len(all_asns)})"
        )
        return 0 if same else 1

    LISTS_DIR.mkdir(parents=True, exist_ok=True)
    ASN_CACHE.write_text(render_asn_file(per_group), encoding="utf-8")
    WHITELIST.write_text(render_whitelist(white_asns, manual), encoding="utf-8")

    counts = {name: len(per_group[name]) for name, _ in GROUPS}
    summary = {
        "ok": True,
        "source": f"https://github.com/{REPO}",
        "asns": len(white_asns),
        "asns_all_groups": len(all_asns),
        "whitelist_groups": list(WHITELIST_GROUPS),
        "by_group": counts,
        "manual_entries": len(manual),
        "changed": current != white_asns,
        # 相对路径只为好看；--json 也可能在别处调用（测试用 tmp_path），
        # 那种情况下 relative_to 会抛异常，所以退化成绝对路径。
        "wrote": [_display(ASN_CACHE), _display(WHITELIST)],
    }
    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(
            f"fetch_china_asn: whitelist {len(white_asns)} ASN (from {'/'.join(WHITELIST_GROUPS)}) "
            f"+ {len(manual)} manual -> docs/lists/whitelist.txt"
        )
        print(f"  china-asn.txt keeps all groups: {len(all_asns)} ASN (evidence, not trusted wholesale)")
        for name, label in GROUPS:
            print(f"  {label:<20} {counts[name]:>5}")
        if summary["changed"]:
            print(f"  whitelist ASN set changed (was {len(current)}, now {len(white_asns)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
