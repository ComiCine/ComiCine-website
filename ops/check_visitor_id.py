#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.


"""Look up a visitor's real IP and visit summary by visitor ID (ip_hash) for troubleshooting.

Each row on the visitor page displays `ID: xxxxxxxxxxxxxxxx`, which is `visitor_rollups.ip_hash`
(the first 16 characters of HMAC-SHA256). Since 2026-09-26, the full IP is stored as Fernet
ciphertext in `visitor_rollups.ip_enc`, encrypted with VISITOR_IP_KEY from the local
secrets/webauthn.env. The Worker `functions/_lib/visitor-ip.ts` uses the same key, so either side
can decrypt it.

Data source: D1 `visitor_rollups`, queried by its (ip_hash, last_ts) index without scanning the
table. `--requests` also reads ray_log_v2; migration 017 added an (ip_hash, ts DESC) index, so this
query is indexed too and no longer scans seven days of request details. It is disabled by default.

Rows from before 2026-09-26 have no ciphertext, only an irreversible hash. The script distinguishes
an unknown ID from a record without ciphertext and does not misreport the latter as nonexistent.

Usage:
    python3 ops/check_visitor_id.py d51153cb767fc758
    VISITOR_ID=d51153cb767fc758 python3 ops/check_visitor_id.py
    python3 ops/check_visitor_id.py d51153cb767fc758 --requests 10

Exit codes: 0 if IP decrypted; 1 if no record, query failure, or key missing; 2 for invalid ID;
3 if a record exists without ciphertext.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
from pathlib import Path

ROOT = Path(
    os.environ.get("COMICINE_ROOT")
    or Path(__file__).resolve().parents[1]
)
sys.path.insert(0, str(ROOT))

from ops import d1_client  # noqa: E402

ID_RE = re.compile(r"[0-9a-f]{16}")
SECRETS_FILE = ROOT / "secrets" / "webauthn.env"


def normalize(raw: str) -> str:
    """Accept 'd51153cb767fc758', 'ID: d51153cb767fc758', or uppercase; return 16 lowercase characters."""
    value = (raw or "").strip()
    value = re.sub(r"^(?:id|visitor)[\s:=]+", "", value, flags=re.IGNORECASE).strip()
    value = value.lower()
    if not ID_RE.fullmatch(value):
        raise ValueError("invalid visitor ID")
    return value


def fmt_ts(value: object) -> str:
    if not isinstance(value, (int, float)):
        return "-"
    return dt.datetime.fromtimestamp(value).strftime("%Y-%m-%d %H:%M:%S")


def d1_query_retry(cfg: dict[str, str], sql: str, tries: int = 4) -> list[dict]:
    """Raise on persistent failure, unlike other check_* scripts that return None."""
    return d1_client.d1_query_retry(cfg, sql, tries, raise_on_failure=True) or []


def decrypt_ip(token: str, key: str) -> str:
    """Decrypt Fernet ciphertext; raise on an invalid key or token so the caller can give guidance."""
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:  # pragma: no cover - Depends on the Python interpreter.
        raise RuntimeError(
            "this interpreter lacks cryptography, cannot decrypt ip_enc.\n"
            "  use an interpreter that has it: /tmp/comicine-venv/bin/python "
            f"{Path(__file__).name} <ID>\n"
            "  (recreate: python3 -m venv /tmp/comicine-venv && "
            "/tmp/comicine-venv/bin/pip install -r ops/requirements.txt)"
        ) from exc
    return Fernet(key.encode("ascii")).decrypt(token.encode("ascii")).decode("utf-8")


def summarize(rows: list[dict]) -> str:
    return " ".join(f"{r['status']}×{r['n']}" for r in rows) or "-"


def main() -> int:
    parser = argparse.ArgumentParser(description="Look up the real IP and visit summary by visitor ID")
    parser.add_argument("visitor_id", nargs="?", help="the 16-char ID shown on the visitor page (ip_hash)")
    parser.add_argument(
        "--requests",
        type=int,
        default=0,
        metavar="N",
        help="also list the most recent N request details (reads ray_log_v2, indexed by (ip_hash, ts) since migration 017)",
    )
    args = parser.parse_args()

    raw = args.visitor_id or os.environ.get("VISITOR_ID") or ""
    try:
        visitor = normalize(raw)
    except ValueError:
        print("invalid visitor ID (expected 16 hex chars, e.g. d51153cb767fc758)", file=sys.stderr)
        return 2

    def warn(message: str) -> None:
        sys.stdout.flush()
        print(message, file=sys.stderr)
        sys.stderr.flush()

    env = d1_client.load_env(SECRETS_FILE)
    key = (os.environ.get("VISITOR_IP_KEY") or env.get("VISITOR_IP_KEY") or "").strip()
    cfg = d1_client.cloudflare_config(env)

    print(f"visitor {visitor}", flush=True)
    try:
        totals = d1_query_retry(
            cfg,
            "SELECT COUNT(*) AS rows_n, COALESCE(SUM(requests), 0) AS total_requests, "
            "MIN(last_ts) AS first_ts, MAX(last_ts) AS last_ts, "
            "GROUP_CONCAT(DISTINCT NULLIF(country, '')) AS countries "
            f"FROM visitor_rollups WHERE ip_hash = '{visitor}'",
        )
    except Exception as exc:  # noqa: BLE001
        warn(f"  D1 query failed: {exc}")
        warn(f"\nquery incomplete: {visitor} (this does NOT mean there is no record; please retry)")
        return 1

    row = totals[0] if totals else {}
    if not row or not row.get("rows_n"):
        warn(f"\nno records found: {visitor} (this ID is outside the visitor_rollups retention window)")
        return 1

    statuses = d1_query_retry(
        cfg,
        "SELECT status, SUM(requests) AS n FROM visitor_rollups "
        f"WHERE ip_hash = '{visitor}' GROUP BY status ORDER BY n DESC",
    )
    pages = d1_query_retry(
        cfg,
        "SELECT page_slug, SUM(requests) AS n FROM visitor_rollups "
        f"WHERE ip_hash = '{visitor}' GROUP BY page_slug ORDER BY n DESC LIMIT 8",
    )

    print(f"  first      {fmt_ts(row.get('first_ts'))}")
    print(f"  last       {fmt_ts(row.get('last_ts'))}")
    print(f"  requests   {row.get('total_requests')} visits / {row.get('rows_n')} rollup rows")
    print(f"  country    {row.get('countries') or '-'}")
    print(f"  status     {summarize(statuses)}")
    print("  pages      " + (" ".join(f"{r['page_slug']}×{r['n']}" for r in pages) or "-"))

    # Read only the latest ciphertext: an IP may have many hourly rows, but the ciphertext is identical.
    tokens = d1_query_retry(
        cfg,
        "SELECT ip_enc, last_ts FROM visitor_rollups "
        f"WHERE ip_hash = '{visitor}' AND ip_enc != '' ORDER BY last_ts DESC LIMIT 1",
    )
    token = (tokens[0].get("ip_enc") if tokens else "") or ""

    if not token:
        print("  IP         unavailable")
        warn(
            "\nthis visitor only has records from before 2026-09-26: only an HMAC hash was stored then, "
            "which is irreversible.\n"
            "if the same IP visits once more, this row will automatically carry a decryptable IP."
        )
        return 3

    if not key:
        warn(f"  ciphertext found, but {SECRETS_FILE} has no VISITOR_IP_KEY, cannot decrypt.")
        return 1
    try:
        ip = decrypt_ip(token, key)
    except Exception as exc:  # noqa: BLE001
        warn(f"  decryption failed: {exc}")
        return 1

    print(f"  IP         {ip}")
    print(f"  ciphertext {fmt_ts(tokens[0].get('last_ts'))} (Fernet / VISITOR_IP_KEY, decrypted locally)")

    if args.requests > 0:
        print(f"recent requests (ray_log_v2, up to {args.requests})", flush=True)
        # tasks/22 W7-9 and migration 017: this query uses the (ip_hash, ts DESC) index for an exact lookup.
        # Report the scan size first so the diagnostic script says what it will read before starting and does not exceed
        # the D1 read budget.
        warn(
            "  "
            + d1_client.scan_note(
                cfg,
                "ray_log_v2",
                f"ip_hash = '{visitor}'",
                "indexed by (ip_hash, ts DESC) since migration 017; at most this visitor's own rows are read",
                "The main lookup above uses the (ip_hash, last_ts) index instead; drop --requests to skip this read.",
            )
        )
        try:
            hits = d1_query_retry(
                cfg,
                "SELECT ts, host, normalized_path, method, status, country, ua_family "
                f"FROM ray_log_v2 WHERE ip_hash = '{visitor}' "
                f"ORDER BY ts DESC LIMIT {int(args.requests)}",
            )
        except Exception as exc:  # noqa: BLE001
            warn(f"  ray_log_v2 query failed: {exc}")
            hits = []
        if not hits:
            print("  (no detail records within the retention window)")
        for hit in hits:
            print(
                f"  {fmt_ts(hit.get('ts'))} {hit.get('host')} {hit.get('method')} "
                f"{hit.get('normalized_path')} {hit.get('status')} "
                f"country={hit.get('country')} ua={hit.get('ua_family')} [ray_log_v2]"
            )
    else:
        print("  (pass --requests 10 to list this visitor's recent request details)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
