#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine WAF custom rule compaction / snapshot (zero-VPS, local token only).
#
# Background (tasks/17 section 10): the free plan allows only 5 custom rules,
# while IP Access Rules allow 50,000 and do not consume that quota. This script
# migrates one-line rules such as single-IP allow entries from custom rules to
# IP Access Rules, and can optionally clean up disabled rules.
#
# It is also the only tool that refreshes ops/waf/rules.snapshot.json.
#
# Usage:
#   bash ops/waf_rules.sh --show                   # live: print current rules, write nothing
#   bash ops/waf_rules.sh --snapshot               # live: fetch rules, rewrite ops/waf/rules.snapshot.json
#   bash ops/waf_rules.sh --dry-run                # offline: print the plan from the local snapshot (default)
#   bash ops/waf_rules.sh --apply                  # live: skip(single IP) -> IP Access Rule
#   bash ops/waf_rules.sh --apply --drop-disabled  # live: also delete disabled rules
#   bash ops/waf_rules.sh --from=<file>            # offline: plan from another snapshot file
#
# Credentials: CLOUDFLARE_API_TOKEN from the environment, else from the local
# secrets/webauthn.env (never echoed, never written to disk). The VPS was retired
# on 2026-09-17, so nothing here talks to a server over ssh.
#
# --dry-run is fully offline: it reads the local snapshot and touches no network.
# Live modes (--show / --snapshot / --apply) call the Cloudflare API with curl.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="${WAF_ENV_FILE:-$ROOT/secrets/webauthn.env}"
ZONE_NAME="${WAF_ZONE_NAME:-limooo.cn}"
SNAP_DIR="$ROOT/ops/waf"
SNAP="$SNAP_DIR/rules.snapshot.json"
PHASE_PATH="/rulesets/phases/http_request_firewall_custom/entrypoint"
API_BASE="https://api.cloudflare.com/client/v4"
PY="${PYTHON_BIN:-python3}"

MODE=plan
DROP_DISABLED=0
PLAN_SOURCE="$SNAP"
PLAN=""
SNAP_TMP=""

# Remove only temporary files created by this script. Never delete --from inputs or repository snapshots.
cleanup() {
    [ -n "$PLAN" ] && rm -f "$PLAN"
    [ -n "$SNAP_TMP" ] && rm -f "$SNAP_TMP"
    return 0
}
trap cleanup EXIT

usage() {
    # Print the leading comment block, starting at line 3 and ending at the first non-comment
    # line. Do not hard-code the ending line number.
    awk 'NR>=3 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); print }' "$0"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --show) MODE=show ;;
        --snapshot) MODE=snapshot ;;
        --dry-run|--plan) MODE=plan ;;
        --apply) MODE=apply ;;
        --drop-disabled) DROP_DISABLED=1 ;;
        --from=*) PLAN_SOURCE="${1#--from=}" ;;
        -h|--help) usage; exit 0 ;;
        *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

jsonq() { "$PY" -c "import sys,json;d=json.load(sys.stdin);$1"; }

# Credentials come only from the local environment or secrets/webauthn.env, shared with pages_deploy.sh.
needs_network() {
    [ "$MODE" = show ] || [ "$MODE" = snapshot ] || [ "$MODE" = apply ]
}

if needs_network; then
    TOKEN="${CLOUDFLARE_API_TOKEN:-}"
    if [ -z "$TOKEN" ] && [ -f "$SECRETS_FILE" ]; then
        TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS_FILE" | tail -1)"
    fi
    if [ -z "$TOKEN" ]; then
        echo "FATAL: CLOUDFLARE_API_TOKEN not set and not found in $SECRETS_FILE" >&2
        echo "       live modes are --show / --snapshot / --apply; --dry-run needs no token." >&2
        exit 1
    fi
    export CLOUDFLARE_API_TOKEN="$TOKEN"
fi

