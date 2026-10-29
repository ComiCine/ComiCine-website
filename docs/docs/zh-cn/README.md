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
- **认证与角色**：单一 `ComiCine` Access 应用保护 `identity.comicine.com/login`；identity 主机上的 Pages Function 验证 JWT 后，通过一次性 D1 交接把身份和来源主机交回来源站点，再由该站点按本地配置授权。目前两个受保护站点都需要 admin 会话。
- **共享登录跳转**：未登录浏览器打开受保护页面时，站点先返回 HTTP 401 HTML，再由同源外置脚本跳转到 `identity.comicine.com/login`；Cloudflare Access 随后引导浏览器经 `comicine.cloudflareaccess.com` 登录。API 认证失败仍返回 JSON 401。
- **监控**：`comicine-status` Worker 每分钟探测（probe）HTTP/D1 目标，探针处于故障状态时每 10 秒重新检查一次，并把结果存入 D1；告警通过 webhook 发出（Email binding 作为后备）
- **状态页**（`status.comicine.com`）：由同一个 Worker 从 D1 服务端渲染，支持 4 种语言与显式 `?lang=` 覆盖，探针错误码有四种语言的对照表，并自带品牌化的 404/503 故障页，每日在线率取自 `probe_uptime_daily` 汇总表
- **自动 IP 封禁**：
  - D1 `blocked_ips` 是权威数据源；`sync-worker` 把生效的行同步到 Cloudflare IP List，用于边缘拦截（没有源站，因此也不需要 ipset/iptables）
  - 应用层全局过滤器作为后备 —— 被封禁的 IP 直接收到 403
- **统一跳转页**（`redirect.comicine.com/?to=<https-url>`，也接受 `/r`）：在跳转到任意 HTTPS 目标之前显示一个中转提示页
- **作品集图片处理**：原图永不对外发布；只有加水印的完整图片（`image.comicine.com/portfolio/*`）和干净的缩略图是公开的

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
├── LICENSE.txt                                        # GNU AGPL v3 官方英文正文
├── ADDITIONAL_TERMS.txt                               # Section 7 附加条款
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
├── data/                                             # runtime databases and caches (generated; git-ignored)
├── secrets/                                          # secrets & certificates, git-ignored
│   ├── webauthn.env                                  # env file read by the deploy scripts
│   └── apple_account_encryption.key                  # Apple Account password encryption key
├── ops/                                              # deployment & ops tooling
│   ├── deploy.sh                                     # the single deploy entry point (commit/push + Pages + docs + Worker)
│   ├── build.sh                                      # Pages build: venv, contract checks, public/manifest.json
│   ├── pages_deploy.sh                               # Cloudflare Pages build + Wrangler deploy
│   ├── docs_deploy.sh                                # docs.comicine.com build + deploy (VitePress → Pages project comicine-docs)
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
│   ├── check_config_contract.py / check_gate_trust.py / check_security_headers.py / check_ip_rays.py / check_ray_id.py / check_visitor_id.py
│   ├── migrations/                                   # D1 schema migrations
│   ├── waf/                                          # WAF rule snapshots
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
└── docs/                                             # docs.comicine.com VitePress root + services.comicine.com price-list CSVs
```

## 品牌资源与字体

- 首页主视觉和左上角导航均以 Baloo 2 文本显示准确品牌名称 `ComiCine`。作品集展开时，同一个品牌文字元素会从页面中央移动到导航栏；颜色跟随主题文字色，保持黑白效果。
- `src/static/icons/comicine-favicon.svg` 用于浏览器 Favicon 和小尺寸网页标识；横向字标及主要社交预览图使用 `src/static/icons/comicine-xtext.svg`。PNG 版本仅用于 Apple 触控图标，以及邮件、社交媒体等仅支持栅格图像的场景。`src/static/icons/comicine-watermark.png` 继续作为图片水印流水线的输入。
- Copyright 区域使用自托管的 Delius Swash Caps 字体子集，存放于 `src/static/fonts/delius-swash-caps/`，并随附 OFL 许可证。状态 Worker 内嵌所需字体子集。Baloo 2 仅用于准确的 `ComiCine` 品牌字样，页面其他文字沿用原有字体栈。
- 生产构建使用仓库内的字体子集，不依赖开发机上的原始字体目录。

## 快速开始

```bash
# 安装 package-lock.json 锁定的 Node 依赖
npm ci

