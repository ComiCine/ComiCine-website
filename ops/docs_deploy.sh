#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine - docs.limooo.cn build and deploy (VitePress)
#
# Content lives in site/docs/docs/ (the VitePress root, with its own
# .vitepress/ beside it); every markdown file becomes
# https://docs.limooo.cn/<path>. site/docs/ is a per-subdomain container:
# docs/ -> docs.limooo.cn, services/ -> services.limooo.cn (the price-list CSVs
# read by src/services_pricing.py). The VitePress implementation is the fork at
# ComiCine/vitepress, so that header / footer changes in the fork show up
# on the next deploy.
#
# The fork has no published dist, so this script clones it into a cache dir,
# builds it with pnpm + tsdown and packs it into a tarball. The tarball is cached
# by commit sha: the fork is only rebuilt when COMICINE_VITEPRESS_REF moves.
#
# The docs site is its own Cloudflare Pages project (default: limooo-docs), so a
# heavy VitePress build never touches the main limooo Pages artifact.
#
# Usage:
#   bash ops/docs_deploy.sh --dry-run      # print the plan only
#   bash ops/docs_deploy.sh --build-only   # build + validate, no Cloudflare writes
#   bash ops/docs_deploy.sh                # build + validate + deploy + smoke test
#   bash ops/docs_deploy.sh --dev          # run the VitePress dev server
#
# Environment overrides:
#   COMICINE_VITEPRESS_REF   git ref of the fork (default: main)
#   COMICINE_VITEPRESS_DIR   fork checkout cache (default: /tmp/comicine-vitepress)
#   COMICINE_DOCS_BUILD_DIR  build workspace   (default: /tmp/comicine-docs-build)
#   DOCS_PAGES_PROJECT     Pages project     (default: limooo-docs)
#   COMICINE_SKIP_VITEPRESS_BUILD=1  reuse the cached tarball as-is
#   COMICINE_VITEPRESS_FETCH=0       use the fork working tree as-is (fork development)

set -euo pipefail

_COMICINE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -r "$_COMICINE_SCRIPT_DIR/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/env_compat.sh"
elif [[ -r "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# site/docs/ is a container organized by subdomain: docs/ = docs.limooo.cn,
# services/ = services.limooo.cn. This script handles only docs.limooo.cn content,
# including its own .vitepress/ directory.
DOCS_DIR="$ROOT/docs/docs"
SECRETS_FILE="${SECRETS_FILE:-$ROOT/secrets/webauthn.env}"

PAGES_PROJECT="${DOCS_PAGES_PROJECT:-limooo-docs}"
PAGES_BRANCH="${DOCS_PAGES_BRANCH:-main}"
DOCS_HOST="${DOCS_HOST:-docs.limooo.cn}"

VITEPRESS_REPO="${COMICINE_VITEPRESS_REPO:-https://github.com/ComiCine/vitepress.git}"
VITEPRESS_REF="${COMICINE_VITEPRESS_REF:-main}"
VITEPRESS_DIR="${COMICINE_VITEPRESS_DIR:-/tmp/comicine-vitepress}"
BUILD_DIR="${COMICINE_DOCS_BUILD_DIR:-/tmp/comicine-docs-build}"

SRC_DIR="$BUILD_DIR/src"
DIST_DIR="$SRC_DIR/.vitepress/dist"
TARBALL="$BUILD_DIR/vitepress.tgz"
SHA_MARKER="$BUILD_DIR/vitepress.sha"

PNPM_BIN="${PNPM_BIN:-pnpm}"
# If pnpm detects that node_modules was created by another version or store, it prompts for
# interactive confirmation before removing it. Deployments run in a non-interactive shell and
# fail with ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. The intended behavior is to reinstall
# when the dependency tree differs, so allow pnpm to rebuild it.
PNPM_INSTALL_FLAGS="--config.confirmModulesPurge=false"
WRANGLER_BIN="${WRANGLER_BIN:-/tmp/wrangler-env/node_modules/.bin/wrangler}"

DRY_RUN=0
BUILD_ONLY=0
DEV=0

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --build-only|--no-deploy) BUILD_ONLY=1 ;;
        --dev) DEV=1 ;;
        --help|-h) sed -n '20,36p' "$0"; exit 0 ;;
        *)
            echo "FATAL: unknown argument $1 (supported: --dry-run / --build-only / --dev)" >&2
            exit 2
            ;;
    esac
    shift
done

