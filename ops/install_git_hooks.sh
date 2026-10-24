#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

# Install the repository's git hooks (.githooks/pre-push).
# Run once after cloning on each machine:
#   bash ops/install_git_hooks.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -d .githooks ]; then
    echo "FATAL: .githooks/ not found" >&2
    exit 1
fi

chmod +x .githooks/* 2>/dev/null || true
git config core.hooksPath .githooks

echo "[hooks] core.hooksPath = .githooks"
echo "[hooks] active: ops/ci_check.sh runs before git push (validates the commit being pushed)"
