---
aside: false
title: プロジェクト README
description: "ComiCine のウェブサイトと管理システム（Cloudflare 完全サーバーレス構成）のプロジェクト README"
---
<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->


# ComiCine

[comicine.com](https://comicine.com) で稼働する、完全サーバーレスの個人ウェブサイト兼管理システムです。公開ページ、人間検証ゲート、ビジターパネル、Apple Account マネージャー、監視、ステータスページは、すべて Cloudflare（Pages Functions、Workers、D1、R2）上で動作します。

## 機能

- **公開ページ**：ホーム、サービス、お問い合わせ、ポートフォリオ — 4 言語で事前レンダリングされ、ダーク／ライトテーマの切り替えに対応
- **人間検証（human verification）**：Turnstile ゲートページは、どのホストでも要求された URL に**その場で**レンダリングされます（クロスドメインへの遷移なし）— [ゲートの挙動](#ゲートの挙動)を参照
- **ビジターパネル（visitor panel）**（`visitor.comicine.com`）：Pages Function + D1 によるアクセス解析。ハッシュ化された訪問者識別子（一覧系 API は生の IP を返しません）、国、取得できる場合は ISP/ASN、ステータスコードの分布を表示し、ログインで保護されています
- 初回読み込み後は、訪問者ステータスのチップが新たな `/api/visitors` リクエストなしにローカルで絞り込まれます。API はディープリンク用に `?status=<3-digit>` も引き続き受け付けます。
- **Apple Account マネージャー**（`account.comicine.com/apple`）：Pages Function + D1 による CRUD で、ドラッグ＆ドロップによる並べ替えに対応。パスワードは Fernet で暗号化して保存し、一覧にはマスクされたパスワードのみを表示、一時的な平文表示も可能
- **認証とロール**：単一の `ComiCine` Access アプリが `identity.comicine.com/login` を保護します。identity ホストの Pages Function は JWT を検証し、登録済み送信元ホストに結び付いた短時間・1 回限りの D1 ハンドオフで本人情報を返します。送信元サイトの callback がローカル設定のロールを適用します。現在の両サイトは admin セッションを必要とします。
- **共有ログイン遷移**：未認証のブラウザーが保護ページを開くと HTTP 401 HTML を返し、同一オリジンの外部スクリプトが `identity.comicine.com/login` へ遷移します。その後 Cloudflare Access が `comicine.cloudflareaccess.com` 経由でログインさせます。API の認証失敗は JSON 401 のままです。
- **監視（monitoring）**：`comicine-status` Worker が HTTP/D1 のターゲットを毎分プローブ（probe）し、プローブがダウンしている間は 10 秒ごとに再確認して、結果を D1 に保存します。アラートは webhook（フォールバックとして Email binding）で送信されます
- **ステータスページ**（`status.comicine.com`）：同じ Worker が D1 からサーバーサイドレンダリングし、4 言語と明示的な `?lang=` 上書きに対応、プローブのエラーコードは 4 言語の対応表を持ち、ブランド化された 404/503 の故障ページも表示します。日ごとの稼働率は `probe_uptime_daily` ロールアップから取得します
- **自動 IP ブロック**：
  - D1 の `blocked_ips` が権威データです。`sync-worker` が有効な行を Cloudflare IP List に反映し、エッジで遮断します（オリジンがないため ipset/iptables はありません）
  - フォールバックとしてアプリケーション層のグローバルフィルタ — ブロックされた IP は直接 403 になります
- **統一リダイレクトページ**（`redirect.comicine.com/?to=<https-url>`、`/r` も可）：任意の HTTPS 宛先へリダイレクトする前に中間ページを表示します
- **ポートフォリオ画像の扱い**：原本は一切公開されません。公開されるのはウォーターマーク入りのフル画像（`image.comicine.com/portfolio/*`）とクリーンなサムネイルのみです

## 技術スタック

| レイヤー | 技術 | 実行環境 |
| --- | --- | --- |
| 公開ページ、ゲート、ビジターパネル、Apple Account マネージャー、ステータスページ | Pages Functions（`functions/`）+ 事前レンダリングされた静的 HTML | Cloudflare エッジ |
| データ | D1（訪問者分析、ブロックリスト、Apple Account アカウント、認証セッション、プローブ／ハートビート） | Cloudflare |
| 人間検証 | Cloudflare Turnstile、ゲートページをその場でレンダリング | Cloudflare + ブラウザ |
| 認証 | Cloudflare Access（Zero Trust JWT、Pages Function が自ら検証） | Cloudflare |
| 監視とデータ保持 | `ops/status-worker`（Cron Triggers + Durable Object alarms） | Cloudflare Workers |
| D1 アーカイブ | `ops/d1-archive`（毎日の cron） | Cloudflare Workers |
| ブロックリスト同期 | `ops/sync-worker`（日次 cron → Cloudflare IP List） | Cloudflare Workers |
| 画像ウォーターマーク | `ops/image-watermark`（パスを正規化するプロキシ） | Cloudflare Workers |
| 静的アセット／原本バックアップ | Pages アセットサーバー + プライベート R2 バケット `comicine-originals` | Cloudflare |
| デプロイ | `ops/deploy.sh`（git + `ops/pages_deploy.sh` + `ops/workers_deploy.sh`） | ローカル |

## プロジェクト構成

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
├── LICENSE.txt                                        # GNU AGPL v3 公式英文本文
├── ADDITIONAL_TERMS.txt                               # Section 7 の追加条項
├── ADDITIONAL_TERMS_zh_CN.txt                         # 簡体字中国語訳
├── ADDITIONAL_TERMS_ja_JP.txt                         # 日本語訳
├── ADDITIONAL_TERMS_ko_KR.txt                         # 韓国語訳
├── COPYRIGHT.md                                      # 著作権およびライセンス（英語）
├── COPYRIGHT_zh_CN.md                                # 簡体字中国語訳
├── COPYRIGHT_ja_JP.md                                # 日本語訳
├── COPYRIGHT_ko_KR.md                                # 韓国語訳
├── THIRD_PARTY_NOTICES.md                            # 第三者表示（英語）
├── THIRD_PARTY_NOTICES_zh_CN.md                      # 簡体字中国語訳
├── THIRD_PARTY_NOTICES_ja_JP.md                      # 日本語訳
├── THIRD_PARTY_NOTICES_ko_KR.md                      # 韓国語訳
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

## クイックスタート

```bash
# package-lock.json で固定された Node 依存関係をインストールします
npm ci

# 静的サイトをビルドします（Python 仮想環境 + コントラクト検証 + public/ + preview/）
npm run build
```

`npm run build` は `ops/build.sh` です。リポジトリ外に
`/tmp/comicine-build-venv` を作成し、`requirements.lock` の固定依存関係をインストールして、
レンダリング前に実行環境間の設定を検証します。作品の透かしは Pillow と
`src/static/icons/comicine-watermark.png` で生成するため、システムの Cairo ライブラリは不要です。
レンダラーを直接実行する場合は、固定された Python 依存関係をインストールしてから
`COMICINE_BUILD=1 python3 src/build.py` を実行してください。

生成されたサイトをローカルでプレビューするには、ビルドして `preview/` の出力を開きます。

## ビルド、テスト、デプロイ

クリーンなローカルビルドには、デプロイスクリプトと同じ依存関係セットを使用します：

```bash
cd site
npm ci
npm run build
```

`src/build.py` は `public/<lang>/*.html`、`public/static/`、
`functions/_data/i18n.ts`、`functions/_data/runtime.ts`、`preview/` を再生成します。
これらの出力を手で編集しないでください。`locales/*.json`、テンプレート、静的ソースを変更して再ビルドします。
`src/static/tailwind.css` はリポジトリにコミット済みの Tailwind ビルド済み出力です。
`npm run build` は `ops/build.sh` を使用し、これが `/tmp/comicine-build-venv` を作成して
 `public/manifest.json`（ビルド成果物のハッシュ証跡）を生成します。

Pages の出力だけをデプロイするには：

```bash
# build + validate only, no Cloudflare writes
bash ops/pages_deploy.sh --build-only

# build + validate + deploy Pages + smoke test (/_health must be 200)
bash ops/pages_deploy.sh

# full deploy: (1) commit (2) push (3) deploy Pages + docs + Workers
bash ops/deploy.sh --all
```

**デプロイ入口**：`ops/deploy.sh` が唯一のデプロイ入口です — commit + push +
Pages + docs を実行し、`--worker=<name>` で単一の Worker も配布できます。
`ops/pages_deploy.sh` がビルド + Pages を担当します。
`--dry-run` はどのリモートにも書き込まずに計画を出力します。

既定では `deploy.sh` は**静か（quiet）**です。1 ステップにつきステータス 1 行を出力し、そのステップの完全なログは
失敗したときにだけ吐き出されます。`--full` を付けるとすべてをストリーム出力します（ビルドマニフェスト、
成果物の数、wrangler のアップロード進捗）。どちらでもフラグとステップは同一で、
`--full` は冗長さだけを変えます。

認証情報はローカルの `secrets/webauthn.env` から読み込みます（コミットされず、
エコーもされません）。ssh / rsync / リモート systemd のステップはありません。
`ops/migrate_d1.sh` と `ops/workers_deploy.sh` も `--dry-run` に対応しています。

自動テストの入口を用意しています：

```bash
# Python テスト
python3 -m pytest

# Pages Functions, Workers and image-watermark tests
npm test
```

## 環境変数

デプロイスクリプトが `secrets/webauthn.env` から読み込み、Git にはコミットされません。Pages ランタイムは独自のシークレット群を持ちます（後述のエッジのセクションを参照）。

| 変数 | 説明 |
| --- | --- |
| `GATE_HMAC_KEY` | `__gate` cookie 用の HMAC-SHA256 鍵。エッジで発行・検証します |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | `ops/d1_client.py`、`ops/pages_deploy.sh`、`ops/workers_deploy.sh` が使う Cloudflare API アクセス |

鍵素材はリポジトリの外に置きます。`apple_account_encryption.key` は Apple Account のパスワードと
暗号化された訪問者 IP カラムに使う Fernet 鍵です。

## Cron ジョブ

スケジューリングはすべて Cloudflare 上にあり、各 Worker の `wrangler.toml` で
宣言された Worker Cron Triggers として動作します：

| スケジュール | Worker | ジョブ |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 毎分の HTTP/D1 プローブ。プローブがダウンしている間は Durable Object のアラームが 10 秒ごとに再確認し、状態変化時にアラートします |
| `47 3 * * *` | `ops/status-worker` | D1 のデータ保持（`src/retention.ts`）：`ray_log_v2`（7 日）、`visitors_v2`（30 日）、`visitor_rollups`（30 日）、`heartbeats`（30 日）、`events`（90 日）、`probe_uptime_daily`（90 日）、`auth_sessions`（60 日）、`identity_handoffs`（1 日）を削除します |
| `30 3 * * *` | `ops/sync-worker` | 有効な D1 `blocked_ips` の行を Cloudflare IP List `comicine_blocklist` に反映します |
| `0 0 * * *` | `ops/d1-archive` | D1 のスナップショット／アーカイブ |

`python3 ops/readme_facts.py --check` は上記のスケジュール、保持期間、TTL、ディレクトリツリーを
リポジトリから読み直し、このページと食い違えば失敗します。`--live` はデプロイ済みの状態
（D1 の件数、Pages のホストとシークレット、DNS、WAF、Worker のスケジュール）を Cloudflare
から読みます。

TLS 証明書は Cloudflare が Pages のカスタムドメイン向けに発行・更新します。
`ops/migrate_d1.sh` と `ops/workers_deploy.sh` は手動実行用で、
`--dry-run` に対応したメンテナンスの入口です。

## デプロイ

デプロイ対象は本番 Pages プロジェクト `comicine-production`、エイリアス用プロジェクト `comicine`、Docs プロジェクト `comicine-docs`、および独立した Workers です。本番プロジェクトは `limooo.pages.dev`、既存のカスタムドメイン、暗号化済みランタイム設定を維持します。独立した `comicine.pages.dev` プロジェクトは、パス、クエリ、リクエストメソッドを保ったまま `https://comicine.com` へ 308 リダイレクトします。Docs のエイリアスは `comicine-docs.pages.dev`、Workers のアカウントサブドメインは `comicine.workers.dev` です。
リポジトリのルートから：

```bash
cd site
bash ops/deploy.sh              # with no arguments = --all (full deploy, see below)
bash ops/deploy.sh --all        # commit + push + deploy Pages + docs + Workers
bash ops/deploy.sh --pages      # deploy production Pages + the comicine.pages.dev alias
bash ops/deploy.sh --docs       # deploy docs.comicine.com only
bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker
bash ops/deploy.sh --all --full             # same, but stream every step's output
```

`ops/deploy.sh` を**引数なしで実行すると、それは正確に `--all`** です：commit + push +
 Pages + docs、すなわち「完全デプロイ（full deploy）」の契約です。すでにローカルでコミット済みのものだけを配信するには、
`--pages` / `--docs` を明示的に指定します。

出力は既定で静かです（1 ステップにつきステータス 1 行）。`--full` を付けると全工程を確認できます。
`--dry-run` は上記のフラグのどの組み合わせでも動作します。

認証情報はローカルの `secrets/webauthn.env` から読み込みます。すべてのステップは
Cloudflare API か Git 経由で実行されます。

### ドキュメントサイト（docs.comicine.com）

`site/docs/` は**サブドメインごとのコンテナ**です：`docs/` には docs.comicine.com の
 VitePress ルート（1 ページ 1 言語につき 1 つの markdown ファイル）が入り、`services/` には
 services.comicine.com の価格表 CSV が入ります。言語コードは URL の**最後**のセグメントで、
内容ページは常に明示的に付けます（`/README/zh-cn`、`/README/en-us`）。サフィックスなしの
`/README` は `/README/zh-cn` へ 302 で転送されます。ドキュメントサイトのルート `/` は `https://comicine.com` へ 302 で転送されます。

`.vitepress/rewrites.json`（コンテンツの隣）がソースをサフィックス付きルートにマッピングし、
`.vitepress/config.mts` が `additionalConfig` を通じて各ページに固有の `lang` / `themeConfig` を与えます。
ページを追加するには、各言語ディレクトリに markdown ファイルを 1 つ置き、
rewrites のエントリと `public/_redirects` のサフィックスなしパス用 302 を 1 行足します —
markdown ファイルに HTML が出力されないと `ops/docs_check_output.py` がビルドを失敗させます。

サイトはフォーク `ComiCine/vitepress` の VitePress でビルドします。ヘッダーとフッターはフォーク側
（`VPComiCineNav.vue` / `VPComiCineFooter.vue`）にあり、メインサイトの `base.html` / `_footer.html` を忠実に再現しています —
 編集はフォークで行えば次のデプロイが反映します（フォークはコミットが変わったときだけ再ビルドされます。
フォークの作業ツリーからビルドするには `COMICINE_VITEPRESS_FETCH=0` を使います）。
サイトは独立した Cloudflare Pages プロジェクト（`comicine-docs`）なので
メインサイトの成果物には一切触れず、
`user_lang_preference` / `comicine_theme` cookie をメインサイトと共有します。

```bash
bash ops/docs_deploy.sh --build-only   # build + validate only
bash ops/docs_deploy.sh --dev          # local VitePress dev server
```

## セキュリティ設計

- セッション cookie は `Secure` + `HttpOnly` + `SameSite=Lax` を使用し、現在のホストのみに限定されます。これによりセッション cookie を他のサイトで再利用できません。
  すべてのセッションは D1 `auth_sessions` に記録されたランダムな `sid` を持ち、`requireAuth` は
  失効・期限切れのセッションを拒否します。実行時に HMAC 鍵がない場合や `auth_sessions` テーブルが利用できない場合は、
  503 でフェイルクローズ（fail closed）します。
- ゲートも同様にフェイルクローズします。`TURNSTILE_SECRET`、`GATE_HMAC_KEY`、
  `SESSION_HMAC_KEY` のいずれかが空の場合、エッジはページをレンダリングしたり署名のない
   cookie を発行したりせず、503 を返します。
- `__gate` cookie は `<unix-expiry>.<HMAC-SHA256 hex>` です（TTL 1 時間、`HttpOnly`、
  `Domain=.comicine.com`）。発行と検証はすべてエッジで行います。
- 未認証で保護ページを開くと、送信元サイトは短時間有効な state cookie を設定した HTTP 401 HTML を返します。同一オリジンの外部スクリプトが `identity.comicine.com/login` へ遷移し、Cloudflare Access が `comicine.cloudflareaccess.com` 経由でログインさせます。API の認証失敗は JSON 401 のままです。identity ホストの Pages Function は `Cf-Access-Jwt-Assertion`（RS256、JWKS は 1 時間キャッシュ）を検証し、送信元ホストと state に結び付いたハッシュ化済みの一回限りの D1 コードを作成します。送信元サイトの callback がサーバー間でコードを消費し、ローカル設定のロールを適用します。handoff にロールは含まれません。現在の visitor と account の両サイトでは API が admin セッションを要求します。
- 鍵と暗号文は別々に保管し、リポジトリには決してコミットしません
- ブロックの層：アプリ層の D1 ブロックリストがエッジで 403 を返し、`ops/sync-worker` が
  有効な行を Cloudflare IP List `comicine_blocklist` に追随させます（WAF ルールが使う想定ですが、
  そのカスタムルールは現在デプロイされていません）
- 管理操作（作成／更新／削除）には admin ロールが必要で、viewer は読み取り専用です
- 訪問者の IP を一覧系 API が返すことはありません。完全な IP は `visitor_rollups.ip_enc` に
   Fernet で暗号化して保存し、admin 向けに 1 行ずつ復号します

## ホワイトリスト

信頼するソースは [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt) で手動管理し、デプロイ時に生成ファイル [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt) へ反映します。

| エントリ | 効果 |
| --- | --- |
| `ASN/<number>` | 任意の Cloudflare ゾーン単位 ASN Access Rule エントリです。ゾーンルールを変更するには `bash ops/waf_whitelist.sh --apply` を手動実行します。ASN エントリは Pages Functions のゲートを迂回しません。 |
| `IP-CIDR/<ip>/<mask>` | Pages エッジで完全に許可されるソースです（例：`IP-CIDR/97.64.18.11/32`）。IPv4 は `/24`–`/32`、IPv6 は `/64`–`/128` のプレフィックスのみ許可され、ブロックリストとチャレンジゲートの両方をスキップします。 |

現在の生成リストには **ASN が 0 件**、**IP-CIDR が 2 件**あります。通常のデプロイはローカルのホワイトリストを生成しますが、ゾーン単位の ASN Access Rules は変更しません。`own-ips.txt` の編集後、デプロイ時に `ops/sync_whitelist.py` を実行し、その後ビルドで `ops/check_gate_trust.py --emit` がエッジ用ファイルを生成します。

## 唯一の情報源

- ユーザー向けの文字列：`locales/*.json`。`functions/_data/*` と API の i18n ルートはそこから生成されます。
- 共有ランタイム定数：`config-contract.json` がランタイム横断で合意された契約です。`src/config.py` と生成物 `functions/_lib/config.ts` の双方がこれを消費し、`ops/check_config_contract.py` が一致を強制します。
- ゲート／リダイレクトの文言：`locales/*.json` を `functions/_data/runtime.ts` 経由で。`src/build.py` がそれを組み立てます。
- D1 のスキーマとマイグレーション：`ops/migrations/*.sql`。ブロックの権威は `blocked_ips` のみです。
- セキュリティレスポンスヘッダーの基準（有効時）：`ops/security-headers.json`。
- デプロイとランタイムの境界：`ops/deploy.sh`。ランタイムは Cloudflare Pages と Workers のみです。

## Cloudflare Pages ランタイム

公開サイト（ホーム／サービス／お問い合わせ、ゲート、訪問者パネル、Apple Account 管理、`images.comicine.com` 静的アセットホスト、リダイレクト中継）は本番 Pages プロジェクト `comicine-production` で動作し、ステータスページとすべての定期ジョブも同様です。本番プロジェクトは `limooo.pages.dev`、既存のカスタムドメイン、暗号化済みランタイム設定を維持します。独立した `comicine` Pages プロジェクトの `comicine.pages.dev` は、パス、クエリ、リクエストメソッドを保ったまま `https://comicine.com` へ 308 リダイレクトします。Docs Pages プロジェクトは `comicine-docs.pages.dev` を使用します。

ランタイムの分担：

| レイヤー | 技術 |
| --- | --- |
| エッジ／人間検証 | Pages Functions（`functions/_middleware.ts`） |
| Pages | ビルド時に事前レンダリングされた静的 HTML（多言語） |
| データ | D1（訪問者分析、ブロックリスト、Apple Account 管理、認証セッション） |
| 人間検証 | Cloudflare Turnstile、ゲートページをその場でレンダリング |
| 独立した Workers | `status.comicine.com`（`comicine-status`：プローブ、ステータスページ、データ保持）、`image.comicine.com`（`comicine-image-watermark`）、`comicine-blocklist-sync` |

### ビルドとディレクトリ構成

- `python3 src/build.py`：4 言語のページを `public/` に事前レンダリングし、
  `locales/*.json` を `functions/api/i18n/[lang].ts` としてインライン化し、共有の
   `functions/_data/runtime.ts`（ゲート／リダイレクトの i18n + プリロードアセット）を生成します
- `ops/migrations/001_init.sql`：D1 の初期スキーマ（`apple_accounts` / `blocked_ips` / `visitors`）
- `ops/export_d1.py`：D1 取り込み用 SQL を生成（出力は `ops/out/`、git 管理外）
- `ops/migrations/007_visitor_status_indexes.sql`：訪問者ステータスの絞り込み用に `(status, ts)` と `(status, ip_hash, ts)` インデックスを追加します
- `ops/sync-worker/`：毎日 03:30 の Worker cron が有効な D1 `blocked_ips` の行を Cloudflare IP List に同期します。`auto_block.py cf` は明示的なメンテナンス専用です

### 環境変数

**Pages プロジェクト設定 → 環境変数 → Encrypt（Secret）**で設定し、リポジトリにはコミットしません：

| 変数 | 目的 |
| --- | --- |
| `TURNSTILE_SITEKEY` | ゲートページの Turnstile ウィジェットの公開 sitekey |
| `TURNSTILE_SECRET` | サーバー側 siteverify のシークレット |
| `GATE_HMAC_KEY` | `__gate` cookie 用の HMAC-SHA256 署名鍵（`openssl rand -hex 32`） |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access のチームドメイン。検証に使う JWT の `iss` でもあります |
| `ACCESS_IDENTITY_AUD` | 単一 `ComiCine` Access アプリの AUD。ロールは `config-contract.json` の送信元ホストマップで決まります |
| `VISITOR_IP_KEY` | 暗号化された訪問者 IP 完全版カラム（`visitor_rollups.ip_enc`）用の Fernet 鍵 |
| `OBSERVABILITY_HMAC_KEY` | プライバシー最小化された訪問者 IP ハッシュの HMAC 鍵（`functions/_lib/tracking.ts`）。未設定だとゲートがフェイルクローズします |
| `SESSION_HMAC_KEY` | Pages のセッション cookie 署名鍵（`GATE_HMAC_KEY` とは別） |
| `APPLE_ACCOUNT_ENCRYPTION_KEY` | Fernet 鍵（`secrets/apple_account_encryption.key` から） |

ローカル開発：`.dev.vars.example` を `.dev.vars` にコピーして実際の値を記入します（git 管理外）。`ops/sync-worker` 用の `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` は `wrangler secret put` で設定します。

### ゲートの挙動

すべてのリクエストで署名済み `__gate` cookie を確認します。Cloudflare の `botManagement.verifiedBot` は検証済み検索エンジンの信頼シグナルとして受理されますが、任意の `Googlebot`/`GPTBot` の User-Agent 文字列やクライアントが送ってきた `cf_clearance` cookie がゲートを迂回することはありません。エッジコードが完全なバイパスを認めるのは、生成されたホワイトリスト（`docs/lists/whitelist.txt` → `functions/_data/gateTrust.ts`）にある IP-CIDR だけです。

未検証のリクエストには Turnstile ゲートページを**その場で**返します。ホストもパスも変わりません。ミドルウェアは要求された URL に `public/<lang>/auth.html` をステータス `403` でレンダリングし、`POST /__gate/verify` が同じオリジンで `Set-Cookie: __gate=…`（1 時間、`Domain=.comicine.com`）を返し、その後ページが元のターゲットを再読み込みします。`auth.comicine.com` はゲートのホストです — 自身のルートで同じページを配信し、`/__gate/config|diag|verify` エンドポイントを持ちます。

ゲートをレンダリングするすべてのホストは同じエッジコードで配信されるため、同期させる 2 つ目のゲート実装はありません。

ミドルウェアは正規化された D1 ブロックリストも適用し、プライバシーを最小化した訪問者分析を記録します。ゲートページは `no-store`/`noindex` で、ダーク／ライトテーマの切り替えに対応します。Cloudflare ダッシュボードのスクリーンショットでは Turnstile の許可ホストに `comicine.com` が表示されていますが、`.com` のチャレンジはまだ失敗し、`/gate/verify` に token が届くことを確認できていません。`auth.js` は手動再試行ボタンを表示し、ブラウザーコンソールに Turnstile の数値エラーコードを記録します。設定済み API 資格情報では widget の読み取りと更新が HTTP 403 / error `10000` となり、API から設定を確認できません。ゲートを無効にせず、実際のブラウザーチャレンジが `/gate/verify` に届くか確認してください。

### ページ配信（クリーン URL、言語パスプレフィックスなし）

`src/build.py` が `public/<lang>/` を 4 言語で事前レンダリングします。ゲート通過後、ミドルウェアは **cookie > Accept-Language > CF region > en-US** の順で言語を選び、`env.ASSETS.fetch()` で該当ページを取得して URL をクリーンに保ちます：

- `comicine.com/` → ホームページ、`comicine.com/services` / `comicine.com/contact` → それぞれ対応するページ
- `services.comicine.com/` → サービスページ、`contact.comicine.com/` → お問い合わせページ（サブドメインはメインサイトへの 301 なしで直接コンテンツを配信します）
- `visitor.comicine.com/` → ビジターパネル（要ログイン）、`account.comicine.com/apple` → Apple Account マネージャー（要ログイン）
- `images.comicine.com/` → `comicine.com/` へ 301、その他のパスはポートフォリオ画像、favicon、ロゴ、QR などの静的アセットを配信します。`image.comicine.com/portfolio/<img>` → 正規化 Worker によるウォーターマーク版（そのルートも `comicine.com/` へ 301）
- `www.comicine.com` → メインサイトへ 301
- ルート直下の `x.html` は、`x` が公開ホームページを持つ稼働中のサブドメイン（`services`、`contact`、`docs`、`status`）なら `x.comicine.com/` へ 302 で転送し、不明な名前なら現在のサイトのホームへ 302 で転送します。`index.html` は現在のホストの正規ホームへ転送します。
- ナビのリンクは絶対サブドメイン URL（`https://services.comicine.com` など）を維持します。言語切り替えは純粋にフロントエンドの `applyLang()` で、リロードも URL 変更もありません

### services.comicine.com の価格表（CSV 駆動）

サービスの価格表は**マークアップではなくデータ**です：`src/build.py` はレンダリングのたびに
 `docs/services/*.csv` を読み（`src/services_pricing.py`）、`src/templates/services.html` の
プラングリッドを埋めます。価格を変更するには CSV を編集してデプロイするだけです —
 テンプレートの編集は不要です。

| ファイル | 列 | 埋める内容 |
| --- | --- | --- |
| `docs/services/convention.csv` | `shots,price[,bookable]` | 01 Convention、撮影枚数のティアごとにカード 1 枚 |
| `docs/services/outdoor.csv` | `type,people,price[,bookable]` | 02 Outdoor、スタジオ／屋外 × 1 人／2 人 |

CSV から取得するのは数値、ティアの集合、受付可否だけです。ラベル、
単位の接尾辞、注記ブロックは引き続き `locales/*.json` から取得します
（`plan_studio_solo`、`unit_per_shot` など）。

**`bookable`（任意の列）** は、取り消し線付きの価格スタイルと
注記ブロックのスタジオ行の両方を制御します：

- ティアごと：`no` → そのティアの価格は
   `class="plan-price strikethrough"` でレンダリングされます。`yes`、空のセル、または列自体が
  存在しない → 通常の価格
- 注記ブロック：**すべての** `studio` ティアが `no` なら、スタジオ行は一時停止の文言
  （`studio_paused`）を表示します。予約可能なスタジオティアが 1 つでもあれば、代わりに
   `studio_bookable` を表示します

つまり「一時的に受付停止」は端から端までデータです：`outdoor.csv` で `studio` を `no` から `yes` に変えれば、
次のデプロイで取り消し線*と*一時停止の注記の両方が消え、
テンプレートもロケールも編集する必要はありません。両者が食い違うことは決してありません。
それ以外の値（例：`maybe`）は黙って推測せず、ビルドを失敗させます。

**`price` が正の整数でない場合は `-` としてレンダリングされます。** プレースホルダーの
許可リストはありません。空欄、`N/A`、`TBD`、打ち間違い（`1OO`）、`0`、負の数は
いずれも「価格未公開」を意味します。カードは `CNY` プレフィックスと単位の接尾辞を
保ったまま数値だけが `-` になります（`CNY - / 枚`）。レイアウトは数値のティアと
まったく同じです。`-` は `0` でも「無料」でもありません。1 つのファイルにこのような
セルと数値の行を混在させても問題ありません。

契約の残りの部分は次のとおりです：

- convention の行は CSV の**撮影枚数の昇順**で並びます。ティアの数は
  固定ではありません（12 枚の行を追加してもコード変更は不要）
- convention のティアに単位の接尾辞が付くのは
   `CONVENTION_UNIT_KEYS` に登録されている場合だけです。未登録のティアは価格のみをレンダリングします
- outdoor の行は 4 つの `type/people` の組み合わせをすべて網羅する必要があります。行の順序に関係なく
  固定の順序（スタジオ 1 人／2 人、次に屋外 1 人／2 人）でレンダリングされます

ファイルの欠落、列の誤り、ティアの重複、未知のティア、認識できない `bookable` の値は
**ビルドを失敗させます** — 誤った価格表はビルドの失敗よりも悪いからです。価格セルだけは
ビルドを失敗させません。正の整数として解釈できない内容はすべて `-` として
レンダリングされます。
`tests/test_services_pricing.py` はこれらのすべてのケースと、コミットされた CSV に対するラウンドトリップ
検査をカバーします。

`docs/services/` は VitePress のビルドから除外されるため（`docs/.vitepress/config.mts` の
 `srcExclude`）、CSV はデータソースのままで、
docs.comicine.com に公開されることはありません。

### パフォーマンス／エッジキャッシュ

- `public/_routes.json` は `/static/*` とルートの静的アセットを Pages
   Functions から除外するため、CSS/JS/フォントは Pages アセットサーバーが直接配信します。
- `src/static/files/` 内のファイルはビルド出力の `/public/files/` に元の階層を保ってミラーされ、`src/static/files/<path>` は `https://comicine.com/public/files/<path>` で配信されます。
  `/public/files/*` は Pages Functions を迂回し、静的アセットと同じ1日キャッシュを使用し、存在しないパスは404を返します。
- `public/_headers` はバージョン付きの静的アセットに
   `stale-while-revalidate` 付きの長いブラウザキャッシュを与えます。`public/_routes.json` と `_headers` は
  どちらも `src/build.py` が生成します。
- 事前レンダリングされた公開 HTML は**プロセス内ページキャッシュ**で再利用されます
  （キーは host + 言語）。レスポンスは `public, max-age=300, stale-while-revalidate=3600` と
  `Vary: Accept-Language` を通知します。ここで**エッジキャッシュは主張しません**：
  Cloudflare は Pages Functions のレスポンスをキャッシュしないため
  （同じ URL への連続リクエストでも `cf-cache-status` は `DYNAMIC` のまま）、
  共有キャッシュ向けの寿命ディレクティブは死んだ設定になります。言語 cookie も `Vary` に入れません
  （ブラウザキャッシュが細分化されるだけだからです）。
- ファーストパーティのポートフォリオサムネイルと favicon は、
  ウォーターマーク Worker ではなく `images.comicine.com/static/...`（静的エッジキャッシュ、Functions を迂回）
  を使用します。QR コードと外部から直リンクされた画像は
  引き続き `image.comicine.com` を使用します。
- ポートフォリオの原本は一切公開されません：`/static/portfolio/<img>` は 404 を返します。
  公開されるのはクリーンなサムネイル（`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`）と、
  `image.comicine.com` の正規化・ウォーターマーク済み `/portfolio/<img>` だけです。
  原本は git 管理外の `src/static/portfolio/` とプライベート R2 バケット
   `comicine-originals`（`ops/upload_originals.sh`）に残ります。
- Turnstile の検証にはサーバー側で 3 秒のタイムアウトがあるため、
  Cloudflare のチャレンジ基盤の障害時はユーザーを最大 8 秒待たせず、
  素早くフェイルクローズします。

### 本番の状態

デプロイ済みの構成です。`python3 ops/readme_facts.py --live` でいつでも読み直せます：

1. **Pages**：本番プロジェクト `comicine-production` がメインサイトの Pages ホストを提供し、`limooo.pages.dev`、既存のカスタムドメイン、暗号化済みランタイム設定を維持します。独立した `comicine` プロジェクトが `comicine.pages.dev` を提供し、パス、クエリ、リクエストメソッドを保ったまま `https://comicine.com` へ 308 リダイレクトします。Docs プロジェクトは `comicine-docs`、既定エイリアスは `comicine-docs.pages.dev` で、`docs.comicine.com` が配信します。`image.comicine.com` は透かし Worker、`fonts.comicine.com` は R2、`status.comicine.com` と `sink.comicine.com` は Worker が提供します。
2. **D1**：メイン DB は `limooo`（APAC）、Sink は `sink-limooo` と既存 Analytics Engine dataset `sink_limooo` です。ステータス Durable Object は既存の状態名前空間を保持します。これらは表示用名称ではなく稼働中の技術 ID で、D1 はその場で改名できず、変更にはデータ移行と切り替えが必要です。022 は適用済み、021 は未適用です。023 で Apple Account のメールアドレスを新ドメインへ移行します。
3. **シークレット**は **Pages → Settings → Environment variables → Encrypt** にあります：Turnstile の 2 つ、`GATE_HMAC_KEY`、`SESSION_HMAC_KEY`、`OBSERVABILITY_HMAC_KEY`、`VISITOR_IP_KEY`、`APPLE_ACCOUNT_ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_IDENTITY_AUD`。旧 `ACCESS_ADMIN_AUDS` と `ACCESS_VIEWER_AUDS` は設定に残っていますが、ランタイムでは読みません。`APPLEID_ENCRYPTION_KEY` と 2 つの `AUTHENTIK_*` も同様に未使用です
4. **Access**：`ComiCine` は `identity.comicine.com/login` を保護し、visitor/account は共有 identity handoff を使います。未使用の `ComiCine-Admin` アプリ名はすでに新ブランドですが、DNS と Pages ドメインのない旧 `admin.limooo.cn` ホストを参照しています。
5. **Worker** は独立して稼働します：`comicine-status`、`comicine-blocklist-sync`、`comicine-d1-archive`、`comicine-image-watermark`、`comicine-sink`。Workers アカウントのサブドメインは `comicine.workers.dev` です。`status.comicine.com`、`image.comicine.com`、`sink.comicine.com` は Worker カスタムドメインです。状態を保護するため、Status Durable Object の既存技術名前空間は維持します。
6. **Cloudflare のルール**：現在、有効な WAF と Cache Rules はありません。IP List は `comicine_blocklist` で、参照する WAF フィルターはありません。`.com` の動的リダイレクトフェーズは空です。旧 `.cn` は GET/HEAD を 301、他のメソッドを 308 で対応する `.com` URL に転送し、パスとクエリを保持します。その後、`comicine.com/feishu/<path>` と `/lark/<path>` は Pages 経由で 302 を返し、`https://comicine.feishu.cn/<path>` に転送してパスとクエリを保持します。
7. **スモークチェック**：各リリース後に `https://comicine.com/_health`、`https://docs.comicine.com/`、`https://status.comicine.com/`、`https://sink.comicine.com/` を確認します。スクリーンショットでは Turnstile に `.com` ホストが登録済みですが、実際のブラウザーチャレンジが `/gate/verify` に届くことを確認してください。

> Cloudflare アカウントの表示名はまだ更新されていません。権限不足のため名前の変更は拒否されました。現在の API Token は Turnstile 設定を読み取れません。スクリーンショットでは `.com` ホストが登録済みですが、検証成功は未確認です。
注意：`?challenge=1` の 403 はゲートページが表示されたことだけを確認し、Turnstile の検証成功を示しません。ブラウザーで実際にチャレンジを完了し、`/gate/verify` が成功することを確認してください。

ゲートはどのホストでもその場でレンダリングされ、ゲートページとログに実際の訪問者 IP が表示され、Access が唯一のアイデンティティ源であり続けます。
## ライセンス

ComiCine が著作権を有し、ライセンスする権限を有するオリジナル資料は、GNU Affero General Public License 第 3 版またはそれ以降のバージョン（AGPL-3.0-or-later）に基づいて提供されます。GNU AGPL v3 第 7 条に基づく追加条項は [ADDITIONAL_TERMS_ja_JP.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ja_JP.txt) を、GNU AGPL v3 の本文は [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt) を参照してください。追加条項は GNU AGPL v3 を選択する場合に適用され、後続バージョンでの適用はそのバージョンの条件によります。

ComiCine は、本プロジェクトで使用する開発ブランドおよび公開上の表示です。著作権は、法的に該当する権利を有する実際の権利者に帰属します。再配布時には、適用される作者表示および著作権表示（合理的な出典表示を含む）を保持してください。適用される AGPL バージョンの条件に従う限り、商用利用が認められます。

追加の許諾または商標許可に関するお問い合わせ：[contact@comicine.com](mailto:contact@comicine.com)。適用される GNU AGPL バージョンに従う商用利用に追加の許諾申請は必要ありません。

第三者フォント、依存関係、および QR コード画像内のプラットフォーム標章については[第三者表示](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES_ja_JP.md)を、著作権の範囲については[著作権表示](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT_ja_JP.md)を参照してください。
