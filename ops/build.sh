#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# Reproducible ComiCine build entry point.
#
# Run in a clean environment:
#   npm ci
#   npm run build
#
# This script installs and isolates the Python dependencies used by npm's build command:
# 1. Create an external build venv and install locked dependencies.
# 2. Validate the cross-runtime configuration contract.
# 3. Run a render-only build with COMICINE_BUILD=1 (no database initialization or production secrets).
# 4. Generate public/manifest.json.
set -euo pipefail

_COMICINE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -r "$_COMICINE_SCRIPT_DIR/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/env_compat.sh"
elif [[ -r "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh"
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
VENV="${COMICINE_BUILD_VENV:-/tmp/comicine-build-venv}"

if [ -n "${COMICINE_VENV_PYTHON:-}" ]; then
    VENV_PY="$COMICINE_VENV_PYTHON"
    if [ ! -x "$VENV_PY" ]; then
        echo "FATAL: configured Python is not executable: $VENV_PY" >&2
        exit 1
    fi
else
    VENV_PY="$VENV/bin/python"
    if [ ! -x "$VENV_PY" ]; then
        echo "[build] creating $VENV"
        "$PYTHON" -m venv "$VENV"
    fi
fi

echo "[build] installing Python dependencies"
if [ -f "$ROOT/requirements.lock" ]; then
    "$VENV_PY" -m pip install --disable-pip-version-check -q -r requirements.lock
else
    "$VENV_PY" -m pip install --disable-pip-version-check -q -r ops/requirements.txt
fi

echo "[build] validating config contract"
"$VENV_PY" ops/check_config_contract.py --skip-ts

echo "[build] rendering static pages (build mode)"
COMICINE_BUILD=1 "$VENV_PY" src/build.py

echo "[build] validating generated config contract"
"$VENV_PY" ops/check_config_contract.py

echo "[build] done"
