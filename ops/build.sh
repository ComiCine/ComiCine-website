#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

# Reproducible Limooo build entry point.
#
# Run in a clean environment:
#   npm ci
#   npm run build
#
# This script installs and isolates the Python dependencies used by npm's build command:
# 1. Create an external build venv and install locked dependencies.
# 2. Validate the cross-runtime configuration contract.
# 3. Run a render-only build with LIMOOO_BUILD=1 (no database initialization or production secrets).
# 4. Generate public/manifest.json.
set -euo pipefail

# Homebrew's cairosvg/cairocffi on macOS needs an explicit search path for the Cairo shared library.
if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    CAIRO_PREFIX="$(brew --prefix cairo 2>/dev/null || true)"
    if [ -n "$CAIRO_PREFIX" ] && [ -d "$CAIRO_PREFIX/lib" ]; then
        export DYLD_LIBRARY_PATH="$CAIRO_PREFIX/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}"
        export DYLD_FALLBACK_LIBRARY_PATH="$CAIRO_PREFIX/lib${DYLD_FALLBACK_LIBRARY_PATH:+:$DYLD_FALLBACK_LIBRARY_PATH}"
    fi
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
VENV="${LIMOOO_BUILD_VENV:-/tmp/limooo-build-venv}"

if [ -n "${LIMOOO_VENV_PYTHON:-}" ]; then
    VENV_PY="$LIMOOO_VENV_PYTHON"
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
LIMOOO_BUILD=1 "$VENV_PY" src/build.py

echo "[build] validating generated config contract"
"$VENV_PY" ops/check_config_contract.py

echo "[build] done"
