#!/usr/bin/env bash

# Limooo - Flask Web Application
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

# Local replica of .github/workflows/tests.yml.
#
# Why: CI runs "build first, then typecheck / tests"; running only vitest/pytest
# locally can be all green while CI turns red -- typically when the generated
# functions/_lib/config.ts and src/build.py drift apart (a rename applied on one
# side only), because the local tree happens to be self-consistent while the
# committed tree is not.
#
# So: run this before pushing. Whatever CI runs, this runs.
#
# Step set (identical to .github/workflows/tests.yml -- keep both in sync):
#   typescript: build / typecheck / migrate --dry-run / npm test / coverage (report only)
#   python:     ruff / mypy / pytest / config contract / security headers / license headers
#               / readme_facts.py --check
#
# config contract vs. artifact drift are two different gates, keep both:
#   check_config_contract.py  -- contract <-> src/config.py <-> functions/_lib/config.ts
#   check_requirements_lock.py -- requirements.lock stays in step with ops/requirements.txt
#                                semantically agree (a field added to the contract but
#                                never consumed fails here, and build does not complain)
#   the inline check below    -- after build, no generated file differs from git (drift)
#
# ruff, mypy, and pytest-cov are installed by ensure_gate_tools when missing.
# If installation fails, the affected check reports NOT VERIFIED locally.
#
# Build output isolation: LIMOOO_PUBLIC_DIR / LIMOOO_PREVIEW_DIR point the build at a
# scratch dir instead of the iCloud-synced tree. Export them to pin the location: the
# value is used exactly as given and is never removed. Left unset, every run gets its
# own mktemp -d directory (removed on exit), so two concurrent runs cannot delete each
# other's files mid-build.
#
# Usage:
#   bash ops/ci_check.sh                # check the current working tree
#   bash ops/ci_check.sh --ref=<rev>    # check <rev> in a temporary worktree
#                                       # (validates the commit about to be pushed,
#                                       #  even when the working tree is dirty)
#   bash ops/ci_check.sh --typescript   # typescript job only
#   bash ops/ci_check.sh --python       # python job only
#   bash ops/ci_check.sh --no-build     # skip build (assume artifacts are fresh)
#
# Exit code 0 = CI would pass; non-zero = CI would fail, do not push.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REF=""
RUN_TS=1
RUN_PY=1
DO_BUILD=1

while [ $# -gt 0 ]; do
    case "$1" in
        --ref=*) REF="${1#--ref=}" ;;
        --typescript) RUN_PY=0 ;;
        --python) RUN_TS=0 ;;
        --no-build) DO_BUILD=0 ;;
        # The help text is the comment block at the top of this file, from "# Local replica"
        # through the line before "set -euo pipefail". Do not hard-code line numbers: editing
        # the comments would silently truncate the help text if sed used a fixed range.
        --help|-h)
            awk '/^# Local replica/,/^set -euo pipefail/' "$0" | sed '$d'
            exit 0
            ;;
        *)
            echo "FATAL: unknown argument $1" >&2
            echo "       supported: --ref=<rev> / --typescript / --python / --no-build" >&2
            exit 2
            ;;
    esac
    shift
done

# Isolate build output instead of repeatedly removing public/ inside the iCloud-synced tree.
# The default path must be unique per process: concurrent ci_check.sh runs would otherwise
# remove each other's staging directories when build.py starts (Errno 66 Directory not empty /
# FileNotFoundError). This has already wasted investigation time during an audit. An explicitly
# supplied path keeps its existing behavior: use it as given, do not uniquify it, and never
# remove it on exit because it belongs to the caller.
CI_TMP_PUBLIC=""
CI_TMP_PREVIEW=""
# macOS TMPDIR ends in /; strip it to avoid producing a double slash in paths.
SCRATCH_ROOT="${TMPDIR:-/tmp}"
SCRATCH_ROOT="${SCRATCH_ROOT%/}"
if [ -z "${LIMOOO_PUBLIC_DIR:-}" ]; then
    LIMOOO_PUBLIC_DIR="$(mktemp -d "$SCRATCH_ROOT/limooo-ci-public.XXXXXX")" || {
        echo "FATAL: cannot create a temporary public dir under $SCRATCH_ROOT" >&2
        exit 2
    }
    CI_TMP_PUBLIC="$LIMOOO_PUBLIC_DIR"
fi
if [ -z "${LIMOOO_PREVIEW_DIR:-}" ]; then
    LIMOOO_PREVIEW_DIR="$(mktemp -d "$SCRATCH_ROOT/limooo-ci-preview.XXXXXX")" || {
        echo "FATAL: cannot create a temporary preview dir under $SCRATCH_ROOT" >&2
        exit 2
    }
    CI_TMP_PREVIEW="$LIMOOO_PREVIEW_DIR"