if [ "$DRY_RUN" = 1 ]; then
    echo "[docs] DRY-RUN: no fork build, no VitePress build, no Cloudflare writes."
    echo "[docs] will-run: git clone/fetch $VITEPRESS_REPO ($VITEPRESS_REF) -> $VITEPRESS_DIR"
    echo "[docs] will-run: pnpm install && pnpm exec tsdown && pnpm pack -> $TARBALL (only when the fork commit changes)"
    echo "[docs] will-run: rsync $DOCS_DIR/ -> $SRC_DIR/ (exclude node_modules, .vitepress/dist)"
    echo "[docs] will-run: pnpm install && pnpm exec vitepress build . --outDir $DIST_DIR"
    echo "[docs] will-run: python3 ops/docs_headers.py $DIST_DIR"
    echo "[docs] will-run: $WRANGLER_BIN pages deploy $DIST_DIR --project-name $PAGES_PROJECT --branch $PAGES_BRANCH"
    exit 0
fi

if [ ! -d "$DOCS_DIR" ]; then
    echo "FATAL: docs source directory not found: $DOCS_DIR" >&2
    exit 1
fi

if ! command -v "$PNPM_BIN" >/dev/null 2>&1; then
    echo "FATAL: pnpm not found (needed to build the VitePress fork and the docs site)" >&2
    exit 1
fi

mkdir -p "$BUILD_DIR"

# Stage 1: build the fork, cached by commit.
ensure_vitepress() {
    if [ ! -d "$VITEPRESS_DIR/.git" ]; then
        echo "[docs] cloning VitePress fork: $VITEPRESS_REPO"
        rm -rf "$VITEPRESS_DIR"
        git clone --filter=blob:none --quiet "$VITEPRESS_REPO" "$VITEPRESS_DIR"
    fi

    if [ "${COMICINE_VITEPRESS_FETCH:-1}" = 1 ]; then
        echo "[docs] fetching VitePress fork: $VITEPRESS_REF"
        git -C "$VITEPRESS_DIR" fetch --quiet --depth 1 origin "$VITEPRESS_REF"
        git -C "$VITEPRESS_DIR" reset --hard --quiet FETCH_HEAD
    else
        echo "[docs] COMICINE_VITEPRESS_FETCH=0, using the working tree at $VITEPRESS_DIR"
    fi
    local sha
    sha="$(git -C "$VITEPRESS_DIR" rev-parse HEAD)"
    echo "[docs] VitePress fork commit: $sha"

    if [ "${COMICINE_SKIP_VITEPRESS_BUILD:-0}" = 1 ] && [ -f "$TARBALL" ]; then
        echo "[docs] COMICINE_SKIP_VITEPRESS_BUILD=1, reusing cached tarball"
        return 0
    fi
    # FETCH=0 means developing in the fork's working tree. It may be dirty, so rebuild even
    # when the commit SHA has not changed.
    if [ "${COMICINE_VITEPRESS_FETCH:-1}" = 1 ] && [ -f "$TARBALL" ] \
        && [ "$(cat "$SHA_MARKER" 2>/dev/null || true)" = "$sha" ]; then
        echo "[docs] VitePress fork already built for this commit, reusing tarball"
        return 0
    fi

    echo "[docs] building VitePress fork (pnpm install + tsdown)"
    (
        cd "$VITEPRESS_DIR"
        "$PNPM_BIN" install --frozen-lockfile $PNPM_INSTALL_FLAGS
        "$PNPM_BIN" exec tsdown
    )
    echo "[docs] packing VitePress fork"
    rm -f "$BUILD_DIR"/vitepress-*.tgz
    (
        cd "$VITEPRESS_DIR"
        "$PNPM_BIN" pack --pack-destination "$BUILD_DIR" >/dev/null
    )
    local packed
    packed="$(ls -t "$BUILD_DIR"/vitepress-*.tgz | head -n 1)"
    mv "$packed" "$TARBALL"
    printf '%s' "$sha" > "$SHA_MARKER"
    echo "[docs] tarball: $TARBALL"
}

ensure_vitepress

# Stage 2: sync content to the build workspace.
echo "[docs] syncing $DOCS_DIR -> $SRC_DIR"
mkdir -p "$SRC_DIR"
rsync -a --delete \
    --exclude '.DS_Store' \
    --exclude 'node_modules' \
    --exclude 'package.json' \
    --exclude 'pnpm-lock.yaml' \
    --exclude '.vitepress/cache' \
    --exclude '.vitepress/dist' \
    "$DOCS_DIR/" "$SRC_DIR/"

cat > "$SRC_DIR/package.json" <<JSON
{
  "name": "comicine-docs",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vitepress dev .",
    "build": "vitepress build .",
    "preview": "vitepress preview ."
  },
  "devDependencies": {
    "vitepress": "file:$TARBALL",
    "vue": "^3.5.42"
  }
}
JSON

echo "[docs] installing docs dependencies (vitepress from the fork tarball)"
(
    cd "$SRC_DIR"
    "$PNPM_BIN" install --no-frozen-lockfile --reporter=append-only $PNPM_INSTALL_FLAGS
)

