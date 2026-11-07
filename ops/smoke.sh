#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# Standalone, read-only post-deploy smoke checks for the public ComiCine sites.
#
# Unauthenticated GET requests only: no cookies, no credentials, no writes, so a
# run is safe to repeat and safe to schedule. This is a supplement to the checks
# built into ops/pages_deploy.sh and ops/docs_deploy.sh, never a replacement.
#
# Usage:
#   bash ops/smoke.sh [--host <host|origin>] [--docs-host <host>] [--status-host <host>]
#                     [--timeout <sec>] [--verbose] [--help]
#
# Defaults:
#   --host         comicine.com
#   --docs-host    docs.comicine.com
#   --status-host  status.comicine.com
#   --timeout      20 seconds per request
#
# Output:
#   stdout  OK <scope> <path> <code> for every check, then smoke: N passed, M failed
#   stderr  FAIL <scope> <path>: <reason> for every failed check
#   exit    0 when every check passed, 1 when any check failed, 2 on bad arguments
#
# A status-code mismatch is retried up to 3 attempts, 3 s apart, except after a
# 403 or 429. A missing content marker is reported immediately (the code matched).
#
# Scheduled use (no credentials, no cookies, safe to repeat), run from site/:
#   17 */6 * * *  bash ops/smoke.sh
#
# END-USAGE

set -euo pipefail

# Keep diagnostic text English even when the caller has a non-English locale.
unset LC_ALL
export LANG=C
export LC_MESSAGES=C

MAIN_HOST="comicine.com"
DOCS_HOST="docs.comicine.com"
STATUS_HOST="status.comicine.com"
TIMEOUT=20
VERBOSE=0

usage() {
    sed -n '/^# Standalone, read-only post-deploy smoke checks/,/^# END-USAGE/p' "$0" | sed '$d'
}

while [ $# -gt 0 ]; do
    case "$1" in
        --host|--docs-host|--status-host)
            if [ $# -lt 2 ] || [ -z "$2" ]; then
                echo "FATAL: $1 needs a host or origin" >&2
                exit 2
            fi
            case "$1" in
                --host) MAIN_HOST="$2" ;;
                --docs-host) DOCS_HOST="$2" ;;
                --status-host) STATUS_HOST="$2" ;;
            esac
            shift
            ;;
        --timeout)
            if [ $# -lt 2 ] || ! [[ "$2" =~ ^[0-9]+$ ]] || [ "$((10#$2))" -le 0 ]; then
                echo "FATAL: --timeout needs a positive integer (seconds)" >&2
                exit 2
            fi
            TIMEOUT="$((10#$2))"
            shift
            ;;
        --verbose) VERBOSE=1 ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "FATAL: unknown argument $1" >&2
            echo "       supported: --host / --docs-host / --status-host / --timeout / --verbose / --help" >&2
            exit 2
            ;;
    esac
    shift
done

# Accept both "host" and "origin": add https:// when no scheme is given, then
# remove any trailing slash so requests are always "<origin><path>".
normalize_origin() {
    local origin="$1"
    case "$origin" in
        http://*|https://*) ;;
        *) origin="https://$origin" ;;
    esac
    while [ "${origin%/}" != "$origin" ]; do
        origin="${origin%/}"
    done
    printf '%s' "$origin"
}

MAIN_ORIGIN="$(normalize_origin "$MAIN_HOST")"
DOCS_ORIGIN="$(normalize_origin "$DOCS_HOST")"
STATUS_ORIGIN="$(normalize_origin "$STATUS_HOST")"

BODY_FILE="$(mktemp -t comicine-smoke-XXXXXX)"
trap 'rm -f "$BODY_FILE"' EXIT

PASSED=0
FAILED=0

now_ms() {
    perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000'
}

# Print the marker for a failure message. Markers that already contain double
# quotes (the hreflang ones) are printed bare so the quotes are not doubled.
quote_marker() {
    local marker="$1"
    case "$marker" in
        *'"'*) printf '%s' "$marker" ;;
        *) printf '"%s"' "$marker" ;;
    esac
}

verbose_detail() {
    local url="$1" elapsed_ms="$2" target="${3:-stdout}"
    [ "$VERBOSE" = 1 ] || return 0
    if [ "$target" = stderr ]; then
        printf '  %-58s %s ms\n' "$url" "$elapsed_ms" >&2
    else
        printf '  %-58s %s ms\n' "$url" "$elapsed_ms"
    fi
}

# Record one failed check. Content failures are not retried: the status code
# already matched, so a retry would only repeat the same body.
fail_check() {
    local scope="$1" path="$2" reason="$3"
    printf 'FAIL %s %s: %s\n' "$scope" "$path" "$reason" >&2
    FAILED=$((FAILED + 1))
}