api() {
    local method="$1" path="$2" body="${3:-}"
    local args=(-sS --max-time 30 -X "$method"
        -H "Authorization: Bearer $TOKEN"
        -H "Content-Type: application/json")
    if [ -n "$body" ]; then
        args+=(--data-binary "$body")
    fi
    local payload
    payload="$(curl "${args[@]}" "$API_BASE$path")"
    case "$method" in
        POST|PUT|PATCH|DELETE)
            if ! printf '%s' "$payload" | jsonq 'if d.get("success") is not True: raise SystemExit(json.dumps(d.get("errors"))[:300])'; then
                echo "FATAL: Cloudflare API rejected $method $path" >&2
                return 1
            fi
            ;;
    esac
    printf '%s' "$payload"
}

ZID=""
if needs_network; then
    ZONE_JSON="$(api GET "/zones?name=$ZONE_NAME" || true)"
    ZID="$(printf '%s' "$ZONE_JSON" | jsonq 'print((d.get("result") or [{}])[0].get("id",""))' || true)"
    if [ -z "$ZID" ]; then
        echo "FATAL: cannot resolve zone id for $ZONE_NAME (check CLOUDFLARE_API_TOKEN)" >&2
        exit 1
    fi
fi

# Fetch the current phase entrypoint (raw API response) to $1; exit on failure.
fetch_entrypoint() {
    local out="$1"
    api GET "/zones/$ZID$PHASE_PATH" > "$out"
    if ! jsonq 'print("ok" if d.get("success") else "fail")' < "$out" | grep -q '^ok$'; then
        echo "FATAL: Cloudflare API rejected the ruleset request:" >&2
        jsonq 'print(json.dumps(d.get("errors"))[:300])' < "$out" >&2 || true
        exit 1
    fi
}

# Snapshot documents use {captured_at, zone, phase, ruleset}; raw API responses use {result, success}.
# Printing and planning read the ruleset from either format, so --dry-run and live modes share logic.
print_rules() {
    "$PY" - "$1" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
res = doc.get("result") or doc.get("ruleset") or {}
print(f"ruleset v{res.get('version')} / {res.get('last_updated')}")
for rule in res.get("rules") or []:
    expression = rule.get("expression", "")
    if len(expression) > 48:
        expression = expression[:45] + "..."
    print(f"  {str(rule.get('action')):13} enabled={str(rule.get('enabled')):6} {expression}")
print(f"  custom rule quota used: {len(res.get('rules') or [])}/5")
PY
}

if [ "$MODE" = plan ]; then
    # Offline mode uses only the local snapshot and never makes a network request.
    if [ ! -f "$PLAN_SOURCE" ]; then
        echo "FATAL: snapshot not found: $PLAN_SOURCE" >&2
        echo "       run 'bash ops/waf_rules.sh --snapshot' once to create it." >&2
        exit 1
    fi
    SNAPFILE="$PLAN_SOURCE"
else
    SNAP_TMP="$(mktemp)"
    SNAPFILE="$SNAP_TMP"
    fetch_entrypoint "$SNAPFILE"
fi

if [ "$MODE" = show ]; then
    print_rules "$SNAPFILE"
    exit 0
fi

# Convert $SNAPFILE (raw API response) into a repository snapshot. Report the existing snapshot's
# size before overwriting it so the historical ruleset used by the README is not replaced silently.
write_snapshot() {
    mkdir -p "$SNAP_DIR"
    if [ -f "$SNAP" ]; then
        "$PY" - "$SNAP" <<'PY' >&2 || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        doc = json.load(handle)
except (OSError, ValueError):
    print("previous snapshot: unreadable")
else:
    ruleset = doc.get("ruleset") or {}
    print(f"previous snapshot: {len(ruleset.get('rules') or [])} rules, captured_at {doc.get('captured_at')}")
PY
    fi
    "$PY" - "$SNAPFILE" "$ZONE_NAME" > "$SNAP" <<'PY'
import datetime, json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
out = {
    "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "zone": sys.argv[2],
    "phase": "http_request_firewall_custom",
    "ruleset": doc.get("result") or {},
}
json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
PY
    "$PY" - "$SNAP" <<'PY' >&2 || true
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
ruleset = doc.get("ruleset") or {}
print(f"new snapshot: {len(ruleset.get('rules') or [])} rules")
PY
    echo "wrote $SNAP"
}

