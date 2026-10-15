#!/usr/bin/env bash

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

# Push the trusted ASNs from docs/lists/whitelist.txt to Cloudflare as zone-level
# IP Access Rules (`mode=whitelist`, `target=asn`), so the list actually does
# something at the edge.
#
# Why IP Access Rules and not a WAF custom rule:
#   * the free plan allows only 5 custom rules, while IP Access Rules allow 50,000
#     and consume none of that quota (tasks/17 section 10 already established this);
#   * an Access Rule with `mode=whitelist` makes Cloudflare bypass its security
#     features (including the challenge tier) for matching traffic, which is exactly
#     the behavior this explicit manual rule controls.
# The zone already used this mechanism for a single trusted IP
# (`97.64.18.11`), so this is the same thing at ASN granularity.
#
# Scope discipline (important): this script **only** ever creates/updates/deletes
# rules whose `configuration.target` is `asn`. IP rules someone added by hand in the
# dashboard are never touched, and rules it did not create are only removed when
# they are ASN rules no longer present in the whitelist.
#
# Usage:
#   bash ops/waf_whitelist.sh --dry-run    # offline plan from the local list (default)
#   bash ops/waf_whitelist.sh --show       # live: what ASN rules exist right now
#   bash ops/waf_whitelist.sh --apply      # live: make the zone match the list
#
# Credentials: CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID from the environment, else
# from the local secrets/webauthn.env (never echoed, never written to disk).

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="${SECRETS_FILE:-$ROOT/secrets/webauthn.env}"
ZONE_ID="${CLOUDFLARE_ZONE_ID:-9fae48942c655fd03a4a483b4866c1c3}"
WHITELIST="$ROOT/docs/lists/whitelist.txt"
API="https://api.cloudflare.com/client/v4"
NOTES="limooo: trusted ASN (managed by ops/waf_whitelist.sh from docs/lists/whitelist.txt)"

MODE=dry-run
case "${1:-}" in
    --dry-run|"") MODE=dry-run ;;
    --show) MODE=show ;;
    --apply) MODE=apply ;;
    --zone=*) ZONE_ID="${1#--zone=}"; MODE=dry-run ;;
    -h|--help) sed -n '/^# Usage:/,/^$/p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
esac

if [ ! -f "$WHITELIST" ]; then
    echo "FATAL: whitelist not found: $WHITELIST" >&2
    exit 1
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$SECRETS_FILE" ]; then
    CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS_FILE" | tail -1)"
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "FATAL: CLOUDFLARE_API_TOKEN not set and not found in $SECRETS_FILE" >&2
    exit 1
fi
export CLOUDFLARE_API_TOKEN ZONE_ID WHITELIST API NOTES MODE

# Python's macOS framework build does not always install a default CA bundle.
# urllib honors SSL_CERT_FILE, so use certifi when available and common OpenSSL
# bundle paths as a fallback. Respect an explicit caller override.
if [ -z "${SSL_CERT_FILE:-}" ]; then
    PYTHON_CA_BUNDLE="$(python3 -c 'import certifi; print(certifi.where())' 2>/dev/null || true)"
    if [ -n "$PYTHON_CA_BUNDLE" ] && [ -f "$PYTHON_CA_BUNDLE" ]; then
        export SSL_CERT_FILE="$PYTHON_CA_BUNDLE"
    else
        for PYTHON_CA_BUNDLE in /etc/ssl/cert.pem /opt/homebrew/etc/openssl@3/cert.pem /usr/local/etc/openssl@3/cert.pem; do
            if [ -f "$PYTHON_CA_BUNDLE" ]; then
                export SSL_CERT_FILE="$PYTHON_CA_BUNDLE"
                break
            fi
        done
    fi
fi

python3 - <<'PY'
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

API = os.environ["API"]
ZONE = os.environ["ZONE_ID"]
NOTES = os.environ["NOTES"]
MODE = os.environ["MODE"]
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
WHITELIST = os.environ["WHITELIST"]

RULES_URL = f"{API}/zones/{ZONE}/firewall/access_rules/rules"

# 每页条数（2026-10-11）：默认 100 条时响应约 40 KB，实测会被中途截断
# （`IncompleteRead` / 半截 JSON）。25 条约 7.5 KB，稳定，即使规则较多也只需
# 合理数量的请求。
PER_PAGE = 25


def read_full(resp) -> bytes:
    """读满响应体。

    2026-10-11 的两轮教训：
      1. 早期版本直接 `json.load(r)`，偶发 `IncompleteRead`；
      2. 改成"按 Content-Length 读满、把 partial 留下"只治了症 —— 分页响应真的
         传不完时，留下半截 JSON 反而让解析报 `Unterminated string`，比直接失败
         更难查。
    所以这里**让异常照常抛出**（不管 Content-Length 还是 chunked），交给 `call()`
    重试；根因（页太大）由 `PER_PAGE` 解决。
    """
    return resp.read()


def call(method: str, url: str, body=None, attempts: int = 12) -> dict:
    """调 API，对**传输层抖动**重试。

    2026-10-11 实测：这个端点会间歇性 `IncompleteRead(0 bytes read)`（13 页里
    通常 2~5 页需要重试，极少一次就全过）。重试不是权宜之计而是必需 ——
    实测 12 次上限下 13 页全部成功。HTTP 状态错误（4xx/5xx）不重试：那些是
    确定性的，重试只会浪费时间（唯一例外见下方 apply 对 duplicate 的处理）。
    """
    data = json.dumps(body).encode() if body is not None else None
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(read_full(r))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except Exception as exc:  # noqa: BLE001
            # 传输层问题（IncompleteRead / 半截 JSON / 超时）：退避后重来。
            last = exc
            if attempt < attempts:
                time.sleep(min(0.2 * attempt, 2.0))
                continue
    raise RuntimeError(f"{type(last).__name__}: {last}") from last


