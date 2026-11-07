#!/usr/bin/env bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# Local full test entry point: Python pytest + TypeScript vitest.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Python tests"
if [ -z "${PYTHON_BIN:-}" ]; then
    for candidate in /tmp/comicine-venv312/bin/python /tmp/comicine-venv/bin/python; do
        if [ -x "$candidate" ]; then
            PYTHON_BIN="$candidate"
            break
        fi
    done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"
# Run with the same hostile Git environment as ops/ci_check.sh: a CI runner has no
# global user.name/email, so tests must not depend on the developer's identity.
GIT_HOSTILE_HOME="$(mktemp -d -t comicine-run-tests-home-XXXXXX)"
trap 'rm -rf "$GIT_HOSTILE_HOME"' EXIT
env "HOME=$GIT_HOSTILE_HOME" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true \
    "$PYTHON_BIN" -m pytest

echo "TypeScript tests"
if command -v npm >/dev/null 2>&1 && [ -f package.json ]; then
    echo "TypeScript typecheck"
    npm run typecheck
    npm test
else
    echo "NOT VERIFIED: npm/package.json not found; TypeScript tests did not run" >&2
    exit 1
fi
