#!/bin/bash

# ComiCine - Flask Web Application
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

# ComiCine.com deploy entrypoint (tasks/17, zero-VPS) -- the SINGLE deploy script.
#
# The VPS was retired on 2026-09-17: no ssh, no rsync, no remote restart, no nginx.
# Full deploy = (1) git commit -> (2) git push -> (3) Cloudflare Pages (+ related Workers).
#
# Usage:
#   bash ops/deploy.sh                          # = --all (commit + push + Pages + docs + Workers)
#   bash ops/deploy.sh --all                    # commit + push + Pages + docs + every Worker
#   bash ops/deploy.sh --dry-run                # print what would happen only
#   bash ops/deploy.sh --commit                 # commit only
#   bash ops/deploy.sh --commit --push          # commit and push
#   bash ops/deploy.sh -m "fix: thing"          # commit with message "deploy: fix: thing"
#   bash ops/deploy.sh --message="fix: thing"   # same, long form
#   bash ops/deploy.sh --pages                  # deploy production Pages + the comicine.pages.dev alias
#   bash ops/deploy.sh --docs                   # build + deploy docs.comicine.com only
#   bash ops/deploy.sh --workers                # deploy every standalone Worker only
#   bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker only
#   bash ops/deploy.sh --full ...               # same flags, but stream every step's output
#
# Default output is QUIET, and each phase collapses into a single word (2026-10-13):
#   Deploy: start
#   Prepare: done            <- Lists + Bans + Check
#   Git: committed 997f680
#      M ops/deploy.sh       <- changed files, one per line
#   Git: pushed to GitHub
#   Release: done            <- Pages + Docs + Workers
#   Deploy: done
# Only success lines are collapsed; skips still print themselves and a failing step
# dumps its full log. Pass --full (or COMICINE_DEPLOY_VERBOSE=1) to get one line per
# step plus every command.
# Ctrl-C stops the active step, cleans temporary files, and exits 130. Staged changes remain staged;
# completed commits, pushes, or deployments are not rolled back.
#
# With NO arguments this is exactly --all: commit + push + Pages + docs + Workers,
# matching the "full deploy" contract in AGENTS.md. To ship only what is already
# committed locally, pass --pages / --docs / --workers explicitly.
#
# **Workers are part of a full deploy** (2026-10-11): they used to need a separate
# `--worker=<name>`, so a change inside ops/*/src/** would sit committed and pushed
# while production kept running the old code — that silently happened twice in one
# session (the alert webhook channel report and the English alert copy). Pages and
# docs are **not** a proxy for a Worker update: they are separate deployments.
# Re-deploying an unchanged Worker is harmless (same bytes, new version id).
#
# commit / push require the current branch to be "main": this script compares HEAD with
# origin/main but pushes refs/heads/main, so on a feature branch the commit would land
# on the feature branch while the edge got built from a tree GitHub never saw. Any
# other branch (including a detached HEAD) aborts with FATAL (exit 2).
#
# --pages and --docs build the WORKING TREE, so they run ops/ci_check.sh first and
# refuse to deploy when the tree has uncommitted changes. Emergency override:
#   COMICINE_ALLOW_DIRTY=1 bash ops/deploy.sh --pages
#
# --workers (all of them) and --worker=<one> are mutually exclusive; passing both is a
# FATAL, because "deploy everything" and "deploy just this one" cannot both be meant.
#
# --worker= needs a non-empty Worker name: an empty value used to fall through to the
# "no arguments = --all" branch and silently became a full deploy. It is rejected with
# FATAL (exit 2).
#
# Before commit / push this runs ops/ci_check.sh (a local replica of
# .github/workflows/tests.yml): build first, then typecheck / tests. Any failure
# aborts, so nothing is committed or pushed. The checks run against the STAGED tree
# (git add happens first) and the staged tree hash is compared before committing, so
# a file changed by another tool during the checks cannot slip in unchecked.
# Emergency skip:
#   COMICINE_SKIP_CHECKS=1 bash ops/deploy.sh --all
#
# Two list-maintenance steps run FIRST, before the dirty-tree gate and CI (both
# can produce changes, so running them later would trip the gate and skip CI):
#   1. ops/sync_whitelist.py       -- generate the edge/WAF whitelist from own-ips.txt
#   2. ops/reconcile_blocklist.sh  -- reconcile the ban list with D1 `blocked_ips`
#                                     (the authority)
# Blocklist reconciliation is best-effort by default; make it fatal with
# COMICINE_STRICT_BLOCKLIST=1 or skip it with COMICINE_SKIP_BLOCKLIST_RECONCILE=1.
# Zone-level ASN Access Rules are managed manually with ops/waf_whitelist.sh --apply;
# a full deploy does not change those live rules.
#
# A failed git push aborts BEFORE the Pages deploy (never let the edge run ahead of
# GitHub). Emergency override:
#   COMICINE_ALLOW_PUSH_FAIL=1 bash ops/deploy.sh --all
#
# Environment:
#   COMICINE_DEPLOY_VERBOSE=1   same as --full
#   COMICINE_SKIP_DOCS=1        drop the docs.comicine.com step
#   COMICINE_SKIP_CHECKS=1      skip the local CI replica before commit / push / Pages / docs
#   COMICINE_ALLOW_DIRTY=1      deploy release artifacts with a dirty working tree
#   COMICINE_ALLOW_PUSH_FAIL=1  deploy even when git push fails (emergency only)
# Credentials are read from local secrets/webauthn.env; never written to disk or echoed.
# END-USAGE

