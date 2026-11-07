---
aside: false
title: 项目说明
description: "ComiCine 网站与管理系统（Cloudflare 全无服务器架构）的项目 README"
---
<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->


# ComiCine

一个完全无服务器的个人网站与管理系统，运行在 [comicine.com](https://comicine.com)。公开页面、人类验证门禁、访客面板、Apple Account 管理器、监控与状态页全部运行在 Cloudflare 上（Pages Functions、Workers、D1、R2）。

## 功能特性

- **公开页面**：首页、服务、联系、作品集 —— 以 4 种语言预渲染，支持深色/浅色主题切换
- **人类验证**：Turnstile 门禁页在所有主机上都**原地**渲染在请求的 URL 上（不跨域跳转）—— 见 [门禁行为](#门禁行为)
- **访客面板**（`visitor.comicine.com`）：Pages Function + D1 分析；显示经过哈希处理的访客标识（列表接口不返回原始 IP）、国家/地区、可获取时的 ISP/ASN、状态码分布，并受登录保护
- 首次加载之后，访客状态筛选标签在本地过滤，不再发起新的 `/api/visitors` 请求；API 仍然接受 `?status=<3-digit>` 以支持深链接
- **Apple Account 管理器**（`account.comicine.com/apple`）：Pages Function + D1 增删改查，支持拖拽排序；密码使用 Fernet 加密存储，列表中只显示掩码后的密码，并支持临时明文查看
- **认证与角色**：单一 `ComiCine` Access 应用保护 `identity.comicine.com/login`；identity 主机上的 Pages Function 验证 JWT 后，签发一个短期有效、一次性的 D1 交接码并绑定到已注册的来源主机，随后由该来源主机应用本地角色。目前两个受保护主机都需要 admin 会话。
- **共享登录跳转**：未登录浏览器打开受保护页面时，站点直接返回 302 跳转到 `identity.comicine.com/login`，没有中间页和外置脚本；Cloudflare Access 随后引导浏览器经 `comicine.cloudflareaccess.com` 登录。API 认证失败仍返回 JSON 401。
- **监控**：`comicine-status` Worker 每分钟探测（probe）HTTP/D1 目标，探针处于故障状态时每 10 秒重新检查一次，并把结果存入 D1；告警通过 webhook 发出（Email binding 作为后备）
- **状态页**（`status.comicine.com`）：由同一个 Worker 从 D1 服务端渲染，支持 4 种语言与显式 `?lang=` 覆盖，探针错误码有四种语言的对照表，并自带品牌化的 404/503 故障页，每日在线率取自 `probe_uptime_daily` 汇总表
- **自动 IP 封禁**：
  - D1 `blocked_ips` 是权威数据源；`sync-worker` 把生效的行同步到 Cloudflare IP List，用于边缘拦截（没有源站，因此也不需要 ipset/iptables）
  - 应用层全局过滤器作为后备 —— 被封禁的 IP 直接收到 403
- **统一跳转页**（`redirect.comicine.com/?to=<https-url>`，也接受 `/r`）：在跳转到任意 HTTPS 目标之前显示一个中转提示页
- **作品集图片处理**：原图永不对外发布；网站使用干净的缩略图和静态资源。水印 Worker 继续部署，用于直接访问及旧版图片链接，但网站页面不再调用它。

## 技术栈

| 层 | 技术 | 运行位置 |
| --- | --- | --- |
| 公开页面、门禁、访客面板、Apple Account 管理器、状态页 | Pages Functions（`functions/`）+ 预渲染静态 HTML | Cloudflare 边缘 |
| 数据 | D1（访客分析、黑名单、Apple Account 账号、认证会话、探针/心跳） | Cloudflare |
| 人类验证 | Cloudflare Turnstile，门禁页原地渲染 | Cloudflare + 浏览器 |
| 认证 | Cloudflare Access（Zero Trust JWT，由 Pages Function 自行验证） | Cloudflare |
| 监控与数据保留 | `ops/status-worker`（Cron Triggers + Durable Object alarms） | Cloudflare Workers |
| D1 归档 | `ops/d1-archive`（每日 cron） | Cloudflare Workers |
| 黑名单同步 | `ops/sync-worker`（每日 cron → Cloudflare IP List） | Cloudflare Workers |
| 图片水印 | `ops/image-watermark`（路径归一化代理） | Cloudflare Workers |
| 静态资源 / 原图备份 | Pages 资源服务器 + 私有 R2 桶 `comicine-originals` | Cloudflare |
| 部署 | `ops/deploy.sh`（git + `ops/pages_deploy.sh` + `ops/workers_deploy.sh`） | 本地 |

这些层如何连接 —— 请求流水线、身份交接、文档站构建、独立 Worker 以及生成的产物 —— 在 [ARCHITECTURE.md](https://github.com/ComiCine/ComiCine-website/blob/main/ARCHITECTURE.md) 中有详细说明。

## 项目结构

```
├── src/
│   ├── config.py                                     # unified config: paths, languages, domains, DB/IP utils (consumes config-contract.json)
│   ├── auto_block.py                                 # manual blocklist.txt → D1 reconciliation (D1 is the authority)
│   ├── cidr.py                                       # CIDR parsing helpers
│   ├── portfolio.py                                  # portfolio image / thumbnail helpers
│   ├── render_app.py                                 # build-time read-only renderer used by src/build.py
│   ├── services_pricing.py                           # CSV-driven price list for services.comicine.com
│   ├── build.py                                      # Pages static build (python3 src/build.py)
│   ├── static/                                       # static css/js/fonts + icons/portfolio/QR codes; files/ maps to /public/
│   └── templates/                                    # Jinja2 page templates
├── README.md                                         # this file
├── ARCHITECTURE.md                                   # 请求流程、身份、Worker 与构建产物（英文）
├── SECURITY.md                                       # 威胁模型、信任层级与密钥处理（英文）
├── LICENSE.txt                                        # GNU AGPL v3 官方英文正文
├── ADDITIONAL_TERMS.txt                               # Section 7 附加条款（英文）
├── ADDITIONAL_TERMS_zh_CN.txt                         # Section 7 附加条款（简体中文）
├── ADDITIONAL_TERMS_ja_JP.txt                         # 日语译本
├── ADDITIONAL_TERMS_ko_KR.txt                         # 韩语译本
├── COPYRIGHT.md                                      # 版权与许可说明（英文）
├── COPYRIGHT_zh_CN.md                                # 简体中文译本
├── COPYRIGHT_ja_JP.md                                # 日语译本
├── COPYRIGHT_ko_KR.md                                # 韩语译本
├── THIRD_PARTY_NOTICES.md                            # 第三方声明（英文）
├── THIRD_PARTY_NOTICES_zh_CN.md                      # 简体中文译本
├── THIRD_PARTY_NOTICES_ja_JP.md                      # 日语译本
├── THIRD_PARTY_NOTICES_ko_KR.md                      # 韩语译本
├── LICENSE_zh_CN.txt                                  # AGPL-3.0 (Simplified Chinese)
├── LICENSE_ja_JP.txt                                  # AGPL-3.0 (Japanese)
├── LICENSE_ko_KR.txt                                  # AGPL-3.0 (Korean)
├── config-contract.json                              # single source of domains / languages / cookies / TTLs
├── package.json                                      # npm scripts: build / test / typecheck
├── package-lock.json                                 # locked Node dependency tree (npm ci)
├── requirements.lock                                 # pinned Python dependencies (read by ops/build.sh)
├── wrangler.toml                                     # Cloudflare Pages project + D1 binding
├── tsconfig.json                                     # TypeScript config for functions/ and the Workers in ops/
├── vitest.config.ts                                  # vitest config (functions/**/*.test.ts)
├── pytest.ini                                        # pytest config (tests/)
├── pyproject.toml                                    # ruff / mypy config
├── .gitignore                                        # ignore rules shipped with the repository
├── .github/                                          # GitHub Actions workflows
│   └── workflows/
│       └── tests.yml                                 # CI: build, then typecheck / migrations / vitest / pytest
├── .githooks/                                        # git hooks (installed by ops/install_git_hooks.sh)
│   └── pre-push                                      # runs ops/ci_check.sh on the commit being pushed
├── data/                                             # runtime data (generated; git-ignored)
│   ├── GeoLite2-ASN.mmdb                             # GeoIP databases (large; git-ignored)
│   └── *.db                                          # local caches (git-ignored)
├── secrets/                                          # secrets & certificates, git-ignored
│   ├── webauthn.env                                  # env file read by the deploy scripts
│   └── apple_account_encryption.key                  # Apple Account password encryption key
├── ops/                                              # deployment & ops tooling
│   ├── deploy.sh                                     # the single deploy entry point (commit/push + Pages + docs + Worker)
│   ├── build.sh                                      # Pages build: venv, contract checks, public/manifest.json
│   ├── pages_deploy.sh                               # Cloudflare Pages build + Wrangler deploy
│   ├── docs_deploy.sh                                # docs.comicine.com build + deploy (VitePress → Pages project comicine-docs)
│   ├── smoke.sh                                      # standalone read-only smoke checks (main site, docs, status)
│   ├── docs_headers.py                               # generates the docs site `_headers` (CSP hashes + cache)
│   ├── ci_check.sh                                   # local replica of .github/workflows/tests.yml
│   ├── run-tests.sh                                  # test runner used locally
│   ├── install_git_hooks.sh                          # installs the pre-push hook
│   ├── readme_facts.py                               # re-reads the facts on this page (--check / --live)
│   ├── migrate_d1.sh                                 # D1 migrations (--dry-run / --remote)
│   ├── workers_deploy.sh                             # standalone Worker deploys
│   ├── export_d1.py                                  # unified D1 import SQL/JSON export (apple-account | blocklist)
│   ├── prune_d1.py                                   # manual D1 retention and aggregation (scheduled retention runs in status-worker)
│   ├── d1_client.py                                  # Cloudflare API client for D1
│   ├── upload_originals.sh                           # private R2 backup of portfolio originals
│   ├── security-headers.json                         # single source of the response-header baseline
│   ├── tailwind.config.js                            # Tailwind config for the prebuilt CSS
│   ├── check_config_contract.py / check_gate_trust.py / check_security_headers.py / check_license_headers.py / check_ip_rays.py / check_ray_id.py / check_visitor_id.py / check_blocklist_sync.py / zone_settings.py
│   ├── migrations/                                   # D1 schema migrations
│   ├── cloudflare/                                   # Cloudflare resource inventory (declarative)
│   ├── email-templates/                              # transactional email framework + i18n copy
│   ├── fonts/                                        # gate-diagnostic font subset
│   ├── status-worker/                                # Worker: probes, status page, alerting, D1 retention
│   ├── image-watermark/                              # Worker: image.comicine.com watermark normalizer
│   ├── d1-archive/                                   # Worker: D1 snapshot/archive (cron 00:00)
│   ├── sync-worker/                                  # Worker: D1 blocked_ips → Cloudflare IP List (cron 03:30)
│   ├── requirements.txt                              # Python dependencies
├── functions/                                        # Cloudflare Pages Functions
│   ├── _middleware.ts                                # gate/redirect/blocklist/visitors/ray orchestration (test: _middleware.test.ts)
│   ├── _lib/                                         # config, d1, cidr, gate, access, session, fernet, routing
│   ├── _data/                                        # generated i18n/runtime modules (do not hand-edit)
│   ├── api/                                          # apple-account, auth, i18n, ray, visitors endpoints
│   ├── types.d.ts                                    # shared Env / PagesFunction types
│   └── login.ts / logout.ts                          # Access login callback and logout (tests: *.test.ts)
├── tests/                                            # pytest suites + fixtures
├── locales/                                          # i18n / translation catalogs
├── public/                                           # Pages build output (git keeps only .gitkeep)
├── preview/                                          # local preview (build-generated; git keeps only .gitkeep)
└── docs/                                             # 容器：每个子域一个目录
    ├── docs/                                         # docs.comicine.com —— VitePress 根目录
    │   ├── .vitepress/                               # config.mts、rewrites.json、theme
    │   ├── zh-cn/                                    # 每种语言一个目录，各语言文件树相同
    │   ├── en-us/
    │   ├── ja-jp/
    │   ├── ko-kr/
    │   ├── functions/                                # 文档站 Pages Functions：无语言后缀的入口路由
    │   └── public/                                   # 静态资源、_redirects、_routes.json、robots.txt
    ├── services/                                     # services.comicine.com —— 价目表 CSV
    └── lists/                                        # 门禁/爬虫/封禁名单与生成的白名单（不发布）
        ├── README.md                                 # 各名单的用途与修改方式
        ├── own-ips.txt                               # 手工维护：自己的 IP / 额外可信条目
        ├── whitelist.txt                             # 由 own-ips.txt 生成；供边缘门禁与可选的 WAF 工具使用
        └── blocklist.txt                             # 手工维护：src/auto_block.py 的封禁种子（D1 才是权威）
```

## 品牌资源与字体

- 首页主视觉和左上角导航均以 Delius Swash Caps 显示准确品牌名称 `ComiCine`。作品集展开时，同一个品牌文字元素会从页面中央移动到导航栏；颜色跟随主题文字色，保持黑白效果。
- `src/static/icons/comicine-favicon.svg` 用于浏览器 Favicon 和小尺寸网页标识；横向字标及主要社交预览图使用 `src/static/icons/comicine-xtext.svg`。PNG 版本仅用于 Apple 触控图标，以及邮件、社交媒体等仅支持栅格图像的场景。`src/static/icons/comicine-watermark.png` 继续作为图片水印流水线的输入。
- 自托管的 Delius Swash Caps 字体子集和 OFL 许可证位于 `src/static/fonts/delius-swash-caps/`。品牌字标中的准确名称 `ComiCine` 使用该字体；Copyright 行的符号和年份沿用原字体，只有 `ComiCine` 使用 Delius，字号为其余版权文字的 `1.3em`。状态 Worker 内嵌所需子集，其他文字沿用原有字体栈。
- 生产构建使用仓库内的字体子集，不依赖开发机上的原始字体目录。

## 快速开始

```bash
# Install the Node dependencies pinned by package-lock.json
npm ci

# Build the static site (Python venv + contract checks + public/ + preview/)
npm run build
```

`npm run build` 就是 `ops/build.sh`：它会在仓库外创建构建虚拟环境
`/tmp/comicine-build-venv`，从 `requirements.lock` 安装锁定的依赖，
并在渲染前校验跨运行时配置。作品水印由 Pillow 使用
`src/static/icons/comicine-watermark.png` 生成，不需要系统 Cairo 库。
若要直接运行渲染器，请先安装锁定的 Python 依赖，再执行
`COMICINE_BUILD=1 python3 src/build.py`。

若要在本地预览生成后的站点，请先构建，然后打开 `preview/` 中的产物。

## 构建、测试与部署

为获得干净的本地构建，请使用与部署脚本相同的依赖集合：

```bash
cd site
npm ci
npm run build
```

`src/build.py` 会重新生成 `public/<lang>/*.html`、`public/static/`、
`functions/_data/i18n.ts`、`functions/_data/runtime.ts` 与 `preview/`。
不要手动编辑这些产物；应修改 `locales/*.json`、模板或静态源文件后重新构建。
`src/static/tailwind.css` 是已入库的 Tailwind 预构建产物。
`npm run build` 使用 `ops/build.sh`，它会创建 `/tmp/comicine-build-venv`
并生成 `public/manifest.json`（构建产物哈希凭据）。

只部署 Pages 产物时使用：

```bash
# build + validate only, no Cloudflare writes
bash ops/pages_deploy.sh --build-only

# build + validate + deploy Pages + smoke test (/_health must be 200)
bash ops/pages_deploy.sh

# full deploy: (1) commit (2) push (3) deploy Pages + docs + Workers
bash ops/deploy.sh --all
```

**部署入口**：`ops/deploy.sh` 是唯一的部署入口 —— commit + push + Pages + docs，
并可用 `--worker=<name>` 单独部署一个 Worker；`ops/pages_deploy.sh` 负责构建 + Pages。
`--dry-run` 只打印计划，不向任何远端写入。

默认情况下 `deploy.sh` 是**安静模式**：每个步骤一行状态，
只有该步骤失败时才输出它的完整日志。加上 `--full` 可流式输出全部内容
（构建清单、产物数量、wrangler 上传进度）。两种模式下标志与步骤完全相同 ——
`--full` 只改变详细程度。

凭据从本地 `secrets/webauthn.env` 读取（从不提交、从不回显）；
没有 ssh / rsync / 远端 systemd 步骤。`ops/migrate_d1.sh` 与
`ops/workers_deploy.sh` 也支持 `--dry-run`。

已提供自动化测试入口：

```bash
# Python tests
python3 -m pytest

# Pages Functions, Workers and image-watermark tests
npm test
```

## 环境变量

由部署脚本从 `secrets/webauthn.env` 读取，不提交到 Git。Pages 运行时有一套自己的 Secret（见下文的边缘章节）。

| 变量 | 说明 |
| --- | --- |
| `GATE_HMAC_KEY` | `__gate` cookie 的 HMAC-SHA256 密钥，在边缘签发并校验 |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | 供 `ops/d1_client.py`、`ops/pages_deploy.sh` 与 `ops/workers_deploy.sh` 使用的 Cloudflare API 访问凭据 |

密钥材料存放在仓库之外；`apple_account_encryption.key` 是用于 Apple Account 密码
与加密访客 IP 字段的 Fernet 密钥。

## 定时任务

所有调度都位于 Cloudflare 上，以各 Worker 的 `wrangler.toml` 中声明的
Worker Cron Triggers 形式存在。`python3 ops/readme_facts.py` 会重新读取本表、保留窗口
以及下方目录树中的每条路径：

| 调度 | Worker | 任务 |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 每分钟执行 HTTP/D1 探针；探针故障期间由 Durable Object alarm 每 10 秒复查一次，并在状态变化时告警 |
| `47 3 * * *` | `ops/status-worker` | D1 数据保留（`src/retention.ts`）：清理 `ray_log_v2`（7 天）、`visitors_v2`（30 天）、`visitor_rollups`（30 天）、`heartbeats`（30 天）、`events`（90 天）、`probe_uptime_daily`（90 天）、`auth_sessions`（60 天）与 `identity_handoffs`（1 天）；同一次运行会把各 bucket 的结果记录到 `retention_state`，对清理失败发出告警，并执行账号级 D1 读/写预算检查；它还会把此前七个完整 UTC 日的访客明细汇总进 `visitors_daily`（`src/visitor-daily.ts`），也就是 `/api/visitors` 读取 30 天统计数据所用的聚合结果 |
| `30 3 * * *` | `ops/sync-worker` | 把生效的 D1 `blocked_ips` 行同步到 Cloudflare IP List `comicine_blocklist` |
| `0 0 * * *` | `ops/d1-archive` | D1 快照 / 归档 |

TLS 证书由 Cloudflare 为 Pages 自定义域名签发与续期。
`ops/migrate_d1.sh` 与 `ops/workers_deploy.sh` 是手动的、
支持 `--dry-run` 的维护入口。

`python3 ops/readme_facts.py --check` 会从仓库重新读一遍上面的调度、保留期、TTL 与目录树，
与本页不一致就让检查失败；`--live` 则从 Cloudflare 读线上状态（D1 计数、Pages 主机与
Secret、DNS、WAF、Worker 调度）。

## 部署

部署目标是生产 Pages 项目 `comicine`、文档项目 `comicine-docs` 和独立 Workers。生产项目通过 `comicine.pages.dev` 提供访问，并承载全部生产自定义域名与加密运行配置。文档默认别名为 `comicine-docs.pages.dev`。Worker 账号子域为 `comicine.workers.dev`。Cloudflare 部署使用已配置的 API token。
在仓库根目录下执行：

```bash
cd site
bash ops/deploy.sh              # with no arguments = --all (full deploy, see below)
bash ops/deploy.sh --all        # commit + push + deploy Pages + docs + Workers
bash ops/deploy.sh --pages      # deploy production Pages
bash ops/deploy.sh --docs       # deploy docs.comicine.com only
bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker
bash ops/deploy.sh --all --full             # same, but stream every step's output
```

不带任何参数运行 `ops/deploy.sh` **完全等同于 `--all`**：commit + push + Pages +
docs + Workers，即「完整部署」契约。若要只发布本地已提交的内容，
请显式传入 `--pages` / `--docs`。

输出默认是安静模式（每步一行状态）；加上 `--full` 可观察整个过程。
`--dry-run` 可与上述任意标志组合使用。

凭据从本地 `secrets/webauthn.env` 读取；所有步骤都走 Cloudflare API 或 Git。

### 文档站（docs.comicine.com）

`site/docs/` 是一个**按子域分目录的容器**：`docs/` 存放 docs.comicine.com 的
VitePress 根，`services/` 存放 services.comicine.com 的价目表 CSV。`docs/` 内部的源文件按语言分类：
`zh-cn/`、`en-us/`、`ja-jp/`、`ko-kr/` 各自包含同一棵文件树（`<lang>/<page>.md`），
与共用的 `.vitepress/`、`functions/`、`public/` 目录并列。语言码是 URL 的**最后**一段，
内容页一律显式带上（`/README/zh-cn`、`/README/en-us`）。无后缀的 `/README` 由文档站的
Pages Function 按主站顺序解析（语言 cookie、`Accept-Language`、Cloudflare 国家信息，最后是
契约默认语言）。文档站没有首页：`/` 返回 404；`/docs-home/*` 和以前的本地化首页路径也直接返回 404。

`.vitepress/rewrites.json` 把每个 `<lang>/<page>.md` 源文件映射到带后缀的路由，
`.vitepress/config.mts` 通过 `additionalConfig` 为每个语言目录设置各自的 `lang` / `themeConfig`。
新增页面时，需要在四个语言目录中各建一份，加四条 rewrites 条目，并为无后缀路径添加
`functions/<page>.js` 入口及对应的 `_routes.json` include。若任何 markdown 文件没有产出 HTML、
不在语言目录中，或缺少某种语言的译本，`ops/docs_check_output.py` 都会让构建失败。

该站点使用来自 fork `ComiCine/vitepress` 的 VitePress 构建：
页头与页脚位于 fork 中（`VPComiCineNav.vue` / `VPComiCineFooter.vue`），
并与主站的 `base.html` / `_footer.html` 逐条对齐 —— 在那里修改它们，
下一次部署就会生效（只有当 fork 的 commit 变化时才会重新构建它；
使用 `COMICINE_VITEPRESS_FETCH=0` 可从 fork 工作区构建）。该站点是独立的
Cloudflare Pages 项目（`comicine-docs`），因此绝不会碰到主 `comicine` 的产物，
并且与主站共享 `user_lang_preference` / `comicine_theme` 两个 cookie。

```bash
bash ops/docs_deploy.sh --build-only   # build + validate only
bash ops/docs_deploy.sh --dev          # local VitePress dev server
```

## 安全设计

- 会话 cookie 名为 `__Host-comicine_session`（契约中的 `session_cookie`），仅限当前主机使用，
  并设置 `Secure` + `HttpOnly` + `SameSite=Lax` + `Path=/`，不带 `Domain`；`__Host-` 前缀
  会让浏览器强制要求「无 `Domain` + `Secure` + `Path=/`」这几项，因此子域无法覆盖这个带前缀
  的 cookie。以改名前的 `comicine_session` 名称提交的会话只在过渡期内、且只在其认证时间早于
  2026-11-08T16:00Z 时才被接受，这样新签发的 token 就无法通过 `Domain=.comicine.com` 注入；
  这项旧名读取及其清除逻辑会在 2026-12-07 之后移除（一个会话 TTL）。`/logout` 会同时清除
  这两个名称。每个会话都有一个随机 `sid` 记录在 D1 `auth_sessions` 中，`requireAuth`
  会拒绝已撤销/已过期的会话。运行时 HMAC 密钥缺失或 `auth_sessions` 表
  不可用时，以 503 快速失败。
- 门禁同样快速失败：当 `TURNSTILE_SECRET`、`GATE_HMAC_KEY` 或
  `SESSION_HMAC_KEY` 为空时，边缘返回 503，
  而不是渲染页面或签发未签名的 cookie。
- `__gate` cookie 的形式是 `<issued-at>.<expires-at>.<HMAC-SHA256 hex>`（1 小时 TTL，
  `HttpOnly`，在请求所属的当前或旧版根域间共享），完全在边缘签发与校验。
- 未登录浏览器访问受保护页面时，来源站点直接返回 302 跳转到 `identity.comicine.com/login`（不再有中间页和外置脚本），并在响应中设置短时 state cookie；Cloudflare Access 随后引导浏览器经 `comicine.cloudflareaccess.com` 登录。API 认证失败仍返回 JSON 401。identity 主机上的 Pages Function 自行验证 `Cf-Access-Jwt-Assertion`（RS256，JWKS 缓存 1 小时），将来源主机和 state 绑定到哈希存储、单次使用的 D1 交接码；来源站点回调再通过服务端请求消费代码，并按 `identity_sites` 中的本地配置授予角色。交接内容不包含角色；当前 visitor 与 account 两个站点的 API 都要求 admin 会话。
- 密钥与密文分开存储，且从不提交到仓库
- 封禁层级：应用层的 D1 黑名单在边缘直接 403，`ops/sync-worker` 把生效行同步到
  Cloudflare IP List `comicine_blocklist` 供 WAF 规则使用（该自定义规则目前未部署）
- 管理写入（创建/更新/删除）需要 admin 角色；viewer 为只读
- 每个写入端点都通过 `functions/_lib/request.ts`（`readJsonBody`）读取 JSON 请求体：
  请求体上限为 8 KB（身份交换为 2 KB，Apple Account 排序为 32 KB，因为它最多接受
  1000 个 id），超限请求会在流式读取过程中被取消并返回 413，而不是先整个缓冲下来。
  声明的 `Content-Length` 只是快速判断的提示，真正强制执行的是实际读取的字节数。
- 列表接口永不返回访客 IP；完整 IP 以 Fernet 加密存放在 `visitor_rollups.ip_enc` 中，
  仅对管理员逐行解密
- 完整的威胁模型 —— 信任层级、身份/会话边界、密钥缺失时的 fail-closed 处理
  以及访客 IP 流水线 —— 见 [SECURITY.md](https://github.com/ComiCine/ComiCine-website/blob/main/SECURITY.md)；
  漏洞披露按照它链接到的文档站政策处理。

## 白名单

手工维护的可信来源位于 [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt)，部署时会生成 [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt)，每行一个条目：

| 条目 | 效果 |
| --- | --- |
| `ASN/<number>` | 由 `ops/waf_whitelist.sh --apply` 手动管理的区域级 Cloudflare Access Rule 的可选 ASN 条目。ASN 条目不会绕过 Pages Functions 门禁。 |
| `IP-CIDR/<ip>/<mask>` | 完全放行的来源（例如 `IP-CIDR/97.64.18.11/32`）；IPv4 前缀只接受 `/24`–`/32`，IPv6 只接受 `/64`–`/128`；同时跳过黑名单与挑战门禁。 |

当前生成名单包含 **0 个 ASN 条目**和 **2 个完全放行的 IP**。完整部署只生成本地白名单，不会更改区域级 ASN Access Rules；如需更改这些规则，请手动运行 `ops/waf_whitelist.sh --apply`。

爬虫属于**独立且更弱的一层**（只跳过人机验证，并非完全信任），其名单就是站点自己的 [`docs/lists/robots.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/robots.txt) —— 一个文件承担两项职责：`src/build.py` 把其中的爬虫规则发布到 `/robots.txt`，并追加来自 `config-contract.json` 的 `Sitemap` URL；`ops/check_gate_trust.py`
把每一条显式列出的 `User-agent:`（除 `*` 之外的全部）转换为
`functions/_data/gateTrust.ts` 中的 `GATE_TRUST_CRAWLER_UAS`，再由
`functions/_lib/bots.ts` 对 `User-Agent` 请求头的前 512 个字符做大小写不敏感匹配。
新增一个爬虫只需加一行 `User-agent:`；开关是 `config-contract.json` 中的
`gate_trust.ua_allowlist_enabled`。当前编译出的名单包含 **101 个 token**
（99 个 User-Agent，加上只存在于 robots.txt 的 `Google-Extended` / `Applebot-Extended`，
它们永远不会匹配真实请求）。由于每个条目都是子串匹配，任何 token 都不能同时出现在
真实的浏览器 User-Agent 中：微信/QQ 内置浏览器、搜狗手机浏览器、CUBOT 手机、
Spider 8 平板、预览构建以及 AKAI/Funai 电视浏览器都仍然留在门禁之后，
通用标记也仅限于 `crawler`、`fetcher` 和 `LLM`。由于 User-Agent 是自报的，
这一层永远不会跳过 D1 黑名单、永远不会获得 `__gate` cookie，也不会被计为访客 —— 见
[门禁行为](#门禁行为)。

运行时信任范围：边缘代码只把 `IP-CIDR` 条目视为可信
（`isGateTrustedIp` → `functions/_data/gateTrust.ts`）。修改
`docs/lists/own-ips.txt` 或 `docs/lists/robots.txt` 之后，请通过一次构建
（`bash ops/build.sh`，它会运行
`ops/check_gate_trust.py --emit`）重新生成边缘使用的副本。

## 权威来源

- 面向用户的文案：`locales/*.json`；`functions/_data/*` 与 API 的 i18n 路由都由它生成。
- 共享运行时常量：`config-contract.json` 是约定的跨运行时契约；`src/config.py` 与生成的 `functions/_lib/config.ts` 都消费它，并由 `ops/check_config_contract.py` 强制保持一致。
- 门禁文案与跳转预加载资源：`locales/*.json` 经 `functions/_data/runtime.ts` 提供；由 `src/build.py` 组装。跳转页文案同样由这些语言文件预渲染到 `public/<lang>/redirect.html`。
- D1 结构与迁移：`ops/migrations/*.sql`；`blocked_ips` 是封禁的唯一权威。
- 安全响应头基线（启用时）：`ops/security-headers.json`。
- 部署与运行时边界：`ops/deploy.sh`；只有 Cloudflare Pages + Workers 两个运行时。

## Cloudflare Pages 运行时

公开站点（首页 / 服务 / 联系、门禁、访客面板、Apple Account 管理器、`images.comicine.com` 静态资源主机与跳转中继）运行在 `comicine` Cloudflare Pages 项目上，状态页与所有定时任务也是如此。该项目通过 `comicine.pages.dev` 提供访问，并承载全部生产自定义域名与加密运行配置。文档项目 `comicine-docs` 使用 `comicine-docs.pages.dev`。Worker 的 URL 使用 `comicine.workers.dev`。

运行时划分：

| 层 | 技术 |
| --- | --- |
| 边缘 / 人类验证 | Pages Functions（`functions/_middleware.ts`） |
| 页面 | 构建时预渲染的静态 HTML（多语言） |
| 数据 | D1（访客分析、黑名单、Apple Account 管理、认证会话） |
| 人类验证 | Cloudflare Turnstile，门禁页原地渲染 |
| 独立 Worker | `status.comicine.com`（`comicine-status`：探针、状态页、数据保留）、`image.comicine.com`（`comicine-image-watermark`）、`comicine-blocklist-sync` |

### 构建与目录结构

- `python3 src/build.py`：把页面以 4 种语言预渲染到 `public/`，把 `locales/*.json`
  内联为 `functions/api/i18n/[lang].ts`，并生成共享的 `functions/_data/runtime.ts`
  （门禁 i18n + 跳转预加载资源）
- `ops/migrations/001_init.sql`：D1 初始结构（`apple_accounts` / `blocked_ips` / `visitors`）
- `ops/export_d1.py`：生成 D1 导入 SQL（输出在 `ops/out/`，已被 git 忽略）
- `ops/migrations/007_visitor_status_indexes.sql`：为访客状态筛选新增 `(status, ts)` 与 `(status, ip_hash, ts)` 索引
- `ops/sync-worker/`：每日 03:30 的 Worker cron 把生效的 D1 `blocked_ips` 行同步到 Cloudflare IP List；`auto_block.py cf` 仅用于显式的人工维护

### 环境变量

配置在 **Pages 项目设置 → 环境变量 → 加密（Secret）** 下，不提交到仓库：

| 变量 | 用途 |
| --- | --- |
| `TURNSTILE_SITEKEY` | 门禁页上 Turnstile 组件的公开 sitekey |
| `TURNSTILE_SECRET` | 服务端 siteverify 密钥 |
| `GATE_HMAC_KEY` | `__gate` cookie 的 HMAC-SHA256 签名密钥（`openssl rand -hex 32`） |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access 团队域名；同时也是用于验证的 JWT `iss` |
| `ACCESS_IDENTITY_AUD` | 单一 `ComiCine` Access 应用的 AUD；角色由 `config-contract.json` 的来源主机映射决定 |
| `VISITOR_IP_KEY` | 用于加密完整访客 IP 字段（`visitor_rollups.ip_enc`）的 Fernet 密钥 |
| `OBSERVABILITY_HMAC_KEY` | 隐私最小化访客 IP 哈希的 HMAC 密钥（`functions/_lib/tracking.ts`）；缺失时门禁 fail-closed |
| `SESSION_HMAC_KEY` | Pages 会话 cookie 签名密钥（与 `GATE_HMAC_KEY` 分开） |
| `APPLE_ACCOUNT_ENCRYPTION_KEY` | Fernet 密钥（来自 `secrets/apple_account_encryption.key`） |

本地开发：把 `.dev.vars.example` 复制为 `.dev.vars` 并填入真实值（已被 git 忽略）。通过 `wrangler secret put` 为 `ops/sync-worker` 配置 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。

### 门禁行为

每个请求都会检查已签名的 `__gate` cookie。通过门禁有三种方式，其中只有前两种基于身份：

| 来源 | 绕过效果 |
| --- | --- |
| IP 允许名单（`docs/lists/whitelist.txt` 中的 `IP-CIDR` 条目 → `functions/_data/gateTrust.ts`） | 完全绕过：同时跳过挑战**与** D1 黑名单 |
| Cloudflare `botManagement.verifiedBot` | 完全绕过（经过验证的搜索引擎签名） |
| 自报的爬虫 User-Agent（`docs/lists/robots.txt` 中显式的 `User-agent:` 行 → `GATE_TRUST_CRAWLER_UAS`） | 仅跳过挑战：仍受黑名单约束，永远不会获得 `__gate` cookie，也不会被计为访客 |

因此爬虫和 AI agent（GPTBot、ClaudeBot、PerplexityBot、Bytespider、CCBot、DeepSeekBot 等）可以读到真实页面，而来自非允许名单来源的浏览器仍然会看到 Turnstile 门禁页。`cf_clearance` 永远不被接受，User-Agent 名单是**自报的** —— 它只用于区分诚实的爬虫与浏览器，并不是身份认证（`functions/_lib/bots.ts` 对此有明确说明）。

门禁只是两层中的一层。它前面的边缘还有自己的 AI bot 策略：在 Cloudflare 默认配置（`ai_bots_protection: only_on_ad_pages`）下，托管规则集会以 `403 Your request was blocked.` 响应 GPTBot/ClaudeBot/CCBot/Amazonbot/Bytespider，而且这发生在任何 Worker 代码运行**之前**，`functions/` 里的逻辑再怎么改也无法撤销。`ops/ai_bots.py --apply` 会把该策略对每种 AI 行为（Search / Agent / Training）都设为「不阻止」，关闭 AI Labyrinth（`crawler_protection`），并阻止 Cloudflare 前置托管 `robots.txt`；`--show` / `--snapshot` / `--dry-run` 用于读取和记录当前状态。该策略于 2026-10-12 应用成功；其归档快照已于 2026-10-31 删除。Token 具备 **Bot Management: Edit** 权限，更新动词是 `PUT`（PATCH 返回 `405 / code 10405`）。有两件事**不可行**，不要再试：在 `phases: ["http_request_firewall_managed"]` 上使用 `action: skip` 的 WAF 自定义规则在这个 Free 区域上会被接受，但并不能解除 AI bot 拦截；区域的 `/settings/*` 键也都不暴露该策略。

发现类文件由 `src/build.py` 构建，并在 `_routes.json` 中排除出 Functions，因此爬虫无需经过门禁即可获取：`/robots.txt` —— 爬虫规则来自 `docs/lists/robots.txt`，除端点/管理路径外全部允许，并显式列出欢迎的爬虫，包括只存在于 robots.txt 的 `Google-Extended` / `Applebot-Extended` token（该文件同时就是上面的门禁允许名单）—— `/llms.txt`（主站与 `docs.comicine.com` 的精选索引）—— 以及 `/sitemap.xml`（规范的首页、服务与联系 URL；`docs.comicine.com` 有自己的 sitemap）。

`POST https://comicine.com/mcp` 是由 `functions/mcp.ts` 实现的一个只读 MCP 服务器（JSON-RPC 2.0，工具为 `get_public_page` 与 `search_public_pages`）；它只通过 `ASSETS` 绑定读取预渲染好的公开页面。它**不是公开 API**，仅供允许名单中的客户端和内部客户端使用：`/llms.txt` 有意不收录它，`/robots.txt` 也禁止它，因此它不会被宣传。`functions/_lib/routing.ts` 中的 `isExemptPath("/mcp")` 返回 false，未通过验证的客户端会收到常规的 403 Turnstile 页面。能访问此端点意味着已经通过门禁：允许名单中的 IP、Cloudflare 验证过的 bot，或有效的 `__gate` cookie；自报的爬虫 User-Agent 名单只跳过人机验证，并不是身份认证。

读取有明确上限：请求体 64 KiB（`MAX_BODY_BYTES`），每次读取页面文本 12,000 个字符（`MAX_PAGE_TEXT`），最多 5 条搜索命中、4 种语言和 4 条可读路径；除边缘/门禁之外没有按客户端限流，每次读取都是对已预渲染页面的一次 `ASSETS` fetch。

较新的 `2026-07-28` 协议版本要求 `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` 请求头以及 `params._meta`；旧版 `2025-11-25` / `2025-06-18` / `2025-03-26` 不需要这些请求头，不支持的版本会返回 `-32022` 与 `supportedVersions`。该策略由 `functions/mcp.test.ts`（门禁/策略断言）与 `tests/test_build.py`（发现类文件）锁定。

未验证的请求会**原地**获得 Turnstile 门禁页：主机与路径始终不变。中间件在请求的 URL 上以状态码 `403` 渲染 `public/<lang>/auth.html`，`POST /__gate/verify` 在同一来源上返回 `Set-Cookie: __gate=…`（1 小时，作用域为该请求当前或旧版根域），随后页面重新加载最初的目标地址。`auth.comicine.com` 是门禁主机 —— 它在自己的根路径上提供同一个页面，且拥有 `/__gate/config|diag|verify` 端点。

每个渲染门禁的主机都由同一份边缘代码提供服务，因此不存在需要保持同步的第二套门禁实现。

中间件还会强制执行归一化后的 D1 黑名单，并记录隐私最小化的访客分析数据。门禁页为 `no-store`/`noindex`，并支持深色/浅色主题切换。Turnstile widget 必须列出所有渲染它的主机（`comicine.com` 的门禁子域，包括 `auth`、`status`、`visitor`、`apple` 与 `images`）。

**认证路径限流（`/login` 与 `/logout`）。** 这两条路径都不受 D1 黑名单约束，这样被封锁 IP 上的管理员仍能登录或登出，但也因此成为成本最低的洪水攻击目标；`/logout` 还可能会写一次 D1 会话撤销更新。Pages Functions 按来源地址（`CF-Connecting-IP`）对这两条路径限流：

| 路径 | 限额 | 窗口 | 超限 |
| --- | --- | --- | --- |
| `/login` | 10 次请求 | 60 秒 | `429` |
| `/logout` | 20 次请求 | 60 秒 | `429` |

- 固定窗口与 UTC 整分钟对齐。固定窗口在滚动一分钟内最多允许两倍限额；这些是滥用限流，不是计费计数器，而且不同 isolate 之间的读-改-写竞争可能导致少计。
- 429 响应带有 `Retry-After` 与 `Cache-Control: no-store`，绝不带 `Location`（不返回 3xx）。默认返回 HTML；当客户端只接受 `application/json` 时返回 JSON（`{"error":"rate_limited","retry_after":N}`）；同时列出 `text/html` 的请求头仍返回 HTML。
- 只有这些精确路径受限。`/login/entra`、`/login/callback`、`/identity/callback` 与 `/api/identity/exchange` 是 Access 登录回调，永不限流。`IP-CIDR` 允许名单中的来源豁免（它们是管理员自己的地址）；自报的爬虫 User-Agent **不**豁免，因为该请求头是自报的。
- 计数器不接触 D1：它们存放在同一 colo 内共享的 Cache API 中，本地开发（以及测试中的计数器）回退到 isolate 内存。读取或写入失败的计数器会 fail open，因此缓存故障不会把管理员锁在外面。
- 实现：`functions/_lib/rate-limit.ts`，由 `functions/_middleware.ts` 在门禁之前、任何数据库操作之前调用。单元测试：`functions/_lib/rate-limit.test.ts`。
- 阈值依据：在 2026-11-07 之前的七天里，站点共记录到 6 次 `/login` 与 2 次 `/logout` 请求，全部来自同一个来源地址，因此该限额既能挡住洪水攻击，又不影响正常登录。
- 不使用区域级限流规则。Free 计划只允许一条规则、10 秒计数周期，表达式只支持 Path/Verified-Bot，且计数按 IP，因此无法表达两条不同的按路径阈值或 IP 允许名单豁免，而且它会返回 Cloudflare 自己的页面，而不是协商后的 429。如果以后要加，请把它当作更外层的纵深防御，并保留这里的 Worker 阈值。

### 页面服务（干净 URL，无语言路径前缀）

`src/build.py` 以 4 种语言预渲染 `public/<lang>/`；门禁通过之后，中间件按 **cookie > Accept-Language > CF 区域 > en-US** 的顺序选择语言，并通过 `env.ASSETS.fetch()` 获取匹配的页面，从而保持 URL 干净：

- `comicine.com/` → 首页；`comicine.com/services` / `comicine.com/contact` → 对应页面
- `services.comicine.com/` → 服务页；`contact.comicine.com/` → 联系页（子域直接提供内容，不 301 到主站）
- `visitor.comicine.com/` → 访客面板（需要登录）；`account.comicine.com/apple` → Apple Account 管理器（需要登录）
- `images.comicine.com/` → 301 到 `comicine.com/`；其他路径提供作品集图片、favicon、logo 与二维码等静态资源。`image.comicine.com/portfolio/<img>` → 来自归一化 Worker 的加水印版本（其根路径也 301 到 `comicine.com/`）
- `www.comicine.com` → 301 到主站
- 在 `comicine.com`、`www`、`images`、`services`、`contact`、`visitor` 和 `account` 主机上，`/<name>.html` 兼容别名识别 `www`、`images`、`portfolio`、`services`、`contact`、`visitor`、`apple-account`、`redirect`、`docs` 和 `status`，并按配置跳转；`docs.html` 指向主站根路径，`/index.html` 指向当前主机配置的根路径。格式有效但未识别的名称返回 404。
- 导航链接保持绝对子域 URL（`https://services.comicine.com` 等）；语言切换是纯前端的 `applyLang()`，不重新加载、不改变 URL

### services.comicine.com 价目表（CSV 驱动）

服务价目表是**数据，而不是标记**：`src/build.py` 在每次渲染时读取
`docs/services/*.csv`（`src/services_pricing.py`），并填充
`src/templates/services.html` 中的套餐网格。改价格就意味着改 CSV 然后部署 ——
不需要改模板。

| 文件 | 列 | 填充内容 |
| --- | --- | --- |
| `docs/services/convention.csv` | `shots,price[,bookable]` | 01 场照拍摄（Convention），每个张数档位一张卡片 |
| `docs/services/outdoor.csv` | `type,people,price[,bookable]` | 02 正片拍摄（Outdoor），棚拍/外景 × 单人/双人 |

只有数字、档位集合与可预约状态来自 CSV；
标签、单位后缀与说明栏仍然来自 `locales/*.json`
（`plan_studio_solo`、`unit_per_shot` 等）。

**`bookable`（可选列）** 同时驱动删除线价格样式
与说明栏中的棚拍行：

- 按档位：`no` → 该档价格渲染时带
  `class="plan-price strikethrough"`；
  `yes`、空单元格或整列缺失 → 正常价格
- 说明栏：如果**所有**棚拍档位都是 `no`，棚拍行显示暂停文案
  （`studio_paused`）；只要有一个棚拍档位可预约，
  就改显示 `studio_bookable`

因此「暂时不接单」是端到端的数据：把 `outdoor.csv` 中棚拍的 `no` 改成 `yes`，
删除线*与*暂停说明会在下一次部署时同时消失，无需改动模板或语言文件。
两者永远不会互相矛盾。任何其它取值（例如 `maybe`）都会让构建失败，
而不是默默猜测。

**`price` 不是正整数时一律渲染成 `-`。** 没有占位符白名单：留空、`N/A`、`TBD`、
写错的数字（`1OO`）、`0`、负数都表示「价格暂不公开」。卡片保留 `CNY` 前缀与
单位后缀，只把数字换成 `-`（`CNY - / 张`），因此版式与数字档位完全一致。
`-` 既不是 `0` 也不是「免费」；在同一个文件里混用这类单元格与数字行没有问题。

契约的其余部分：

- 场照拍摄的行按**张数升序**来自 CSV；档位数量不固定
  （新增一个 12 张的档位不需要改代码）
- 只有当某个场照拍摄档位登记在 `CONVENTION_UNIT_KEYS` 中时才会带单位后缀；
  未登记的档位只渲染裸价格
- 正片拍摄的行必须覆盖全部四种 `type/people` 组合；无论行序如何，
  它们都按固定顺序渲染（棚拍单人/双人，然后外景单人/双人）

文件缺失、列不正确、档位重复、档位无法识别或 `bookable` 取值非法，
都会**让构建失败** —— 价目表出错比构建失败更严重。价格单元格本身永远不会让
构建失败：解析不出正整数的内容一律渲染成 `-`。
`tests/test_services_pricing.py` 覆盖了上述所有情况，并包含一项针对已入库 CSV 的
往返校验。

`docs/services/` 已被排除在 VitePress 构建之外
（`docs/.vitepress/config.mts` 中的 `srcExclude`），因此这些 CSV 始终只是数据源，
绝不会发布到 docs.comicine.com。

### 性能 / 边缘缓存

- `public/_routes.json` 把 `/static/*` 与根级静态资源排除在 Pages Functions 之外，
  因此 CSS/JS/字体由 Pages 资源服务器直接提供。
- `src/static/files/` 中的文件会镜像到构建产物 `/public/files/` 并保留子目录，因此 `src/static/files/<path>` 可通过 `https://comicine.com/public/files/<path>` 访问。
  `/public/files/*` 绕过 Pages Functions，并使用与其他静态资源相同的一天缓存策略；不存在的路径返回 404。
- `public/_headers` 为带版本号的静态资源设置带 `stale-while-revalidate`
  的长浏览器缓存；`public/_routes.json` 与 `_headers`
  都由 `src/build.py` 生成。
- 预渲染的公开 HTML 由**进程内页面缓存**复用（键为 host + 语言），响应声明
  `private, max-age=300, stale-while-revalidate=3600` 与 `Vary: Accept-Language`。
  `private` 让受门禁保护的 HTML 不进入共享缓存，因为变体取决于语言 cookie，而 `Vary`
  并未覆盖它。这里**刻意不声称**边缘缓存：Cloudflare 不缓存 Pages Functions 的响应
  （同一 URL 连续请求 `cf-cache-status` 恒为 `DYNAMIC`），所以共享缓存的生命周期指令是死配置；
  语言 cookie 也不放进 `Vary`，否则只会把浏览器缓存切得更碎。
- 第一方作品集缩略图、二维码与 favicon 使用 `images.comicine.com/static/...`
  （静态边缘缓存，绕过 Functions）。网站页面不再调用水印 Worker；
  Worker 仍部署着，以服务直接访问及旧版图片链接。
- 作品集原图永不发布：`/static/portfolio/<img>` 返回 404。
  只有干净的缩略图（`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`）
  与 `image.comicine.com` 上归一化、加水印的 `/portfolio/<img>` 是公开的；
  原图保留在被 git 忽略的 `src/static/portfolio/` 与私有 R2 桶
  `comicine-originals` 中（`ops/upload_originals.sh`）。
- Turnstile 验证有 3 秒的服务端超时，
  这样 Cloudflare 质询平台故障时会快速失败，
  而不是让用户最多卡住 8 秒。

### 当前部署与迁移状态

线上部署与外部资源状态，随时可用 `python3 ops/readme_facts.py --live` 重新读取：

1. **Pages**：生产项目 `comicine` 提供 `comicine.com`、`www`、`services`、`contact`、`auth`、`visitor`、`account`、`identity`、`images` 与 `redirect`，并拥有 `comicine.pages.dev` 与加密运行配置。已退役的 `comicine-production` 项目没有生产自定义域名，保留给用户自行决定何时删除。文档项目是 `comicine-docs`，地址为 `comicine-docs.pages.dev`；`docs.comicine.com` 由它提供。`image.comicine.com` 是水印 Worker，`fonts.comicine.com` 使用 R2，`status.comicine.com` / `sink.comicine.com` 是 Worker 自定义域名
2. **D1**：新的 `comicine` 数据库（APAC）已创建并载入在用的运维表。Pages 生产与预览的绑定配置现已指向它；独立 Worker 的绑定随本次发布一并切换。最终导入保留 Apple Account 记录原值，并省略旧访客哈希与详细遥测。`blocked_ips` 仍是封禁权威，软删除的行保留用于审计
3. **Secret** 位于 **Pages → Settings → Environment variables → Encrypt**：九个运行时 secret 包括 Turnstile 的两个密钥、`GATE_HMAC_KEY`、`SESSION_HMAC_KEY`、`OBSERVABILITY_HMAC_KEY`、`VISITOR_IP_KEY`、`APPLE_ACCOUNT_ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN` 与 `ACCESS_IDENTITY_AUD`。已废弃的 `ACCESS_ADMIN_AUDS` 与 `ACCESS_VIEWER_AUDS` 没有被复制，因为运行时代码不读取它们；已退役的 AppleID 与 Authentik secret 也未配置
4. **Access**：`ComiCine` 保护 `identity.comicine.com/login`；`visitor.comicine.com` 与 `account.comicine.com` 使用共享身份交接和各自的主机专用 Pages 会话。已废弃的 `identity.limooo.cn/login` 目标已于 2026-10-29 移除，同时保留应用 AUD 与策略。未使用的 `ComiCine-Admin` 应用（`admin.limooo.cn`）也已移除；该主机名没有 DNS 记录或 Pages 自定义域名。不存在自托管 IdP 或自定义登录表单
5. **Worker** 独立运行：`comicine-status`、`comicine-blocklist-sync`、`comicine-d1-archive`、`comicine-image-watermark` 与 `comicine-sink`；Workers 账号子域为 `comicine.workers.dev`。`status.comicine.com`、`image.comicine.com` 与 `sink.comicine.com` 是 Worker 自定义域名。状态 Worker 使用 `comicine-status_ComiCineProbeStateV2`；确认新绑定可用后，已删除旧命名空间。`comicine-sink` 数据库已导入，`comicine_sink` dataset 已配置，Sink Worker 已部署；一条有效短链返回了带 Location 的 302
6. **Cloudflare 规则**：当前没有启用的 WAF 或 Cache Rules；线上 IP List 为 `comicine_blocklist`。`.com` 区域的动态重定向阶段为空；旧 `.cn` 区域将请求以 GET/HEAD 301、其他方法 308 跳到对应 `.com` URL，并保留路径和查询参数。随后 `comicine.com/feishu/<path>` 与 `/lark/<path>` 由 Pages 返回 302，转到 `https://comicine.feishu.cn/<path>` 并保留路径和查询参数。
7. **冒烟检查**：`https://comicine.com/_health` → 200，`https://comicine.com/?challenge=1` → 403，`https://docs.comicine.com/` → 404，`https://status.comicine.com/` → 200

Cloudflare 账号显示名尚未更新，因为已配置的 API token 缺少 `Account Settings Write`。Sink 的目标 D1 数据库是 `comicine-sink`，配有 `comicine_sink` Analytics Engine dataset。状态 Durable Object 的目标见上文。

门禁在每个主机上都原地渲染，门禁页与日志显示真实访客 IP，Access 仍是唯一的身份来源。2026-10-27 提供的 Cloudflare 仪表盘截图显示 `comicine.com` 已列入 Turnstile widget 的 Hostname Management。`Turnstile Sites Write` 权限现已生效，widget API 返回 HTTP 200；其主机名列表包含 `comicine.com`。用户 2026-10-29 的截图来自 `comicine.pages.dev/?challenge=1`：Turnstile 显示成功，但 D1 记录 `/gate/verify` 返回 403 `hostname_rejected`，因为服务端有意拒绝 Pages 主机作为公开主机。`comicine.com` 上的真实浏览器挑战尚未确认成功。不要绕过或削弱验证，也不要把 Pages 主机加入公开主机 allowlist。

## 许可证

ComiCine 拥有并有权授权的原创软件材料依据 GNU Affero 通用公共许可证第 3 版或任何后续版本（AGPL-3.0-or-later）提供。GNU AGPL v3 许可证正文见 [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt)，并附[简体中文](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_zh_CN.txt)、[日语](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ja_JP.txt)与[韩语](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ko_KR.txt)参考译本。GNU AGPL v3 第 7 条附加条款见 [ADDITIONAL_TERMS.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS.txt)，并附[简体中文](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_zh_CN.txt)、[日语](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ja_JP.txt)与[韩语](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ko_KR.txt)参考译本。该等附加条款适用于采用 GNU AGPL v3 的情形，后续版本是否适用取决于相应版本的条款。英文版附加条款为权威文本；译本仅供参考。

ComiCine 是项目使用的开发品牌及公开署名；版权归属于依法享有相关权利的实际权利人。再分发时必须保留适用的作者署名和版权声明，包括合理的来源声明。版权范围见 [COPYRIGHT.md](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT.md)，已识别的第三方材料与平台标识见 [THIRD_PARTY_NOTICES.md](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES.md)。遵守适用 GNU AGPL 版本即可进行商业使用。

额外授权或商标许可咨询：[contact@comicine.com](mailto:contact@comicine.com)。遵守适用 GNU AGPL 版本的商业使用无需额外申请授权。
