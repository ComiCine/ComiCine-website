# Limooo - serverless personal website and admin system
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

"""ops/deploy.sh 与 ops/migrate_d1.sh 的安全闸门（tasks/22 · W3）。

这些用例全部离线运行：
  * deploy.sh 只走 --dry-run，或在临时 git 仓库里换成 stub 的 pages/docs 步骤；
  * migrate_d1.sh 用 WRANGLER_BIN 指向假 wrangler，绝不接触 Cloudflare / 生产 D1。
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
MIGRATE = ROOT / "ops" / "migrate_d1.sh"
MIGRATIONS_DIR = ROOT / "ops" / "migrations"


# ── 辅助 ──────────────────────────────────────────────────────────────


# 这些用例测的是 deploy.sh 的**闸门逻辑**，不是工具链。工具自愈（2026-10-11 加）
# 会在临时仓库里尝试建 venv / 装 wrangler —— 那里没有 requirements.lock，必然失败，
# 于是整条用例假红。默认关掉自愈；要专门测自愈的用例自己再打开。
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
    """建一个干净的临时 git 仓库，并把 deploy.sh 与 stub 步骤脚本放进去。

    身份必须**写进这个仓库的 config**，不能只靠 `git -c`（那只管我们自己发的命令）：
    `deploy.sh --commit` 内部会自己 `git commit`，而 CI runner 上没有 user.name /
    user.email，git 会以 128（`Author identity unknown`）失败 —— 本地因为全局配过身份
    看不到这个问题（2026-10-12 在 GitHub 上真的红过一次）。顺带关掉签名：
    万一某个环境的全局配置开了 `commit.gpgsign` 而没有可用密钥，同样会让用例假红。
    """
    repo = tmp_path / "repo"
    (repo / "ops").mkdir(parents=True)
    shutil.copy2(DEPLOY, repo / "ops" / "deploy.sh")
    for name, body in (
        ("ci_check.sh", '#!/bin/bash\necho "STUB ci_check ran (args: $*)"\n'),
        ("pages_deploy.sh", '#!/bin/bash\necho "STUB pages_deploy ran"\n'),
        ("docs_deploy.sh", '#!/bin/bash\necho "STUB docs_deploy ran"\n'),
        # 白名单刷新（2026-10-11 加）：deploy.sh 在闸门之前跑它。
        # 桩化是必须的 —— 真脚本要联网拉 china-mainland-asn，测试不该依赖外网。
        ("fetch_china_asn.py", '#!/usr/bin/env python3\nprint("STUB fetch_china_asn ran (args: $*)")\n'),
        # 封禁名单双向对账（2026-10-11 加）：要读 D1，测试里桩掉。
        ("reconcile_blocklist.sh", '#!/bin/bash\necho "STUB reconcile_blocklist ran (args: $*)"\n'),
        # 白名单推 WAF（2026-10-11 加）：会改 zone 的 IP Access Rules，必须桩掉。
        ("waf_whitelist.sh", '#!/bin/bash\necho "STUB waf_whitelist ran (args: $*)"\n'),
    ):
        path = repo / "ops" / name
        path.write_text(body)
        path.chmod(0o755)
    (repo / "tracked.txt").write_text("v1\n")
    git(["-c", "init.defaultBranch=main", "init", "-q"], repo)
    # 仓库级身份：deploy.sh 内部那次 commit 靠它，不靠 runner 的全局配置。
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


def write_fake_wrangler(path: Path, file_error: str, versions: list[int]) -> Path:
    """假 wrangler：--file 一律按 file_error 失败，SELECT version 返回 versions。"""
    rows = ",".join(f'{{"version":{v}}}' for v in versions)
    path.write_text(
        "#!/bin/bash\n"
        'cmd=""; file=""\n'
        "while [ $# -gt 0 ]; do\n"
        '    case "$1" in\n'
        '        --command) cmd="$2"; shift ;;\n'
        '        --file) file="$2"; shift ;;\n'
        "    esac\n"
        "    shift\n"
        "done\n"
        'if [ -n "$file" ]; then\n'
        f'    echo "{file_error}"\n'
        "    exit 1\n"
        "fi\n"
        'case "$cmd" in\n'
        f'    *"FROM schema_version"*) echo \'[{{"results":[{rows}],"success":true,"meta":{{"rows_read":{len(versions)}}}}}]\'; exit 0 ;;\n'
        '    *) echo "ok"; exit 0 ;;\n'
        "esac\n"
    )
    path.chmod(0o755)
    return path


# ── W3-2：--worker= 空值 ──────────────────────────────────────────────


def test_deploy_rejects_empty_worker_value():
    result = run([BASH, "ops/deploy.sh", "--worker=", "--dry-run"])
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: --worker= needs a Worker name" in result.stderr
    # 旧行为是静默落到「无参数 = --all」，这里必须什么都不部署
    assert "would-run: bash ops/pages_deploy.sh" not in result.stdout
    assert "Deploy: dry-run done" not in result.stdout


def test_deploy_rejects_worker_name_with_unsafe_characters():
    result = run([BASH, "ops/deploy.sh", "--worker=../evil", "--dry-run"])
    assert result.returncode == 2
    assert "FATAL: invalid Worker name" in result.stderr


# ── W3-1：非 main 分支不得 commit / push ─────────────────────────────


def test_deploy_dry_run_on_feature_branch_is_fatal(tmp_path):
    repo = make_repo(tmp_path, branch="tmp/w3-check")
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "FATAL: commit/push must run on branch main" in result.stderr
    assert "tmp/w3-check" in result.stderr
    # 没有真正开跑
    assert "Deploy: start (dry-run)" not in result.stdout


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


# ── 推完看 CI（2026-10-12 加）：本地闸门看不见 runner 环境 ─────────────


def test_ci_check_stays_as_strict_as_ci():
    """闸门必须与 CI 一样严：缺工具要装、pytest 要在无 git 身份的环境里跑。

    2026-10-12 加。守的是两件容易被「顺手简化」掉的事：
      * `ensure_gate_tools` —— ruff / mypy / pytest-cov 缺了就装；退回 SKIP 时
        输出里必须写 `NOT VERIFIED locally`，不能让闸门看起来全绿；
      * pytest 的环境变量 —— HOME 指空、禁 global/system 配置、关掉身份自动探测。
        没有这一段，「用例偷偷依赖本机 git 身份」就会一路绿到 GitHub 才红。
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
    """安静模式下每个阶段收成一个词：`Prepare`（Lists+Bans+WAF+Check）/ `Release`
    （Pages+Docs+Workers）；`CI: tests success, …` 整行去掉（2026-10-13 用户逐行批注 +
    定词）。提交行的文件清单另有批注：恢复逐行列出 —— 由 test_deploy_commits… 覆盖。
    """
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
    # 子步骤的个别行不再出现在成功路径上（跳过/失败才出声）
    for gone in ("Lists: done", "Bans: done", "WAF: done", "Check: done",
                 "Pages: done", "Docs: done", "Workers: done"):
        assert gone not in ran.stdout, f"{gone} 应该被并进阶段行"


