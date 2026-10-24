#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

# Limooo D1 migration entry point.
#
# Usage:
#   bash ops/migrate_d1.sh --dry-run                 # print the plan only; fully offline
#   bash ops/migrate_d1.sh --remote                  # apply unapplied migrations to production D1
#   bash ops/migrate_d1.sh --check-schema --remote   # read-only check that all tables exist
#
# D1's schema_version table is the sole source of truth for whether a migration was applied.
# The repository's .d1-migrations/applied file is only a cache for offline plans. Older versions
# of this script could run against local .wrangler SQLite without --remote and still record the
# migration, so that cache is not trusted and is no longer used to decide whether to skip.
#
# Back up D1 before migrating (see docs/parallel-actions.md).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/ops/migrations"
STATE_FILE="${D1_STATE_FILE:-$ROOT/.d1-migrations/applied}"
LEGACY_STATE_FILE="/tmp/limooo-d1-schema-state"
D1_DATABASE_NAME="${D1_DATABASE_NAME:-limooo}"
# A saved wrangler --json payload makes --check-schema fully offline (for debugging and tests).
SCHEMA_JSON_FILE="${LIMOOO_D1_SCHEMA_JSON:-}"
WRANGLER_BIN="${WRANGLER_BIN:-}"
if [ -n "$WRANGLER_BIN" ]; then
    WRANGLER_CMD=("$WRANGLER_BIN")
else
    WRANGLER_CMD=(npx --no-install wrangler)
fi

DRY_RUN=0
REMOTE=0
CHECK_SCHEMA=0

usage() {
    cat <<'EOF'
Usage: bash ops/migrate_d1.sh [--dry-run] [--remote] [--check-schema]

  --dry-run       print the migration plan only; never contacts D1 (works offline).
  --remote        run against the remote (production) D1 database. Required for
                  --check-schema and for applying migrations: the old local mode
                  executed against the local .wrangler sqlite while still recording
                  the files as applied, so production silently never got the change.
  --check-schema  check that remote D1 has every expected table; no migration.

Applied state: the D1 table schema_version is the single source of truth. Its key is
version * 1000 + sequence (004_schema_version.sql -> 4003), so files sharing a number
stay distinguishable. Rows written by older versions of this script carry the plain
version number and still count as applied for every file with that number. New
migrations must use the next free number (the highest number in ops/migrations/ plus
one): duplicate numbers are reported, and a legacy row can never tell them apart.

Offline schema check: set LIMOOO_D1_SCHEMA_JSON=<file> to the payload of
  wrangler d1 execute limooo --command "SELECT name FROM sqlite_master WHERE type='table'" --json
and --check-schema validates that payload without contacting D1 (debug and tests).
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --remote) REMOTE=1 ;;
        --check-schema) CHECK_SCHEMA=1 ;;
        --help|-h) usage; exit 0 ;;
        *) echo "FATAL: unknown argument $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

if [ ! -d "$MIGRATIONS_DIR" ]; then
    echo "FATAL: migrations directory not found: $MIGRATIONS_DIR" >&2
    exit 1
fi

# Mode validation (W3-4 / W3-5):
#   * Applying without --remote would run against local SQLite but record the migration as
#     applied, so reject it.
#   * --check-schema without --remote would inspect only the local database and can fail on
#     empty array expansion in bash versions earlier than 4.4, so require an explicit target.
#     For an offline check, set LIMOOO_D1_SCHEMA_JSON.
#   * --dry-run is fully offline and is not affected by this restriction.
if [ "$DRY_RUN" = 0 ] && [ "$REMOTE" = 0 ]; then
    if [ "$CHECK_SCHEMA" = 1 ] && [ -n "$SCHEMA_JSON_FILE" ]; then
        : # Validate a saved sqlite_master payload offline without contacting D1.
    else
        echo "FATAL: --remote is required for --check-schema and for applying migrations" >&2
        echo "       use --dry-run for an offline plan, or set LIMOOO_D1_SCHEMA_JSON=<file>" >&2
        echo "       to validate a saved sqlite_master payload without contacting D1" >&2
        exit 2
    fi
fi

# Migrate the legacy temporary state file to the persistent repository location. It is only an
# offline plan cache and does not determine whether a migration was applied; D1 schema_version does.
if [ -f "$LEGACY_STATE_FILE" ] && [ ! -f "$STATE_FILE" ]; then
    mkdir -p "$(dirname "$STATE_FILE")"
    cp "$LEGACY_STATE_FILE" "$STATE_FILE"
    echo "[d1] migrated legacy plan cache to $STATE_FILE"
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

# Detect duplicate migration numbers (W3-8): three files use 004, and the legacy plain version
# number (version=4) cannot distinguish them. Warn without blocking because historical filenames
# cannot be changed; new migrations must use the next available number.
duplicate_seen=0
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
        duplicate_seen=1
        echo "[d1] warning: migration number $prefix is used by $count files:$group"
    fi