# 构建静态站点（Python 虚拟环境 + 契约校验 + public/ + preview/）
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
# Python 测试
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
Worker Cron Triggers 形式存在：

| 调度 | Worker | 任务 |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 每分钟执行 HTTP/D1 探针；探针故障期间由 Durable Object alarm 每 10 秒复查一次，并在状态变化时告警 |
| `47 3 * * *` | `ops/status-worker` | D1 数据保留（`src/retention.ts`）：清理 `ray_log_v2`（7 天）、`visitors_v2`（30 天）、`visitor_rollups`（30 天）、`heartbeats`（30 天）、`events`（90 天）、`probe_uptime_daily`（90 天）、`auth_sessions`（60 天）与 `identity_handoffs`（1 天） |
| `30 3 * * *` | `ops/sync-worker` | 把生效的 D1 `blocked_ips` 行同步到 Cloudflare IP List `comicine_blocklist` |
| `0 0 * * *` | `ops/d1-archive` | D1 快照 / 归档 |

`python3 ops/readme_facts.py --check` 会从仓库重新读一遍上面的调度、保留期、TTL 与目录树，
与本页不一致就让检查失败；`--live` 则从 Cloudflare 读线上状态（D1 计数、Pages 主机与
Secret、DNS、WAF、Worker 调度）。

TLS 证书由 Cloudflare 为 Pages 自定义域名签发与续期。
`ops/migrate_d1.sh` 与 `ops/workers_deploy.sh` 是手动的、
支持 `--dry-run` 的维护入口。

## 部署

部署目标是生产 Pages 项目 `comicine`、文档项目 `comicine-docs` 和独立 Workers。生产项目通过 `comicine.pages.dev` 提供访问，并承载全部生产自定义域名与加密运行配置。文档默认别名为 `comicine-docs.pages.dev`。Worker 账号子域为 `comicine.workers.dev`。
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
docs，即「完整部署」契约。若要只发布本地已提交的内容，
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
契约默认语言）；文档站根路径 `/` 会 302 到 `https://comicine.com`。

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

- 会话 cookie 使用 `Secure` + `HttpOnly` + `SameSite=Lax`，并限定在当前主机，避免会话 cookie 被其他站点复用；
  每个会话都有一个随机 `sid` 记录在 D1 `auth_sessions` 中，`requireAuth`
  会拒绝已撤销/已过期的会话。运行时 HMAC 密钥缺失或 `auth_sessions` 表
  不可用时，以 503 快速失败。
- 门禁同样快速失败：当 `TURNSTILE_SECRET`、`GATE_HMAC_KEY` 或
  `SESSION_HMAC_KEY` 为空时，边缘返回 503，
  而不是渲染页面或签发未签名的 cookie。
- `__gate` cookie 的形式是 `<unix-expiry>.<HMAC-SHA256 hex>`（1 小时 TTL，
  `HttpOnly`，`Domain=.comicine.com`），完全在边缘签发与校验。
- 未登录浏览器访问受保护页面时，来源站点先返回 HTTP 401 HTML，并设置短时 state cookie；同源外置脚本再跳转到 `identity.comicine.com/login`，Cloudflare Access 随后引导浏览器经 `comicine.cloudflareaccess.com` 登录。API 认证失败仍返回 JSON 401。identity 主机上的 Pages Function 自行验证 `Cf-Access-Jwt-Assertion`（RS256，JWKS 缓存 1 小时），将来源主机和 state 绑定到哈希存储、单次使用的 D1 交接码；来源站点回调再通过服务端请求消费代码，并按 `identity_sites` 中的本地配置授予角色。交接内容不包含角色；当前 visitor 与 account 两个站点的 API 都要求 admin 会话。
- 密钥与密文分开存储，且从不提交到仓库
- 封禁层级：应用层的 D1 黑名单在边缘直接 403，`ops/sync-worker` 把生效行同步到
  Cloudflare IP List `comicine_blocklist` 供 WAF 规则使用（该自定义规则目前未部署）