# ── W3-3：Pages / docs 前先跑 CI，脏树要拒绝 ─────────────────────────


def test_deploy_pages_runs_ci_first_on_a_clean_tree(tmp_path):
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert result.returncode == 0, result.stdout + result.stderr
    # 输出自 2026-10-13 起按阶段合并成两个词：`Prepare`（含 Check）先于 `Release`。
    assert result.stdout.index("Prepare: done") < result.stdout.index("Release: done")

    # 真实执行序列用 --full 断言（它逐条回显命令，不合并）：
    #   ① 名单刷新必须**先于** CI（2026-10-11）—— 它会产生改动，放在 CI 之后会被脏树
    #      闸门拦下，也漏过 CI 对该名单的校验；
    #   ② 闸门必须**先于**发布 —— 检查没跑过就不许发。
    full = run([BASH, "ops/deploy.sh", "--pages", "--full"], cwd=repo)
    assert full.returncode == 0, full.stdout + full.stderr
    assert full.stdout.index("ops/fetch_china_asn.py") < full.stdout.index("ops/ci_check.sh")
    assert full.stdout.index("ops/ci_check.sh") < full.stdout.index("ops/pages_deploy.sh")


def test_deploy_commits_when_the_list_refresh_changes_the_tree(tmp_path):
    """名单刷新改了工作区，一次性提交仍要成功（2026-10-12 修）。

    回归点：stage + 工作区快照原先排在 Lists / Bans / WAF **之前**，而这三步会
    合法地改写 mainland-asn-catalog.txt / whitelist.txt / blocklist.txt —— 于是上游名单一变，
    ⓪c 的比对必然报「检查期间工作区又被改动」，第一次部署永远要跑两遍。
    这里让桩 fetch_china_asn.py 真的改一个已跟踪文件来复现那个场景。
    """
    repo = make_repo(tmp_path)
    stub = repo / "ops" / "fetch_china_asn.py"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "from pathlib import Path\n"
        "Path('tracked.txt').write_text('v1\\nrefreshed-by-the-list-step\\n')\n"
        "print('STUB fetch_china_asn rewrote tracked.txt')\n"
    )
    stub.chmod(0o755)

    # 只走 commit 那一段：Pages / docs / Workers 在桩仓库里没有（也不在回归点上），
    # 而快照比对（⓪c）正是 commit 路径独有的闸门。
    result = run([BASH, "ops/deploy.sh", "--commit"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "working tree changed during checks" not in result.stderr
    assert "Git: committed" in result.stdout
    # 刷新写进去的内容确实进了提交（而不是「检查过的树」与「提交的树」两份）
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


def test_deploy_lists_step_can_be_skipped_and_made_strict(tmp_path):
    """两个逃生阀：跳过抓取 / 抓不到就失败。

    断言用**安静模式真正可见**的东西：`run_step` 把子进程输出吞进日志、只在失败时
    吐出来，所以桩里的 echo 看不见 —— 判据只能是步骤行的有无。
    """
    repo = make_repo(tmp_path)

    skipped = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo, env={"LIMOOO_SKIP_ASN_FETCH": "1"})
    assert skipped.returncode == 0, skipped.stdout + skipped.stderr
    assert "skipped ASN refresh" in skipped.stdout
    # 阶段行现在只说 `Prepare: done`（不点名子步骤）；哪一步被跳过由它自己的跳过行负责，
    # 所以判据是「跳过行在、且那一步没有以 done 形状出现」。
    assert "Lists: done" not in skipped.stdout

    # strict 走 run_step（参数传错会 FATAL），所以能证明那一步真的执行了。
    strict = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo, env={"LIMOOO_STRICT_ASN": "1"})
    assert strict.returncode == 0, strict.stdout + strict.stderr
    assert "Prepare: done" in strict.stdout


