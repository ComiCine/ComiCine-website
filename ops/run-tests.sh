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
