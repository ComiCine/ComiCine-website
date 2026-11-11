#!/usr/bin/env bash

# ComiCine site project
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine D1 migration entry point.
#
# Usage:
#   bash ops/migrate_d1.sh --dry-run                 # print the plan only; fully offline
#   bash ops/migrate_d1.sh --remote                  # apply unapplied migrations to production D1
#   bash ops/migrate_d1.sh --check-schema --remote   # read-only check that all tables exist
#   bash ops/migrate_d1.sh --repair --remote         # record an interrupted 004_blocklist_sync
#
# D1's schema_version table is the sole source of truth for whether a migration was applied.
# The repository's .d1-migrations/applied file is only a cache for offline plans. Older versions
# of this script could run against local .wrangler SQLite without --remote and still record the
# migration, so that cache is not trusted and is no longer used to decide whether to skip.
#
# migration_checksums (created by 024) stores the sha256 of every applied migration file. A run
# compares each applied file with its row and stops before any migration statement when one changed:
# an applied migration must never be edited, because a database that already ran it never sees the
# edit. Missing rows are recorded after a successful run, which is how the first run after this
# upgrade baselines the files that are already applied.
#
# Back up D1 before migrating (see ops/cloudflare/README.md, "Migration and rollback").

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/ops/migrations"
STATE_FILE="${D1_STATE_FILE:-$ROOT/.d1-migrations/applied}"
D1_DATABASE_NAME="${D1_DATABASE_NAME:-comicine}"
# A saved wrangler --json payload makes --check-schema fully offline (for debugging and tests).
SCHEMA_JSON_FILE="${COMICINE_D1_SCHEMA_JSON:-}"
WRANGLER_BIN="${WRANGLER_BIN:-}"
if [ -n "$WRANGLER_BIN" ]; then
    WRANGLER_CMD=("$WRANGLER_BIN")
else
    WRANGLER_CMD=(npx --no-install wrangler)
fi

DRY_RUN=0
REMOTE=0
CHECK_SCHEMA=0
REPAIR=0

# The blocklist rebuild and its post-004 recovery tail. The tail lives in a subdirectory so the
# normal loop (maxdepth 1) never treats it as a versioned migration and the 4001/4002/4003 keys
# cannot shift.
BLOCKLIST_MIGRATION="004_blocklist_sync.sql"
BLOCKLIST_REPAIR_FILE="ops/migrations/repair/004_blocklist_sync_post004.sql"
BLOCKLIST_REPAIR_PATH="$ROOT/ops/migrations/repair/004_blocklist_sync_post004.sql"
# Column set 004_blocklist_sync.sql leaves behind; a blocked_ips table with all of them is in the
# recoverable post-004 state even when schema_version has no row for the key.
POST_004_COLUMNS="cidr network prefix reason source created_at updated_at updated_by active"

CHECKSUM_TABLE_DDL="CREATE TABLE IF NOT EXISTS migration_checksums (version INTEGER PRIMARY KEY, filename TEXT NOT NULL, sha256 TEXT NOT NULL, recorded_at TEXT NOT NULL DEFAULT (datetime('now')));"

# State filled by the preflight and the version/checksum readers.
MIGRATION_TABLES=""
recorded=""
recorded_count=0
newly_applied=""
CHECKSUM_TABLE_PRESENT=0
CHECKSUM_ROWS=""
CHECKSUM_SHAS=()

usage() {
    cat <<'EOF'
Usage: bash ops/migrate_d1.sh [--dry-run] [--remote] [--check-schema] [--repair]

  --dry-run       print the migration plan only; never contacts D1 (works offline).
  --remote        run against the remote (production) D1 database. Required for
                  --check-schema and for applying migrations: the old local mode
                  executed against the local .wrangler sqlite while still recording
                  the files as applied, so production silently never got the change.
  --check-schema  check that remote D1 has every expected table; no migration.
  --repair        recovery mode for an interrupted 004_blocklist_sync run: replay the
                  post-004 tail in ops/migrations/repair/ and record key 4002. Requires
                  --remote. It refuses when the version is already recorded, when the
                  blocklist table is still legacy, when blocked_ips_new holds rows next
                  to blocked_ips, and when the replay changes the row count. Add
                  --dry-run to print the preconditions without contacting D1.

Applied state: the D1 table schema_version is the single source of truth. Its key is
version * 1000 + sequence (004_schema_version.sql -> 4003), so files sharing a number
stay distinguishable. Rows written by older versions of this script carry the plain
version number and still count as applied for every file with that number. New
migrations must use the next free number (the highest number in ops/migrations/ plus
one): duplicate numbers are reported, and a legacy row can never tell them apart.

Checksums: migration_checksums holds the sha256 of every applied migration file. A run
refuses to continue when an applied file changed on disk, and records missing rows (the
first run after an upgrade baselines the files that are already applied).

Offline schema check: set COMICINE_D1_SCHEMA_JSON=<file> to the payload of
  wrangler d1 execute comicine --command "SELECT name FROM sqlite_master WHERE type='table'" --json
and --check-schema validates that payload without contacting D1 (debug and tests).
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --remote) REMOTE=1 ;;
        --check-schema) CHECK_SCHEMA=1 ;;
        --repair) REPAIR=1 ;;
        --help|-h) usage; exit 0 ;;
        *) echo "FATAL: unknown argument $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "FATAL: migrations directory not found: $MIGRATIONS_DIR" >&2
    exit 1