if [ "$MODE" = snapshot ]; then
    write_snapshot
    print_rules "$SNAPFILE"
    exit 0
fi

if [ "$MODE" = plan ]; then
    echo "source"
    "$PY" - "$SNAPFILE" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
print(f"  {sys.argv[1]}")
if doc.get("captured_at"):
    print(f"  captured_at {doc['captured_at']}")
PY
    echo
    echo "current"
    print_rules "$SNAPFILE"
    echo
fi

# Planning: Python writes only an action table as TSV; Bash reads it line by line without string interpolation.
PLAN="$(mktemp)"
"$PY" - "$SNAPFILE" "$DROP_DISABLED" > "$PLAN" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    doc = json.load(handle)
drop_disabled = sys.argv[2] == "1"
ruleset = doc.get("result") or doc.get("ruleset") or {}
single_ip = re.compile(r"ip\.src eq ([0-9a-fA-F.:]+)")
for rule in ruleset.get("rules") or []:
    expression = (rule.get("expression") or "").strip()
    match = single_ip.fullmatch(expression)
    if rule.get("action") == "skip" and match:
        rule_id = rule.get("id")
        if rule.get("enabled") is not False and not rule_id:
            raise SystemExit("enabled single-IP skip rule is missing its id")
        print(f"access-rule\t{match.group(1)}\tskip(single IP) -> IP Access Rule whitelist")
        if rule.get("enabled") is not False:
            print(f"delete\t{rule_id}\tdelete migrated custom skip rule")
    elif drop_disabled and rule.get("enabled") is False:
        print(f"delete\t{rule.get('id') or ''}\tdelete (disabled rule)")
PY

"$PY" - "$PLAN" <<'PY'
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    rows = [line.rstrip("\n").split("\t") for line in handle if line.strip()]
adds = [row for row in rows if row[0] == "access-rule"]
deletes = [row for row in rows if row[0] == "delete"]
print("plan")
for kind, value, why in rows:
    print(f"  {kind:<12} {value:<34} {why}")
if not rows:
    print("  (nothing to do)")
print(f"  new IP Access Rules: {len(adds)}")
print(f"  rules to delete: {len(deletes)}")
PY
echo

if [ "$MODE" != apply ]; then
    echo "(dry-run: nothing changed. pass --apply to execute)"
    exit 0
fi

echo "execute"
while IFS=$'\t' read -r kind value why; do
    [ -n "${kind:-}" ] || continue
    case "$kind" in
        access-rule)
            body="{\"mode\":\"whitelist\",\"configuration\":{\"target\":\"ip\",\"value\":\"$value\"},\"notes\":\"limooo: bypass security for trusted IP (migrated from custom skip rule)\"}"
            api POST "/zones/$ZID/firewall/access_rules/rules" "$body" \
                | jsonq 'print("  access rule:", "OK" if d.get("success") else "FAIL " + json.dumps(d.get("errors"))[:160])'
            ;;
        delete)
            RULESET_ID="$(jsonq 'print((d.get("result") or {}).get("id",""))' < "$SNAPFILE")"
            api DELETE "/zones/$ZID/rulesets/$RULESET_ID/rules/$value" \
                | jsonq 'print("  deleted rule:", "OK" if d.get("success") else "FAIL " + json.dumps(d.get("errors"))[:160])'
            ;;
        *)
            echo "  unknown plan row: $kind" >&2
            ;;
    esac
done < "$PLAN"

fetch_entrypoint "$SNAPFILE"
write_snapshot
echo
echo "result"
print_rules "$SNAPFILE"
echo "snapshot: $SNAP"
