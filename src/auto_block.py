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

This script previously scanned Nginx access logs on the VPS to generate blocked
networks. Nginx was removed with the VPS on `2026-09-17`, and the scanning code
(`LOG_PATTERN`, `SCAN_PATTERNS`, `_is_scan_path`, `collect_logs`, `analyze`, and
`run_scan`) was deleted. Logs now come only from the Cloudflare edge (such as
`ray_log_v2`), and blocking decisions are made by Pages or Workers.

Authoritative flow: D1 `blocked_ips` -> daily sync-worker -> Cloudflare IP List.
`blocklist.txt` is a local import seed and auditable snapshot. The CF List is
updated directly only by the explicit maintenance command `auto_block.py cf`;
the default execution path does not write to Cloudflare.

Usage:
    python3 auto_block.py d1 [--dry-run]  # sync blocklist.txt to D1 (full diff)
    python3 auto_block.py cf              # maintenance: sync blocklist.txt to CF only
    python3 auto_block.py sync [--dry-run]  # alias of `d1` (does not write to CF)
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

from cidr import normalize_cidr, parse_cidr

# Repository root; this file is in src/, so move up one level.
# Keep each aliased constant in a separate import, as ruff isort expects them
# sorted by their original names; combining them triggers I001.
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

# Start marker for the managed section (2026-10-11). `reconcile` writes rows pulled from D1
# after this line and rewrites the section each time; everything before it is the manual area
# and is always preserved unchanged.
MANAGED_MARKER = "# 以下是 D1 blocked_ips 的活跃行"


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


# Sync the Cloudflare IP List (formerly sync_blocklist_cf.py).
# Read CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from webauthn.env;
# skip if they are missing. Uses only the standard library (urllib).
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
    """Read blocklist.txt and return normalized CIDRs, ignoring invalid lines and comments."""
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
    """Ensure a CA certificate is available for HTTPS (2026-10-11).

    The repository's build venv (python.org Python 3.14 in `.venv-build`) has no CA
    certificate. `ssl.get_default_verify_paths()` returns `None` for `cafile`, and its
    expected `/Library/Frameworks/Python.framework/Versions/3.14/etc/openssl/cert.pem`
    does not exist. All HTTPS calls then fail with `CERTIFICATE_VERIFY_FAILED`, so this
    script cannot read D1. macOS provides the complete system root store at
    `/etc/ssl/cert.pem`; pointing to it resolves the issue.

    Preserve an `SSL_CERT_FILE` already configured by the caller (CI or system Python).
    """
    system_ca = "/etc/ssl/cert.pem"
    if not os.environ.get("SSL_CERT_FILE") and os.path.exists(system_ca):
        os.environ["SSL_CERT_FILE"] = system_ca


def _read_body(resp) -> bytes:
    """Read the complete response body; raise on incomplete reads so callers can retry.

    Two lessons from 2026-10-11:
      1. The original `json.load(r)` failed immediately on occasional `IncompleteRead` errors.
      2. Keeping partial data without raising only treated the symptom: parsing truncated
         JSON produced harder-to-diagnose `Expecting property name` or `Unterminated string`
         errors, and swallowing the exception prevented retries entirely.
    Raise the exception and let `_call` retry. Resolve the root cause of oversized
    responses with narrower queries and pagination (see `_d1_query_paged` and D1's
    8191-byte limit).
    """
    return resp.read()


def _call(token: str, method: str, url: str, body=None, attempts: int = 3) -> dict:
    """Call the Cloudflare API and retry transient truncated-read failures.

    Retry only `IncompleteRead` and `http.client` read errors. Retrying HTTP status
    errors is pointless because they are deterministic: 401, 403, and 400 remain the
    same regardless of the number of retries.
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
            # Status errors are deterministic, so retrying is pointless.
            raise
        except Exception as exc:  # noqa: BLE001
            # Retry transient transport failures (IncompleteRead, truncated JSON, or timeout) with backoff.
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
        # Cloudflare DELETE accepts only {"items": [{"id": ...}]}; a bare array returns 400 filters.api.invalid_json.
        chunk = [{"id": x} for x in item_ids[i:i + BATCH]]
        resp = _call(token, "DELETE", f"{API}/accounts/{account_id}/rules/lists/{list_id}/items", {"items": chunk})
        _wait_operation(token, account_id, resp.get("result", {}).get("operation_id"))


def sync_cloudflare() -> int:
    """Incrementally sync blocklist.txt to the Cloudflare IP List and return an exit code."""
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
        # The loop sets url to None when pagination ends (see `if after else None` below),
        # so its type is str | None. The `while url` condition already excludes None.
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
    """Preserve the legacy test name while delegating to src/cidr.py."""
    return normalize_cidr(line)


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _d1_query(token: str, account_id: str, db_id: str, sql: str) -> list[dict]:
    """Run a D1 HTTP query and extract results from the first result set."""
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
    """Run a paginated D1 query and combine the results from each page.

    `sql_template` must contain `{limit}` and `{offset}` placeholders.

    Pagination is required because D1 HTTP query responses are truncated above 8191
    bytes. In practice, 83 rows x 5 columns (about 8.9 KB) failed with `Unterminated
    string` or `IncompleteRead`. At 40 rows per page, responses are only a few KB, so
    the limit is not reached regardless of the total number of rows.
    """
    out: list[dict] = []
    offset = 0
    while True:
        sql = sql_template.format(limit=page_size, offset=offset)
        rows = _d1_query(token, account_id, db_id, sql)
        # Keep only the requested columns to avoid loading large fields such as reason into memory.
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
    """Render active D1 rows as a managed section, rewritten on every reconcile.

    `rows` maps CIDR to source; `pulled` contains entries newly pulled this run and only
    affects the section heading.
    """
    lines = [
        "",
        "# 以下是 D1 blocked_ips 的活跃行（自动维护，勿手改；本轮从 D1 拉回 "
        f"{len(pulled)} 条）",
        "# 手写区在上面；这一段每次 `auto_block.py reconcile` 都会整体重写。",
    ]
    for cidr in sorted(rows):
        src = rows[cidr] or "unknown"
        lines.append(f"{cidr:<20} # from D1 (source={src})")
    return "\n".join(lines) + "\n"


def _write_pulled_section(path: str, rows: dict[str, str], pulled: list[str]) -> None:
    """Preserve the manually maintained section and rewrite the managed section."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    head = text.split(MANAGED_MARKER)[0].rstrip("\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write(head + _render_managed_section(rows, pulled))