# One check: <scope> <path> <expected code> [contains:<marker>] [absent:<marker>] [count:<marker>:<n>]
# Every call ends in exactly one OK or FAIL line; the counters carry the result.
check() {
    local scope="$1" path="$2" expected="$3"
    shift 3
    local origin url code attempt
    local start_ms="" elapsed_ms="-" end_ms
    local spec kind value count needle expected_count

    case "$scope" in
        main) origin="$MAIN_ORIGIN" ;;
        docs) origin="$DOCS_ORIGIN" ;;
        status) origin="$STATUS_ORIGIN" ;;
    esac
    url="${origin}${path}"

    # Only --verbose needs timing, and a missing clock helper must not fail a check.
    if [ "$VERBOSE" = 1 ]; then
        start_ms="$(now_ms 2>/dev/null || echo -)"
    fi
    code=""
    attempt=0
    while [ "$attempt" -lt 3 ]; do
        attempt=$((attempt + 1))
        code="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time "$TIMEOUT" "$url" 2>/dev/null || true)"
        [ -n "$code" ] || code="000"
        if [ "$code" = "$expected" ]; then
            break
        fi
        # A 403 or 429 will not change on its own; do not add load and do not wait.
        if [ "$code" = "403" ] || [ "$code" = "429" ]; then
            break
        fi
        if [ "$attempt" -lt 3 ]; then
            sleep 3
        fi
    done
    if [ "$VERBOSE" = 1 ]; then
        end_ms="$(now_ms 2>/dev/null || echo -)"
        if [ "$start_ms" != "-" ] && [ "$end_ms" != "-" ]; then
            elapsed_ms=$((end_ms - start_ms))
        fi
    fi

    if [ "$code" != "$expected" ]; then
        fail_check "$scope" "$path" "expected $expected, got $code"
        verbose_detail "$url" "$elapsed_ms" stderr
        return
    fi

    for spec in "$@"; do
        kind="${spec%%:*}"
        value="${spec#*:}"
        case "$kind" in
            contains)
                if ! grep -Fq -- "$value" "$BODY_FILE"; then
                    fail_check "$scope" "$path" "200 but missing marker $(quote_marker "$value")"
                    verbose_detail "$url" "$elapsed_ms" stderr
                    return
                fi
                ;;
            absent)
                if grep -Fq -- "$value" "$BODY_FILE"; then
                    fail_check "$scope" "$path" "200 but found forbidden marker $(quote_marker "$value")"
                    verbose_detail "$url" "$elapsed_ms" stderr
                    return
                fi
                ;;
            count)
                expected_count="${value##*:}"
                needle="${value%:*}"
                count="$( { grep -Fo -- "$needle" "$BODY_FILE" || true; } | wc -l | tr -d '[:space:]' )"
                if [ "$count" != "$expected_count" ]; then
                    fail_check "$scope" "$path" "200 but found $count occurrences of $(quote_marker "$needle") (expected $expected_count)"
                    verbose_detail "$url" "$elapsed_ms" stderr
                    return
                fi
                ;;
        esac
    done

    PASSED=$((PASSED + 1))
    printf 'OK %-6s %-58s %s\n' "$scope" "$path" "$code"
    verbose_detail "$url" "$elapsed_ms"
}

# Main site. The main "/" is deliberately not checked: a first visit from a
# non-allowlisted IP gets the 403 challenge, so its status is not a fixed value.
check main "/_health" 200 "contains:ok"
check main "/?challenge=1" 403 'contains:action="/gate/verify"'
check main "/robots.txt" 200 "contains:User-agent:" "absent:cf-turnstile"
check main "/llms.txt" 200 "contains:# ComiCine" "absent:cf-turnstile"
check main "/sitemap.xml" 200 "contains:<urlset" "absent:cf-turnstile" "count:<loc>:4"

# Docs site. The docs "/" returns 404 by design; the deep docs checks belong to
# ops/docs_deploy.sh stage 8, so only the localized page and its root assets are
# covered here.
check docs "/video-platform/zh-cn" 200 \
    'contains:hreflang="zh-CN"' \
    'contains:hreflang="en-US"' \
    'contains:hreflang="ja-JP"' \
    'contains:hreflang="ko-KR"' \
    'contains:hreflang="x-default"' \
    "contains:/video-platform/en-us"
check docs "/fonts.css" 200
check docs "/hashmap.json" 200
check docs "/logo.svg" 200
check docs "/comicine-favicon.svg" 200
check docs "/comicine-xtext.svg" 200
check docs "/fonts/delius-swash-caps/delius-swash-caps-copyright.woff2" 200

# Status Worker. The degraded 503 page and the 404 page do not carry this marker,
# so it proves the real status page was served.
check status "/" 200 'contains:id="updated-at"'

echo "smoke: $PASSED passed, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
    exit 1
fi
exit 0