def test_deploy_pages_refuses_a_dirty_tree(tmp_path):
    repo = make_repo(tmp_path)
    (repo / "tracked.txt").write_text("v1\nuncommitted\n")
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "FATAL: working tree has uncommitted changes" in result.stderr
    assert "tracked.txt" in result.stderr
    # 拒绝要发生在准备阶段与发布阶段之前：两个阶段词都不该出现
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
    # 阶段顺序：准备（含 Check）→ 发布
    assert result.stdout.index("Prepare: done") < result.stdout.index("Release: done")


# ── W3-4 / W3-5：--remote 必需，--dry-run 完全离线 ────────────────────


def test_deploy_all_includes_every_worker(tmp_path):
    """完整部署必须带上 Worker。

    2026-10-11 的真实事故：`deploy.sh` 只在显式 `--worker=<name>` 时才调用
    `workers_deploy.sh`，于是 `ops/*/src/**` 里的改动会被 commit + push，
    而线上继续跑旧代码 —— 同一个会话里静默发生了两次（webhook 通道报错、
    告警文案该是英文却仍是中文）。Pages 与 docs **不是** Worker 更新的代理。
    """
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--dry-run"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "bash ops/workers_deploy.sh" in result.stdout, result.stdout
    # 其余三步也必须在，别为了加 Worker 把 Pages/docs 挤掉。
    for step in ("ops/ci_check.sh", "ops/pages_deploy.sh", "ops/docs_deploy.sh"):
        assert step in result.stdout, f"{step} missing from a full deploy"