fi
export LIMOOO_PUBLIC_DIR LIMOOO_PREVIEW_DIR
if [ -n "$CI_TMP_PUBLIC" ] || [ -n "$CI_TMP_PREVIEW" ]; then
    echo "[ci] scratch dirs: public=$LIMOOO_PUBLIC_DIR preview=$LIMOOO_PREVIEW_DIR (temporary, removed on exit)"
fi

# Prefer an existing external build venv, then fall back to python3.
if [ -z "${PYTHON_BIN:-}" ]; then
    for candidate in /tmp/limooo-venv312/bin/python /tmp/limooo-venv/bin/python; do
        if [ -x "$candidate" ]; then
            PYTHON_BIN="$candidate"
            break
        fi
    done
fi
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Install missing gate tools instead of silently skipping them (changed 2026-10-12).
# Previously, ruff, mypy, and pytest-cov were only probed: if missing, a SKIP line still counted
# as success. CI installs them from pinned versions in ops/requirements.txt, so local and CI
# results could differ. This contributed to the 2026-10-12 case where local checks passed but CI
# failed after a push. Install missing tools into the same interpreter CI uses; only fall back to
# SKIP if installation fails, such as when offline, and make clear that the check was not run.
ensure_gate_tools() {
    [ "${LIMOOO_SKIP_TOOL_INSTALL:-0}" = 1 ] && return 0
    local missing=()
    "$PYTHON_BIN" -m ruff --version >/dev/null 2>&1 || missing+=(ruff)
    "$PYTHON_BIN" -m mypy --version >/dev/null 2>&1 || missing+=(mypy)
    "$PYTHON_BIN" -c 'import pytest_cov' >/dev/null 2>&1 || missing+=(pytest-cov)
    [ ${#missing[@]} -eq 0 ] && return 0
    echo "[ci] installing gate tools into $PYTHON_BIN: ${missing[*]}"
    "$PYTHON_BIN" -m pip install -q --disable-pip-version-check "${missing[@]}" >/dev/null 2>&1 || true
}
ensure_gate_tools

WORKTREE=""
cleanup() {
    if [ -n "$WORKTREE" ] && [ -d "$WORKTREE" ]; then
        git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
    fi
    # Remove only directories created by this process with mktemp; caller-supplied paths are
    # not ours to remove (see above). Use if instead of `[ -n x ] && rm`: when false, the latter
    # returns 1, and cleanup in an EXIT trap must not become a source of failure under set -e.
    if [ -n "$CI_TMP_PUBLIC" ]; then
        rm -rf "$CI_TMP_PUBLIC"
    fi
    if [ -n "$CI_TMP_PREVIEW" ]; then
        rm -rf "$CI_TMP_PREVIEW"
    fi
}
trap cleanup EXIT

# Select the tree to check.
TARGET="$ROOT"
if [ -n "$REF" ]; then
    if ! git rev-parse --verify --quiet "$REF^{commit}" >/dev/null; then
        echo "FATAL: not a commit: $REF" >&2
        exit 2
    fi
    WORKTREE="$(mktemp -d "${TMPDIR:-/tmp}/limooo-ci-check.XXXXXX")"
    # git worktree add requires the destination to be empty or absent.
    rmdir "$WORKTREE"
    git worktree add --detach "$WORKTREE" "$REF" >/dev/null
    # Reuse the main repository's dependencies instead of reinstalling them in the temporary tree.
    [ -d "$ROOT/node_modules" ] && ln -s "$ROOT/node_modules" "$WORKTREE/node_modules"
    TARGET="$WORKTREE"
    echo "[ci] checking ref $REF (tree at $TARGET)"
else
    echo "[ci] checking working tree at $ROOT"
fi

# Guard 1: detect iCloud conflict copies such as "build 2.py" or ".venv-build 2".
# A conflict copy can be a file or an entire directory. When iCloud copies
# `site/.venv-build` to `site/.venv-build 2`, only the directory name gets a suffix, so
# `-type f` would miss it. Search both files and directories with `\( -type f -o -type d \)`.
# Prune only the original dependency directories (node_modules/.venv-build/...), not numbered
# copies; otherwise the copies would be skipped, which was a gap in the previous version.
CONFLICTS="$(cd "$TARGET" && find functions src locales tests ops .github \
    \( -type d \( -name node_modules -o -name .venv-build -o -name .wrangler \
       -o -name out -o -name coverage -o -name .pytest_cache -o -name .ruff_cache \
       -o -name __pycache__ \) \) -prune -o \
    \( -type f -o -type d \) \( -name '* [0-9]' -o -name '* [0-9].*' \) -print 2>/dev/null | sort)"
if [ -n "$CONFLICTS" ]; then
    echo "[ci] FAIL: iCloud conflict copies detected ('xxx 2.ext' / 'xxx 2'); resolve them before committing:" >&2
    echo "$CONFLICTS" | head -20 | sed 's/^/       /' >&2
    echo "       once confirmed identical to the original:" >&2
    echo "         rm -f 'functions/_data/runtime 2.ts'" >&2
    echo "         rm -rf '.venv-build 2' 'node_modules.recovery-20260912-0145'" >&2
    exit 1
fi

# Guard 2: sensitive files must never be committed.
# If a checkout lacks .gitignore (for example, a new clone or a worktree created by an AI tool),
# `git add -A` can stage secrets/, *.db, and *.pem. .gitignore is now tracked, but this guard is
# still needed because `git add -f` and changing ignore rules after staging can bypass it.
#
# Check both staged files and untracked files that are not ignored.
# --directory collapses an ignored directory into one line, keeping output concise.
# Keep these patterns in sync with the sensitive-file section of the repository's .gitignore.
SENSITIVE_PATTERNS=(
    'secrets/*' '.dev.vars' '*.db' '*.db-shm' '*.db-wal' '*.pem' '*.key'
    'ops/out/*' 'ops/backups/*' 'backup-limooo-*' '各种密钥.txt' '*.mmdb'
)

sensitive_paths() {
    {
        (cd "$TARGET" && git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)
        (cd "$TARGET" && git ls-files --others --exclude-standard --directory 2>/dev/null || true)
    } | sort -u
}

match_sensitive_path() {
    local path="$1" pattern
    for pattern in "${SENSITIVE_PATTERNS[@]}"; do
        # shellcheck disable=SC2254 # The pattern must be expanded for wildcard matching.
        case "$path" in $pattern) return 0 ;; esac
    done
    return 1
}

SENSITIVE_HITS=""
while IFS= read -r path; do
    [ -n "$path" ] || continue
    if match_sensitive_path "$path"; then
        SENSITIVE_HITS="${SENSITIVE_HITS}${path}"$'\n'
    fi
done < <(sensitive_paths)

if [ -n "$SENSITIVE_HITS" ]; then
    echo "[ci] FAIL: sensitive files would be committed:" >&2
    printf '%s' "$SENSITIVE_HITS" | sed 's/^/       /' >&2
    echo "       remove them from the index (git restore --staged <path>) or add an ignore rule;" >&2
    echo "       secrets/ and *.db must never enter the repository." >&2
    exit 1
fi

# Guard 3: regenerate generated TypeScript artifacts during the build and ensure they match Git.
# If functions/_lib/config.ts, functions/_data/*.ts, or src/config.py differs from HEAD after
# the build, those generated files were omitted from the commit, a known cause of CI failures.
GENERATED_PATHS=(functions/_lib/config.ts functions/_data src/config.py)

echo "[ci] typescript job"
if [ "$RUN_TS" = 1 ]; then
    if [ ! -d "$TARGET/node_modules" ]; then
        echo "[ci] FAIL: $TARGET/node_modules is missing; run npm ci first" >&2
        exit 1
    fi

    echo "[ci] verify npm direct dependencies match package-lock"
    (cd "$TARGET" && node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
const mismatches = [];
for (const name of Object.keys(dependencies)) {
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  const packagePath = path.join(root, "node_modules", name, "package.json");
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  } catch {
    installed = "missing";
  }
  if (installed !== locked) mismatches.push(`${name}: installed=${installed} locked=${locked ?? "missing"}`);
}
if (mismatches.length) {
  console.error("[ci] FAIL: npm dependencies do not match package-lock.json");
  for (const mismatch of mismatches) console.error(`       ${mismatch}`);
  console.error("       run npm ci with node_modules stored outside the iCloud-synced repository");
  process.exit(1);
}
NODE
    )

    if [ "$DO_BUILD" = 1 ]; then
        echo "[ci] npm run build"
        (cd "$TARGET" && LIMOOO_VENV_PYTHON="$PYTHON_BIN" npm run build)
    fi

    if [ -n "$REF" ]; then
        drift="$(cd "$TARGET" && git status --porcelain -- "${GENERATED_PATHS[@]}" 2>/dev/null || true)"
        if [ -n "$drift" ]; then
            echo "[ci] FAIL: generated artifacts in $REF do not match src/build.py + config-contract.json:" >&2
            echo "$drift" | sed 's/^/       /' >&2
            echo "       commit the generator sources you changed (src/build.py / config-contract.json / locales/) as well." >&2
            exit 1
        fi
    fi

    echo "[ci] npm run typecheck"
    (cd "$TARGET" && npm run typecheck)

    echo "[ci] bash ops/migrate_d1.sh --dry-run"
    (cd "$TARGET" && bash ops/migrate_d1.sh --dry-run)

    echo "[ci] npm test"
    (cd "$TARGET" && npm test)

    # Coverage is reported without a threshold (W6-3) and never determines CI success:
    #   - Skip if @vitest/coverage-v8 is missing, and tell the user to install dependencies.
    #   - If tests fail, vitest emits no coverage report; `npm test` above already catches the
    #     failure, and reporting another coverage failure would obscure the real cause.
    #   - A second instrumented vitest run can produce different numbers because module state
    #     changes within a process; treating that difference as a gate failure would be flaky.
    # Do not write `if ! npm run ...`: that would turn exit code 1 into 0 and hide failures.
    if [ ! -d "$TARGET/node_modules/@vitest/coverage-v8" ]; then
        echo "[ci] SKIP coverage: @vitest/coverage-v8 is not installed (npm ci first)"
    else
        echo "[ci] npm run test:coverage (report only, no threshold)"
        set +e +o pipefail
        (cd "$TARGET" && npm run test:coverage) || echo "[ci] coverage report unavailable (see the npm test step above for the real result)"
        set -eo pipefail
    fi
