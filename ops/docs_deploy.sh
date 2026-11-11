#!/usr/bin/env bash

# ComiCine site project
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine - docs.comicine.com build and deploy (VitePress)
#
# Content lives in site/docs/docs/ (the VitePress root, with its own
# .vitepress/ beside it); every markdown file becomes
# https://docs.comicine.com/<path>. site/docs/ is a per-subdomain container:
# docs/ -> docs.comicine.com, services/ -> services.comicine.com (the price-list CSVs
# read by src/services_pricing.py). The VitePress implementation is the fork at
# ComiCine/vitepress, so that header / footer changes in the fork show up
# on the next deploy.
#
# The fork has no published dist, so this script clones it into a cache dir,
# builds it with pnpm + tsdown and packs it into a tarball. The tarball is cached
# by commit sha: the fork is only rebuilt when COMICINE_VITEPRESS_REF moves.
#
# The docs site is its own Cloudflare Pages project (default: comicine-docs), so a
# heavy VitePress build never touches the main comicine Pages artifact.
#
# Usage:
#   bash ops/docs_deploy.sh --dry-run      # print the plan only
#   bash ops/docs_deploy.sh --build-only   # build + validate, no Cloudflare writes
#                                          # (CI and ops/ci_check.sh reuse this path; it needs
#                                          #  git, pnpm, python3, and network access, but no secrets)
#   bash ops/docs_deploy.sh                # build + validate + deploy + smoke test
#   bash ops/docs_deploy.sh --dev          # run the VitePress dev server
#
# Environment overrides:
#   COMICINE_VITEPRESS_REF   git ref of the fork (default: main)
#   COMICINE_VITEPRESS_DIR   fork checkout cache (default: /tmp/comicine-vitepress)
#   COMICINE_DOCS_BUILD_DIR  build workspace   (default: /tmp/comicine-docs-build)
#   DOCS_PAGES_PROJECT     Pages project     (default: comicine-docs)
#   COMICINE_SKIP_VITEPRESS_BUILD=1  reuse the cached tarball as-is
#   COMICINE_VITEPRESS_FETCH=0       use the fork working tree as-is (fork development)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# site/docs/ is a container organized by subdomain: docs/ = docs.comicine.com,
# services/ = services.comicine.com. This script handles only docs.comicine.com content,
# including its own .vitepress/ directory.
DOCS_DIR="$ROOT/docs/docs"
SECRETS_FILE="${SECRETS_FILE:-$ROOT/secrets/webauthn.env}"

PAGES_PROJECT="${DOCS_PAGES_PROJECT:-comicine-docs}"
PAGES_BRANCH="${DOCS_PAGES_BRANCH:-main}"
DOCS_HOST="${DOCS_HOST:-docs.comicine.com}"

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
    echo "[docs] will-run: copy $ROOT/config-contract.json into the staged VitePress root"
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
cp "$ROOT/config-contract.json" "$SRC_DIR/config-contract.json"
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
    "markdown-it-mathjax3": "4.3.2",
    "vitepress": "file:$TARBALL",
    "vue": "3.5.44"
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
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    CLOUDFLARE_ACCOUNT_ID="$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' "$SECRETS_FILE" | tail -1)"
fi
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

# Wrangler adds emoji to its output; remove only emoji and preserve all other output.
strip_emoji() {
    perl -CSD -pe 's/[\x{1F000}-\x{1FAFF}\x{2705}\x{274C}\x{26A0}\x{26C5}\x{2728}\x{2B50}][\x{FE0F}\x{200D}]*\h?//g'
}

# Put the direct-404 Worker in front of Pages before removing legacy Access destinations.
# It handles moved article paths before Pages' static cache can serve an old response.
echo "[docs] deploying direct-404 Worker"
(
    cd "$ROOT/ops/docs-legacy-404"
    "$WRANGLER_BIN" deploy --config "$ROOT/ops/docs-legacy-404/wrangler.toml" 2>&1 | strip_emoji
)

