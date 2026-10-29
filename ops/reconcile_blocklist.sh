#!/bin/bash

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# Reconcile the ban list with D1 (the authority) in both directions.
#
# Authority: the `blocked_ips` table in D1. `docs/lists/blocklist.txt` is the
# hand-editable mirror:
#   * entries only in the file  -> pushed up to D1
#   * entries only in D1 (active) -> pulled back into the file's managed section
# It never deletes from the file (an unblock is recorded as a soft delete in D1,
# not as a removal instruction). See `docs/lists/README.md`.
#
# Usage:
#   bash ops/reconcile_blocklist.sh              # do it
#   bash ops/reconcile_blocklist.sh --dry-run    # show the diff, write nothing
#
# Why a wrapper instead of calling `src/auto_block.py` directly from deploy.sh:
#   1. `auto_block.py` needs Python >= 3.10 (it uses `X | None`). macOS ships
#      /usr/bin/python3 = 3.9, so "python3" is not good enough -- pick one that works.
#   2. It imports `cidr`/`config` from `src/`, so it must run with `src/` on
#      sys.path and from the repo root.
#   3. Tests can stub this single entry point without faking D1.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

# Pick an interpreter that can actually import the module. Prefer the external
# build venv, then whatever `python3` resolves to.
candidates=(
    "${COMICINE_PYTHON:-}"
    "${COMICINE_VENV_PYTHON:-/tmp/comicine-venv312/bin/python}"
    "/opt/homebrew/bin/python3"
    "$(command -v python3 2>/dev/null || true)"
)
PYTHON=""
for cand in "${candidates[@]}"; do
    [ -n "$cand" ] || continue
    [ -x "$cand" ] || continue
    if "$cand" - <<'PY' >/dev/null 2>&1
import sys
sys.path.insert(0, "src")
import auto_block  # noqa: F401
PY
    then
        PYTHON="$cand"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "FATAL: no Python >= 3.10 with src/ importable was found (tried COMICINE_PYTHON, COMICINE_VENV_PYTHON, /opt/homebrew/bin/python3, python3)" >&2
    exit 1
fi

exec "$PYTHON" src/auto_block.py reconcile "$@"