def test_deploy_workers_only_does_not_touch_pages_or_docs(tmp_path):
    """`--workers` 是「只发 Worker」，不能顺带把 Pages/docs 也发一遍。

    这条守的是一个真实 bug：默认分支（无参数 = --all）最初没把 `DO_WORKERS` 算进去，
    于是单独 `--workers` 落进那个分支、静默变成完整部署。
    """
    repo = make_repo(tmp_path)
    result = run([BASH, "ops/deploy.sh", "--workers", "--dry-run"], cwd=repo)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "bash ops/workers_deploy.sh" in result.stdout, result.stdout
    assert "ops/pages_deploy.sh" not in result.stdout, result.stdout
    assert "ops/docs_deploy.sh" not in result.stdout, result.stdout


def test_deploy_rejects_workers_together_with_a_single_worker(tmp_path):
    """`--workers` 与 `--worker=<name>` 同时给是自相矛盾，必须 FATAL。"""
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
    # 空缓存 → 全部 cache=no；假 wrangler 不存在也不能被调用
    assert "cache=yes" not in result.stdout
    assert not cache.exists()


# ── W3-7：--check-schema 用精确表名，不做子串匹配 ────────────────────


def test_check_schema_does_not_accept_a_prefix_table(tmp_path):
    """visitors_v2 存在但 visitors 丢失时必须报缺表（W3-7）。"""
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


# ── W3-5 / W3-6 / W3-8：D1 schema_version 是唯一事实源 ────────────────


def test_apply_ignores_the_local_cache_and_reads_d1_state(tmp_path):
    names = migration_names()
    prefixes = sorted({int(n.split("_")[0]) for n in names})
    legacy = prefixes[:-1]  # 生产库现状：旧式纯版本号，缺最新那条
    newest = [n for n in names if int(n.split("_")[0]) == prefixes[-1]][0]

    fake = write_fake_wrangler(
        tmp_path / "wrangler", "D1_ERROR: duplicate column name: last_alert_at", legacy
    )
    cache = tmp_path / "applied"
    # 故意埋一份「谎报最新迁移已应用」的本地缓存
    cache.write_text(f"{newest}\n")

    result = run(
        [BASH, "ops/migrate_d1.sh", "--remote"],
        env={"WRANGLER_BIN": str(fake), "D1_STATE_FILE": str(cache)},
    )
    assert result.returncode == 0, result.stdout + result.stderr
    # 本地缓存不能决定跳过：最新迁移仍要执行
    assert f"[d1] apply: {newest}" in result.stdout
    assert "skip (recorded legacy version" in result.stdout
    # ALTER 重复报错要被识别成「已应用」而不是 FATAL
    assert f"already applied (schema already present, record was missing): {newest}" in result.stdout
    assert f"[d1] recorded: {newest} key=" in result.stdout
    # 跑完后缓存被覆盖成 D1 的权威集合
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