set -euo pipefail

_COMICINE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -r "$_COMICINE_SCRIPT_DIR/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/env_compat.sh"
elif [[ -r "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh" ]]; then
    source "$_COMICINE_SCRIPT_DIR/../ops/env_compat.sh"
fi

ACTIVE_LOG=""
ACTIVE_TMP_INDEX=""

cleanup_deploy_temp_files() {
    [ -z "$ACTIVE_LOG" ] || rm -f "$ACTIVE_LOG"
    [ -z "$ACTIVE_TMP_INDEX" ] || rm -f "$ACTIVE_TMP_INDEX"
}

handle_interrupt() {
    trap '' INT
    cleanup_deploy_temp_files
    echo "Deploy: interrupted" >&2
    exit 130
}

trap cleanup_deploy_temp_files EXIT
trap handle_interrupt INT

# Set the diagnostic message language for this entry point and its child processes, while
# preserving the other locale settings.
unset LC_ALL
export LANG=C
export LC_MESSAGES=C

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DO_COMMIT=0
DO_PUSH=0
DO_PAGES=0
DO_WORKERS=0
DO_DOCS=0
WORKER=""
DRY_RUN=0
COMMIT_MESSAGE=""
VERBOSE="${COMICINE_DEPLOY_VERBOSE:-0}"

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --commit) DO_COMMIT=1 ;;
        --push) DO_PUSH=1 ;;
        --pages) DO_PAGES=1 ;;
        --docs) DO_DOCS=1 ;;
        --workers) DO_WORKERS=1 ;;
        --all) DO_COMMIT=1; DO_PUSH=1; DO_PAGES=1; DO_DOCS=1; DO_WORKERS=1 ;;
        --full) VERBOSE=1 ;;
        --worker=*)
            WORKER="${1#--worker=}"
            if [ "${DO_WORKERS:-0}" = 1 ]; then
                echo "FATAL: --workers and --worker=<name> are mutually exclusive" >&2
                exit 2
            fi
            # An empty value (`--worker=$W` when $W is empty) would satisfy the "no arguments =
            # --all" branch below and silently trigger a full commit + push + Pages + docs deploy (W3-2).
            if [ -z "$WORKER" ]; then
                echo "FATAL: --worker= needs a Worker name (for example --worker=comicine-status)" >&2
                exit 2
            fi
            case "$WORKER" in
                *[!A-Za-z0-9._-]*)
                    echo "FATAL: invalid Worker name '$WORKER' (allowed: letters, digits, dot, underscore, hyphen)" >&2
                    exit 2
                    ;;
            esac
            ;;
        --message=*) COMMIT_MESSAGE="${1#--message=}" ;;
        -m)
            if [ $# -lt 2 ]; then
                echo "FATAL: -m requires a commit message" >&2
                exit 2
            fi
            COMMIT_MESSAGE="$2"
            shift
            ;;
        -m*) COMMIT_MESSAGE="${1#-m}" ;;
        --help|-h) sed -n '/^# Usage:/,/^# END-USAGE/p' "$0"; exit 0 ;;
        *)
            echo "FATAL: unknown argument $1" >&2
            echo "       supported: --dry-run / --commit / --push / --pages / --docs / --workers / --all / --full / -m <msg> / --message=<msg> / --worker=<name>" >&2
            exit 2
            ;;
    esac
    shift