# Stage 6: reconcile Cloudflare Access.
# Protect private routes and assets on the existing shared Access app before publishing the build.
# Legacy public MU5735 paths now return direct 404s and must not remain Access redirects.
python3 - "$SECRETS_FILE" <<'PY'
import json
import os
import pathlib
import re
import subprocess
import sys

secrets_path = pathlib.Path(sys.argv[1])
token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
account_id = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
if (not token or not account_id) and secrets_path.is_file():
    secret_text = secrets_path.read_text()
    if not token:
        match = re.search(r"^CLOUDFLARE_API_TOKEN=(.*)$", secret_text, re.M)
        token = match.group(1).strip() if match else ""
    if not account_id:
        match = re.search(r"^CLOUDFLARE_ACCOUNT_ID=(.*)$", secret_text, re.M)
        account_id = match.group(1).strip() if match else ""
if not token:
    raise SystemExit("FATAL: Cloudflare API token is missing; cannot reconcile docs routes and Access")
if not account_id:
    raise SystemExit("FATAL: Cloudflare account ID is missing; cannot reconcile docs Access")

base_url = "https://api.cloudflare.com/client/v4"

def call(method, url, body=None):
    config = f'header = "Authorization: Bearer {token}"\nurl = "{url}"\n'
    if method != "GET":
        config += f'request = "{method}"\n'
    if body is not None:
        config += 'header = "Content-Type: application/json"\n'
        config += f"data = {json.dumps(json.dumps(body, separators=(',', ':')))}\n"
    response = subprocess.run(
        ["curl", "--http1.1", "-sS", "--config", "-"],
        input=config,
        text=True,
        capture_output=True,
        check=True,
    )
    try:
        payload = json.loads(response.stdout)
    except json.JSONDecodeError as error:
        raise SystemExit(f"FATAL: Cloudflare API returned invalid JSON: {error}")
    if not payload.get("success"):
        errors = json.dumps(payload.get("errors", []), ensure_ascii=True)
        raise SystemExit(f"FATAL: Cloudflare API request failed: {errors}")
    return payload.get("result")

zones = call("GET", f"{base_url}/zones?name=comicine.com&status=active")
zone = next((item for item in zones or [] if item.get("name") == "comicine.com"), None)
if not zone:
    raise SystemExit("FATAL: active comicine.com zone was not found")

apps_url = f"{base_url}/accounts/{account_id}/access/apps"
apps = call("GET", apps_url)
identity_uri = "identity.comicine.com/login"
docs_private_routes = {
    "docs.comicine.com/private/*",
    "comicine-docs.pages.dev/private/*",
    "*.comicine-docs.pages.dev/private/*",
}
docs_private_asset_routes = {
    "docs.comicine.com/assets/private_articles_*",
    "comicine-docs.pages.dev/assets/private_articles_*",
    "*.comicine-docs.pages.dev/assets/private_articles_*",
}
legacy_mu5735_routes = {
    "docs.comicine.com/articles/mu5735-report",
    "docs.comicine.com/articles/mu5735-report/*",
    "docs.comicine.com/assets/articles_mu5735_*",
}
docs_access_routes = docs_private_routes | docs_private_asset_routes
legacy_docs_app_names = {
    "ComiCine Docs Archived and Preview Paths",
    "ComiCine Docs Private",
    "ComiCine Docs Private Preview Paths",
}

def destination_uris(item):
    destinations = item.get("destinations") or []
    if not destinations and item.get("domain"):
        return {item["domain"]}
    return {destination.get("uri", "") for destination in destinations}

shared_candidates = [
    item for item in apps or []
    if identity_uri in destination_uris(item)
]
if len(shared_candidates) != 1:
    raise SystemExit("FATAL: expected exactly one existing Access application for the ComiCine identity route")