if [ "$DEV" = 1 ]; then
    echo "[docs] starting dev server"
    exec bash -c "cd '$SRC_DIR' && '$PNPM_BIN' exec vitepress dev . --host"
fi

# Stage 3: build the site.
echo "[docs] building docs site"
(
    cd "$SRC_DIR"
    "$PNPM_BIN" exec vitepress build . --outDir "$DIST_DIR"
)

# Stage 4: validate the output; every Markdown file must have a corresponding HTML file.
echo "[docs] validating markdown -> html mapping"
python3 "$ROOT/ops/docs_check_output.py" "$DOCS_DIR" "$DIST_DIR"

echo "[docs] artifact: $(find "$DIST_DIR" -type f | wc -l | tr -d ' ') files"

python3 "$ROOT/ops/docs_headers.py" "$DIST_DIR"

if [ "$BUILD_ONLY" = 1 ]; then
    echo "[docs] build finished (--build-only), skipping Pages deploy."
    exit 0
fi

# Stage 5: credentials.
if [ ! -f "$SECRETS_FILE" ]; then
    echo "FATAL: missing $SECRETS_FILE" >&2
    exit 1
fi
if [ ! -x "$WRANGLER_BIN" ]; then
    echo "FATAL: wrangler not found: $WRANGLER_BIN" >&2
    echo "       recreate: mkdir -p /tmp/wrangler-env && cd /tmp/wrangler-env && npm i wrangler@4" >&2
    exit 1
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$SECRETS_FILE" | tail -1)"
    CLOUDFLARE_ACCOUNT_ID="$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' "$SECRETS_FILE" | tail -1)"
    export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
fi

# Wrangler adds emoji to its output; remove only emoji and preserve all other output.
strip_emoji() {
    perl -CSD -pe 's/[\x{1F000}-\x{1FAFF}\x{2705}\x{274C}\x{26A0}\x{26C5}\x{2728}\x{2B50}][\x{FE0F}\x{200D}]*\h?//g'
}

# Stage 6: deploy to Pages.
# Run from BUILD_DIR so Wrangler does not find the main site's project name in site/wrangler.toml.
echo "[docs] deploying Pages project: $PAGES_PROJECT"
export CI=1 WRANGLER_SEND_METRICS=false
(
    cd "$BUILD_DIR"
    "$WRANGLER_BIN" pages deploy "$DIST_DIR" \
        --project-name "$PAGES_PROJECT" \
        --branch "$PAGES_BRANCH" \
        --commit-dirty=true 2>&1 | strip_emoji
)

# Stage 7: smoke checks.
echo "[docs] post-deploy check"
# Immediately after deployment, the custom domain may still serve the previous deployment.
# This happened on 2026-10-08: the new deployment was live, but the first probe saw old output.
# Retry each probe several times.
check_code() {
    local path="$1" expected="$2" code=""
    local i
    for i in 1 2 3 4 5 6; do
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${DOCS_HOST}${path}" || echo 000)"
        [ "$code" = "$expected" ] && break
        sleep 10
    done
    if [ "$code" != "$expected" ]; then
        echo "FATAL: https://${DOCS_HOST}${path} = ${code} (expected ${expected})" >&2
        exit 1
    fi
    echo "[docs] ${path} = ${expected} OK"
}

check_root_redirect() {
    local i result code location
    for i in 1 2 3 4 5 6; do
        result="$(curl -s -o /dev/null -w '%{http_code}\n%{redirect_url}' --max-time 20 "https://${DOCS_HOST}/" || true)"
        code="${result%%$'\n'*}"
        location="${result#*$'\n'}"
        if [ "$code" = 302 ] && [ "$location" = "https://limooo.cn/" ]; then
            break
        fi
        sleep 10
    done
    if [ "$code" != 302 ] || [ "$location" != "https://limooo.cn/" ]; then
        echo "FATAL: https://${DOCS_HOST}/ = ${code} Location: ${location:--} (expected 302 to https://limooo.cn/)" >&2
        exit 1
    fi
    echo "[docs] / = 302 to https://limooo.cn OK"
}

# Content page paths without a language suffix must return 302 to /<page>/zh-cn.
for path in /video-platform /README /LICENSE; do
    check_code "$path" 302
done

check_root_redirect

for path in /video-platform/zh-cn /video-platform/en-us /video-platform/ja-jp /video-platform/ko-kr \
    /README/zh-cn /README/en-us /README/ja-jp /README/ko-kr \
    /LICENSE/zh-cn /LICENSE/en-us /LICENSE/ja-jp /LICENSE/ko-kr; do
    check_code "$path" 200
done
echo "[docs] done."
