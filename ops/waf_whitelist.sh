#!/usr/bin/env bash

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

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

if [ "$MODE" != dry-run ]; then
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$SECRETS_FILE" ]; then
        CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS_FILE" | tail -1)"
    fi
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
        echo "FATAL: CLOUDFLARE_API_TOKEN not set and not found in $SECRETS_FILE" >&2
        exit 1
    fi
fi
export ZONE_ID WHITELIST API NOTES MODE
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    export CLOUDFLARE_API_TOKEN
fi

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
TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN", "")
WHITELIST = os.environ["WHITELIST"]

RULES_URL = f"{API}/zones/{ZONE}/firewall/access_rules/rules"

# Page size (2026-10-11): at the default of 100 entries, responses were about 40 KB and could
# be truncated (`IncompleteRead` / partial JSON). At 25 entries, responses were about 7.5 KB and
# stable, with a reasonable number of requests even when there are many rules.
PER_PAGE = 25


class CloudflareApiError(RuntimeError):
    pass


def read_full(resp) -> bytes:
    """Read the complete response body.

    Two lessons from 2026-10-11:
      1. The early version called `json.load(r)` directly and occasionally got `IncompleteRead`.
      2. Reading up to Content-Length and keeping partial data only hid the symptom. When a paged
         response was genuinely incomplete, the partial JSON caused `Unterminated string`, which
         was harder to diagnose than the original failure.
    Let exceptions propagate, whether caused by Content-Length or chunked transfer, so `call()`
    can retry. `PER_PAGE` addresses the root cause: oversized pages.
    """
    return resp.read()


def call(method: str, url: str, body=None, attempts: int = 12) -> dict:
    """Call the API and retry transport-layer failures.

    Observed on 2026-10-11: this endpoint intermittently returns `IncompleteRead(0 bytes read)`.
    Usually 2-5 of 13 pages need retries, and all pages rarely succeed on the first attempt.
    Retries are required, not a workaround: with a limit of 12 attempts, all 13 pages succeeded.
    Do not retry HTTP status errors (4xx/5xx), which are deterministic and would waste time; the
    only exception is duplicate handling during apply, described below.
    """
    data = json.dumps(body).encode() if body is not None else None
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                payload = json.loads(read_full(r))
                if payload.get("success") is not True:
                    raise CloudflareApiError(
                        f"Cloudflare API rejected request: {payload.get('errors')}"
                    )
                return payload
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:200]
            raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
        except CloudflareApiError:
            raise
        except Exception as exc:  # noqa: BLE001
            # Transport failures (IncompleteRead, partial JSON, or timeout): back off and retry.
            last = exc
            if attempt < attempts:
                time.sleep(min(0.2 * attempt, 2.0))
                continue
    raise RuntimeError(f"{type(last).__name__}: {last}") from last


def desired_asns() -> list[str]:
    """Return whitelist ASNs normalized to Cloudflare's `AS<number>` format."""
    out = []
    with open(WHITELIST, encoding="utf-8") as f:
        for raw in f:
            m = re.match(r"^\s*ASN/(\d{1,10})\s*(?:#.*)?$", raw, re.I)
            if m:
                out.append(f"AS{int(m.group(1))}")
    return sorted(set(out))


def current_asn_rules() -> dict[str, dict]:
    """Fetch every page of this zone's Access Rules and keep only target=asn rules."""
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
    # Offline plan: without querying live state, report only the intended rules.
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

# Bulk-removal guard (added 2026-10-11): this script deletes the ASN rules it manages on the zone.
# Removing dozens of rules at once is a significant security change and requires a second check.
# Set LIMOOO_WAF_ALLOW_BULK_REMOVE=1 to allow bulk cleanup.
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

# Remove first, then add: removed entries are ASNs no longer in the list, and added entries are
# new ASNs, so the sets do not overlap. Handle each rule independently so one failure does not
# abort the batch. On 2026-10-11, POST returned `10009 duplicate_of_existing` when an ASN had been
# added manually in the dashboard. The old script did not catch it and aborted on the second item,
# leaving a partially updated list. Now each operation is handled separately and failures are
# summarized at the end.
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
        # Treat an existing rule (usually added manually) as the desired state, not a failure.
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