done

# No arguments means --all (commit + push + Pages + docs + Workers), matching the definition of
# a full deploy in AGENTS.md.
# Check `DO_WORKERS` as well: without it, `--workers` alone would enter this branch and silently
# trigger a full deploy. This happened before: `--workers --dry-run` printed Pages and docs steps.
if [ "$DO_COMMIT" = 0 ] && [ "$DO_PUSH" = 0 ] && [ "$DO_PAGES" = 0 ] && [ "$DO_DOCS" = 0 ] &&
    [ "${DO_WORKERS:-0}" = 0 ] && [ -z "$WORKER" ]; then
    DO_COMMIT=1
    DO_PUSH=1
    DO_PAGES=1
    DO_DOCS=1
    DO_WORKERS=1
fi

if [ "${COMICINE_SKIP_DOCS:-0}" = 1 ]; then
    DO_DOCS=0
fi

# Stage 0 branch assertion: commit and push are allowed only on main (W3-1).
# A past bug compared HEAD but always pushed refs/heads/main. A full deploy from a feature branch
# committed to that feature branch, pushed main (usually a no-op while still reporting "pushed"),
# and then built Pages from the feature branch working tree. The edge could get ahead of GitHub,
# breaking this script's ordering guarantee. Run the assertion before --dry-run so dry runs report
# the same invalid path.
IN_GIT_TREE=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    IN_GIT_TREE=1
fi
CURRENT_BRANCH=""
if [ "$IN_GIT_TREE" = 1 ]; then
    CURRENT_BRANCH="$(git symbolic-ref --short -q HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
BRANCH_LABEL="$CURRENT_BRANCH"
if [ "$CURRENT_BRANCH" = "HEAD" ]; then
    BRANCH_LABEL="detached HEAD"
elif [ -z "$CURRENT_BRANCH" ]; then
    BRANCH_LABEL="unknown"
fi

if [ "$IN_GIT_TREE" = 1 ] && { [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ]; }; then
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo "FATAL: commit/push must run on branch main (current: $BRANCH_LABEL)" >&2
        echo "       switch to main first (git switch main) and rerun; this script pushes refs/heads/main only" >&2
        exit 2
    fi
fi

