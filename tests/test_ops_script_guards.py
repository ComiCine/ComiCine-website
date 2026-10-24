# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Safety guards for `ops/deploy.sh` and `ops/migrate_d1.sh` (tasks/22, W3).

All cases run offline:
  * `deploy.sh` uses only `--dry-run` or stubbed Pages/docs steps in a temporary Git repository;
  * `migrate_d1.sh` points `WRANGLER_BIN` at a fake Wrangler and never contacts Cloudflare or production D1.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASH = "/bin/bash"
DEPLOY = ROOT / "ops" / "deploy.sh"
WORKERS_DEPLOY = ROOT / "ops" / "workers_deploy.sh"
MIGRATE = ROOT / "ops" / "migrate_d1.sh"
MIGRATIONS_DIR = ROOT / "ops" / "migrations"


# Helpers


# These cases test deploy.sh **gate logic**, not the toolchain. Tool bootstrap (added 2026-10-11)
# tries to create a venv and install wrangler in a temporary repository. It has no requirements.lock, so it fails,
# making the whole test fail spuriously. Disable bootstrap by default; tests for bootstrap can enable it explicitly.
_GUARD_ENV = {"LIMOOO_SKIP_TOOL_BOOTSTRAP": "1"}


def run(args, cwd=ROOT, env=None, timeout=60):
    full_env = dict(os.environ)
    full_env.update(_GUARD_ENV)
    if env:
        full_env.update(env)
    return subprocess.run(
        args, cwd=str(cwd), env=full_env, capture_output=True, text=True, timeout=timeout
    )


def git(args, cwd):
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, check=True
    )


def make_repo(tmp_path: Path, branch: str = "main") -> Path:
    """Create a clean temporary Git repository and add `deploy.sh` plus stub step scripts.

    The identity must be written to this repository's config; `git -c` only applies to the command we invoke. `deploy.sh --commit` runs `git commit` internally, and CI runners have no `user.name` or `user.email`, so Git exits 128 with `Author identity unknown`. A global identity masked this locally until the GitHub failure on 2026-10-12. Also disable signing: if a global `commit.gpgsign` setting is enabled without an available key, the test fails spuriously.
    """
    repo = tmp_path / "repo"
    (repo / "ops").mkdir(parents=True)
    shutil.copy2(DEPLOY, repo / "ops" / "deploy.sh")
    for name, body in (
        ("ci_check.sh", '#!/bin/bash\necho "STUB ci_check ran (args: $*)"\n'),
        ("pages_deploy.sh", '#!/bin/bash\necho "STUB pages_deploy ran"\n'),
        ("docs_deploy.sh", '#!/bin/bash\necho "STUB docs_deploy ran"\n'),
        ("workers_deploy.sh", '#!/bin/bash\necho "STUB workers_deploy ran (args: $*)"\n'),
        # Allowlist generation: deploy.sh builds it from own-ips.txt before running the gates.
        ("sync_whitelist.py", '#!/usr/bin/env python3\nprint("STUB sync_whitelist ran (args: $*)")\n'),
        # Blocklist reconciliation (added 2026-10-11) reads D1; stub it in tests.
        ("reconcile_blocklist.sh", '#!/bin/bash\necho "STUB reconcile_blocklist ran (args: $*)"\n'),
    ):
        path = repo / "ops" / name
        path.write_text(body)
        path.chmod(0o755)
    (repo / "tracked.txt").write_text("v1\n")
    git(["-c", "init.defaultBranch=main", "init", "-q"], repo)
    # Repository-level identity: the commit made inside deploy.sh relies on this, not the runner global config.
    git(["config", "user.name", "w3"], repo)
    git(["config", "user.email", "w3@example.com"], repo)
    git(["config", "commit.gpgsign", "false"], repo)
    git(["add", "-A"], repo)
    git(["commit", "-q", "-m", "init"], repo)
    if branch != "main":
        git(["checkout", "-q", "-b", branch], repo)
    return repo


def migration_names() -> list[str]:
    return sorted(p.name for p in MIGRATIONS_DIR.glob("*.sql"))