shared_app = shared_candidates[0]
shared_policies = shared_app.get("policies") or []
if not shared_policies:
    raise SystemExit("FATAL: the shared ComiCine Access application has no policies to preserve")

def policy_signature(policies):
    readonly = {"id", "uid", "account_id", "created_at", "updated_at", "app_count"}
    values = [
        {key: value for key, value in policy.items() if key not in readonly}
        for policy in policies
    ]
    return sorted(values, key=lambda item: (item.get("precedence", 0), item.get("decision", "")))

def policy_links(policies):
    links = []
    for policy in policies:
        if not policy.get("id"):
            raise SystemExit("FATAL: a shared Access policy is missing its ID")
        links.append({key: policy[key] for key in ("id", "account_id", "precedence") if key in policy})
    return links

def update_app_destinations(app, required_routes, name=None, remove_routes=None):
    destinations = list(app.get("destinations") or [])
    remove_routes = remove_routes or set()
    destinations = [destination for destination in destinations if destination.get("uri", "") not in remove_routes]
    existing = {destination.get("uri", "") for destination in destinations}
    for uri in sorted(required_routes):
        if uri not in existing:
            destinations.append({"type": "public", "uri": uri})
    policies = app.get("policies") or []
    body = {
        key: value
        for key, value in app.items()
        if key not in {"id", "created_at", "updated_at", "uid", "policies"}
    }
    body.update(
        {
            "type": "self_hosted",
            "domain": app.get("domain") or identity_uri,
            "destinations": destinations,
            "policies": policy_links(policies),
        }
    )
    if name:
        body["name"] = name
    body.pop("self_hosted_domains", None)
    call("PUT", f"{apps_url}/{app['id']}", body)
    return call("GET", f"{apps_url}/{app['id']}")

def asset_routes_for(private_routes):
    return {
        f"{route.split('/', 1)[0]}/assets/private_articles_*"
        for route in private_routes
    }

legacy_apps = [item for item in apps or [] if item.get("name") in legacy_docs_app_names]
for legacy_app in legacy_apps:
    routes = destination_uris(legacy_app)
    if not routes or not routes.issubset(docs_private_routes):
        raise SystemExit("FATAL: a docs Access application contains destinations outside the private docs routes")
    if policy_signature(legacy_app.get("policies") or []) != policy_signature(shared_policies):
        raise SystemExit("FATAL: a docs Access application has a different policy; refusing to merge it")
for legacy_app in legacy_apps:
    routes = destination_uris(legacy_app)
    asset_routes = asset_routes_for(routes)
    legacy_with_assets = update_app_destinations(legacy_app, asset_routes)
    if not asset_routes.issubset(destination_uris(legacy_with_assets)):
        raise SystemExit("FATAL: a legacy docs Access application did not protect private article assets")
    call("DELETE", f"{apps_url}/{legacy_app['id']}")
    shared_app = call("GET", f"{apps_url}/{shared_app['id']}")
    shared_app = update_app_destinations(shared_app, routes | asset_routes | {identity_uri}, "ComiCine")
    updated_uris = destination_uris(shared_app)
    if not (routes | asset_routes | {identity_uri}).issubset(updated_uris):
        raise SystemExit("FATAL: the shared Access application is missing an internal service destination")
    if policy_signature(shared_app.get("policies") or []) != policy_signature(shared_policies):
        raise SystemExit("FATAL: the shared Access application policy changed unexpectedly")
    if shared_app.get("name") != "ComiCine":
        raise SystemExit("FATAL: the shared Access application name did not update")

shared_app = call("GET", f"{apps_url}/{shared_app['id']}")
shared_app = update_app_destinations(
    shared_app,
    docs_access_routes | {identity_uri},
    "ComiCine",
    legacy_mu5735_routes,
)
updated_uris = destination_uris(shared_app)
if not docs_access_routes.issubset(updated_uris) or identity_uri not in updated_uris:
    raise SystemExit("FATAL: the shared Access application is missing an internal service destination")