fi

# --repair rewrites the recorded state of an existing database, so it needs an explicit target and
# cannot share a run with the read-only schema check.
if [ "$REPAIR" = 1 ] && [ "$CHECK_SCHEMA" = 1 ]; then
    echo "FATAL: --repair cannot be combined with --check-schema" >&2
    exit 2
fi
if [ "$REPAIR" = 1 ] && [ "$DRY_RUN" = 0 ] && [ "$REMOTE" = 0 ]; then
    echo "FATAL: --remote is required for --repair" >&2
    echo "       --repair writes to remote D1; use --dry-run for the offline precondition list" >&2
    exit 2
fi

# Mode validation (W3-4 / W3-5):
#   * Applying without --remote would run against local SQLite but record the migration as
#     applied, so reject it.
#   * --check-schema without --remote would inspect only the local database and can fail on
#     empty array expansion in bash versions earlier than 4.4, so require an explicit target.
#     For an offline check, set COMICINE_D1_SCHEMA_JSON.
#   * --dry-run is fully offline and is not affected by this restriction.
if [ "$DRY_RUN" = 0 ] && [ "$REMOTE" = 0 ]; then
    if [ "$CHECK_SCHEMA" = 1 ] && [ -n "$SCHEMA_JSON_FILE" ]; then
        : # Validate a saved sqlite_master payload offline without contacting D1.
    else
        echo "FATAL: --remote is required for --check-schema and for applying migrations" >&2
        echo "       use --dry-run for an offline plan, or set COMICINE_D1_SCHEMA_JSON=<file>" >&2
        echo "       to validate a saved sqlite_master payload without contacting D1" >&2
        exit 2
    fi
fi

MIGRATION_NAMES=()
while IFS= read -r file; do
    name="$(basename "$file")"
    if ! [[ "$name" =~ ^[0-9]{3}_[A-Za-z0-9_-]+\.sql$ ]]; then
        echo "FATAL: migration filename does not match 001_name.sql convention: $name" >&2
        exit 1
    fi
    MIGRATION_NAMES+=("$name")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

# Detect duplicate migration numbers (W3-8). The three historical 004 files are a known group
# whose sequence keys must stay stable; report that mapping as information. Warn for any other
# duplicate group so new migrations cannot silently make an existing key ambiguous.
duplicate_seen=0
legacy_004_seen=0
max_prefix=0
warned_prefixes=" "
for name in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
    prefix="${name%%_*}"
    if [ "$((10#$prefix))" -gt "$max_prefix" ]; then
        max_prefix="$((10#$prefix))"
    fi
    case "$warned_prefixes" in
        *" $prefix "*) continue ;;
    esac
    group=""
    count=0
    for other in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
        if [ "${other%%_*}" = "$prefix" ]; then
            count=$((count + 1))
            group="$group $other"
        fi
    done
    if [ "$count" -gt 1 ]; then
        warned_prefixes="$warned_prefixes$prefix "
        if [ "$prefix" = "004" ] && [ "$group" = " 004_auth_sessions.sql 004_blocklist_sync.sql 004_schema_version.sql" ]; then
            legacy_004_seen=1
        else
            duplicate_seen=1
            echo "[d1] warning: migration number $prefix is used by $count files:$group"
        fi
    fi
done
next_free="$(printf '%03d' "$((max_prefix + 1))")"
if [ "$legacy_004_seen" = 1 ]; then
    echo "[d1] legacy migration group 004 uses stable keys 4001, 4002, and 4003; legacy version 4 marks all three as applied; next free number is $next_free"
fi
if [ "$duplicate_seen" = 1 ]; then
    echo "[d1] warning: a legacy version row cannot tell duplicate numbers apart; new migrations must use the next free number ($next_free)"
fi

# Migration key: version * 1000 + the file's 1-based sequence among files with the same number.
# This gives files with duplicate numbers distinct keys.
migration_key() {
    local name="$1" prefix seq=0 other
    prefix="${name%%_*}"
    for other in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
        if [ "${other%%_*}" = "$prefix" ]; then
            seq=$((seq + 1))
            [ "$other" = "$name" ] && break
        fi
    done
    echo "$((10#$prefix * 1000 + seq))"
}

migration_prefix() {
    local name="$1"
    echo "$((10#${name%%_*}))"
}

if [ -f "$MIGRATIONS_DIR/$BLOCKLIST_MIGRATION" ]; then
    BLOCKLIST_KEY="$(migration_key "$BLOCKLIST_MIGRATION")"
else
    BLOCKLIST_KEY=4002
fi
BLOCKLIST_VERSION="$(migration_prefix "$BLOCKLIST_MIGRATION")"

# Local cache for offline plans: a match means status 0.
is_cached() {
    local name="$1"
    if [ -f "$STATE_FILE" ]; then
        grep -Fxq -- "$name" "$STATE_FILE"
    else
        return 1
    fi
}

# Check whether newline-separated text contains an exact line; avoid SIGPIPE from grep -q exiting early.
line_has() {
    local value="$1" lines="$2"
    if [ -z "$lines" ]; then
        return 1
    fi
    grep -Fxq -- "$value" <<< "$lines"
}