def expected_tables() -> list[str]:
    text = MIGRATE.read_text()
    match = re.search(r"^\s*expected=\(([^)]*)\)", text, re.M)
    assert match, "could not read the expected table list from ops/migrate_d1.sh"
    tables = match.group(1).split()
    if (MIGRATIONS_DIR / "004_auth_sessions.sql").exists():
        tables.append("auth_sessions")
    return tables


def wrangler_payload(names: list[str]) -> str:
    return json.dumps(
        [{"results": [{"name": n} for n in names], "success": True, "meta": {"rows_read": len(names)}}],
        indent=2,
    )


def write_fake_wrangler(
    path: Path, command_error: str, versions: list[int], failure_fragment: str | None = None
) -> Path:
    """Fake Wrangler: selected SQL commands fail, and SELECT version returns the supplied state."""
    rows = ",".join(f'{{"version":{v}}}' for v in versions)
    path.write_text(
        "#!/bin/bash\n"
        'cmd=""\n'
        "while [ $# -gt 0 ]; do\n"
        '    case "$1" in\n'
        '        --command) cmd="$2"; shift ;;\n'
        "    esac\n"
        "    shift\n"
        "done\n"
        'case "$cmd" in\n'
        f'    *"FROM schema_version"*) echo \'[{{"results":[{rows}],"success":true,"meta":{{"rows_read":{len(versions)}}}}}]\'; exit 0 ;;\n'
        '    *"CREATE TABLE IF NOT EXISTS schema_version"*|*"INSERT OR REPLACE INTO schema_version"*) echo "ok"; exit 0 ;;\n'
        '    *)\n'
        '        if [ -n "${FAKE_WRANGLER_LOG:-}" ]; then printf "%s\\n" "$cmd" >> "$FAKE_WRANGLER_LOG"; fi\n'
        + (
            f'        if [[ "$cmd" == *"{failure_fragment}"* ]]; then echo "{command_error}"; exit 1; fi\n'
            if failure_fragment is not None
            else f'        echo "{command_error}"; exit 1\n'
        )
        + '        echo "ok"; exit 0 ;;\n'
        "esac\n"
    )
    path.chmod(0o755)
    return path


# W3-2: Empty --worker value.


def test_deploy_rejects_empty_worker_value():
    result = run([BASH, "ops/deploy.sh", "--worker=", "--dry-run"])
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: --worker= needs a Worker name" in result.stderr
    # The old behavior silently treated no value as --all; this must deploy nothing.
    assert "would-run: bash ops/pages_deploy.sh" not in result.stdout
    assert "Deploy: dry-run done" not in result.stdout


def test_deploy_rejects_worker_name_with_unsafe_characters():
    result = run([BASH, "ops/deploy.sh", "--worker=../evil", "--dry-run"])
    assert result.returncode == 2
    assert "FATAL: invalid Worker name" in result.stderr


# W3-1: Do not commit or push from a branch other than main.


def test_deploy_dry_run_on_feature_branch_is_fatal(tmp_path):
    repo = make_repo(tmp_path, branch="tmp/w3-check")
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: commit/push must run on branch main" in result.stderr
    assert "tmp/w3-check" in result.stderr
    # No deployment actually started.
    assert "Deploy: start (dry-run)" not in result.stdout


@pytest.mark.parametrize("release_arg", ["--pages", "--docs", "--workers", "--worker=status-worker"])
def test_deploy_rejects_production_release_from_feature_branch(tmp_path, release_arg):
    repo = make_repo(tmp_path, branch="tmp/release-check")
    result = run([BASH, "ops/deploy.sh", release_arg, "--dry-run"], cwd=repo)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: production deploy must run on branch main" in result.stderr


def test_deploy_dry_run_on_detached_head_is_fatal(tmp_path):
    repo = make_repo(tmp_path)
    git(["checkout", "-q", "--detach"], repo)
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)
    assert result.returncode == 2
    assert "FATAL: commit/push must run on branch main" in result.stderr
    assert "detached HEAD" in result.stderr


