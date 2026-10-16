#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026 Limooo <https://limooo.cn/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# Reproducible Limooo build entry point.
#
# Run in a clean environment:
#   npm ci
#   npm run build
#
# This script installs and isolates the Python dependencies used by npm's build command:
# 1. Create the local, untracked .venv-build and install locked dependencies.
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
VENV="$ROOT/.venv-build"
VENV_PY="$VENV/bin/python"

if [ ! -x "$VENV_PY" ]; then
    echo "[build] creating $VENV"
    "$PYTHON" -m venv "$VENV"
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