# Check whether a space-separated list contains an exact word (bash 3.2 has no associative arrays).
word_has() {
    case " ${2:-} " in
        *" $1 "*) return 0 ;;
    esac
    return 1
}

# Check whether the preflight query saw a table with this exact name.
has_table() {
    line_has "$1" "$MIGRATION_TABLES"
}

# Extract all values for an integer key from a wrangler --json payload, one per line.
json_int_values() {
    local payload="$1" key="$2"
    printf '%s' "$payload" \
        | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*[0-9]+" \
        | sed -E 's/^[^0-9]*([0-9]+)$/\1/' || true
}

# Extract the exact set of table names from a wrangler --json payload, sorted and deduplicated,
# with one name per line. Compare exact names, not substrings: visitors must not match visitors_v2 (W3-7).
json_table_names() {
    local payload="$1"
    printf '%s' "$payload" \
        | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' \
        | sed -E 's/^"name"[[:space:]]*:[[:space:]]*"([^"]+)"$/\1/' \
        | sort -u || true
}

# Print the `name` column of a wrangler --json payload, one per line. Used for sqlite_master
# (table names) and PRAGMA table_info (column names); both payloads are validated strictly.
json_name_column() {
    python3 -c '
import json
import sys

payload = json.load(sys.stdin)
if isinstance(payload, list):
    if len(payload) != 1:
        raise SystemExit("expected one result set")
    payload = payload[0]
if not isinstance(payload, dict) or payload.get("success") is not True:
    raise SystemExit("unexpected Wrangler response")
rows = payload.get("results")
if not isinstance(rows, list):
    raise SystemExit("missing result rows")
for row in rows:
    if not isinstance(row, dict) or not isinstance(row.get("name"), str):
        raise SystemExit("unexpected row")
    print(row["name"])
'
}

# Print the first integer value of one column from a wrangler --json payload.
json_int_column() {
    python3 -c '
import json
import sys

column = sys.argv[1]
payload = json.load(sys.stdin)
if isinstance(payload, list):
    if len(payload) != 1:
        raise SystemExit("expected one result set")
    payload = payload[0]
if not isinstance(payload, dict) or payload.get("success") is not True:
    raise SystemExit("unexpected Wrangler response")
rows = payload.get("results")
if not isinstance(rows, list) or not rows:
    raise SystemExit("missing result rows")
value = rows[0].get(column)
if not isinstance(value, int):
    raise SystemExit("unexpected row")
print(value)
' "$1"
}

# Print "<version> <sha256>" for every migration_checksums row.
json_checksum_rows() {
    python3 -c '
import json
import sys

payload = json.load(sys.stdin)
if isinstance(payload, list):
    if len(payload) != 1:
        raise SystemExit("expected one result set")
    payload = payload[0]
if not isinstance(payload, dict) or payload.get("success") is not True:
    raise SystemExit("unexpected Wrangler response")
rows = payload.get("results")
if not isinstance(rows, list):
    raise SystemExit("missing result rows")
for row in rows:
    if not isinstance(row, dict):
        raise SystemExit("unexpected checksum row")
    try:
        version = int(row.get("version"))
    except (TypeError, ValueError):
        raise SystemExit("unexpected checksum row")
    digest = row.get("sha256")
    if not isinstance(digest, str) or not digest:
        raise SystemExit("unexpected checksum row")
    print(f"{version} {digest}")
'
}

# Execute one SQL statement against remote D1; print Wrangler's full output on failure.
d1_execute_sql() {
    local sql="$1" log
    log="$(mktemp -t comicine-d1-sql-XXXXXX.log)"
    if "${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote --command "$sql" >"$log" 2>&1; then
        rm -f "$log"
        return 0
    fi
    echo "FATAL: wrangler d1 execute failed for: $sql" >&2
    cat "$log" >&2
    rm -f "$log"
    return 1
}

# Run one read-only query against remote D1 and print its --json payload. The label completes the
# sentence "FATAL: could not <label> from remote D1".
d1_query_json() {
    local sql="$1" label="$2" log payload
    log="$(mktemp -t comicine-d1-query-XXXXXX.log)"
    if payload="$("${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote --command "$sql" --json 2>"$log")"; then
        rm -f "$log"
        printf '%s' "$payload"
        return 0
    fi
    echo "FATAL: could not $label from remote D1 ($D1_DATABASE_NAME)" >&2
    cat "$log" >&2
    rm -f "$log"
    return 1
}

# Split a migration file into NUL-separated complete SQL statements written to <out>.
split_sql_statements() {
    local path="$1" out="$2"
    python3 - "$path" >"$out" <<'PY'
import sqlite3
import sys

source = sys.argv[1]
pending = ""
with open(source, encoding="utf-8") as handle:
    for line in handle:
        pending += line
        if sqlite3.complete_statement(pending):
            statement = pending.strip()
            if statement:
                sys.stdout.write(statement + "\0")
            pending = ""

if pending.strip() and any(
    line.strip() and not line.lstrip().startswith("--") for line in pending.splitlines()
):
    raise SystemExit(f"incomplete SQL statement at end of {source}")
PY
}

