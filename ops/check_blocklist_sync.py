#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.


"""Compare the D1 blocklist with the Cloudflare IP List, and show the last sync run.

Why this exists (2026-10-11): the daily sync Worker wrote
`ctx.waitUntil(sync(env))`, so a rejection was swallowed and the cron panel still
said "ran". Nothing recorded what the sync actually did, and the only way to notice
a divergence was to eyeball the Dashboard. This script is the missing black box
reader: it prints what SHOULD be in the list (D1 `blocked_ips` with `active = 1`),
what IS in the list (Cloudflare IP List API), the delta between them, and the last
recorded run per job (`worker_runs`, migration 018).

Exit codes:
    0  D1 and the IP List agree, and every reported job finished ok/skipped
    1  drift detected (to_add or to_remove is non-zero), or a job failed
    2  the check itself could not complete (credentials, D1, Cloudflare)

D1 cost: two reads, both tiny and both indexed --
    SELECT cidr FROM blocked_ips WHERE active = 1      (uses idx_blocked_ips_active)
    SELECT ... FROM worker_runs WHERE job = ? LIMIT 1   (uses idx_worker_runs_job_started)
No other table is touched. This is a read-only script: it never writes to the IP
List, and `--record` (opt-in) only appends to `worker_runs`.

Usage:
    python3 ops/check_blocklist_sync.py
    python3 ops/check_blocklist_sync.py --json
    python3 ops/check_blocklist_sync.py --record      # also log this check as a run
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("LIMOOO_ROOT") or Path(__file__).resolve().parents[1])
sys.path.insert(0, str(ROOT))

from ops import d1_client  # noqa: E402

API = "https://api.cloudflare.com/client/v4"
LIST_NAME = "limooo_blocklist"
PAGE_SIZE = 500
MAX_PAGES = 20
# Job name used by this operations script for its own records, distinct from the jobs run by the two cron Workers.
CHECK_JOB = "blocklist_sync_check"
# Maximum rows printed per table; this affects output only, not the result.
SAMPLE_LIMIT = 10
STALE_RUNNING_SECONDS = 2 * 60 * 60


def install_ca_bundle() -> None:
    """Use certifi's CA bundle with local Python so the script works from any shell.

    macOS framework Python does not always use the Homebrew certificate chain, and urllib can
    fail with `CERTIFICATE_VERIFY_FAILED`. This is not a script bug, but it would make a diagnostic
    script unusable, so provide a fallback here. Honor an explicitly set SSL_CERT_FILE.
    """
    if os.environ.get("SSL_CERT_FILE"):
        return
    try:
        import certifi  # noqa: PLC0415 - Optional dependency; use the system default if unavailable.
    except ImportError:
        return
    os.environ["SSL_CERT_FILE"] = certifi.where()
    ssl._create_default_https_context = lambda: ssl.create_default_context(  # noqa: SLF001
        cafile=certifi.where()
    )


def normalize_list_item(value: str) -> str:
    """Match normalizeListItem in ops/sync-worker/src/index.ts.

    Cloudflare's IP List stores IPv4 /32 and IPv6 /128 entries as bare IPs. Comparing raw strings
    on both sides would make the same entry appear to need both adding and removing.
    """
    raw = (value or "").strip()
    slash = raw.rfind("/")
    if slash < 0:
        return raw
    addr, _, prefix = raw.partition("/")
    if prefix.isdigit():
        if int(prefix) == 32 and ":" not in addr:
            return addr
        if int(prefix) == 128 and ":" in addr:
            return addr
    return raw


def cf_get_json(token: str, url: str, attempts: int = 4) -> object:
    """Make a Cloudflare GET with backoff retries; never include the token in errors."""
    last: Exception | None = None
    for _attempt in range(attempts):
        request = urllib.request.Request(
            url,
            method="GET",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            last = RuntimeError(f"HTTP {exc.code} {url}: {detail}")
            if exc.code < 500:
                # A 403 or 404 is a definitive response and should not be retried.
                break
        except Exception as exc:  # noqa: BLE001 - Retry transient network failures uniformly.
            last = exc
    raise RuntimeError(f"Cloudflare API request failed: {last}")


def find_list(cfg: dict[str, str]) -> dict:
    """Find an IP List by name; raise an error if it is missing (this script does not create lists)."""
    url = f"{API}/accounts/{cfg['account_id']}/rules/lists?per_page=100"
    payload = cf_get_json(cfg["token"], url)
    for item in payload.get("result") or []:
        if item.get("name") == LIST_NAME:
            return item
    raise RuntimeError(f"no IP List named {LIST_NAME} in account {cfg['account_id']}")


def list_items(cfg: dict[str, str], list_id: str) -> dict[str, str]:
    """Return {normalized IP: list item ID}, paginating by cursor like the Worker."""
    items: dict[str, str] = {}
    cursor = ""
    for _ in range(MAX_PAGES):
        query = {"per_page": str(PAGE_SIZE)}
        if cursor:
            query["cursor"] = cursor
        url = (
            f"{API}/accounts/{cfg['account_id']}/rules/lists/{list_id}/items?"
            + urllib.parse.urlencode(query)
        )
        payload = cf_get_json(cfg["token"], url)
        rows = payload.get("result") or []
        for row in rows:
            ip = str(row.get("ip") or "")
            if ip:
                items[normalize_list_item(ip)] = str(row.get("id") or "")
        next_cursor = ((payload.get("result_info") or {}).get("cursor")) or ""
        if not next_cursor or not rows:
            return items
        if next_cursor == cursor:
            raise RuntimeError(f"list {list_id}: cursor did not advance ({next_cursor})")
        cursor = str(next_cursor)
    raise RuntimeError(f"list {list_id}: more than {MAX_PAGES} pages of items")


def query_last_runs(cfg: dict[str, str], jobs: list[str]) -> tuple[dict[str, dict | None], str | None]:
    """Return the latest run per job using idx_worker_runs_job_started (one row each).

    Returns ({job: latest row}, error message). Report a missing table separately from a failed
    query; "unreadable" must not be treated as "no record".
    """
    found: dict[str, dict | None] = {}
    for job in jobs:
        # The job name comes from this script's constants or CLI and is constrained; still quote it to be safe.
        escaped = job.replace("'", "''")
        sql = (
            "SELECT job, started_at, finished_at, outcome, added, removed, error, dry_run "
            f"FROM worker_runs WHERE job = '{escaped}' "
            "ORDER BY started_at DESC, id DESC LIMIT 1"
        )
        rows = d1_client.d1_query_retry(cfg, sql)
        if rows is None:
            return found, (
                "worker_runs query failed (network/API flake, or migration 018 was never "
                "applied); this does NOT mean no run was recorded"
            )
        found[job] = rows[0] if rows else None
    return found, None


def format_ts(value: object) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    return dt.datetime.fromtimestamp(value, dt.UTC).strftime("%Y-%m-%d %H:%M:%SZ")


def format_run(job: str, row: dict | None) -> str:
    if row is None:
        return f"  {job:<22} {'-':<17} outcome=- added=- removed=-"
    started = format_ts(row.get("started_at"))
    outcome = str(row.get("outcome") or "-")
    added = row.get("added")
    removed = row.get("removed")
    line = (
        f"  {job:<22} {started:<17} outcome={outcome:<8} "
        f"added={' -' if added is None else added} removed={' -' if removed is None else removed}"
    )
    if row.get("dry_run"):
        line += " dry_run=1"
    error = row.get("error")
    if error:
        line += f" error={str(error)[:160]}"
    return line


def compute_diff(desired: list[str], actual: dict[str, str]) -> tuple[list[str], list[str]]:
    """Return (to_add, to_remove), comparing normalized values on both sides.

    Report the D1-side original value in to_add because that is what the Worker will upload.
    Report the normalized list value in to_remove because that is what Cloudflare stores.
    """
    desired_norm = {normalize_list_item(cidr) for cidr in desired}
    to_add = sorted(cidr for cidr in desired if normalize_list_item(cidr) not in actual)
    to_remove = sorted(ip for ip in actual if ip not in desired_norm)
    return to_add, to_remove


def record_check(cfg: dict[str, str], outcome: str, detail: str) -> str | None:
    """Optionally record this manual check in worker_runs; return an error message if it fails."""
    now = int(dt.datetime.now(dt.UTC).timestamp())
    escaped = detail.replace("'", "''")
    sql = (
        "INSERT INTO worker_runs (job, started_at, finished_at, outcome, error, dry_run) "
        f"VALUES ('{CHECK_JOB}', {now}, {now}, '{outcome}', '{escaped}', 0)"
    )
    try:
        d1_client.d1_query(cfg, sql)
    except Exception as exc:  # noqa: BLE001 - A recording failure does not affect the check result.
        return str(exc)
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare the D1 blocklist with the Cloudflare IP List"
    )
    parser.add_argument("--json", action="store_true", help="print one JSON object instead of text")
    parser.add_argument(
        "--record",
        action="store_true",
        help=f"also append this check to worker_runs as job={CHECK_JOB}",
    )
    parser.add_argument(
        "--job",
        action="append",
        default=None,
        help="only report this job's last run (repeatable); default: the two cron jobs",
    )
    args = parser.parse_args()

    install_ca_bundle()
    cfg = d1_client.cloudflare_config(d1_client.load_env(ROOT / "secrets" / "webauthn.env"))
    jobs = args.job or ["blocklist_sync", "d1_archive"]

    error: str | None = None
    desired: list[str] = []
    actual: dict[str, str] = {}
    runs: dict[str, dict | None] = {}
    run_error: str | None = None
    list_meta: dict = {}

    try:
        rows = d1_client.d1_query_retry(cfg, "SELECT cidr FROM blocked_ips WHERE active = 1")
        if rows is None:
            raise RuntimeError(
                "D1 read of blocked_ips failed (network/API flake, or credentials wrong)"
            )
        for row in rows:
            cidr = str(row.get("cidr") or "").strip()
            if cidr:
                desired.append(cidr)
        runs, run_error = query_last_runs(cfg, jobs)
        list_meta = find_list(cfg)
        actual = list_items(cfg, str(list_meta.get("id")))
        if run_error:
            error = run_error
    except Exception as exc:  # noqa: BLE001 - Use the common error handling for operations scripts.
        error = str(exc)

    if error:
        if args.json:
            print(json.dumps({"ok": False, "error": error, "run_history_error": run_error}, ensure_ascii=False))
        else:
            print("desired=-  actual=-  to_add=-  to_remove=-  status=error")
            print(f"  error: {error}")
            print("  the check did not complete; this is NOT a statement about drift")
        return 2

    to_add, to_remove = compute_diff(desired, actual)
    now = int(dt.datetime.now(dt.UTC).timestamp())
    failed_jobs = []
    for job, row in runs.items():
        if row is None:
            continue
        outcome = str(row.get("outcome") or "").strip().lower()
        if outcome in {"ok", "skipped"}:
            continue
        if outcome == "running":
            started_at = row.get("started_at")
            if isinstance(started_at, (int, float)) and now - started_at < STALE_RUNNING_SECONDS:
                continue
        failed_jobs.append(job)
    drift = bool(to_add) or bool(to_remove)
    status = "drift" if drift else ("failed_run" if failed_jobs else "ok")

    if args.json:
        if args.record:
            detail = f"status={status} to_add={len(to_add)} to_remove={len(to_remove)}"
            record_error = record_check(cfg, status, detail)
        else:
            record_error = None
        payload = {
            "ok": not drift and not failed_jobs,
            "status": status,
            "desired": len(desired),
            "actual": len(actual),
            "to_add": len(to_add),
            "to_remove": len(to_remove),
            "to_add_sample": to_add[:SAMPLE_LIMIT],
            "to_remove_sample": to_remove[:SAMPLE_LIMIT],
            "list": {
                "name": LIST_NAME,
                "id": list_meta.get("id"),
                "modified_on": list_meta.get("modified_on"),
            },
            "last_runs": {
                job: (
                    None
                    if row is None
                    else {
                        "started_at": row.get("started_at"),
                        "finished_at": row.get("finished_at"),
                        "outcome": row.get("outcome"),
                        "added": row.get("added"),
                        "removed": row.get("removed"),
                        "error": row.get("error"),
                        "dry_run": row.get("dry_run"),
                    }
                )
                for job, row in runs.items()
            },
            "run_history_error": run_error,
            "record_error": record_error,
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 1 if payload["ok"] is False else 0

    print("blocklist sync check")
    print(f"  {'list':<22}{LIST_NAME}")
    print(f"  {'list id':<22}{list_meta.get('id')}")
    print(f"  {'list modified_on':<22}{list_meta.get('modified_on')}")
    print(f"  {'d1 active':<22}{len(desired)}")
    print(f"  {'ip list items':<22}{len(actual)}")
    print(f"  desired={len(desired)} actual={len(actual)} to_add={len(to_add)} to_remove={len(to_remove)}")
    if to_add:
        print(f"  to add ({len(to_add)}):")
        for cidr in to_add[:SAMPLE_LIMIT]:
            print(f"    + {cidr}")
    if to_remove:
        print(f"  to remove ({len(to_remove)}):")
        for ip in to_remove[:SAMPLE_LIMIT]:
            print(f"    - {ip}")
    print("last runs (worker_runs)")
    for job in jobs:
        print(format_run(job, runs.get(job)))
    if run_error:
        print(f"  note: {run_error}")
    if failed_jobs:
        print(f"  failed jobs: {', '.join(failed_jobs)}")

    if args.record:
        detail = f"status={status} to_add={len(to_add)} to_remove={len(to_remove)}"
        record_error = record_check(cfg, status, detail)
        if record_error:
            print(f"  note: could not record this check: {record_error}")
        else:
            print(f"  recorded this check as {CHECK_JOB} outcome={status}")

    if drift:
        print(
            "result: DRIFT - the IP List does not match D1 active rows "
            "(run the sync, or wait for the 03:30 cron)"
        )
        return 1
    if failed_jobs:
        print(f"result: FAILED RUN - no drift, but these jobs last failed: {', '.join(failed_jobs)}")
        return 1
    print("result: OK - IP List matches D1 active rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
