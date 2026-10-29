#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine - Cloudflare Pages build and deploy (tasks/17, zero-VPS)
#
# The VPS was retired on 2026-09-17: no ssh, no remote secrets, no rsync.
# Credentials come from the environment when supplied by CI, or from local
# secrets/webauthn.env otherwise; values are never committed, written to logs, or echoed.
#
# Usage:
#   bash ops/pages_deploy.sh --dry-run      # print what would happen only
#   bash ops/pages_deploy.sh --build-only   # build + validate only, no Cloudflare writes
#   bash ops/pages_deploy.sh                # build + validate + deploy Pages + smoke test
#
# Does not commit or push: that is ops/deploy.sh's job.
#
# This repo lives in an iCloud-synced area, where in-repo node_modules / .venv-build are
# unusable; use the wrangler and venv under /tmp instead (see tasks/18-resume.md).

set -euo pipefail

LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PAGES_PROJECT="${PAGES_PROJECT:-comicine-production}"
PAGES_ALIAS_PROJECT="${PAGES_ALIAS_PROJECT:-comicine}"
PAGES_ALIAS_SOURCE_DIR="${PAGES_ALIAS_SOURCE_DIR:-$LOCAL_DIR/ops/pages-alias}"
PAGES_BRANCH="${PAGES_BRANCH:-main}"
SECRETS_FILE="${SECRETS_FILE:-$LOCAL_DIR/secrets/webauthn.env}"

# Reading many small files from the iCloud-synced directory can stall; use an isolated build directory under /tmp.
PUBLIC_DIR="${COMICINE_PUBLIC_DIR:-/tmp/comicine-public}"
PREVIEW_DIR="${COMICINE_PREVIEW_DIR:-/tmp/comicine-preview}"
VENV_PYTHON="${COMICINE_VENV_PYTHON:-/tmp/comicine-venv/bin/python}"
WRANGLER_BIN="${WRANGLER_BIN:-/tmp/wrangler-env/node_modules/.bin/wrangler}"

DRY_RUN=0
BUILD_ONLY=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --build-only|--no-deploy) BUILD_ONLY=1 ;;
        --help|-h) sed -n '3,17p' "$0"; exit 0 ;;
        *)
            echo "FATAL: unknown argument $1 (supported: --dry-run / --build-only)" >&2
            exit 2
            ;;
    esac
    shift
done

cd "$LOCAL_DIR"

if [ "$DRY_RUN" = 1 ]; then
    echo "[pages] DRY-RUN: no build, no Cloudflare writes."
    echo "[pages] will-run: $VENV_PYTHON src/build.py   (PUBLIC_DIR=$PUBLIC_DIR)"
    echo "[pages] will-run: check_config_contract.py + check_security_headers.py"
    echo "[pages] will-run: $WRANGLER_BIN pages deploy $PUBLIC_DIR --project-name $PAGES_PROJECT --branch $PAGES_BRANCH"
    echo "[pages] will-run: deploy Pages alias project $PAGES_ALIAS_PROJECT from $PAGES_ALIAS_SOURCE_DIR/public"
    echo "[pages] will-run: verify https://comicine.pages.dev redirects to https://comicine.com with status 308"
    echo "[pages] credentials source: ${SECRETS_FILE} (reads CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID only)"
    exit 0
fi

# Build.
if [ ! -x "$VENV_PYTHON" ]; then
    echo "FATAL: build venv not found: $VENV_PYTHON" >&2
    echo "       recreate: python3 -m venv /tmp/comicine-venv && /tmp/comicine-venv/bin/pip install -r ops/requirements.txt" >&2
    exit 1
fi

echo "[pages] building (isolated output: ${PUBLIC_DIR})"

COMICINE_PUBLIC_DIR="$PUBLIC_DIR" COMICINE_PREVIEW_DIR="$PREVIEW_DIR" "$VENV_PYTHON" src/build.py

if [ ! -f "$PUBLIC_DIR/manifest.json" ]; then
    echo "FATAL: $PUBLIC_DIR/manifest.json missing after build" >&2
    echo "       a half-finished build would publish whatever is in $PUBLIC_DIR;" >&2
    echo "       rerun the build and check the log for the failing step." >&2
    exit 1
fi
# The manifest must match every file in the directory byte for byte. This catches edits made
# after the build, as well as extra or missing files, including changes made by another process.
COMICINE_PUBLIC_DIR="$PUBLIC_DIR" "$VENV_PYTHON" src/build.py --verify-manifest
echo "[pages] artifact: $(find "$PUBLIC_DIR" -type f | wc -l | tr -d ' ') files"