# Execute every statement of a split migration file; stop at the first real failure.
execute_sql_statements() {
    local label="$1" statements_file="$2" statement statement_count=0 apply_log
    while IFS= read -r -d '' statement; do
        statement="$(printf '%s\n' "$statement" | sed '/^[[:space:]]*--/d')"
        if [ -z "${statement//[[:space:]]/}" ]; then
            continue
        fi
        statement_count=$((statement_count + 1))
        apply_log="$(mktemp -t comicine-d1-apply-XXXXXX.log)"
        if "${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote --command "$statement" >"$apply_log" 2>&1; then
            rm -f "$apply_log"
        elif grep -Eq 'duplicate column name:' "$apply_log"; then
            echo "[d1] skip (column already exists): $label"
            rm -f "$apply_log"
        else
            echo "FATAL: migration failed: $label" >&2
            echo "       No schema_version row was written; inspect the schema and repair this migration before retrying." >&2
            cat "$apply_log" >&2
            rm -f "$apply_log"
            return 1
        fi
    done < "$statements_file"
    if [ "$statement_count" -eq 0 ]; then
        echo "FATAL: migration contains no SQL statements: $label" >&2
        return 1
    fi
    return 0
}

# Split and execute one SQL file. The normal loop and --repair share this path so both report
# duplicate-column skips and statement failures with exactly the same wording.
apply_sql_file() {
    local label="$1" path="$2" statements_file
    statements_file="$(mktemp -t comicine-d1-statements-XXXXXX)"
    if ! split_sql_statements "$path" "$statements_file"; then
        echo "FATAL: could not split migration into complete SQL statements: $label" >&2
        rm -f "$statements_file"
        return 1
    fi
    if ! execute_sql_statements "$label" "$statements_file"; then
        rm -f "$statements_file"
        return 1
    fi
    rm -f "$statements_file"
    return 0
}

# Apply a versioned migration by name.
apply_migration_file() {
    apply_sql_file "$1" "$MIGRATIONS_DIR/$1"
}

# Read the table list from the one preflight query. Nothing may write before this and its guard.
inspect_migration_state() {
    local preflight_raw
    if ! preflight_raw="$(d1_query_json \
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('blocked_ips', 'blocked_ips_new', 'schema_version', 'migration_checksums') ORDER BY name" \
        "inspect blocklist migration state")"; then
        exit 1
    fi
    if ! MIGRATION_TABLES="$(json_name_column <<< "$preflight_raw" 2>/dev/null)"; then
        echo "FATAL: could not parse the remote blocklist migration state; refusing to run migrations" >&2
        exit 1
    fi
}

# The blocklist rebuild's dangerous state: blocked_ips_new may be the only surviving copy, so no
# write may run and it must never be dropped automatically.
require_blocklist_not_orphaned() {
    if has_table blocked_ips_new && ! has_table blocked_ips; then
        echo "FATAL: interrupted blocklist migration detected: blocked_ips_new exists but blocked_ips is missing" >&2
        echo "       blocked_ips_new may be the only surviving copy of the blocklist; no SQL write was executed" >&2
        echo "       inspect the table and restore the blocklist manually before rerunning migrations" >&2
        exit 1
    fi
}

# Read schema_version (the sole source of truth) and print the same summary line as before.
load_recorded_versions() {
    local versions_raw
    if ! versions_raw="$(d1_query_json "SELECT version FROM schema_version ORDER BY version" "read schema_version")"; then
        exit 1
    fi
    recorded="$(json_int_values "$versions_raw" version)"
    recorded_count=0
    if [ -n "$recorded" ]; then
        recorded_count="$(printf '%s\n' "$recorded" | grep -c . || true)"
    fi
    echo "[d1] schema_version: rows=$recorded_count versions=$(printf '%s' "$recorded" | tr '\n' ',' | sed -E 's/,$//; s/^$/-/')"
}