def test_deploy_dry_run_on_main_is_allowed(tmp_path):
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "branch: main" in result.stdout
    assert "Deploy: dry-run done" in result.stdout


# Check CI after pushing (added 2026-10-12): local gates cannot see the runner environment.


def test_ci_check_stays_as_strict_as_ci():
    """The gate must be as strict as CI: install missing tools and run pytest without a Git identity.

    Added on 2026-10-12 to protect two behaviors that are easy to simplify away:
      * `ensure_gate_tools` installs missing `ruff`, `mypy`, and `pytest-cov`. If installation fails and the check is skipped, output must say `NOT VERIFIED locally` rather than appearing fully green.
      * pytest runs with an empty `HOME`, global and system Git configuration disabled, and automatic identity discovery turned off. Without this, a test could silently rely on the local Git identity and pass here only to fail on GitHub.
    """
    text = (ROOT / "ops" / "ci_check.sh").read_text(encoding="utf-8")

    assert "ensure_gate_tools()" in text, "gate tools must be installed, not skipped"
    assert "NOT VERIFIED locally" in text, "a skipped check must say so out loud"
    for expected in (
        "GIT_CONFIG_GLOBAL=/dev/null",
        "GIT_CONFIG_SYSTEM=/dev/null",
        "GIT_CONFIG_KEY_0=user.useConfigOnly",
        "GIT_CONFIG_VALUE_0=true",
    ):
        assert expected in text, f"pytest must run without ambient git config ({expected})"


def test_deploy_quiet_output_uses_one_word_phases(tmp_path):
    """In quiet mode, each phase is summarized in one word: `Prepare` (Lists, Bans, Check) and `Release` (Pages, Docs, Workers). The `CI: tests success, …` line was removed after the user's line-by-line review and naming decision on 2026-10-13. A separate review required the commit output to list changed files one per line; `test_deploy_commits...` covers that behavior."""
    repo = make_repo(tmp_path)

    preview = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)
    assert preview.returncode == 0, preview.stdout + preview.stderr
    assert "gh run list" not in preview.stdout, "CI 观察已去掉，预览里不该还有它"

    ran = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert ran.returncode == 0, ran.stdout + ran.stderr
    assert "Prepare: done" in ran.stdout, ran.stdout
    assert "Release: done" in ran.stdout, ran.stdout
    assert "+" not in ran.stdout.replace("++", ""), "阶段标签不该再是 A+B+C 形状"
    assert not any(line.startswith("CI:") for line in ran.stdout.splitlines()), ran.stdout
    # Individual step lines are hidden on success; skipped and failed steps still print.
    for gone in ("Lists: done", "Bans: done", "Check: done",
                 "Pages: done", "Docs: done", "Workers: done"):
        assert gone not in ran.stdout, f"{gone} 应该被并进阶段行"


# W3-3: Run CI before Pages or docs deployment and reject a dirty worktree.


def test_deploy_pages_runs_ci_first_on_a_clean_tree(tmp_path):
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert result.returncode == 0, result.stdout + result.stderr
    # Since 2026-10-13, output is grouped into `Prepare` (including Check) followed by `Release`.
    assert result.stdout.index("Prepare: done") < result.stdout.index("Release: done")

    # Assert the actual command sequence with --full, which prints every command instead of grouping output:
    #   1. Generate the allowlist **before** CI. It changes files, so running it after CI would trigger the dirty-tree
    #      gate and skip CI validation of the allowlist.
    #   2. Run the gates **before** release; do not deploy before checks pass.
    full = run([BASH, "ops/deploy.sh", "--pages", "--full"], cwd=repo)
    assert full.returncode == 0, full.stdout + full.stderr
    assert full.stdout.index("ops/sync_whitelist.py") < full.stdout.index("ops/ci_check.sh")
    assert full.stdout.index("ops/ci_check.sh") < full.stdout.index("ops/pages_deploy.sh")