done
next_free="$(printf '%03d' "$((max_prefix + 1))")"
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

# Execute one SQL statement against remote D1; print Wrangler's full output on failure.
d1_execute_sql() {
    local sql="$1" log
    log="$(mktemp -t limooo-d1-sql-XXXXXX.log)"
    if "${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote --command "$sql" >"$log" 2>&1; then
        rm -f "$log"
        return 0
    fi
    echo "FATAL: wrangler d1 execute failed for: $sql" >&2
    cat "$log" >&2
    rm -f "$log"
    return 1
}

if [ "$CHECK_SCHEMA" = 1 ]; then
    expected=(apple_accounts blocked_ips visitors ray_log events visitors_v2 visitor_rollups ray_log_v2 visitors_daily retention_state schema_version blocklist_audit gate_failures identity_handoffs auth_credentials probes heartbeats probe_state probe_uptime_daily worker_runs)
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
            echo "FATAL: LIMOOO_D1_SCHEMA_JSON file not found: $SCHEMA_JSON_FILE" >&2
            exit 1
        fi
        echo "[d1] schema source: offline payload $SCHEMA_JSON_FILE"
        schema_payload="$(cat "$SCHEMA_JSON_FILE")"
    else
        echo "[d1] schema source: remote D1 ($D1_DATABASE_NAME)"
        schema_log="$(mktemp -t limooo-d1-schema-XXXXXX.log)"
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
    echo "[d1] cache file (advisory, gitignored): $STATE_FILE"
    echo "[d1] authoritative state: D1 table schema_version (read it with --remote)"
    exit 0
fi

echo "[d1] apply: database=$D1_DATABASE_NAME target=remote files=${#MIGRATION_NAMES[@]}"

# Create the state table first; it is the sole source of truth for migration state.
d1_execute_sql "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));" || exit 1

versions_log="$(mktemp -t limooo-d1-versions-XXXXXX.log)"
if versions_raw="$("${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote \
    --command "SELECT version FROM schema_version ORDER BY version" --json 2>"$versions_log")"; then
    rm -f "$versions_log"
else
    echo "FATAL: could not read schema_version from remote D1 ($D1_DATABASE_NAME)" >&2
    cat "$versions_log" >&2
    rm -f "$versions_log"
    exit 1
fi
recorded="$(json_int_values "$versions_raw" version)"
recorded_count=0
if [ -n "$recorded" ]; then
    recorded_count="$(printf '%s\n' "$recorded" | grep -c . || true)"
fi
echo "[d1] schema_version: rows=$recorded_count versions=$(printf '%s' "$recorded" | tr '\n' ',' | sed -E 's/,$//; s/^$/-/')"

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
    statements_file="$(mktemp -t limooo-d1-statements-XXXXXX)"
    if ! python3 - "$MIGRATIONS_DIR/$name" >"$statements_file" <<'PY'
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
    then
        echo "FATAL: could not split migration into complete SQL statements: $name" >&2
        rm -f "$statements_file"
        exit 1
    fi

    statement_count=0
    while IFS= read -r -d '' statement; do
        statement_count=$((statement_count + 1))
        apply_log="$(mktemp -t limooo-d1-apply-XXXXXX.log)"
        if "${WRANGLER_CMD[@]}" d1 execute "$D1_DATABASE_NAME" --remote --command "$statement" >"$apply_log" 2>&1; then
            rm -f "$apply_log"
        elif grep -Eq 'duplicate column name:' "$apply_log"; then
            echo "[d1] skip (column already exists): $name"
            rm -f "$apply_log"
        else
            echo "FATAL: migration failed: $name" >&2
            echo "       No schema_version row was written; inspect the schema and repair this migration before retrying." >&2
            cat "$apply_log" >&2
            rm -f "$apply_log" "$statements_file"
            exit 1
        fi
    done < "$statements_file"
    rm -f "$statements_file"
    if [ "$statement_count" -eq 0 ]; then
        echo "FATAL: migration contains no SQL statements: $name" >&2
        exit 1
    fi

    if ! d1_execute_sql "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES ($key, datetime('now'));"; then
        echo "FATAL: could not record $name (key=$key) in schema_version; rerun after fixing D1 access" >&2
        exit 1
    fi
    echo "[d1] recorded: $name key=$key"
    applied=$((applied + 1))
    applied_names+=("$name")
done

# Refresh the local cache only after every remote migration succeeds, replacing it entirely to
# remove stale entries (W3-5).
mkdir -p "$(dirname "$STATE_FILE")"
cache_tmp="$(mktemp -t limooo-d1-cache-XXXXXX)"
printf '%s\n' "${applied_names[@]+"${applied_names[@]}"}" > "$cache_tmp"
mv "$cache_tmp" "$STATE_FILE"
echo "[d1] plan cache refreshed: $STATE_FILE"

echo "[d1] done: applied=$applied skipped=$skipped"