if legacy_mu5735_routes.intersection(updated_uris):
    raise SystemExit("FATAL: the old MU5735 URLs still have Cloudflare Access destinations")
if policy_signature(shared_app.get("policies") or []) != policy_signature(shared_policies):
    raise SystemExit("FATAL: the shared Access application policy changed unexpectedly")
if shared_app.get("name") != "ComiCine":
    raise SystemExit("FATAL: the shared Access application name did not update")

remaining_apps = call("GET", apps_url) or []
if any(item.get("name") in legacy_docs_app_names for item in remaining_apps):
    raise SystemExit("FATAL: a redundant docs Access application remains")
print("[docs] private docs and identity share the existing ComiCine Access application")
print("[docs] legacy MU5735 URLs return direct 404s without redirects")
if legacy_apps:
    print(f"[docs] removed {len(legacy_apps)} redundant docs Access application(s)")

phase = "http_request_dynamic_redirect"
ruleset = call("GET", f"{base_url}/zones/{zone['id']}/rulesets/phases/{phase}/entrypoint")
obsolete_rules = [
    rule for rule in ruleset.get("rules", [])
    if rule.get("ref") == "comicine_docs_removed_home_routes"
    or rule.get("description") == "Move former public UK undergraduate article URLs to the private route"
]
for rule in obsolete_rules:
    call("DELETE", f"{base_url}/zones/{zone['id']}/rulesets/{ruleset['id']}/rules/{rule['id']}")

ruleset = call("GET", f"{base_url}/zones/{zone['id']}/rulesets/phases/{phase}/entrypoint")
if any(
    rule.get("ref") == "comicine_docs_removed_home_routes"
    or rule.get("description") == "Move former public UK undergraduate article URLs to the private route"
    for rule in ruleset.get("rules", [])
):
    raise SystemExit("FATAL: an obsolete public docs redirect remains active")

print("[docs] obsolete public docs redirects removed")
PY


# Stage 7: deploy to Pages.
# Run from the staged docs source so Wrangler finds this Pages project's Functions without
# discovering the main site's wrangler.toml.
echo "[docs] deploying Pages project: $PAGES_PROJECT"
export CI=1 WRANGLER_SEND_METRICS=false
(
    cd "$SRC_DIR"
    "$WRANGLER_BIN" pages deploy "$DIST_DIR" \
        --project-name "$PAGES_PROJECT" \
        --branch "$PAGES_BRANCH" \
        --commit-dirty=true 2>&1 | strip_emoji
)

# Verify the direct-404 Worker routes remain active after the Pages publish.
python3 - "$SECRETS_FILE" <<'PY'
import json
import os
import pathlib
import re
import subprocess
import sys

secrets_path = pathlib.Path(sys.argv[1])
token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
account_id = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
if (not token or not account_id) and secrets_path.is_file():
    secret_text = secrets_path.read_text()
    if not token:
        match = re.search(r"^CLOUDFLARE_API_TOKEN=(.*)$", secret_text, re.M)
        token = match.group(1).strip() if match else ""
    if not account_id:
        match = re.search(r"^CLOUDFLARE_ACCOUNT_ID=(.*)$", secret_text, re.M)
        account_id = match.group(1).strip() if match else ""
if not token or not account_id:
    raise SystemExit("FATAL: Cloudflare credentials are missing; cannot remove the retired docs Worker")

base_url = "https://api.cloudflare.com/client/v4"
legacy_worker = "comicine-docs-legacy-404"
required_route_patterns = {
    "docs.comicine.com/articles/amc-10-formula-guide",
    "docs.comicine.com/articles/amc-10-formula-guide/*",
    "docs.comicine.com/articles/uk-undergraduate-majors",
    "docs.comicine.com/articles/uk-undergraduate-majors/*",
    "docs.comicine.com/articles/mu5735-report",
    "docs.comicine.com/articles/mu5735-report/*",
    "docs.comicine.com/assets/articles_mu5735_*",
}