def test_deploy_commits_when_the_list_sync_changes_the_tree(tmp_path):
    """A deployment must succeed when list synchronization changes the working tree.

    Regression coverage: staging and taking the worktree snapshot must happen after Lists and Bans. Otherwise, list-sync changes trigger the `0c` check that the tree changed during validation, forcing the first deployment to be retried. The stub `sync_whitelist.py` edits a tracked file to reproduce this case.
    """
    repo = make_repo(tmp_path)
    stub = repo / "ops" / "sync_whitelist.py"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "from pathlib import Path\n"
        "Path('tracked.txt').write_text('v1\\nrefreshed-by-the-list-step\\n')\n"
        "print('STUB sync_whitelist rewrote tracked.txt')\n"
    )
    stub.chmod(0o755)

    # Exercise only the commit stage: Pages, docs, and Workers are absent from the stub repository and are not part of this regression.
    # Snapshot comparison (0c) is a gate unique to the commit path.
    result = run([BASH, "ops/deploy.sh", "--commit"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "working tree changed during checks" not in result.stderr
    assert "Git: committed" in result.stdout
    # Verify that refreshed content is included in the commit, so the checked tree and committed tree are the same.
    assert "refreshed-by-the-list-step" in git(["show", "HEAD:tracked.txt"], repo).stdout


def test_deploy_commit_output_lists_every_changed_file(tmp_path):
    repo = make_repo(tmp_path)
    names = [f"changed_{index:02}.txt" for index in range(25)]
    for name in names:
        (repo / name).write_text("changed\n")
    git(["add", *names], repo)

    result = run([BASH, "ops/deploy.sh", "--commit"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    lines = result.stdout.splitlines()
    for name in names:
        assert f"   A {name}" in lines
    assert not any("... and " in line for line in lines)


def test_deploy_pages_refuses_a_dirty_tree(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "tracked.txt").write_text("v1\nuncommitted\n")
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: working tree has uncommitted changes" in result.stderr
    assert "tracked.txt" in result.stderr
    # Rejection must happen before preparation or release; neither stage label should appear.
    assert "Prepare: done" not in result.stdout
    assert "Release: done" not in result.stdout
    assert "STUB pages_deploy ran" not in result.stdout


def test_deploy_pages_allows_a_dirty_tree_with_the_escape_hatch(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "tracked.txt").write_text("v1\nuncommitted\n")
    result = run(
        [BASH, "ops/deploy.sh", "--pages"], cwd=repo, env={"LIMOOO_ALLOW_DIRTY": "1"}
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Warning: deploying a dirty working tree (LIMOOO_ALLOW_DIRTY=1)" in result.stdout
    # Stage order: Prepare (including Check), then Release.
    assert result.stdout.index("Prepare: done") < result.stdout.index("Release: done")


# W3-4 / W3-5: --remote is required; --dry-run must remain fully offline.


def test_deploy_all_includes_every_worker(tmp_path):
    """Full deployment must include Workers.

    A production incident on 2026-10-11 occurred because `deploy.sh` called `workers_deploy.sh` only when `--worker=<name>` was supplied. Changes under `ops/*/src/**` were committed and pushed while production kept running old code. This happened twice in one session: the webhook channel failed, and alert copy that should have been English was still Chinese. Pages and docs do not deploy Worker updates.
    """
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "bash ops/workers_deploy.sh" in result.stdout, result.stdout
    # Keep the other three steps too; adding a Worker must not remove Pages or docs.
    for step in ("ops/ci_check.sh", "ops/pages_deploy.sh", "ops/docs_deploy.sh"):
        assert step in result.stdout, f"{step} missing from a full deploy"


def test_deploy_workers_only_does_not_touch_pages_or_docs(tmp_path):
    """`--workers` means deploy Workers only; it must not also deploy Pages or docs.

    This guards a real bug: the default branch (no arguments, equivalent to `--all`) initially omitted `DO_WORKERS`, so `--workers` fell through that branch and silently became a full deployment.
    """
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--workers", "--dry-run"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "bash ops/workers_deploy.sh" in result.stdout, result.stdout
    assert "ops/pages_deploy.sh" not in result.stdout, result.stdout
    assert "ops/docs_deploy.sh" not in result.stdout, result.stdout
    assert "ops/ci_check.sh" in result.stdout, result.stdout


def test_deploy_workers_only_runs_ci_before_worker_and_rejects_dirty_tree(tmp_path):
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--workers", "--full"], cwd=repo)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.index("ops/ci_check.sh") < result.stdout.index("ops/workers_deploy.sh")

    (repo / "dirty.txt").write_text("uncommitted\n")
    dirty = run([BASH, "ops/deploy.sh", "--workers"], cwd=repo)
    assert dirty.returncode == 1, dirty.stdout + dirty.stderr
    assert "FATAL: working tree has uncommitted changes" in dirty.stderr


def test_workers_helper_rejects_empty_worker_argument():
    result = run([BASH, "ops/workers_deploy.sh", "--worker=", "--dry-run"])
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: --worker= needs a Worker name" in result.stderr


@pytest.mark.parametrize(
    ("branch", "dirty"),
    [("release-check", False), ("main", True)],
)
def test_direct_workers_helper_rejects_unchecked_release_tree(tmp_path, branch, dirty):
    repo = make_repo(tmp_path, branch=branch)
    shutil.copy2(WORKERS_DEPLOY, repo / "ops" / "workers_deploy.sh")
    if dirty:
        (repo / "dirty.txt").write_text("uncommitted\n")

    result = run([BASH, "ops/workers_deploy.sh", "--worker=status-worker"], cwd=repo)

    assert result.returncode in {1, 2}, result.stdout + result.stderr
    assert "[workers] running local CI gate" not in result.stdout
    if dirty:
        assert "FATAL: working tree has uncommitted changes" in result.stderr
    else:
        assert "FATAL: Worker production deploy must run on branch main" in result.stderr


def test_deploy_rejects_workers_together_with_a_single_worker(tmp_path):
    """`--workers` and `--worker=<name>` conflict and must fail with `FATAL`."""
    repo = make_repo(tmp_path)
    result = run(
        [BASH, "ops/deploy.sh", "--workers", "--worker=status-worker", "--dry-run"],
        cwd=repo,
    )

    assert result.returncode == 2, result.stdout + result.stderr
    assert "mutually exclusive" in result.stderr


def test_migrate_apply_requires_remote():
    result = run(
        [BASH, "ops/migrate_d1.sh"],
        env={"WRANGLER_BIN": "/nonexistent/wrangler", "D1_STATE_FILE": "/tmp/w3-unused"},
    )
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: --remote is required" in result.stderr
    assert "unbound variable" not in result.stderr


def test_migrate_check_schema_without_remote_does_not_crash():
    result = run([BASH, "ops/migrate_d1.sh", "--check-schema"])
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: --remote is required" in result.stderr
    assert "unbound variable" not in result.stderr
    assert "unbound variable" not in result.stdout


def test_migrate_dry_run_is_offline_and_lists_every_migration(tmp_path):
    cache = tmp_path / "applied"
    result = run(
        [BASH, "ops/migrate_d1.sh", "--dry-run"],
        env={"WRANGLER_BIN": "/nonexistent/wrangler", "D1_STATE_FILE": str(cache)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    names = migration_names()
    assert f"{len(names)} migration files" in result.stdout
    for name in names:
        assert name in result.stdout
    assert result.stdout.count("key=") == len(names)
    # With an empty cache, every table has cache=no; do not call the fake wrangler if it is absent.
    assert "cache=yes" not in result.stdout
    assert not cache.exists()


# W3-7: --check-schema must use exact table names, not substring matches.


def test_check_schema_does_not_accept_a_prefix_table(tmp_path):
    """If `visitors_v2` exists but `visitors` is missing, the check must report the missing table (W3-7)."""
    tables = [t for t in expected_tables() if t not in ("visitors", "ray_log")]
    assert "visitors_v2" in tables and "ray_log_v2" in tables
    payload = tmp_path / "trap.json"
    payload.write_text(wrangler_payload(tables))
    result = run(
        [BASH, "ops/migrate_d1.sh", "--check-schema"],
        env={"LIMOOO_D1_SCHEMA_JSON": str(payload)},
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: D1 missing expected tables: visitors ray_log" in result.stderr
    assert "visitors_v2" not in result.stderr


def test_check_schema_passes_when_every_table_is_present(tmp_path):
    payload = tmp_path / "full.json"
    payload.write_text(wrangler_payload(expected_tables() + ["gate_assets", "probes"]))
    result = run(
        [BASH, "ops/migrate_d1.sh", "--check-schema"],
        env={"LIMOOO_D1_SCHEMA_JSON": str(payload)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "schema check: OK" in result.stdout


def test_check_schema_includes_tables_used_by_deployed_workers():
    tables = set(expected_tables())
    assert {
        "auth_credentials",
        "probes",
        "heartbeats",
        "probe_state",
        "probe_uptime_daily",
        "worker_runs",
    } <= tables


def test_waf_whitelist_dry_run_needs_no_cloudflare_token():
    result = run(
        [BASH, "ops/waf_whitelist.sh", "--dry-run"],
        env={"SECRETS_FILE": "/no/such/secrets.env", "CLOUDFLARE_API_TOKEN": ""},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "DRY-RUN (offline plan)" in result.stdout


def test_waf_rules_plan_deletes_a_migrated_enabled_skip_rule(tmp_path):
    snapshot = tmp_path / "rules.json"
    snapshot.write_text(
        json.dumps(
            {
                "captured_at": "2026-10-19T00:00:00Z",
                "zone": "limooo.cn",
                "phase": "http_request_firewall_custom",
                "ruleset": {
                    "id": "ruleset-1",
                    "rules": [
                        {
                            "id": "skip-rule-1",
                            "action": "skip",
                            "expression": "ip.src eq 203.0.113.7",
                            "enabled": True,
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )
    result = run([BASH, "ops/waf_rules.sh", "--dry-run", f"--from={snapshot}"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert "IP Access Rules: 1" in result.stdout
    assert "delete migrated custom skip rule" in result.stdout


# W3-5 / W3-8: D1 schema_version is the only source of truth; failed migrations are never recorded.


def test_duplicate_column_statement_does_not_skip_remaining_migration_statements(tmp_path):
    names = migration_names()
    prefixes = sorted({int(n.split("_")[0]) for n in names})
    legacy = [prefix for prefix in prefixes if prefix != 6]
    migration = "006_audit_columns.sql"

    fake = write_fake_wrangler(
        tmp_path / "wrangler",
        "D1_ERROR: duplicate column name: account_id",
        legacy,
        "ALTER TABLE events ADD COLUMN account_id",
    )
    cache = tmp_path / "applied"
    cache.write_text("POISON\n")
    command_log = tmp_path / "commands.log"

    result = run(
        [BASH, "ops/migrate_d1.sh", "--remote"],
        env={
            "WRANGLER_BIN": str(fake),
            "D1_STATE_FILE": str(cache),
            "FAKE_WRANGLER_LOG": str(command_log),
        },
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert f"[d1] apply: {migration}" in result.stdout
    assert "skip (recorded legacy version" in result.stdout
    assert f"[d1] skip (column already exists): {migration}" in result.stdout
    assert "ALTER TABLE events ADD COLUMN actor_sub" in command_log.read_text()
    assert f"[d1] recorded: {migration} key=6001" in result.stdout
    assert cache.read_text().split() == names


def test_apply_failure_does_not_touch_the_local_cache(tmp_path):
    names = migration_names()
    prefixes = sorted({int(n.split("_")[0]) for n in names})
    fake = write_fake_wrangler(
        tmp_path / "wrangler", "D1_ERROR: near SELEC: syntax error", prefixes[:-1]
    )
    cache = tmp_path / "applied"
    cache.write_text("POISON\n")
    result = run(
        [BASH, "ops/migrate_d1.sh", "--remote"],
        env={"WRANGLER_BIN": str(fake), "D1_STATE_FILE": str(cache)},
    )
    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: migration failed" in result.stderr
    assert cache.read_text() == "POISON\n"


@pytest.mark.parametrize("name", ["ops/deploy.sh", "ops/migrate_d1.sh"])
def test_scripts_are_syntactically_valid(name):
    result = run([BASH, "-n", name])
    assert result.returncode == 0, result.stderr


def test_deploy_bootstraps_missing_tooling(tmp_path):
    """`deploy.sh` must recreate its build virtual environment after `/tmp` is cleaned.

    This happened on macOS on 2026-10-11: periodic `/tmp` cleanup removed the tools, and a later `deploy` failed with `build venv not found` and `wrangler not found`. Those `FATAL` messages looked like configuration problems, but the tools had simply been deleted.

    This test uses stub `python3` and `npm` commands to observe the attempted actions without installing anything:
      * Only `-m venv <dir>` counts as a venv creation attempt. The first stub marked every Python call, which made the skip case fail spuriously.
      * `npm` must also be stubbed; otherwise the real npm would install Wrangler and hide the failure path.
    """
    repo = make_repo(tmp_path)
    fake_venv = tmp_path / "venv"
    venv_marker = tmp_path / "venv-created"
    npm_marker = tmp_path / "npm-called"
    bindir = tmp_path / "bin"
    bindir.mkdir()

    # Record and create a venv structure only for `-m venv <dir>`.
    (bindir / "python3").write_text(
        "#!/bin/bash\n"
        'if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then\n'
        f'  echo "$3" >> {venv_marker}\n'
        '  mkdir -p "$3/bin"\n'
        '  printf "#!/bin/bash\\nexit 0\\n" > "$3/bin/python"\n'
        '  chmod +x "$3/bin/python"\n'
        "fi\n"
        "exit 0\n"
    )
    (bindir / "python3").chmod(0o755)
    # Stub npm records the call but **does not** create wrangler, so bootstrap must report FATAL.
    (bindir / "npm").write_text(f"#!/bin/bash\necho \"$@\" >> {npm_marker}\nexit 0\n")
    (bindir / "npm").chmod(0o755)

    env = {
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "LIMOOO_VENV_PYTHON": str(fake_venv / "bin" / "python"),
        "WRANGLER_BIN": str(tmp_path / "wrangler" / "node_modules" / ".bin" / "wrangler"),
        "LIMOOO_SKIP_CHECKS": "1",
        # run() disables bootstrap by default (see _GUARD_ENV); this case tests bootstrap, so enable it explicitly.
        "LIMOOO_SKIP_TOOL_BOOTSTRAP": "0",
    }
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo, env=env)

    assert venv_marker.is_file(), f"没有尝试创建 venv\n{result.stdout}\n{result.stderr}"
    assert "recreating the build venv" in result.stdout, result.stdout
    assert npm_marker.is_file(), "没有尝试安装 wrangler"
    # If wrangler cannot be installed, fail explicitly instead of silently continuing to pages_deploy.
    assert result.returncode != 0, result.stdout + result.stderr
    assert "could not install wrangler" in result.stderr, result.stderr


def test_deploy_tooling_bootstrap_can_be_skipped(tmp_path):
    """`LIMOOO_SKIP_TOOL_BOOTSTRAP=1` disables all bootstrap attempts."""
    repo = make_repo(tmp_path)
    venv_marker = tmp_path / "venv-created"
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "python3").write_text(
        "#!/bin/bash\n"
        'if [ "$1" = "-m" ] && [ "$2" = "venv" ]; then\n'
        f'  echo "$3" >> {venv_marker}\n'
        "fi\n"
        "exit 0\n"
    )
    (bindir / "python3").chmod(0o755)

    env = {
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "LIMOOO_VENV_PYTHON": str(tmp_path / "nope" / "bin" / "python"),
        "LIMOOO_SKIP_CHECKS": "1",
        "LIMOOO_SKIP_TOOL_BOOTSTRAP": "1",
    }
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo, env=env)

    assert "recreating the build venv" not in result.stdout, result.stdout
    assert not venv_marker.is_file(), "跳过后不该创建 venv"
    # With bootstrap disabled, let the pages_deploy stub handle the missing venv; the stub does not inspect it.
    assert "Release: done" in result.stdout, result.stdout