def test_deploy_pushes_the_whitelist_to_the_waf(tmp_path):
    """白名单推送是「完整部署」的一部分，且**默认失败即停**（与名单刷新不同）。

    它改的是线上安全面：静默留下「文件说 319 条、zone 上不是」比部署失败更危险。
    跳过要显式 LIMOOO_SKIP_WAF_WHITELIST=1。
    """
    repo = make_repo(tmp_path)

    ran = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo)
    assert ran.returncode == 0, ran.stdout + ran.stderr
    assert "Prepare: done" in ran.stdout, ran.stdout

    # 顺序：名单先刷新，再推 WAF（推的是刷新后的名单）。安静模式把三行并成一个标签，
    # 所以用 --full 看真实执行序列（它逐条回显命令，不合并）。
    full = run([BASH, "ops/deploy.sh", "--pages", "--full"], cwd=repo)
    assert full.returncode == 0, full.stdout + full.stderr
    assert full.stdout.index("ops/fetch_china_asn.py") < full.stdout.index("ops/waf_whitelist.sh --apply")

    skipped = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo,
                  env={"LIMOOO_SKIP_WAF_WHITELIST": "1"})
    assert skipped.returncode == 0, skipped.stdout + skipped.stderr
    assert "skipped ASN whitelist push" in skipped.stdout
    assert "WAF: done" not in skipped.stdout


def test_deploy_bootstraps_missing_tooling(tmp_path):
    """`/tmp` 被清理后，deploy.sh 要自己把构建 venv 补回来。

    2026-10-11 真实踩过：macOS 定期清理 /tmp，之后一次 `deploy` 同时挂在
    "build venv not found" 与 "wrangler not found" —— 那两个 FATAL 看起来像配置
    问题，实际只是工具被删了。

    这里用桩 python3 / 桩 npm 观察**它尝试了什么**（不真装东西）：
      * 只有 `-m venv <dir>` 这个调用才算数（我第一版桩对任何 python3 调用都留标记，
        于是"跳过"那条测试假红）；
      * npm 必须桩掉，否则真 npm 会把 wrangler 装上，测试就测不到失败路径。
    """
    repo = make_repo(tmp_path)
    fake_venv = tmp_path / "venv"
    venv_marker = tmp_path / "venv-created"
    npm_marker = tmp_path / "npm-called"
    bindir = tmp_path / "bin"
    bindir.mkdir()

    # 只在 `-m venv <dir>` 时留痕并造出 venv 结构。
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
    # 桩 npm：留痕但**不**产出 wrangler —— 于是 bootstrap 会走到明确的 FATAL。
    (bindir / "npm").write_text(f"#!/bin/bash\necho \"$@\" >> {npm_marker}\nexit 0\n")
    (bindir / "npm").chmod(0o755)

    env = {
        "PATH": f"{bindir}:{os.environ['PATH']}",
        "LIMOOO_VENV_PYTHON": str(fake_venv / "bin" / "python"),
        "WRANGLER_BIN": str(tmp_path / "wrangler" / "node_modules" / ".bin" / "wrangler"),
        "LIMOOO_SKIP_CHECKS": "1",
        # run() 默认会把自愈关掉（见 _GUARD_ENV）；这条用例正是要测自愈，显式打开。
        "LIMOOO_SKIP_TOOL_BOOTSTRAP": "0",
    }
    result = run([BASH, "ops/deploy.sh", "--pages"], cwd=repo, env=env)

    assert venv_marker.is_file(), f"没有尝试创建 venv\n{result.stdout}\n{result.stderr}"
    assert "recreating the build venv" in result.stdout, result.stdout
    assert npm_marker.is_file(), "没有尝试安装 wrangler"
    # wrangler 装不出来时必须明确失败，而不是静默继续去跑 pages_deploy。
    assert result.returncode != 0, result.stdout + result.stderr
    assert "could not install wrangler" in result.stderr, result.stderr


def test_deploy_tooling_bootstrap_can_be_skipped(tmp_path):
    """`LIMOOO_SKIP_TOOL_BOOTSTRAP=1` 时不做任何重建尝试。"""
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
    # 跳过自愈 → 缺 venv 由 pages_deploy 的桩接住（桩脚本不看 venv）。
    assert "Release: done" in result.stdout, result.stdout