# Pages, docs, and Workers publish the current working tree to production. Require main for every
# release path so a feature branch cannot deploy to the production branch accidentally.
if [ "$IN_GIT_TREE" = 1 ] && [ "$CURRENT_BRANCH" != "main" ] \
    && { [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; }; then
    echo "FATAL: production deploy must run on branch main (current: $BRANCH_LABEL)" >&2
    echo "       switch to main first (git switch main) and rerun" >&2
    exit 2
fi

# Run one substep in either of two modes:
#   Quiet (default): capture output in a temporary log; print only "<tag>: done" on success, or
#                    "<tag>: FAILED -- full log follows" and the full log to stderr on failure.
#   --full: print the command, then pass through its output without adding a status line.
# Usage: run_step "<tag>" <command...>
# Since 2026-10-13, successful steps in the same phase are collected and printed by flush_steps
# as one line in quiet mode:
#   Lists + Bans + Check   -> `Prepare: done`
#   Pages + Docs + Workers -> `Release: done`
# Skips and failures still print separately, so only successful steps are combined. A quiet run
# therefore does not show which gates ran; infer that from the absence of skip/fail lines.
# `--full` and COMICINE_DEPLOY_VERBOSE=1 keep per-step output.
DEFERRED_STEPS=()
DEFERRED_LABEL="Steps"
flush_steps() {
    [ ${#DEFERRED_STEPS[@]} -eq 0 ] && return 0
    DEFERRED_STEPS=()
    echo "${DEFERRED_LABEL}: done"
}

run_step() {
    local tag="$1"; shift
    if [ "$VERBOSE" = 1 ]; then
        echo "$*"
        "$@"
        return
    fi
    local log
    log="$(mktemp -t comicine-deploy-XXXXXX.log)"
    ACTIVE_LOG="$log"
    if "$@" >"$log" 2>&1; then
        rm -f "$log"
        ACTIVE_LOG=""
        DEFERRED_STEPS+=("$tag")
    else
        flush_steps
        echo "$tag: FAILED -- full log follows" >&2
        cat "$log" >&2
        rm -f "$log"
        ACTIVE_LOG=""
        return 1
    fi
}

if [ "$DRY_RUN" = 1 ]; then
    echo "Deploy: start (dry-run)"
    [ "$IN_GIT_TREE" = 1 ] && echo "  branch: $BRANCH_LABEL"
    [ "$DO_COMMIT" = 1 ] && echo "  would-run: git add -A && git commit"
    [ "$DO_PUSH" = 1 ] && echo "  would-run: git push origin main"
    { [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ]; } && echo "  requires: branch main (FATAL exit 2 on any other branch)"
    { [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ] || [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; } && echo "  would-run: bash ops/ci_check.sh (skip with COMICINE_SKIP_CHECKS=1)"
    [ "$DO_PAGES" = 1 ] && echo "  would-run: bash ops/pages_deploy.sh"
    { [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ] || [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ]; } && echo "  would-run: python3 ops/sync_whitelist.py"
    { [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ] || [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ]; } && echo "  would-run: bash ops/reconcile_blocklist.sh   (two-way ban-list reconcile with D1; skip with COMICINE_SKIP_BLOCKLIST_RECONCILE=1)"
    [ "$DO_DOCS" = 1 ] && echo "  would-run: bash ops/docs_deploy.sh"
    { [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; } && echo "  requires: clean working tree (override with COMICINE_ALLOW_DIRTY=1)"
    [ -n "$WORKER" ] && echo "  would-run: bash ops/workers_deploy.sh --worker=$WORKER"
    [ "${DO_WORKERS:-0}" = 1 ] && echo "  would-run: bash ops/workers_deploy.sh   (every Worker in its list)"
    echo "Deploy: dry-run done"
    exit 0
fi

echo "Deploy: start"

# Stage 0-1: restore missing tools (added 2026-10-11).
# This repository keeps the build venv and Wrangler under /tmp because tools do not work reliably
# in the iCloud-synced directory (see AGENTS.md). macOS periodically clears /tmp, after which
# deploy would report "build venv not found" or "wrangler not found". Those errors look like
# configuration problems but only mean the tools were removed; both happened in one deploy on
# 2026-10-11. Restore only missing tools, skip those already present, and do this only when a
# build or deploy is needed. Skip with COMICINE_SKIP_TOOL_BOOTSTRAP=1.
ensure_tooling() {
    [ "${COMICINE_SKIP_TOOL_BOOTSTRAP:-0}" = 1 ] && return 0

    local venv="${COMICINE_VENV_PYTHON:-/tmp/limooo-venv/bin/python}"
    if [ ! -x "$venv" ]; then
        echo "Tools: recreating the build venv at $(dirname "$(dirname "$venv")")"
        python3 -m venv "$(dirname "$(dirname "$venv")")" >/dev/null 2>&1 || true
        if [ -x "$venv" ]; then
            "$venv" -m pip install -q --disable-pip-version-check -r requirements.lock 2>&1 | tail -3
        fi
        [ -x "$venv" ] || { echo "FATAL: could not create the build venv at $venv" >&2; exit 1; }
    fi

    local wrangler="${WRANGLER_BIN:-/tmp/wrangler-env/node_modules/.bin/wrangler}"
    if [ ! -x "$wrangler" ]; then
        echo "Tools: recreating the wrangler environment at $(dirname "$(dirname "$(dirname "$wrangler")")")"
        local wenv
        wenv="$(dirname "$(dirname "$(dirname "$wrangler")")")"
        mkdir -p "$wenv"
        (cd "$wenv" && npm i wrangler@4 --silent >/dev/null 2>&1) || true
        [ -x "$wrangler" ] || { echo "FATAL: could not install wrangler at $wrangler" >&2; exit 1; }
    fi
}

if [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; then
    ensure_tooling
fi

# Print the command in --full mode; keep quiet by default (Git is already silent).
show_cmd() {
    [ "$VERBOSE" = 1 ] && echo "$*"
    return 0
}

GIT_VERIFIED=0
verify_head_signature() {
    local signing_key signer_fingerprint
    if ! git verify-commit HEAD >/dev/null 2>&1; then
        echo "Git: unverified"
        exit 1
    fi

    signing_key="$(git config --get user.signingkey || true)"
    signer_fingerprint="$(git show -s --format=%GF HEAD)"
    signing_key="$(printf '%s' "$signing_key" | tr '[:lower:]' '[:upper:]')"
    signer_fingerprint="$(printf '%s' "$signer_fingerprint" | tr '[:lower:]' '[:upper:]')"
    if [ -z "$signing_key" ]; then
        echo "Git: unverified"
        exit 1
    fi
    if [ "$signer_fingerprint" != "$signing_key" ]; then
        case "$signing_key" in
            *[!0-9A-F]*)
                echo "Git: unverified"
                exit 1
                ;;
        esac
        if [ "${#signing_key}" -ne 16 ] || [[ "$signer_fingerprint" != *"$signing_key" ]]; then
            echo "Git: unverified"
            exit 1
        fi
    fi

    GIT_VERIFIED=1
    echo "Git: verified"
}

# Stage 0a: stage first, then run checks against the exact tree to be committed.
# Previously checks ran before `git add -A`, so any tool changing a file between the check and
# commit could make the committed tree differ from the checked tree. Now stage first, capture a
# working-tree snapshot (see Stage 0c), and compare it again after checks. `git add` is normally
# silent, so it does not need to be wrapped in run_step.
#
# Snapshot implementation (two alternatives have failed before; do not replace this with a
# "simpler" approach):
#   * `git write-tree` only hashes the index. Files changed during checks are usually not staged
#     again, so the index and tree hash stay unchanged and the change goes undetected.
#   * `git stash create` includes index state in its hash. Stage 0a changes unstaged content to
#     staged content, producing different hashes for identical working-tree content and a false
#     positive on the normal path.
# The current approach uses a temporary index via GIT_INDEX_FILE, then runs read-tree HEAD,
# add -A, and write-tree. It represents only working-tree content, independent of the real index,
# and does not touch the user's index or working tree.
WORKTREE_SNAPSHOT=""
worktree_snapshot() {
    local tmp
    tmp="$(mktemp -t comicine-deploy-index-XXXXXX)"
    ACTIVE_TMP_INDEX="$tmp"
    rm -f "$tmp"
    # Use HEAD as the baseline, then add all current working-tree files (including untracked but
    # excluding ignored files) to the temporary index.
    if ! GIT_INDEX_FILE="$tmp" git read-tree HEAD 2>/dev/null; then
        rm -f "$tmp"
        ACTIVE_TMP_INDEX=""
        WORKTREE_SNAPSHOT="unavailable"
        return 0
    fi
    GIT_INDEX_FILE="$tmp" git add -A -- . >/dev/null 2>&1 || true
    WORKTREE_SNAPSHOT="$(GIT_INDEX_FILE="$tmp" git write-tree 2>/dev/null || echo "unavailable")"
    rm -f "$tmp"
    ACTIVE_TMP_INDEX=""
}

STAGED_TREE_BEFORE=""
# Note: staging and snapshotting happen after whitelist/blocklist updates and before CI (see
# Stage 0a-2 below). List sync legitimately modifies the working tree, so snapshotting beforehand
# would make Stage 0c report a change during checks and force the deploy to run twice. This happened
# on 2026-10-12.

# Stage 0b: run the local CI replica before commit, push, Pages, or docs.
# Previously, CI built before typecheck/tests, while local runs checked only vitest/pytest. This
# led to a green local run followed by a CI failure notification 30 seconds after pushing. Run the
# same checks here.
#
# The checked tree must be the same one that will be released (W3-3):
#   --commit         -> staged content (all non-ignored changes were staged in Stage 0a)
#   --push without commit -> HEAD that will be pushed
#   --pages / --docs / Workers -> current working tree released by the deploy helper
NEED_CHECKS=0
if [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ] || [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; then
    NEED_CHECKS=1
fi

NEED_PREPARATION=0
if [ "$DO_COMMIT" = 1 ] || [ "$DO_PUSH" = 1 ] || [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ]; then
    NEED_PREPARATION=1
fi

# Dirty-tree gate (W3-3): release helpers use the working tree directly. If it differs from every
# commit, deployment would publish content that CI did not check and GitHub does not have. Block
# before checks when not committing; when committing, check after the commit because Stage 0a's
# staged changes have been committed by then. Use the same pathspec as Stage 0a; ignored files do
# not count as dirty.
dirty_tree_gate() {
    local dirty_paths
    if [ "$IN_GIT_TREE" = 0 ]; then
        echo "Warning: not a git work tree; cannot verify that release artifacts match a commit" >&2
        return 0
    fi
    dirty_paths="$(git status --porcelain -- . ':!limooo.cn.png')"
    if [ -z "$dirty_paths" ]; then
        return 0
    fi
    if [ "${COMICINE_ALLOW_DIRTY:-0}" = 1 ]; then
        echo "Warning: deploying a dirty working tree (COMICINE_ALLOW_DIRTY=1)"
        return 0
    fi
    echo "FATAL: working tree has uncommitted changes; release helpers use the working tree" >&2
    printf '%s\n' "$dirty_paths" | sed 's/^/       /' >&2
    echo "       commit them first, or set COMICINE_ALLOW_DIRTY=1 to deploy them on purpose" >&2
    exit 1
}

if [ "$DO_COMMIT" = 0 ] && { [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; }; then
    dirty_tree_gate
fi

# Generate the whitelist before any gates.
# Generate whitelist.txt locally from own-ips.txt without accessing external list sources.
# Successful preparation steps (Lists / Bans / Check) are combined into `Prepare: done`.
DEFERRED_LABEL="Prepare"
if [ "$NEED_PREPARATION" = 1 ]; then
    run_step "Lists" python3 ops/sync_whitelist.py
fi

# Reconcile the blocklist in both directions, also before any gates.
# D1's blocked_ips table is authoritative: pull entries present in D1 but missing from the file,
# and push entries present in the file but missing from D1 (`src/auto_block.py reconcile`). Run
# this before the dirty-tree gate and CI for the same reason as whitelist generation: it can modify
# files.
#
# Failures do not block by default because source, network, or credential issues should not prevent
# a code release. Set COMICINE_STRICT_BLOCKLIST=1 to make failures fatal, or
# COMICINE_SKIP_BLOCKLIST_RECONCILE=1 to skip the step. This needs D1 access and reads credentials
# from secrets/webauthn.env, like the other scripts.
if [ "$NEED_PREPARATION" = 1 ]; then
    if [ "${COMICINE_SKIP_BLOCKLIST_RECONCILE:-0}" = 1 ]; then
        echo "Bans: skipped D1 reconcile (COMICINE_SKIP_BLOCKLIST_RECONCILE=1)"
    elif [ "${COMICINE_STRICT_BLOCKLIST:-0}" = 1 ]; then
        run_step "Bans" bash ops/reconcile_blocklist.sh
    else
        # In non-strict mode, warn on failure and use a subshell to let deployment continue.
        if ! run_step "Bans" bash ops/reconcile_blocklist.sh; then
            echo "Warning: blocklist reconcile failed; D1 stays authoritative" >&2
        fi
    fi
fi

# Stage 0a-2: stage and snapshot after list sync and before CI.
# The Lists and Bans steps above can legitimately update list files, so the tree to commit is only
# final here. Run git add -A, then take a working-tree snapshot for comparison in Stage 0c.
STAGED_TREE_BEFORE=""
if [ "$DO_COMMIT" = 1 ] && [ "$IN_GIT_TREE" = 1 ]; then
    show_cmd git add -A -- . ':!limooo.cn.png'
    git add -A -- . ':!limooo.cn.png'
    worktree_snapshot
    STAGED_TREE_BEFORE="$WORKTREE_SNAPSHOT"
fi

if [ "$NEED_CHECKS" = 1 ]; then
    if [ "${COMICINE_SKIP_CHECKS:-0}" = 1 ]; then
        echo "Check: skipped (COMICINE_SKIP_CHECKS=1)"
    elif [ "$DO_COMMIT" = 1 ]; then
        run_step "Check" bash ops/ci_check.sh
    elif [ "$DO_PUSH" = 1 ]; then
        run_step "Check" bash ops/ci_check.sh --ref=HEAD
    else
        run_step "Check" bash ops/ci_check.sh
    fi
fi

# End of preparation: combine successful steps into `Prepare: done` (Check is part of this phase).
flush_steps

# Stage 0c: detect working-tree changes made during checks.
# Take snapshots before and after checks. If they differ, another tool changed a file during
# validation, so the content to commit differs from the checked content. Exit and ask for a rerun
# instead of committing an unchecked tree. If snapshotting is unavailable (for example, read-tree
# failed), both values will be "unavailable" and this gate will not block.
if [ "$DO_COMMIT" = 1 ] && [ "$IN_GIT_TREE" = 1 ]; then
    worktree_snapshot
    worktree_snapshot_after="$WORKTREE_SNAPSHOT"
    if [ "$worktree_snapshot_after" != "$STAGED_TREE_BEFORE" ]; then
        echo "FATAL: working tree changed during checks; rerun deploy" >&2
        echo "       snapshot before checks $STAGED_TREE_BEFORE" >&2
        echo "       snapshot after checks  $worktree_snapshot_after" >&2
        exit 1
    fi
fi

# Stage 1: git commit.
if [ "$DO_COMMIT" = 1 ]; then
    if [ "$IN_GIT_TREE" = 0 ]; then
        echo "Warning: not a git work tree, skipped commit" >&2
    else
        if git diff --cached --quiet; then
            verify_head_signature
            echo "Git: nothing to commit"
        else
            # Capture filenames and statuses first; the short SHA is available only after commit.
            staged_status="$(git diff --cached --name-status)"
            # Use "deploy: <msg>" when -m/--message is supplied; otherwise generate a timestamped message.
            if [ -n "$COMMIT_MESSAGE" ]; then
                commit_subject="deploy: $COMMIT_MESSAGE"
            else
                commit_subject="deploy: auto-commit $(date '+%Y-%m-%d %H:%M')"
            fi
            show_cmd git commit -m "$commit_subject"
            git commit -m "$commit_subject" >/dev/null
            verify_head_signature
            # The revision label is the short SHA of the new commit.
            committed_sha="$(git rev-parse --short HEAD)"
            # Status letters come from git --name-status (A added / D deleted / M modified / R renamed).
            # List every committed file without truncating the output.
            STAGED_LINES=()
            while IFS="$(printf '\t')" read -r st path_old path_new; do
                [ -z "$st" ] && continue
                # Git reports renames/copies as "R100\told\tnew"; display the new path.
                [ -n "$path_new" ] && path_old="$path_new"
                STAGED_LINES+=("${st:0:1} ${path_old}")
            done <<< "$staged_status"
            # Print `committed <sha>` on its own line and list every committed file indented below.
            echo "Git: committed $committed_sha"
            for staged_line in "${STAGED_LINES[@]}"; do
                echo "   ${staged_line}"
            done
        fi
        # The new commit is the tree checked in Stage 0, so the pre-push hook does not need to run again.
        export COMICINE_CI_CHECKED_SHA="$(git rev-parse HEAD)"
    fi
fi

# Stage 2: git push.
PUSH_FAILED=0
if [ "$DO_PUSH" = 1 ]; then
    if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        echo "FATAL: not a git work tree; refusing to deploy without GitHub synchronization" >&2
        exit 1
    elif ! git fetch origin main >/dev/null 2>&1; then
        echo "FATAL: could not fetch GitHub state; refusing to deploy without GitHub synchronization" >&2
        exit 1
    else
        if [ "$GIT_VERIFIED" = 0 ]; then
            verify_head_signature
        fi
        LOCAL_HEAD="$(git rev-parse HEAD)"
        REMOTE_HEAD="$(git rev-parse origin/main)"
        if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
            echo "Git: GitHub already up to date, skipped push"
        elif git merge-base --is-ancestor "$REMOTE_HEAD" "$LOCAL_HEAD"; then
            show_cmd git push origin main
            if git push origin main >/dev/null 2>&1; then
                echo "Git: pushed to GitHub"
            elif [ "${COMICINE_ALLOW_PUSH_FAIL:-0}" = 1 ]; then
                # Emergency override: production will get ahead of GitHub. The final output must
                # state this clearly instead of continuing silently.
                PUSH_FAILED=1
            else
                echo "FATAL: git push failed; aborting before Pages deploy" >&2
                echo "       fix the remote/credentials and rerun, or set COMICINE_ALLOW_PUSH_FAIL=1 to deploy anyway" >&2
                exit 1
            fi
        else
            # Resolve diverged histories manually; automatic rebase/merge could include someone else's commit.
            echo "FATAL: local and GitHub histories diverged, resolve manually (rebase/merge) first" >&2
            exit 1
        fi
    fi
fi

# Stage 2b: check for a dirty working tree after commit.
# With --commit, Stage 0a's git add commits all pending changes, so check afterward for anything
# still dirty. Standalone --pages / --docs runs were already checked before Stage 0b.
if [ "$DO_COMMIT" = 1 ] && { [ "$DO_PAGES" = 1 ] || [ "$DO_DOCS" = 1 ] || [ -n "$WORKER" ] || [ "${DO_WORKERS:-0}" = 1 ]; }; then
    dirty_tree_gate
fi

# Stage 3: Pages. Print full logs only on failure; print one status line on success.
# Successful release steps (Pages / Docs / Workers) are combined into `Release: done`.
DEFERRED_LABEL="Release"
if [ "$DO_PAGES" = 1 ]; then
    # pages_deploy.sh checks /_health = 200 before finishing and exits nonzero on failure.
    run_step "Pages" bash ops/pages_deploy.sh
fi

# Stage 3b: docs.comicine.com (separate Pages project comicine-docs).
if [ "$DO_DOCS" = 1 ]; then
    # docs_deploy.sh smoke-checks each language path and exits nonzero on failure.
    run_step "Docs" bash ops/docs_deploy.sh
fi

# Stage 4: deploy an individual Worker (optional; independent of Pages).
if [ -n "$WORKER" ]; then
    run_step "Worker: $WORKER" env COMICINE_DEPLOY_GATE_PASSED=1 bash ops/workers_deploy.sh "--worker=$WORKER"
fi

if [ "${DO_WORKERS:-0}" = 1 ] && [ -z "$WORKER" ]; then
    # Deploy every Worker in the list; workers_deploy.sh without arguments deploys all listed Workers.
    # The label `Workers` was chosen on 2026-10-11 to match `Pages` and `Docs`; all three are
    # combined into one `Pages+Docs+Workers: done` line.
    run_step "Workers" env COMICINE_DEPLOY_GATE_PASSED=1 bash ops/workers_deploy.sh
fi

# End of release phase: print `Release: done` (also used when only Pages is deployed).
flush_steps

# The user asked to remove the "CI: tests success, CodeQL success" line on 2026-10-13.
# The Stage 5 post-push CI observation step was removed with it because it only repeated a
# notification GitHub already sends by email. The actual gate runs locally in ops/ci_check.sh,
# matching CI by installing ruff/mypy/pytest-cov and running pytest without a Git identity.
# To see GitHub's result, run: gh run list --commit <sha>.

# The emergency override warning must be the final line. This keeps the fact that production is
# ahead of GitHub visible at the end of the log, rather than letting later steps obscure it.
if [ "$PUSH_FAILED" = 1 ]; then
    echo "Warning: deployed without pushing to GitHub"
fi
echo "Deploy: done"