- 管理写入（创建/更新/删除）需要 admin 角色；viewer 为只读
- 列表接口永不返回访客 IP；完整 IP 以 Fernet 加密存放在 `visitor_rollups.ip_enc` 中，
  仅对管理员逐行解密

## 白名单

手工维护的可信来源位于 [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt)，部署时会生成 [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt)：

| 条目 | 效果 |
| --- | --- |
| `ASN/<number>` | 可选的 Cloudflare 区域级 ASN Access Rule 条目。需要手动运行 `bash ops/waf_whitelist.sh --apply` 才会更改区域规则；ASN 条目不会绕过 Pages Functions 门禁。 |
| `IP-CIDR/<ip>/<mask>` | Pages 边缘完全放行来源（例如 `IP-CIDR/97.64.18.11/32`）；IPv4 前缀只接受 `/24`–`/32`，IPv6 只接受 `/64`–`/128`，同时跳过封禁检查与人机验证。 |

当前生成名单有 **0 个 ASN 条目**和 **2 个 IP 网段**。完整部署只生成本地白名单，不会更改 Cloudflare 区域级 ASN Access Rules。编辑 `own-ips.txt` 后，部署会运行 `ops/sync_whitelist.py`；构建随后运行 `ops/check_gate_trust.py --emit` 生成边缘副本。

## 权威来源

- 面向用户的文案：`locales/*.json`；`functions/_data/*` 与 API 的 i18n 路由都由它生成。
- 共享运行时常量：`config-contract.json` 是约定的跨运行时契约；`src/config.py` 与生成的 `functions/_lib/config.ts` 都消费它，并由 `ops/check_config_contract.py` 强制保持一致。
- 门禁/跳转文案：经由 `functions/_data/runtime.ts` 来自 `locales/*.json`；由 `src/build.py` 组装。
- D1 结构与迁移：`ops/migrations/*.sql`；`blocked_ips` 是封禁的唯一权威。
- 安全响应头基线（启用时）：`ops/security-headers.json`。
- 部署与运行时边界：`ops/deploy.sh`；只有 Cloudflare Pages + Workers 两个运行时。

## Cloudflare Pages 运行时

公开站点（首页 / 服务 / 联系、门禁、访客面板、Apple Account 管理器、`images.comicine.com` 静态资源主机与跳转中继）运行在生产 Pages 项目 `comicine` 上，状态页与所有定时任务也是如此。该项目通过 `comicine.pages.dev` 提供访问，并承载全部生产自定义域名与加密运行配置。文档项目 `comicine-docs` 使用 `comicine-docs.pages.dev`。

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
  （门禁/跳转 i18n + 预加载资源）
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

每个请求都会检查已签名的 `__gate` cookie。Cloudflare 的 `botManagement.verifiedBot` 被视为经过验证的搜索引擎信任信号；任意伪造的 `Googlebot`/`GPTBot` User-Agent 字符串以及客户端自带的 `cf_clearance` cookie 都不能绕过门禁。边缘代码只信任生成的白名单（`docs/lists/whitelist.txt` → `functions/_data/gateTrust.ts`）来做完全绕过。

未验证的请求会**原地**获得 Turnstile 门禁页：主机与路径始终不变。中间件在请求的 URL 上以状态码 `403` 渲染 `public/<lang>/auth.html`，`POST /__gate/verify` 在同一来源上返回 `Set-Cookie: __gate=…`（1 小时，`Domain=.comicine.com`），随后页面重新加载最初的目标地址。`auth.comicine.com` 是门禁主机 —— 它在自己的根路径上提供同一个页面，且拥有 `/__gate/config|diag|verify` 端点。

每个渲染门禁的主机都由同一份边缘代码提供服务，因此不存在需要保持同步的第二套门禁实现。