def sync_d1(dry_run: bool = False, pull: bool = False) -> int:
    """Treat blocklist.txt as an import snapshot and compute a full diff against D1 blocked_ips.

    - Inserts or updates use INSERT ... ON CONFLICT and preserve created_at.
    - Deletions affect only active rows with source=auto_block/blocklist.txt, not admin rows.
    - Rows unblocked through the API (active=0) remain as audit tombstones and are not re-added.
    - ``--dry-run`` only prints the additions and removals.
    - With ``pull=True`` (the CLI's ``reconcile`` command), synchronization is bidirectional:
      active rows in D1 but absent from the file are written back to the managed section,
      preserving the manual section. Rows in the file but absent from D1 are still pushed.
      This keeps the local snapshot current when an administrator blocks an IP in the UI.

    Pulling into the file only adds entries; it never removes one just because it is
    absent from D1. The caller cannot distinguish an intentional admin unblock from an
    unsynchronized change. Deletions remain recorded as soft deletes (active=0) in D1;
    the file is a snapshot, not a deletion command.
    """
    env = load_env(ENV_FILE)
    token = env.get("CLOUDFLARE_API_TOKEN", "")
    account_id = env.get("CLOUDFLARE_ACCOUNT_ID", "")
    db_id = env.get("D1_DATABASE_ID", D1_DATABASE_ID)
    if not token or not account_id or not db_id:
        print("[d1] CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / D1_DATABASE_ID missing, skipping", file=sys.stderr)
        return 0

    cidrs = read_blocklist(BLOCKLIST_TXT)
    # Do not return immediately for an empty file (changed 2026-10-11): in pull mode, an empty
    # local list with rows in D1 is exactly when authoritative rows need to be restored.
    # Skip only when neither pushing nor pulling.
    if not cidrs and not pull:
        print("[d1] blocklist empty, skipping", file=sys.stderr)
        return 0

    # Use two narrow queries instead of one wide query (lesson from 2026-10-11):
    # D1 truncates HTTP query responses over 8191 bytes, causing `Unterminated string` or
    # `IncompleteRead`. The old query returned 83 rows with five columns (about 8.9 KB),
    # crossing the limit and reliably failing the Bans step in deploy.sh.
    # Split it into (1) all CIDRs, including tombstones for `known`, and (2) CIDR plus source
    # for active rows. Both are smaller and paginated, so they remain below the limit as data grows.
    try:
        all_cidrs = _d1_query_paged(
            token, account_id, db_id,
            "SELECT cidr FROM blocked_ips ORDER BY cidr LIMIT {limit} OFFSET {offset}",
            columns=("cidr",),
        )
        # The active row's source labels entries written back to the file; there are usually few rows.
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
    # `known` must include tombstones (active=0). Existing records, including unblocked ones,
    # must not be re-added from the local file because that would undo an admin's intentional unblock.
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
    # Rows to restore from D1: active in D1 but absent from the file. Additions only; see the docstring.
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
        # Write the file only after D1 writes succeed. If D1 fails, keep the local file unchanged
        # so it cannot claim an IP is blocked when D1 has no record.
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
        # Two-way sync: restore rows present in D1 but missing from the file, and push file-only rows to D1.
        sys.exit(sync_d1(dry_run=dry_run, pull=True))
    elif cmd == "cf":
        sys.exit(sync_cloudflare())
    else:
        # The default branch used to scan Nginx logs; that source disappeared with the VPS, so now show usage.
        usage()
        sys.exit(2)


if __name__ == "__main__":
    main()