# Pre-deploy validation.
echo "[pages] validating config contract and security headers"
"$VENV_PYTHON" ops/check_config_contract.py
python3 ops/check_security_headers.py

if [ "$BUILD_ONLY" = 1 ]; then
    echo "[pages] build finished (--build-only), skipping Pages deploy."
    exit 0
fi

if [ ! -x "$WRANGLER_BIN" ]; then
    echo "FATAL: wrangler not found: $WRANGLER_BIN" >&2
    echo "       recreate: mkdir -p /tmp/wrangler-env && cd /tmp/wrangler-env && npm i wrangler@4" >&2
    exit 1
fi

if [ -f "$SECRETS_FILE" ]; then
    if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
        CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS_FILE" | tail -1)"
    fi
    if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
        CLOUDFLARE_ACCOUNT_ID="$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' "$SECRETS_FILE" | tail -1)"
    fi
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "FATAL: CLOUDFLARE_API_TOKEN is missing from the environment and $SECRETS_FILE" >&2
    exit 1
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "FATAL: CLOUDFLARE_ACCOUNT_ID is missing from the environment and $SECRETS_FILE" >&2
    exit 1
fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# Wrangler adds emoji to its output; remove only emoji and preserve all other output.
strip_emoji() {
    perl -CSD -pe 's/[\x{1F000}-\x{1FAFF}\x{2705}\x{274C}\x{26A0}\x{26C5}\x{2728}\x{2B50}][\x{FE0F}\x{200D}]*\h?//g'
}

# Deploy.
# This must run from this directory (site/), or Wrangler cannot find functions/ and will omit
# the entire Pages Functions bundle (this happened in tasks/17 §11.6).
echo "[pages] deploying Pages (must run under site/, otherwise Functions are dropped)"
export CI=1 WRANGLER_SEND_METRICS=false
"$WRANGLER_BIN" pages deploy "$PUBLIC_DIR" \
    --project-name "$PAGES_PROJECT" \
    --branch "$PAGES_BRANCH" \
    --commit-dirty=true 2>&1 | strip_emoji

# Post-deploy smoke check.
echo "[pages] post-deploy check"
health="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://comicine.com/_health || echo 000)"
if [ "$health" != "200" ]; then
    echo "FATAL: https://comicine.com/_health = ${health} (expected 200)" >&2
    exit 1
fi
echo "[pages] /_health = 200 OK"

# The public pages.dev name is a separate project that permanently forwards to the canonical host.
# Stage it outside site/ so Wrangler cannot accidentally bundle the production Pages Functions.
if [ ! -f "$PAGES_ALIAS_SOURCE_DIR/public/_worker.js" ]; then
    echo "FATAL: Pages alias Worker not found: $PAGES_ALIAS_SOURCE_DIR/public/_worker.js" >&2
    exit 1
fi
ALIAS_STAGING_DIR="$(mktemp -d /tmp/comicine-pages-alias.XXXXXX)"
cleanup_alias_staging() {
    [ -z "$ALIAS_STAGING_DIR" ] || rm -rf -- "$ALIAS_STAGING_DIR"
}
trap cleanup_alias_staging EXIT
cp "$PAGES_ALIAS_SOURCE_DIR/public/_worker.js" "$ALIAS_STAGING_DIR/_worker.js"
echo "[pages] deploying canonical alias project $PAGES_ALIAS_PROJECT"
(
    cd "$ALIAS_STAGING_DIR"
    "$WRANGLER_BIN" pages deploy . \
        --project-name "$PAGES_ALIAS_PROJECT" \
        --branch "$PAGES_BRANCH" \
        --commit-dirty=true 2>&1 | strip_emoji
)

# Verify path and query preservation on the published Pages alias.
# Read the status and Location from curl itself: behind an HTTPS proxy the first header line is the
# proxy's "200 Connection established", not the alias response.
alias_result="$(curl -sS -o /dev/null --max-time 20 -w '%{http_code} %{redirect_url}' 'https://comicine.pages.dev/__pages_alias_check?source=deploy')" || {
    echo "FATAL: could not reach https://comicine.pages.dev" >&2
    exit 1
}
alias_status="${alias_result%% *}"
alias_location="${alias_result#* }"
if [ "$alias_status" != "308" ] || [ "$alias_location" != "https://comicine.com/__pages_alias_check?source=deploy" ]; then
    echo "FATAL: https://comicine.pages.dev alias returned status=${alias_status:-unknown} location=${alias_location:-missing}" >&2
    exit 1
fi
echo "[pages] alias path/query check = 308 to https://comicine.com"
cleanup_alias_staging
trap - EXIT
echo "[pages] done. Confirm the log above contains 'Compiled Worker successfully' + 'Uploading Functions bundle'."