中间件还会强制执行归一化后的 D1 黑名单，并记录隐私最小化的访客分析数据。门禁页为 `no-store`/`noindex`，并支持深色/浅色主题切换。用户已授予 `Turnstile Sites Write`，widget API 现在返回 HTTP 200，读回的主机列表包含 `comicine.com`。用户 2026-10-29 的截图来自 `comicine.pages.dev/?challenge=1`：Turnstile 显示成功，但 D1 记录 `/gate/verify` 返回 403 `hostname_rejected`，因为服务端按设计拒绝 Pages 主机作为正式公开主机。正式 `comicine.com` 上的真实浏览器挑战尚未确认成功。`auth.js` 会显示手动重试按钮并在浏览器控制台记录 Turnstile 数字错误码。不要关闭门禁，也不要把 Pages 主机加入正式主机 allowlist。

### 页面服务（干净 URL，无语言路径前缀）

`src/build.py` 以 4 种语言预渲染 `public/<lang>/`；门禁通过之后，中间件按 **cookie > Accept-Language > CF 区域 > en-US** 的顺序选择语言，并通过 `env.ASSETS.fetch()` 获取匹配的页面，从而保持 URL 干净：

- `comicine.com/` → 首页；`comicine.com/services` / `comicine.com/contact` → 对应页面
- `services.comicine.com/` → 服务页；`contact.comicine.com/` → 联系页（子域直接提供内容，不 301 到主站）
- `visitor.comicine.com/` → 访客面板（需要登录）；`account.comicine.com/apple` → Apple Account 管理器（需要登录）
- `images.comicine.com/` → 301 到 `comicine.com/`；其他路径提供作品集图片、favicon、logo 与二维码等静态资源。`image.comicine.com/portfolio/<img>` → 来自归一化 Worker 的加水印版本（其根路径也 301 到 `comicine.com/`）
- `www.comicine.com` → 301 到主站
- 根路径下的 `x.html` 别名在 `x` 是现有公开首页子域名（`services`、`contact`、`docs`、`status`）时返回 302 到 `x.comicine.com/`；名称无效时返回 302 到当前站点首页。`index.html` 返回当前主机的规范首页
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

只有数字、档位集合与 `bookable` 列来自 CSV；
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
  `public, max-age=300, stale-while-revalidate=3600` 与 `Vary: Accept-Language`。
  这里**不再声称边缘缓存**：Cloudflare 不缓存 Pages Functions 的响应
  （同一 URL 连续请求 `cf-cache-status` 恒为 `DYNAMIC`），所以共享缓存的生命周期指令是死配置；
  语言 cookie 也不放进 `Vary`，否则只会把浏览器缓存切得更碎。
- 第一方作品集缩略图与 favicon 使用 `images.comicine.com/static/...`
  （静态边缘缓存，绕过 Functions），而不是水印 Worker；
  二维码与外部热链图片
  仍然使用 `image.comicine.com`。
- 作品集原图永不发布：`/static/portfolio/<img>` 返回 404。
  只有干净的缩略图（`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`）
  与 `image.comicine.com` 上归一化、加水印的 `/portfolio/<img>` 是公开的；
  原图保留在被 git 忽略的 `src/static/portfolio/` 与私有 R2 桶
  `comicine-originals` 中（`ops/upload_originals.sh`）。
- Turnstile 验证有 3 秒的服务端超时，
  这样 Cloudflare 质询平台故障时会快速失败，
  而不是让用户最多卡住 8 秒。

### 当前部署与迁移状态

线上部署的形态，随时可用 `python3 ops/readme_facts.py --live` 重新读取：