fi

if [ "$RUN_PY" = 1 ]; then
    echo "[ci] python job"

    # ensure_gate_tools above tried to install ruff, mypy, and pytest-cov. Run each tool if
    # available, matching CI; otherwise print a clear SKIP so the local run cannot look fully green.
    if (cd "$TARGET" && "$PYTHON_BIN" -m ruff --version >/dev/null 2>&1); then
        echo "[ci] python -m ruff check src ops tests"
        (cd "$TARGET" && "$PYTHON_BIN" -m ruff check src ops tests)
    else
        echo "[ci] SKIP ruff: NOT VERIFIED locally (pip install -r ops/requirements.txt)"
    fi

    if (cd "$TARGET" && "$PYTHON_BIN" -m mypy --version >/dev/null 2>&1); then
        echo "[ci] python -m mypy src"
        (cd "$TARGET" && "$PYTHON_BIN" -m mypy src)
    else
        echo "[ci] SKIP mypy: NOT VERIFIED locally (pip install -r ops/requirements.txt)"
    fi

    echo "[ci] python -m pytest (no ambient git identity: a CI runner has none)"
    # Coverage is reported without a threshold (W6-3). pytest-cov is not in requirements.lock,
    # so probe before adding --cov; if missing, skip it without affecting the exit code.
    #
    # Strip Git identity here. On 2026-10-12, a test invoked `deploy.sh --commit` in a child
    # process. It passed locally because the machine had global user.name/email, but failed on
    # GitHub Actions with `fatal: empty ident name`. To reproduce CI, point HOME to an empty
    # directory, disable global/system config, and disable identity auto-detection with
    # user.useConfigOnly=true. Tests that commit must set an identity in their repository config.
    GIT_HOSTILE_HOME="$(mktemp -d -t limooo-ci-home-XXXXXX)"
    if (cd "$TARGET" && "$PYTHON_BIN" -c 'import pytest_cov' >/dev/null 2>&1); then
        (cd "$TARGET" && env "HOME=$GIT_HOSTILE_HOME" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
            GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true \
            "$PYTHON_BIN" -m pytest -q --cov=src --cov-report=term-missing)
    else
        echo "[ci] SKIP coverage: pytest-cov is not installed (pip install pytest-cov)"
        (cd "$TARGET" && env "HOME=$GIT_HOSTILE_HOME" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
            GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.useConfigOnly GIT_CONFIG_VALUE_0=true \
            "$PYTHON_BIN" -m pytest -q)
    fi
    rm -rf "$GIT_HOSTILE_HOME"
    echo "[ci] python ops/check_config_contract.py"
    (cd "$TARGET" && "$PYTHON_BIN" ops/check_config_contract.py)
    # Added 2026-10-11: Dependabot upgraded cairosvg to 2.9.1 while requirements.lock still
    # pinned 2.8.2, so the upgrade had no effect because build.sh installs from the lock file.
    # CI stayed green without noticing; this guard checks for that mismatch.
    echo "[ci] python ops/check_requirements_lock.py --check"
    (cd "$TARGET" && "$PYTHON_BIN" ops/check_requirements_lock.py --check)
    echo "[ci] python ops/check_security_headers.py"
    (cd "$TARGET" && "$PYTHON_BIN" ops/check_security_headers.py)
    echo "[ci] python ops/check_license_headers.py"
    (cd "$TARGET" && "$PYTHON_BIN" ops/check_license_headers.py)
    echo "[ci] python ops/readme_facts.py --check"
    (cd "$TARGET" && "$PYTHON_BIN" ops/readme_facts.py --check)
fi

echo "[ci] OK: CI will pass."
