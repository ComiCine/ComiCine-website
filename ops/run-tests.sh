#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

# Local full test entry point: Python pytest + TypeScript vitest.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Python tests"
if [ -z "${PYTHON_BIN:-}" ]; then
    for candidate in /tmp/limooo-venv312/bin/python /tmp/limooo-venv/bin/python; do
        if [ -x "$candidate" ]; then
            PYTHON_BIN="$candidate"
            break
        fi
    done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"
"$PYTHON_BIN" -m pytest

echo "TypeScript tests"
if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    echo "TypeScript typecheck"
    npm run typecheck
    npm test
else
    echo "WARNING: npm/package.json not found; skipping vitest" >&2
fi