def desired_asns() -> list[str]:
    """白名单里的 ASN，规范化成 Cloudflare 认的 `AS<number>` 形式。"""
    out = []
    with open(WHITELIST, encoding="utf-8") as f:
        for raw in f:
            m = re.match(r"^\s*ASN/(\d{1,10})\s*(?:#.*)?$", raw, re.I)
            if m:
                out.append(f"AS{int(m.group(1))}")
    return sorted(set(out))


def current_asn_rules() -> dict[str, dict]:
    """拉本 zone 全部 Access Rules 的**第一页之后所有页**，只留下 target=asn 的。"""
    found: dict[str, dict] = {}
    page = 1
    while True:
        resp = call("GET", f"{RULES_URL}?per_page={PER_PAGE}&page={page}")
        if not resp.get("success"):
            raise RuntimeError(f"list failed: {resp.get('errors')}")
        rows = resp.get("result") or []
        for r in rows:
            cfg = r.get("configuration") or {}
            if str(cfg.get("target", "")).lower() == "asn":
                found[str(cfg.get("value"))] = r
        info = resp.get("result_info") or {}
        if page >= int(info.get("total_pages") or 1):
            break
        page += 1
    return found


want = desired_asns()
have = {} if MODE == "dry-run" else current_asn_rules()

if MODE == "dry-run" and not have:
    # 离线计划：不知道线上有什么，所以只报告"想推什么"。
    print(f"waf_whitelist: DRY-RUN (offline plan)")
    print(f"  desired : {len(want)} ASN rules from docs/lists/whitelist.txt")
    print(f"  sample  : {', '.join(want[:5])} …")
    print("  run with --show to see the live rules, --apply to converge")
    sys.exit(0)

if MODE == "show":
    print(f"waf_whitelist: live ASN rules on zone {ZONE[:8]}… = {len(have)}")
    for value in sorted(have):
        r = have[value]
        print(f"  {value:<10} mode={r.get('mode')} id={r.get('id')}")
    print(f"  whitelist wants {len(want)} -> "
          f"to add {len([a for a in want if a not in have])}, "
          f"to remove {len([a for a in have if a not in want])}")
    sys.exit(0)

to_add = [a for a in want if a not in have]
to_remove = [a for a in have if a not in want]

# 大规模删除保护（2026-10-11 加）：这个脚本会删 zone 上它管的 ASN 规则。
# 一次删掉几十条属于安全面的重大变更，值得让人再确认一次；要批量清理就显式设
# LIMOOO_WAF_ALLOW_BULK_REMOVE=1。
BULK_REMOVE_LIMIT = 50
if len(to_remove) > BULK_REMOVE_LIMIT and os.environ.get("LIMOOO_WAF_ALLOW_BULK_REMOVE") != "1":
    print(
        f"REFUSING to remove {len(to_remove)} ASN rules in one run "
        f"(limit {BULK_REMOVE_LIMIT}).\n"
        f"  The whitelist now yields {len(want)} ASN. If that is intentional, re-run with\n"
        f"  LIMOOO_WAF_ALLOW_BULK_REMOVE=1 bash ops/waf_whitelist.sh --apply",
        file=sys.stderr,
    )
    sys.exit(2)

print(f"waf_whitelist: apply (zone {ZONE[:8]}…)")
print(f"  will add    : {len(to_add)}")
print(f"  will remove : {len(to_remove)}")
if not to_add and not to_remove:
    print("  already converged; nothing to do")
    sys.exit(0)

# 先删后加：删掉的是"名单里已经没有的 ASN"，加的是新 ASN，互不重叠。
# 逐条容错：单条失败不能中断整批。
# 2026-10-11 实测教训：手工在 dashboard 建过同一条 ASN 时，POST 会返回
# `10009 duplicate_of_existing`；原来没接住这个异常，脚本在第 2 条就整体崩了，
# 留下"加了一半"的中间态。现在每一轮独立处理，最后汇总失败清单。
removed = failed_remove = 0
for value in sorted(to_remove):
    try:
        call("DELETE", f"{RULES_URL}/{have[value]['id']}")
        removed += 1
    except RuntimeError as exc:
        failed_remove += 1
        print(f"  FAILED to remove {value}: {exc}", file=sys.stderr)

added = already = failed_add = 0
for asn in to_add:
    try:
        call("POST", RULES_URL, {
            "mode": "whitelist",
            "configuration": {"target": "asn", "value": asn},
            "notes": NOTES,
        })
        added += 1
    except RuntimeError as exc:
        # 已存在（多半是人工建过同一条）按"已达成目标"处理，不算失败。
        if "duplicate_of_existing" in str(exc):
            already += 1
            continue
        failed_add += 1
        print(f"  FAILED to add {asn}: {exc}", file=sys.stderr)

print(f"  done: +{added} (already present {already}) -{removed}")
if failed_add or failed_remove:
    print(f"  FAILURES: add={failed_add} remove={failed_remove}", file=sys.stderr)
    sys.exit(1)
print(f"  zone now has {len(want)} managed ASN rules")
PY