def call(method, url, body=None):
    config = f'header = "Authorization: Bearer {token}"\nurl = "{url}"\nrequest = "{method}"\n'
    if body is not None:
        config += 'header = "Content-Type: application/json"\n'
        config += f"data = {json.dumps(json.dumps(body, separators=(',', ':')))}\n"
    response = subprocess.run(
        ["curl", "--http1.1", "-sS", "--config", "-"],
        input=config,
        text=True,
        capture_output=True,
        check=True,
    )
    try:
        payload = json.loads(response.stdout)
    except json.JSONDecodeError as error:
        raise SystemExit(f"FATAL: Cloudflare API returned invalid JSON: {error}")
    if not payload.get("success"):
        errors = json.dumps(payload.get("errors", []), ensure_ascii=True)
        raise SystemExit(f"FATAL: Cloudflare API request failed: {errors}")
    return payload.get("result")

zones = call("GET", f"{base_url}/zones?name=comicine.com&status=active")
zone = next((item for item in zones or [] if item.get("name") == "comicine.com"), None)
if not zone:
    raise SystemExit("FATAL: active comicine.com zone was not found")

worker_routes_url = f"{base_url}/zones/{zone['id']}/workers/routes"
worker_routes = call("GET", worker_routes_url) or []
active_routes = {
    route.get("pattern")
    for route in worker_routes
    if route.get("script") == legacy_worker
}
missing_routes = sorted(required_route_patterns - active_routes)
if missing_routes:
    raise SystemExit("FATAL: the docs direct-404 Worker is missing routes: " + ", ".join(missing_routes))
print("[docs] direct-404 Worker routes verified")

legacy_paths = set()
for slug in ("amc-10-formula-guide", "uk-undergraduate-majors", "mu5735-report"):
    base = f"/articles/{slug}"
    legacy_paths.update((base, base + "/"))
    for language in ("zh-cn", "en-us", "ja-jp", "ko-kr"):
        localized = f"{base}/{language}"
        legacy_paths.update((localized, localized + "/"))
legacy_paths.update(
    (
        "/assets/articles_mu5735_fig01_timeline.png",
        "/assets/articles_mu5735_fig02_last60s.png",
        "/assets/articles_mu5735_fig03_radar.png",
        "/assets/articles_mu5735_fig04_two_flights.png",
        "/assets/articles_mu5735_fig06_acars_trend.png",
        "/assets/articles_mu5735_fig08_investigation_timeline.png",
    )
)
legacy_urls = [f"https://docs.comicine.com{path}" for path in sorted(legacy_paths)]
purge_url = f"{base_url}/zones/{zone['id']}/purge_cache"
for offset in range(0, len(legacy_urls), 20):
    call("POST", purge_url, {"files": legacy_urls[offset:offset + 20]})
print("[docs] purged cached legacy article and figure responses")
PY

# Stage 8: smoke checks.
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

