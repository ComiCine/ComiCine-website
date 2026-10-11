#!/usr/bin/env python3

# Limooo - Flask Web Application
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

"""
Blocklist sync script: reconcile the local blocklist snapshot with D1
`blocked_ips` (the single source of truth).

历史上这里还负责扫描 VPS 上的 Nginx access.log 来自动生成封禁网段；Nginx 随
`2026-09-17` 退租一并消失，扫描部分（`LOG_PATTERN` / `SCAN_PATTERNS` /
`_is_scan_path` / `collect_logs` / `analyze` / `run_scan`）已删除。现在的日志
来源只有 Cloudflare 边缘（`ray_log_v2` 等），封禁判定在 Pages / Worker 侧。

权威链路：D1 `blocked_ips` -> 每日 sync-worker -> Cloudflare IP List。
`blocklist.txt` 是本地导入种子/可审计快照；CF List 只有在显式维护命令
`auto_block.py cf` 才直接同步，默认运行路径不会写 Cloudflare。

Usage:
    python3 auto_block.py d1 [--dry-run]  # sync blocklist.txt to D1 (full diff)
    python3 auto_block.py cf              # maintenance: sync blocklist.txt to CF only
    python3 auto_block.py sync [--dry-run]  # alias of `d1` (不再直写 CF)
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from cidr import normalize_cidr, parse_cidr

# 仓库根目录（本文件位于 src/ 下，向上取一层）。
# 带 as 的常量各自独立成一条 import——ruff isort 就是这么切别名导入的
# （按配置里的原名排序），合并回一条会被 I001 判红。
from config import (
    BLOCKLIST_FILE as BLOCKLIST_TXT,
)
from config import (
    CF_BATCH_SIZE as BATCH,
)
from config import (
    CF_LIST_NAME as LIST_NAME,
)
from config import (
    CLOUDFLARE_API_BASE as API,
)
from config import (
    D1_DATABASE_ID,
    ENV_FILE,
)

# Match x.x.x.0/24
CIDR24_RE = re.compile(r'^(\d+\.\d+\.\d+)\.0/24$')

# 受管段的起始标记（2026-10-11）：`reconcile` 从 D1 拉回的行写在这一行之后，
# 每次整体重写；这一行之前是**手写区**，永远原样保留。
MANAGED_MARKER = "# ── 以下是 D1 blocked_ips 的活跃行"


def read_blocklist_txt(path: str) -> tuple[list[str], set[str]]:
    """
    Read blocklist.txt, return:
    - static lines (comments + non-/24 manual entries)
    - existing /24 prefix set (stripped of .0/24 suffix)
    """
    static_lines: list[str] = []
    existing_prefixes: set[str] = set()

    try:
        with open(path) as f:
            for line in f:
                stripped = line.rstrip("\n")
                if stripped.startswith("#") or not stripped.strip():
                    static_lines.append(stripped)
                    continue
                m = CIDR24_RE.match(stripped)
                if m:
                    existing_prefixes.add(m.group(1))
                else:
                    static_lines.append(stripped)
    except FileNotFoundError:
        pass

    return static_lines, existing_prefixes


# ── Cloudflare IP List 同步（原 sync_blocklist_cf.py） ──
# 读 webauthn.env 里的 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，
# 不存在则跳过。使用纯标准库(urllib)。
def load_env(path: str) -> dict:
    env = {}
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return env


def read_blocklist(path: str) -> list[str]:
    """读取 blocklist.txt 并返回规范化后的 CIDR 列表（无效行/注释忽略）。"""
    entries = []
    try:
        with open(path) as f:
            for line in f:
                cidr = normalize_cidr(line)
                if cidr and cidr not in entries:
                    entries.append(cidr)
    except FileNotFoundError:
        print("[!] blocklist.txt not found", file=sys.stderr)
    return entries


def _ensure_ca_bundle() -> None:
    """确保 HTTPS 有 CA 证书可用（2026-10-11）。

    本仓库的构建 venv（`.venv-build`，python.org 的 3.14）**不带 CA 证书**：
    `ssl.get_default_verify_paths()` 的 `cafile` 是 None，它期望的
    `/Library/Frameworks/Python.framework/Versions/3.14/etc/openssl/cert.pem`
    不存在 —— 于是所有 HTTPS 调用报 `CERTIFICATE_VERIFY_FAILED`，这个脚本因此
    读不到 D1。macOS 自带的 `/etc/ssl/cert.pem` 是完整的系统根证书库，指过去即可。

    尊重调用方已经设好的 `SSL_CERT_FILE`（CI 或系统 python3 会自己配）。
    """
    system_ca = "/etc/ssl/cert.pem"
    if not os.environ.get("SSL_CERT_FILE") and os.path.exists(system_ca):
        os.environ["SSL_CERT_FILE"] = system_ca


def _read_body(resp) -> bytes:
    """读满响应体；**读不完整就抛**，让上层重试。

    2026-10-11 的两轮教训：
      1. 最早直接 `json.load(r)`：偶发 `IncompleteRead` 直接失败；
      2. 后来改成"把 partial 留下、不抛"：那是**治症** —— 半截 JSON 交给解析器会
         报 `Expecting property name …` / `Unterminated string`，错误更难查，
         而且**重试逻辑完全没机会介入**（异常被吞了）。
    正确做法：异常照抛，交给 `_call` 的重试；响应过大的**根因**由窄查询 + 分页解决
    （见 `_d1_query_paged`，D1 的 8191 字节上限）。
    """
    return resp.read()


def _call(token: str, method: str, url: str, body=None, attempts: int = 3) -> dict:
    """调 Cloudflare API；对**读取被截断**这一类瞬时故障重试。

    只重试 `IncompleteRead` / `http.client` 级别的读错误，重试 HTTP 状态错误没有意义
    （那些是确定性的：401/403/400 重试多少次都一样）。
    """
    _ensure_ca_bundle()
    data = json.dumps(body).encode() if body is not None else None
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(_read_body(r))
        except urllib.error.HTTPError:
            # 状态错误是确定性的，重试没意义。
            raise
        except Exception as exc:  # noqa: BLE001
            # 传输层抖动（IncompleteRead / 半截 JSON / 超时）→ 退避重来。
            last = exc
            if attempt < attempts:
                time.sleep(min(0.3 * attempt, 2.0))
                continue
            raise
    raise last if last else RuntimeError("unreachable")


def _wait_operation(token: str, account_id: str, operation_id: str | None):
    if not operation_id:
        return
    for _ in range(40):
        resp = _call(token, "GET",
                     f"{API}/accounts/{account_id}/rules/lists/bulk_operations/{operation_id}")
        status = resp.get("result", {}).get("status")
        if status in ("completed", "failed"):
            return
        time.sleep(2)


def _add_items(token: str, account_id: str, list_id: str, ips: list[str]):
    for i in range(0, len(ips), BATCH):
        chunk = [{"ip": ip} for ip in ips[i:i + BATCH]]
        resp = _call(token, "POST", f"{API}/accounts/{account_id}/rules/lists/{list_id}/items", chunk)
        _wait_operation(token, account_id, resp.get("result", {}).get("operation_id"))


def _remove_items(token: str, account_id: str, list_id: str, item_ids: list[str]):
    for i in range(0, len(item_ids), BATCH):
        # Cloudflare DELETE 只接受 {"items": [{"id": ...}]}，裸数组会返回 400 filters.api.invalid_json
        chunk = [{"id": x} for x in item_ids[i:i + BATCH]]
        resp = _call(token, "DELETE", f"{API}/accounts/{account_id}/rules/lists/{list_id}/items", {"items": chunk})
        _wait_operation(token, account_id, resp.get("result", {}).get("operation_id"))


def sync_cloudflare() -> int:
    """把 blocklist.txt 增量同步到 Cloudflare IP List，返回退出码"""
    env = load_env(ENV_FILE)
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    if not token or not account_id:
        print("[cf] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing, skipping", file=sys.stderr)
        return 0

    entries = read_blocklist(BLOCKLIST_TXT)
    if not entries:
        print("[!] blocklist empty, skipping CF sync", file=sys.stderr)
        return 0

    try:
        # Find existing list
        resp = _call(token, "GET", f"{API}/accounts/{account_id}/rules/lists?per_page=100")
        lst = next((item for item in resp.get("result", []) if item["name"] == LIST_NAME), None)

        if lst is None:
            resp = _call(token, "POST", f"{API}/accounts/{account_id}/rules/lists",
                         {"name": LIST_NAME, "kind": "ip", "description": "auto-blocked networks from nginx logs"})
            lst = resp["result"]
            _add_items(token, account_id, lst["id"], entries)
            print(f"[cf] created list {LIST_NAME} with {len(entries)} items", flush=True)
            return 0

        # Current items in CF (canonical cidr -> item id for deletion), follow cursor pagination
        cur = {}
        base = f"{API}/accounts/{account_id}/rules/lists/{lst['id']}/items"
        # url 在循环里会被赋成 None 来结束翻页（见下面那行 `if after else None`），
        # 所以类型是 str | None；循环条件 `while url` 已经把 None 挡在外面。
        url: str | None = base
        while url:
            resp = _call(token, "GET", url)
            for it in resp.get("result", []):
                canonical = _normalize_cidr(it.get("ip", ""))
                if canonical:
                    cur[canonical] = it["id"]
            cursors = (resp.get("result_info") or {}).get("cursors") or {}
            after = cursors.get("after")
            url = f"{base}?cursor={after}" if after else None

        target = set(entries)
        current = set(cur)
        to_add = sorted(target - current)
        to_remove = sorted(current - target)

        if not to_add and not to_remove:
            print(f"[cf] no change ({len(current)} items)", flush=True)
            return 0

        if to_add:
            _add_items(token, account_id, lst["id"], to_add)
        if to_remove:
            _remove_items(token, account_id, lst["id"], [cur[ip] for ip in to_remove])

        print(f"[cf] synced: +{len(to_add)} -{len(to_remove)} (total {len(target)})", flush=True)
    except urllib.error.HTTPError as e:
        print(f"[cf] HTTP error {e.code}: {e.read().decode()[:300]}", file=sys.stderr)
        return 1
    except Exception as e:  # noqa: BLE001
        print(f"[cf] error: {e}", file=sys.stderr)
        return 1

    return 0


def _normalize_cidr(line: str) -> str | None:
    """兼容旧测试名：统一委托给 src/cidr.py。"""
    return normalize_cidr(line)


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _d1_query(token: str, account_id: str, db_id: str, sql: str) -> list[dict]:
    """执行 D1 HTTP query 并提取首个结果集的 results。"""
    resp = _call(
        token,
        "POST",
        f"{API}/accounts/{account_id}/d1/database/{db_id}/query",
        {"sql": sql},
    )
    result = resp.get("result") or []
    if not result:
        return []
    first = result[0]
    if isinstance(first, dict):
        if first.get("success") is False:
            raise RuntimeError("D1 query failed")
        return first.get("results") or []
    return result


def _d1_query_paged(
    token: str,
    account_id: str,
    db_id: str,
    sql_template: str,
    columns: tuple[str, ...],
    page_size: int = 40,
) -> list[dict]:
    """分页执行 D1 查询，把每页结果拼起来。

    `sql_template` 里要有 `{limit}` 与 `{offset}` 占位符。

    为什么必须分页：D1 的 HTTP query 响应**超过 8191 字节会被截断**（实测：83 行
    ×5 列 ≈ 8.9 KB 就炸，报 `Unterminated string` 或 `IncompleteRead`）。每页 40 行
    时响应只有几 KB，安全；行数再怎么长也不会再撞上限。
    """
    out: list[dict] = []
    offset = 0
    while True:
        sql = sql_template.format(limit=page_size, offset=offset)
        rows = _d1_query(token, account_id, db_id, sql)
        # 只保留需要的列，避免把大字段（reason 等）带进内存。
        for row in rows:
            out.append({c: row.get(c) for c in columns})
        if len(rows) < page_size:
            break
        offset += page_size
    return out


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[i:i + size] for i in range(0, len(values), size)]


def _upsert_blocklist(token: str, account_id: str, db_id: str, cidrs: list[str]) -> int:
    changes = 0
    for chunk in _chunks(cidrs, BATCH):
        values = []
        for cidr in chunk:
            parsed = parse_cidr(cidr)
            if parsed is None:
                continue
            network, prefix = parsed
            sql_value = (
                f"({_sql_str(cidr)}, {_sql_str(network)}, {prefix}, '', "
                f"'auto_block', datetime('now'), datetime('now'), 'auto_block')"
            )
            values.append(sql_value)
        if not values:
            continue
        sql = (
            f"INSERT INTO blocked_ips "
            f"(cidr, network, prefix, reason, source, created_at, updated_at, updated_by, active) "
            f"VALUES {', '.join(values)} "
            "ON CONFLICT(cidr) DO UPDATE SET "
            "network=excluded.network, prefix=excluded.prefix, reason=excluded.reason, "
            "source=excluded.source, updated_at=excluded.updated_at, "
            "updated_by=excluded.updated_by, active=1"
        )
        resp = _call(
            token,
            "POST",
            f"{API}/accounts/{account_id}/d1/database/{db_id}/query",
            {"sql": sql},
        )
        meta = (resp.get("result") or [{}])[0].get("meta", {}) if resp.get("result") else {}
        changes += int(meta.get("changes", 0) or 0)
    return changes


def _delete_blocklist(token: str, account_id: str, db_id: str, cidrs: list[str]) -> int:
    changes = 0
    for chunk in _chunks(cidrs, BATCH):
        placeholders = ", ".join(_sql_str(cidr) for cidr in chunk)
        sql = (
            f"DELETE FROM blocked_ips "
            f"WHERE cidr IN ({placeholders}) "
            "AND source IN ('auto_block', 'blocklist.txt')"
        )
        resp = _call(
            token,
            "POST",
            f"{API}/accounts/{account_id}/d1/database/{db_id}/query",
            {"sql": sql},
        )
        meta = (resp.get("result") or [{}])[0].get("meta", {}) if resp.get("result") else {}
        changes += int(meta.get("changes", 0) or 0)
    return changes


def _render_managed_section(rows: dict[str, str], pulled: list[str]) -> str:
    """把 D1 的活跃行渲染成一个受管段（每次 reconcile 整体重写）。

    `rows` 是 cidr -> source；`pulled` 是本次**新增**的（只影响段头的说明）。
    """
    lines = [
        "",
        "# ── 以下是 D1 blocked_ips 的活跃行（自动维护，勿手改；本轮从 D1 拉回 "
        f"{len(pulled)} 条）" + "─" * 8,
        "# 手写区在上面；这一段每次 `auto_block.py reconcile` 都会整体重写。",
    ]
    for cidr in sorted(rows):
        src = rows[cidr] or "unknown"
        lines.append(f"{cidr:<20} # from D1 (source={src})")
    return "\n".join(lines) + "\n"


def _write_pulled_section(path: str, rows: dict[str, str], pulled: list[str]) -> None:
    """把手写区原样保留、受管段整体重写。"""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    head = text.split(MANAGED_MARKER)[0].rstrip("\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(head + _render_managed_section(rows, pulled))


def sync_d1(dry_run: bool = False, pull: bool = False) -> int:
    """把 blocklist.txt 作为导入快照，与 D1 blocked_ips 做全量 diff。

    - 新增/更新：INSERT ... ON CONFLICT（保留 created_at）
    - 删除：只删 source=auto_block/blocklist.txt 的活跃行，避免覆盖 admin 来源
    - 已由 API 解封的行（active=0）保留为审计墓碑，不会被重新加入
    - ``--dry-run`` 只输出 + / - 集合
    - ``pull=True``（CLI 的 ``reconcile``）时**双向**：D1 有而文件没有的活跃行
      会被写回文件（受管段，手写区不动），文件有而 D1 没有的照旧推上去。
      这条路是给「管理员在后台封了 IP，本地快照要跟上」用的。

    注意：拉回文件**只增不减** —— 绝不因为「D1 少了某条」就从文件里删掉它，
    因为调用方无法区分「管理员有意解封」与「还没同步」两种情况。删除仍由
    D1 侧的软删除（active=0）记录，文件是快照而不是删除指令。
    """
    env = load_env(ENV_FILE)
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    db_id = env.get("D1_DATABASE_ID", D1_DATABASE_ID)
    if not token or not account_id or not db_id:
        print("[d1] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID missing, skipping", file=sys.stderr)
        return 0

    cidrs = read_blocklist(BLOCKLIST_TXT)
    # 文件为空时**不再直接返回**（2026-10-11 改）：pull 模式下「本地空、D1 有行」
    # 恰恰是最需要把权威行拉回来的场景。只有既不推也不拉时才跳过。
    if not cidrs and not pull:
        print("[d1] blocklist empty, skipping", file=sys.stderr)
        return 0

    # 两个窄查询，而不是一条宽查询（2026-10-11 实测教训）：
    # D1 的 HTTP query 响应超过 **8191 字节**会被截断，表现为
    # `Unterminated string` / `IncompleteRead`。原来一次取
    # `cidr, network, prefix, source, active` 共 83 行 ≈ 8.9 KB，**正好越界**
    # —— 于是 `deploy.sh` 的 Bans 步骤稳定失败。
    # 现在拆开：① 只要 cidr（含墓碑，用于 known）② 只要活跃行的 cidr+source。
    # 两者都远小于上限，且**分页**，行数增长也不会再越界。
    try:
        all_cidrs = _d1_query_paged(
            token, account_id, db_id,
            "SELECT cidr FROM blocked_ips ORDER BY cidr LIMIT {limit} OFFSET {offset}",
            columns=("cidr",),
        )
        # 活跃行的 source 用于写回文件时标注来源（行数少，通常 1 条）。
        active_list = _d1_query_paged(
            token, account_id, db_id,
            "SELECT cidr, source FROM blocked_ips WHERE active = 1 "
            "ORDER BY cidr LIMIT {limit} OFFSET {offset}",
            columns=("cidr", "source"),
        )
    except urllib.error.HTTPError as exc:
        print(f"[d1] HTTP error {exc.code}: {exc.read().decode()[:300]}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"[d1] error: {exc}", file=sys.stderr)
        return 1

    desired = set(cidrs)
    # `known` 必须**包含墓碑**（active=0）：库里已有的记录——包括被解封的那些——
    # 不该被本地文件重新加回来，那会把管理员的有意解封覆盖掉。
    known = {str(row.get("cidr", "")) for row in all_cidrs if row.get("cidr")}
    active_rows = {
        str(row["cidr"]): {"cidr": row["cidr"], "source": row.get("source") or ""}
        for row in active_list
        if row.get("cidr")
    }
    to_add = sorted(cidr for cidr in desired if cidr not in known)
    to_delete = sorted(
        cidr
        for cidr, row in active_rows.items()
        if cidr not in desired and row.get("source") in (None, "", "auto_block", "blocklist.txt")
    )
    # 要从 D1 拉回文件的行：D1 活跃、而文件里没有。**只增不减**（见 docstring）。
    pulled = sorted(cidr for cidr in active_rows if cidr not in desired) if pull else []

    if dry_run:
        print(f"[d1] dry-run: +{len(to_add)} -{len(to_delete)} pull={len(pulled)}")
        for cidr in to_add:
            print(f"  + {cidr}")
        for cidr in to_delete:
            print(f"  - {cidr}")
        for cidr in pulled:
            print(f"  < {cidr}  # would pull from D1")
        return 0

    try:
        added = _upsert_blocklist(token, account_id, db_id, to_add) if to_add else 0
        deleted = _delete_blocklist(token, account_id, db_id, to_delete) if to_delete else 0
    except urllib.error.HTTPError as exc:
        print(f"[d1] HTTP error {exc.code}: {exc.read().decode()[:300]}", file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"[d1] error: {exc}", file=sys.stderr)
        return 1

    if pull:
        # 写回文件放在 D1 写入**成功之后**：D1 写失败时本地保持原样，
        # 不出现「文件说已封、D1 里没有」的假象。
        sources = {cidr: str(row.get("source") or "") for cidr, row in active_rows.items()}
        _write_pulled_section(BLOCKLIST_TXT, sources, pulled)
        print(
            f"[d1] reconciled +{len(to_add)} -{len(to_delete)} "
            f"pulled={len(pulled)} (changes={added + deleted})",
            flush=True,
        )
        return 0

    print(f"[d1] synced +{len(to_add)} -{len(to_delete)} (changes={added + deleted})", flush=True)
    return 0


def usage() -> None:
    print("Usage:", file=sys.stderr)
    print("  python3 auto_block.py d1 [--dry-run]        # sync blocklist.txt to D1 (full diff)", file=sys.stderr)
    print("  python3 auto_block.py reconcile [--dry-run] # two-way: pull D1's active rows into the list, push the list up", file=sys.stderr)
    print("  python3 auto_block.py cf                    # maintenance: sync blocklist.txt to CF only", file=sys.stderr)
    print("  python3 auto_block.py sync [--dry-run]      # alias of d1 (never writes CF)", file=sys.stderr)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    dry_run = "--dry-run" in sys.argv[2:]
    if cmd in ("d1", "sync"):
        sys.exit(sync_d1(dry_run=dry_run))
    elif cmd == "reconcile":
        # 双向：D1 有而文件没有的**拉回文件**，文件有而 D1 没有的**推上去**。
        sys.exit(sync_d1(dry_run=dry_run, pull=True))
    elif cmd == "cf":
        sys.exit(sync_cloudflare())
    else:
        # 默认分支原先跑 Nginx 日志扫描；数据源随 VPS 退租消失，现在只提示用法。
        usage()
        sys.exit(2)


if __name__ == "__main__":
    main()