# sha256 of every migration file, kept in MIGRATION_NAMES order.
load_migration_checksums() {
    local checksum_file sha name
    checksum_file="$(mktemp -t comicine-d1-checksums-XXXXXX)"
    if ! python3 - "$MIGRATIONS_DIR" "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}" >"$checksum_file" <<'PY'
import hashlib
import os
import sys

root = sys.argv[1]
for name in sys.argv[2:]:
    path = os.path.join(root, name)
    if not os.path.isfile(path):
        raise SystemExit(f"migration file is missing: {path}")
    with open(path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    print(f"{digest} {name}")
PY
    then
        echo "FATAL: could not compute the sha256 of the migration files" >&2
        rm -f "$checksum_file"
        exit 1
    fi
    CHECKSUM_SHAS=()
    while read -r sha name; do
        if [ -z "$sha" ]; then
            continue
        fi
        CHECKSUM_SHAS+=("$sha")
    done < "$checksum_file"
    rm -f "$checksum_file"
    if [ "${#CHECKSUM_SHAS[@]}" -ne "${#MIGRATION_NAMES[@]}" ]; then
        echo "FATAL: could not compute the sha256 of every migration file" >&2
        exit 1
    fi
}

# Print the sha256 of one migration file.
checksum_for_name() {
    local target="$1" index=0
    while [ "$index" -lt "${#MIGRATION_NAMES[@]}" ]; do
        if [ "${MIGRATION_NAMES[$index]}" = "$target" ]; then
            printf '%s' "${CHECKSUM_SHAS[$index]}"
            return 0
        fi
        index=$((index + 1))
    done
    return 0
}

# Print the recorded sha256 for one migration key (empty when no row exists).
checksum_row_for_key() {
    local key="$1" stored_key stored_sha
    if [ -z "$CHECKSUM_ROWS" ]; then
        return 0
    fi
    while read -r stored_key stored_sha; do
        if [ "$stored_key" = "$key" ]; then
            printf '%s' "$stored_sha"
            return 0
        fi
    done <<< "$CHECKSUM_ROWS"
    return 0
}

# Read migration_checksums before anything is applied. Only called when the preflight saw the table.
load_checksum_rows() {
    local payload rows
    if ! payload="$(d1_query_json "SELECT version, sha256 FROM migration_checksums ORDER BY version" "read migration_checksums")"; then
        return 1
    fi
    if ! rows="$(json_checksum_rows <<< "$payload" 2>/dev/null)"; then
        echo "FATAL: could not parse the migration checksum rows from remote D1; refusing to run migrations" >&2
        return 1
    fi
    CHECKSUM_ROWS="$rows"
    return 0
}

# Refuse to run when an applied migration file changed on disk.
compare_applied_checksums() {
    local index=0 name key prefix stored current
    if [ "$CHECKSUM_TABLE_PRESENT" = 1 ]; then
        if ! load_checksum_rows; then
            exit 1
        fi
    fi
    while [ "$index" -lt "${#MIGRATION_NAMES[@]}" ]; do
        name="${MIGRATION_NAMES[$index]}"
        key="$(migration_key "$name")"
        prefix="$(migration_prefix "$name")"
        stored=""
        if [ "$CHECKSUM_TABLE_PRESENT" = 1 ]; then
            if line_has "$key" "$recorded" || line_has "$prefix" "$recorded"; then
                stored="$(checksum_row_for_key "$key")"
            fi
        fi
        if [ -n "$stored" ]; then
            current="${CHECKSUM_SHAS[$index]}"
            if [ "$stored" != "$current" ]; then
                echo "FATAL: migration checksum mismatch: $name (key=$key)" >&2
                echo "       recorded sha256: $stored" >&2
                echo "       current  sha256: $current" >&2
                echo "       An applied migration must not be edited. Restore it from Git:" >&2
                echo "         git checkout -- ops/migrations/$name" >&2
                echo "       If the change is intentional, add a new numbered migration instead. After a reviewed" >&2
                echo "       change to an applied file, update migration_checksums.version=$key manually." >&2
                exit 1
            fi
        fi
        index=$((index + 1))
    done
    return 0
}

# Detect a database left in the post-004 state without a recorded key. Replaying 004_blocklist_sync
# there fails on the legacy note/added_at columns, so stop before any migration statement and send
# the operator to --repair instead.
detect_interrupted_blocklist_migration() {
    local schema_raw columns missing="" column leftover
    if ! has_table blocked_ips; then
        return 0
    fi
    if line_has "$BLOCKLIST_KEY" "$recorded" || line_has "$BLOCKLIST_VERSION" "$recorded"; then
        return 0
    fi
    if ! schema_raw="$(d1_query_json "PRAGMA table_info(blocked_ips)" "read the blocked_ips schema")"; then
        exit 1
    fi
    if ! columns="$(json_name_column <<< "$schema_raw" 2>/dev/null)"; then
        echo "FATAL: could not parse the blocked_ips column list from remote D1; refusing to run migrations" >&2
        exit 1
    fi
    for column in $POST_004_COLUMNS; do
        if ! line_has "$column" "$columns"; then
            missing="${missing:+$missing }$column"
        fi
    done
    if [ -n "$missing" ]; then
        return 0
    fi
    if has_table blocked_ips_new; then
        leftover="$(table_row_count blocked_ips_new "count the leftover blocked_ips_new rows")" || exit 1
        if [ "$leftover" != "0" ]; then
            echo "FATAL: interrupted blocklist migration detected: blocked_ips_new holds $leftover rows next to the post-004 blocked_ips" >&2
            echo "       the state is ambiguous, so no SQL write was executed." >&2
            echo "       if blocked_ips is the complete post-004 table and blocked_ips_new is only the interrupted" >&2
            echo "       repair copy, drop the copy and retry:" >&2
            echo "         DROP TABLE blocked_ips_new;" >&2
            echo "         bash ops/migrate_d1.sh --repair --remote" >&2
            echo "       otherwise compare both tables and keep the copy that holds the data to preserve." >&2
            exit 1
        fi
    fi
    echo "FATAL: interrupted blocklist migration detected: blocked_ips already has the post-004 schema" >&2
    echo "       but schema_version has no row for $BLOCKLIST_MIGRATION (key=$BLOCKLIST_KEY)." >&2
    echo "       no SQL write was executed." >&2
    echo "       run: bash ops/migrate_d1.sh --repair --remote" >&2
    exit 1
}

# Print the current row count of one table.
table_row_count() {
    local table="$1" label="$2" payload count
    if ! payload="$(d1_query_json "SELECT COUNT(*) AS n FROM $table" "$label")"; then
        return 1
    fi
    if ! count="$(json_int_column n <<< "$payload" 2>/dev/null)"; then
        echo "FATAL: could not parse the $table row count from remote D1; refusing to continue" >&2
        return 1
    fi
    printf '%s' "$count"
}

# A legacy blocked_ips row with a NULL cidr cannot be copied into network NOT NULL; INSERT OR
# IGNORE would silently drop it. Refuse before 004 touches the table rather than lose the row.
count_legacy_null_cidr_rows() {
    local payload count
    if ! payload="$(d1_query_json "SELECT COUNT(*) AS n FROM blocked_ips WHERE cidr IS NULL" "count legacy blocked_ips rows with a NULL cidr")"; then
        return 1
    fi
    if ! count="$(json_int_column n <<< "$payload" 2>/dev/null)"; then
        echo "FATAL: could not parse the blocked_ips NULL-cidr count from remote D1; refusing to migrate" >&2
        return 1
    fi
    printf '%s' "$count"
}

# Record the sha256 of every applied migration that has no row yet. Called only after the apply
# loop finished, so every file is applied by this point; a run that applied a file (or baselined
# nothing) needs no write and reports the verified count instead.
record_migration_checksums() {
    local index=0 name key values="" rows=0
    while [ "$index" -lt "${#MIGRATION_NAMES[@]}" ]; do
        name="${MIGRATION_NAMES[$index]}"
        key="$(migration_key "$name")"
        if [ "$CHECKSUM_TABLE_PRESENT" = 1 ] && ! word_has "$key" "$newly_applied" \
            && [ -n "$(checksum_row_for_key "$key")" ]; then
            index=$((index + 1))
            continue
        fi
        values="$values${values:+, }($key, '$name', '${CHECKSUM_SHAS[$index]}')"
        rows=$((rows + 1))
        index=$((index + 1))
    done
    if [ "$rows" -eq 0 ]; then
        echo "[d1] checksums: verified ${#MIGRATION_NAMES[@]} applied migrations"
        return 0
    fi
    if ! d1_execute_sql "$CHECKSUM_TABLE_DDL"; then
        echo "FATAL: could not record migration checksums; rerun after fixing D1 access" >&2
        exit 1
    fi
    if ! d1_execute_sql "INSERT OR REPLACE INTO migration_checksums (version, filename, sha256) VALUES $values;"; then
        echo "FATAL: could not record migration checksums; rerun after fixing D1 access" >&2
        exit 1
    fi
    echo "[d1] checksums: recorded $rows sha256 rows"
}

if [ "$CHECK_SCHEMA" = 1 ]; then
    expected=(apple_accounts blocked_ips visitors ray_log events visitors_v2 visitor_rollups ray_log_v2 visitors_daily retention_state schema_version blocklist_audit gate_failures identity_handoffs auth_credentials probes heartbeats probe_state probe_uptime_daily worker_runs migration_checksums)
    if [ -f "$MIGRATIONS_DIR/008_auth_sessions.sql" ] || [ -f "$MIGRATIONS_DIR/004_auth_sessions.sql" ]; then
        expected+=(auth_sessions)
    fi
    echo "[d1] schema check: expected ${expected[*]}"
    if [ "$DRY_RUN" = 1 ]; then
        echo "[d1] dry-run: not connected to D1; the real run reads sqlite_master and validates the tables above."
        exit 0
    fi
    if [ -n "$SCHEMA_JSON_FILE" ]; then
        if [ ! -f "$SCHEMA_JSON_FILE" ]; then
            echo "FATAL: COMICINE_D1_SCHEMA_JSON file not found: $SCHEMA_JSON_FILE" >&2
            exit 1
        fi
        echo "[d1] schema source: offline payload $SCHEMA_JSON_FILE"
        schema_payload="$(cat "$SCHEMA_JSON_FILE")"
    else
        echo "[d1] schema source: remote D1 ($D1_DATABASE_NAME)"
        schema_log="$(mktemp -t comicine-d1-schema-XXXXXX.log)"
        if schema_payload="$("${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote \
            --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" \
            --json 2>"$schema_log")"; then
            rm -f "$schema_log"
        else
            echo "FATAL: could not read sqlite_master from remote D1 ($D1_DATABASE_NAME)" >&2
            cat "$schema_log" >&2
            rm -f "$schema_log"
            exit 1
        fi
    fi
    table_names="$(json_table_names "$schema_payload")"
    if [ -z "$table_names" ]; then
        echo "FATAL: no table names parsed from the D1 payload (expected sqlite_master JSON with a name field)" >&2
        exit 1
    fi
    echo "[d1] tables in D1: $(printf '%s' "$table_names" | tr '\n' ' ' | sed -E 's/ $//')"
    missing=()
    for table in "${expected[@]}"; do
        if ! grep -Fxq -- "$table" <<< "$table_names"; then
            missing+=("$table")
        fi
    done
    if [ "${#missing[@]}" -gt 0 ]; then
        echo "FATAL: D1 missing expected tables: ${missing[*]}" >&2
        exit 1
    fi
    echo "[d1] schema check: OK"
    exit 0
fi

# --repair --dry-run lists the preconditions only; it must stay fully offline.
if [ "$REPAIR" = 1 ]; then
    if [ "$DRY_RUN" = 1 ]; then
        echo "[d1] repair dry-run: requires schema_version with no key $BLOCKLIST_KEY, blocked_ips with the post-004 columns, no blocked_ips_new that holds rows (an empty leftover is dropped), an unchanged row count through $BLOCKLIST_REPAIR_FILE, and writes nothing; D1 is not contacted"
        if [ ! -f "$BLOCKLIST_REPAIR_PATH" ]; then
            echo "FATAL: repair file not found: $BLOCKLIST_REPAIR_PATH" >&2
            exit 1
        fi
        exit 0
    fi
    echo "[d1] repair: database=$D1_DATABASE_NAME target=remote file=$BLOCKLIST_REPAIR_FILE"
    inspect_migration_state
    if ! has_table schema_version; then
        echo "FATAL: --repair requires the schema_version table; it is missing, so the migration history is unknown" >&2
        exit 1
    fi
    load_recorded_versions
    if line_has "$BLOCKLIST_KEY" "$recorded" || line_has "$BLOCKLIST_VERSION" "$recorded"; then
        echo "FATAL: --repair refused: 004_blocklist_sync is already recorded (key=$BLOCKLIST_KEY); nothing to repair" >&2
        exit 1
    fi
    if has_table blocked_ips_new && ! has_table blocked_ips; then
        echo "FATAL: interrupted blocklist migration detected: blocked_ips_new exists but blocked_ips is missing" >&2
        echo "       blocked_ips_new may be the only surviving copy of the blocklist; no SQL write was executed" >&2
        echo "       inspect the table and restore the blocklist manually before rerunning migrations" >&2
        echo "       blocked_ips_new contains the completed rebuild; verify its row count and schema, then run" >&2
        echo "       ALTER TABLE blocked_ips_new RENAME TO blocked_ips; and rerun --repair." >&2
        exit 1
    fi
    if ! has_table blocked_ips; then
        echo "FATAL: --repair refused: blocked_ips does not exist, so there is no table to replay 004_blocklist_sync against" >&2
        exit 1
    fi
    if [ ! -f "$BLOCKLIST_REPAIR_PATH" ]; then
        echo "FATAL: --repair requires $BLOCKLIST_REPAIR_FILE; it is missing from this checkout" >&2
        exit 1
    fi
    if [ ! -f "$MIGRATIONS_DIR/$BLOCKLIST_MIGRATION" ]; then
        echo "FATAL: --repair requires $BLOCKLIST_MIGRATION; it is missing from this checkout" >&2
        exit 1
    fi
    if ! schema_raw="$(d1_query_json "PRAGMA table_info(blocked_ips)" "read the blocked_ips schema")"; then
        exit 1
    fi
    if ! columns="$(json_name_column <<< "$schema_raw" 2>/dev/null)"; then
        echo "FATAL: could not parse the blocked_ips column list from remote D1; refusing to repair" >&2
        exit 1
    fi
    missing=""
    for column in $POST_004_COLUMNS; do
        if ! line_has "$column" "$columns"; then
            missing="${missing:+$missing }$column"
        fi
    done
    if [ -n "$missing" ]; then
        echo "FATAL: --repair refused: blocked_ips does not have the post-004 schema (missing: $missing)" >&2
        echo "       run the normal migration plan instead: bash ops/migrate_d1.sh --remote" >&2
        exit 1
    fi
    if has_table blocked_ips_new; then
        leftover="$(table_row_count blocked_ips_new "count the leftover blocked_ips_new rows")" || exit 1
        if [ "$leftover" != "0" ]; then
            echo "FATAL: --repair refused: blocked_ips_new holds $leftover rows next to the post-004 blocked_ips" >&2
            echo "       the state is ambiguous, so no table was dropped and nothing was replayed." >&2
            echo "       if blocked_ips is the complete post-004 table and blocked_ips_new is only the interrupted" >&2
            echo "       repair copy, drop the copy and retry:" >&2
            echo "         DROP TABLE blocked_ips_new;" >&2
            echo "         bash ops/migrate_d1.sh --repair --remote" >&2
            echo "       otherwise compare both tables and keep the copy that holds the data to preserve." >&2
            exit 1
        fi
        if ! d1_execute_sql "DROP TABLE IF EXISTS blocked_ips_new;"; then
            echo "FATAL: --repair could not drop the empty blocked_ips_new; rerun after fixing D1 access" >&2
            exit 1
        fi
        echo "[d1] repair: dropped empty blocked_ips_new from an interrupted repair"
    fi
    if ! rows_before="$(table_row_count blocked_ips "count blocked_ips rows")"; then
        exit 1
    fi
    if ! load_migration_checksums; then
        exit 1
    fi
    echo "[d1] repair: replaying $BLOCKLIST_REPAIR_FILE (rows before=$rows_before)"
    if ! apply_sql_file "$BLOCKLIST_REPAIR_FILE" "$BLOCKLIST_REPAIR_PATH"; then
        exit 1
    fi
    if ! rows_after="$(table_row_count blocked_ips "count blocked_ips rows")"; then
        exit 1
    fi
    if [ "$rows_before" != "$rows_after" ]; then
        echo "FATAL: --repair row count changed: before=$rows_before after=$rows_after; the version was not recorded" >&2
        exit 1
    fi
    if ! d1_execute_sql "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES ($BLOCKLIST_KEY, datetime('now'));"; then
        echo "FATAL: could not record $BLOCKLIST_MIGRATION (key=$BLOCKLIST_KEY) in schema_version; rerun after fixing D1 access" >&2
        exit 1
    fi
    if ! d1_execute_sql "$CHECKSUM_TABLE_DDL"; then
        echo "FATAL: could not record migration checksums; rerun after fixing D1 access" >&2
        exit 1
    fi
    if ! d1_execute_sql "INSERT OR REPLACE INTO migration_checksums (version, filename, sha256) VALUES ($BLOCKLIST_KEY, '$BLOCKLIST_MIGRATION', '$(checksum_for_name "$BLOCKLIST_MIGRATION")');"; then
        echo "FATAL: could not record migration checksums; rerun after fixing D1 access" >&2
        exit 1
    fi
    echo "[d1] repair: recorded $BLOCKLIST_MIGRATION key=$BLOCKLIST_KEY"
    echo "[d1] repair: done rows=$rows_after"
    exit 0
fi

if [ "$DRY_RUN" = 1 ]; then
    echo "[d1] dry-run: ${#MIGRATION_NAMES[@]} migration files in order (D1 not contacted)"
    name_width=0
    for name in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
        if [ "${#name}" -gt "$name_width" ]; then
            name_width="${#name}"
        fi
    done
    for name in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
        if is_cached "$name"; then
            cache_label="yes"
        else
            cache_label="no"
        fi
        printf '  %-*s  key=%-6s cache=%s\n' "$name_width" "$name" "$(migration_key "$name")" "$cache_label"
    done
    echo "[d1] checksums: verified on --remote; a mismatch stops the run"
    echo "[d1] cache file (advisory, gitignored): $STATE_FILE"
    echo "[d1] authoritative state: D1 table schema_version (read it with --remote)"
    exit 0
fi

echo "[d1] apply: database=$D1_DATABASE_NAME target=remote files=${#MIGRATION_NAMES[@]}"

# Check the blocklist rebuild's recoverable state before the first SQL write. Migration 004 runs
# its statements separately; after DROP TABLE blocked_ips but before renaming blocked_ips_new, a
# retry would otherwise delete the only surviving copy of the blocklist at the start of the file.
inspect_migration_state
require_blocklist_not_orphaned

# Create the state table first; it is the sole source of truth for migration state.
d1_execute_sql "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));" || exit 1

load_recorded_versions

# A checksum row is only meaningful once the table exists; 024 creates it, but the first run after
# this upgrade may predate 024, in which case every applied file is baselined at the end.
if has_table migration_checksums; then
    CHECKSUM_TABLE_PRESENT=1
fi
load_migration_checksums
compare_applied_checksums

# The post-004 state with no recorded key cannot run 004_blocklist_sync.sql (it reads legacy
# columns); --repair replays the post-004 tail instead.
detect_interrupted_blocklist_migration

# 004 is still pending and the table is legacy at this point (detect_interrupted... would have
# stopped otherwise). Refuse to run the copy when a legacy NULL cidr would be silently dropped.
if ! line_has "$BLOCKLIST_KEY" "$recorded" && ! line_has "$BLOCKLIST_VERSION" "$recorded" && has_table blocked_ips; then
    null_cidr_rows="$(count_legacy_null_cidr_rows)" || exit 1
    if [ "$null_cidr_rows" != "0" ]; then
        echo "FATAL: legacy blocked_ips contains $null_cidr_rows row(s) with a NULL cidr" >&2
        echo "       the copy derives network from cidr (NOT NULL) and INSERT OR IGNORE would drop them" >&2
        echo "       repair or remove those rows first; no migration statement was executed" >&2
        exit 1
    fi
fi

applied_names=()
applied=0
skipped=0
for name in "${MIGRATION_NAMES[@]+"${MIGRATION_NAMES[@]}"}"; do
    key="$(migration_key "$name")"
    prefix="$(migration_prefix "$name")"
    if line_has "$key" "$recorded"; then
        echo "[d1] skip (recorded): $name key=$key"
        skipped=$((skipped + 1))
        applied_names+=("$name")
        continue
    fi
    if line_has "$prefix" "$recorded"; then
        echo "[d1] skip (recorded legacy version $prefix): $name key=$key"
        skipped=$((skipped + 1))
        applied_names+=("$name")
        continue
    fi

    echo "[d1] apply: $name key=$key"
    if ! apply_migration_file "$name"; then
        exit 1
    fi

    if ! d1_execute_sql "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES ($key, datetime('now'));"; then
        echo "FATAL: could not record $name (key=$key) in schema_version; rerun after fixing D1 access" >&2
        exit 1
    fi
    echo "[d1] recorded: $name key=$key"
    applied=$((applied + 1))
    applied_names+=("$name")
    newly_applied="${newly_applied:+$newly_applied }$key"
done

# Checksums are recorded only after every schema_version row is written; the local cache stays the
# last step so a failure here leaves it untouched.
record_migration_checksums

# Refresh the local cache only after every remote migration succeeds, replacing it entirely to
# remove stale entries (W3-5).
mkdir -p "$(dirname "$STATE_FILE")"
cache_tmp="$(mktemp -t comicine-d1-cache-XXXXXX)"
printf '%s\n' "${applied_names[@]+"${applied_names[@]}"}" > "$cache_tmp"
mv "$cache_tmp" "$STATE_FILE"
echo "[d1] plan cache refreshed: $STATE_FILE"

echo "[d1] done: applied=$applied skipped=$skipped"