check_custom_404() {
    local path="$1" i result metadata code content_type headers refresh_ok location_present body_ok body_file
    body_file="$(mktemp "${TMPDIR:-/tmp}/comicine-docs-404.XXXXXX")" || {
        echo "FATAL: could not create a temporary file for the docs 404 check" >&2
        exit 1
    }
    for i in 1 2 3 4 5 6; do
        result="$(curl -sS -H 'Accept: text/html' -D - -o "$body_file" -w $'\n%{http_code}\t%{content_type}' --max-time 20 "https://${DOCS_HOST}${path}" || true)"
        metadata="${result##*$'\n'}"
        headers="${result%$'\n'*}"
        code="${metadata%%$'\t'*}"
        content_type="${metadata#*$'\t'}"
        refresh_ok=0
        location_present=0
        body_ok=0
        if printf '%s\n' "$headers" | grep -Eiq '^location:'; then location_present=1; fi
        if grep -Fqi '<title>404</title>' "$body_file" \
            && grep -Eqi '<meta name="generator" content="VitePress v' "$body_file" \
            && grep -Fqi 'http-equiv="refresh"' "$body_file" \
            && grep -Fqi 'https://comicine.com/404' "$body_file"; then body_ok=1; fi
        if printf '%s\n' "$headers" | grep -Eiq '^refresh:[[:space:]]*0;[[:space:]]*url=https://comicine\.com/404'; then refresh_ok=1; fi
        if [ "$code" = 404 ] && [[ "$content_type" == text/html* ]] \
            && [ "$refresh_ok" = 1 ] && [ "$location_present" = 0 ] \
            && [ "$body_ok" = 1 ]; then break; fi
        if [ "$i" -lt 6 ]; then sleep 10; fi
    done
    if [ "$code" != 404 ] || [[ "$content_type" != text/html* ]] \
        || [ "$refresh_ok" != 1 ] || [ "$location_present" != 0 ] \
        || [ "$body_ok" != 1 ]; then
        rm -f -- "$body_file"
        echo "FATAL: https://${DOCS_HOST}${path} did not return the VitePress 404 with canonical refresh navigation (status ${code}, content type ${content_type:--})" >&2
        exit 1
    fi
    rm -f -- "$body_file"
    echo "[docs] ${path} = VitePress 404 with canonical refresh navigation OK"
}

check_direct_404() {
    local path="$1" expected_type="$2" i result metadata code content_type headers refresh_ok refresh_present location_present body_ok body_file
    body_file="$(mktemp "${TMPDIR:-/tmp}/comicine-legacy-404.XXXXXX")" || {
        echo "FATAL: could not create a temporary file for the legacy 404 check" >&2
        exit 1
    }
    for i in 1 2 3 4 5 6; do
        result="$(curl -sS -H 'Accept: text/html' -D - -o "$body_file" -w $'\n%{http_code}\t%{content_type}' --max-time 20 "https://${DOCS_HOST}${path}" || true)"
        metadata="${result##*$'\n'}"
        headers="${result%$'\n'*}"
        code="${metadata%%$'\t'*}"
        content_type="${metadata#*$'\t'}"
        refresh_ok=0
        refresh_present=0
        location_present=0
        body_ok=0
        if printf '%s\n' "$headers" | grep -Eiq '^refresh:'; then refresh_present=1; fi
        if printf '%s\n' "$headers" | grep -Eiq '^location:'; then location_present=1; fi
        if [[ "$expected_type" == text/html* ]] \
            && grep -Fqi '<title>404</title>' "$body_file" \
            && grep -Fqi 'http-equiv="refresh"' "$body_file" \
            && grep -Fqi 'https://comicine.com/404' "$body_file"; then body_ok=1; fi
        if [[ "$expected_type" == text/html* ]] \
            && printf '%s\n' "$headers" | grep -Eiq '^refresh:[[:space:]]*0;[[:space:]]*url=https://comicine\.com/404'; then refresh_ok=1; fi
        if [[ "$expected_type" == text/plain* ]] && grep -Fxqi 'Not Found' "$body_file"; then
            body_ok=1
            if [ "$refresh_present" = 0 ]; then refresh_ok=1; fi
        fi
        if [ "$code" = 404 ] && [[ "$content_type" == "$expected_type"* ]] \
            && [ "$refresh_ok" = 1 ] && [ "$location_present" = 0 ] \
            && [ "$body_ok" = 1 ]; then break; fi
        if [ "$i" -lt 6 ]; then sleep 10; fi
    done
    if [ "$code" != 404 ] || [[ "$content_type" != "$expected_type"* ]] \
        || [ "$refresh_ok" != 1 ] || [ "$location_present" != 0 ] \
        || [ "$body_ok" != 1 ]; then
        rm -f -- "$body_file"
        echo "FATAL: https://${DOCS_HOST}${path} did not return the expected direct HTTP 404 response (status ${code}, content type ${content_type:--})" >&2
        exit 1
    fi
    rm -f -- "$body_file"
    echo "[docs] ${path} = direct HTTP 404 response OK"
}