1. **Pages**：生产项目 `comicine` 提供主站 Pages 主机，并拥有 `comicine.pages.dev` 与全部生产自定义域名。文档项目 `comicine-docs` 的默认别名为 `comicine-docs.pages.dev`，`docs.comicine.com` 指向该项目。`image.comicine.com` 使用水印 Worker，`fonts.comicine.com` 使用 R2；`status.comicine.com` 与 `sink.comicine.com` 由 Worker 提供。
2. **D1**：新主数据库 `comicine`（APAC）已创建并导入在用的运维表。Pages 生产与预览环境的绑定配置已指向新库；独立 Worker 的绑定随本次发布切换。最终导入保留 Apple Account 记录原值，并省略旧访客哈希和详细遥测。Sink 的 `comicine-sink` 数据库已导入，`comicine_sink` Analytics Engine dataset 已配置，Worker 已部署；短链冒烟验证待完成。
3. **Secret** 位于 **Pages → Settings → Environment variables → Encrypt**：Turnstile 两个密钥、`GATE_HMAC_KEY`、`SESSION_HMAC_KEY`、`OBSERVABILITY_HMAC_KEY`、`VISITOR_IP_KEY`、`APPLE_ACCOUNT_ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN` 与 `ACCESS_IDENTITY_AUD`；旧的 `ACCESS_ADMIN_AUDS` 和 `ACCESS_VIEWER_AUDS` 仍有配置但已无运行时代码读取，`APPLEID_ENCRYPTION_KEY` 与两个 `AUTHENTIK_*` 也是历史遗留
4. **Access**：`ComiCine` 保护 `identity.comicine.com/login`；visitor/account 使用共享身份交接。未使用的 `ComiCine-Admin` 应用已于 2026-10-29 删除；`admin.limooo.cn` 没有 DNS 记录或 Pages 域名。
5. **Worker** 独立运行：`comicine-status`、`comicine-blocklist-sync`、`comicine-d1-archive`、`comicine-image-watermark` 与 `comicine-sink`；Workers 账号子域为 `comicine.workers.dev`。`status.comicine.com`、`image.comicine.com` 与 `sink.comicine.com` 是 Worker 自定义域名。状态 Worker 使用 `comicine-status_ComiCineProbeStateV2`；确认新绑定可用后，已删除旧命名空间。Sink 的 D1 与 Analytics Engine dataset 已迁移；一条有效短链返回了带 Location 的 302。
6. **Cloudflare 规则**：当前没有启用的 WAF 或 Cache Rules；IP List 名为 `comicine_blocklist`，目前没有 WAF 过滤器引用。`.com` 区域的动态重定向阶段为空；旧 `.cn` 区域将 GET/HEAD 请求以 301、其他方法以 308 跳到对应 `.com` URL，并保留路径和查询参数。随后 `comicine.com/feishu/<path>` 与 `/lark/<path>` 由 Pages 返回 302，转到 `https://comicine.feishu.cn/<path>` 并保留路径和查询参数。
7. **冒烟检查**：部署后应核实 `https://comicine.com/_health`、`https://docs.comicine.com/`、`https://status.comicine.com/` 与 `https://sink.comicine.com/`。`https://comicine.com/?challenge=1` 上的真实浏览器挑战尚未确认成功。

> Cloudflare 账号显示名尚未更新：更名 API 请求被 Cloudflare 以权限不足拒绝。Turnstile API 权限现已生效，但正式 `.com` 主机上的真实浏览器挑战尚未确认成功。
注意：`?challenge=1` 返回 403 只证明门禁页已渲染，不证明 Turnstile 可验证。截图中的 `comicine.pages.dev` 被正式主机校验拒绝；需在 `comicine.com` 上确认验证结果。

门禁在每个主机上都原地渲染，门禁页与日志显示真实访客 IP，Access 仍是唯一的身份来源。
## 许可证

ComiCine 拥有并有权授权的原创材料依据 GNU Affero 通用公共许可证第 3 版或任何后续版本（AGPL-3.0-or-later）授权。GNU AGPL v3 第 7 条附加条款见 [ADDITIONAL_TERMS_zh_CN.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_zh_CN.txt)；该等附加条款适用于采用 GNU AGPL v3 的情形，后续版本是否适用取决于相应版本的条款。GNU AGPL v3 官方英文全文见 [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt)，简体中文参考译本见 [LICENSE_zh_CN.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_zh_CN.txt)。

ComiCine 是项目使用的开发品牌及公开署名；版权归属于依法享有相关权利的实际权利人。再分发时必须保留适用的作者署名和版权声明，包括合理的来源声明。遵守适用 GNU AGPL 版本即可进行商业使用。

额外授权或商标许可咨询：[contact@comicine.com](mailto:contact@comicine.com)。遵守适用 GNU AGPL 版本的商业使用无需额外申请授权。

关于第三方字体、依赖及二维码图片中的平台标识，请参阅[第三方声明](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES_zh_CN.md)；版权范围说明见[版权声明](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT_zh_CN.md)。