check_access_challenge() {
    local path="$1" i result code location location_base
    for i in 1 2 3 4 5 6; do
        result="$(curl -s -o /dev/null -w '%{http_code}\n%{redirect_url}' --max-time 20 "https://${DOCS_HOST}${path}" || true)"
        code="${result%%$'\n'*}"
        location="${result#*$'\n'}"
        location_base="${location%%\?*}"
        if [ "$code" = 302 ] && [[ "$location_base" == https://comicine.cloudflareaccess.com/cdn-cgi/access/login/* ]]; then break; fi
        sleep 10
    done
    if [ "$code" != 302 ] || [[ "$location_base" != https://comicine.cloudflareaccess.com/cdn-cgi/access/login/* ]]; then
        echo "FATAL: https://${DOCS_HOST}${path} did not redirect to Cloudflare Access (status ${code})" >&2
        exit 1
    fi
    echo "[docs] ${path} requires Cloudflare Access OK"
}

check_redirect() {
    local path="$1" expected_path="$2" expected_code="${3:-301}"
    local i result code location expected_location
    expected_location="https://${DOCS_HOST}${expected_path}"
    for i in 1 2 3 4 5 6; do
        result="$(curl -s -o /dev/null -w '%{http_code}\n%{redirect_url}' --max-time 20 "https://${DOCS_HOST}${path}" || true)"
        code="${result%%$'\n'*}"
        location="${result#*$'\n'}"
        if [ "$code" = "$expected_code" ] && [ "$location" = "$expected_location" ]; then break; fi
        sleep 10
    done
    if [ "$code" != "$expected_code" ] || [ "$location" != "$expected_location" ]; then
        echo "FATAL: https://${DOCS_HOST}${path} = ${code} Location: ${location:--} (expected ${expected_code} to ${expected_location})" >&2
        exit 1
    fi
    echo "[docs] ${path} = ${expected_code} to ${expected_path} OK"
}

check_language_redirect() {
    local path="$1" expected_path="$2" cookie="${3:-}" accept="${4:-en-US}"
    local i result code location expected_location
    local -a curl_args=(-s -o /dev/null -w '%{http_code}\n%{redirect_url}' --max-time 20)
    if [ -n "$cookie" ]; then curl_args+=(-H "Cookie: $cookie"); fi
    if [ -n "$accept" ]; then curl_args+=(-H "Accept-Language: $accept"); fi
    expected_location="https://${DOCS_HOST}${expected_path}"
    for i in 1 2 3 4 5 6; do
        result="$(curl "${curl_args[@]}" "https://${DOCS_HOST}${path}" || true)"
        code="${result%%$'\n'*}"
        location="${result#*$'\n'}"
        if [ "$code" = 302 ] && [ "$location" = "$expected_location" ]; then break; fi
        sleep 10
    done
    if [ "$code" != 302 ] || [ "$location" != "$expected_location" ]; then
        echo "FATAL: https://${DOCS_HOST}${path} = ${code} Location: ${location:--} (expected 302 to ${expected_location})" >&2
        exit 1
    fi
    echo "[docs] ${path} = 302 to ${expected_path} OK"
}

# Language-less content entries use the shared cookie and main-site fallback order.
check_language_redirect /video-platform /video-platform/en-us
check_language_redirect /README /README/en-us
check_language_redirect /LICENSE /LICENSE/en-us
check_language_redirect /security/policy /security/policy/en-us
check_language_redirect /security/acknowledgments /security/acknowledgments/en-us
check_language_redirect /security/policy /security/policy/ja-jp "user_lang_preference=ja-jp" "en-US"
check_language_redirect /security/acknowledgments /security/acknowledgments/ko-kr "user_lang_preference=ko-kr" "en-US"
check_access_challenge /private/articles/mu5735-report

check_custom_404 /
check_custom_404 /__codex_missing_page__
for path in /docs-home /docs-home/ /docs-home/zh-cn /docs-home/en-us /docs-home/ja-jp /docs-home/ko-kr \
    /zh-cn /en-us /ja-jp /ko-kr /zh-cn/ /en-us/ /ja-jp/ /ko-kr/; do
    check_custom_404 "$path"
done
for slug in amc-10-formula-guide uk-undergraduate-majors; do
    for lang in zh-cn en-us ja-jp ko-kr; do
        check_direct_404 "/articles/${slug}/${lang}" "text/html"
        check_direct_404 "/articles/${slug}/${lang}/" "text/html"
    done
done

for path in /video-platform/zh-cn /video-platform/en-us /video-platform/ja-jp /video-platform/ko-kr \
    /README/zh-cn /README/en-us /README/ja-jp /README/ko-kr \
    /LICENSE/zh-cn /LICENSE/en-us /LICENSE/ja-jp /LICENSE/ko-kr \
    /security/policy/zh-cn /security/policy/en-us /security/policy/ja-jp /security/policy/ko-kr \
    /security/acknowledgments/zh-cn /security/acknowledgments/en-us \
    /security/acknowledgments/ja-jp /security/acknowledgments/ko-kr; do
    check_code "$path" 200
done
check_direct_404 /articles/mu5735-report "text/html"
for lang in zh-cn en-us ja-jp ko-kr; do
    check_direct_404 "/articles/mu5735-report/${lang}" "text/html"
    check_direct_404 "/articles/mu5735-report/${lang}/" "text/html"
    check_access_challenge "/private/articles/mu5735-report/${lang}"
done
for slug in amc-10-formula-guide uk-undergraduate-majors mu5735-report; do
    for lang in zh-cn en-us ja-jp ko-kr; do
        check_access_challenge "/private/articles/${slug}/${lang}"
    done
done
# Root static assets must be served by Pages, not by the catch-all [lang].js Function.
for asset in /comicine-favicon.svg /comicine-favicon.png /comicine-xtext.svg /comicine-xtext.png \
    /logo.svg /hashmap.json /fonts.css; do
    check_code "$asset" 200
done
private_asset_path="$(find "$DIST_DIR/assets" -maxdepth 1 -type f -name 'private_articles_amc-10-formula-guide_zh-cn.md.*' -print -quit)"
if [ -z "$private_asset_path" ]; then
    echo "FATAL: the built private article JavaScript bundle was not found" >&2
    exit 1
fi
check_access_challenge "/assets/${private_asset_path##*/}"
for asset in \
    /assets/articles_mu5735_fig01_timeline.png \
    /assets/articles_mu5735_fig02_last60s.png \
    /assets/articles_mu5735_fig03_radar.png \
    /assets/articles_mu5735_fig04_two_flights.png \
    /assets/articles_mu5735_fig06_acars_trend.png \
    /assets/articles_mu5735_fig08_investigation_timeline.png \
    /assets/private_articles_mu5735_fig01_timeline.png \
    /assets/private_articles_mu5735_fig02_last60s.png \
    /assets/private_articles_mu5735_fig03_radar.png \
    /assets/private_articles_mu5735_fig04_two_flights.png \
    /assets/private_articles_mu5735_fig06_acars_trend.png \
    /assets/private_articles_mu5735_fig08_investigation_timeline.png; do
    if [[ "$asset" == /assets/articles_mu5735_* ]]; then
        check_direct_404 "$asset" "text/plain"
    else
        check_access_challenge "$asset"
    fi
done
echo "[docs] done."
