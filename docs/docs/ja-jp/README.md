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
- **共有ログイン遷移**：未認証のブラウザーが保護ページを開くと、中間ページや外部スクリプトを挟まず 302 で `identity.comicine.com/login` へ遷移します。その後 Cloudflare Access が `comicine.cloudflareaccess.com` 経由でログインさせます。API の認証失敗は JSON 401 のままです。
- **監視（monitoring）**：`comicine-status` Worker が HTTP/D1 のターゲットを毎分プローブ（probe）し、プローブがダウンしている間は 10 秒ごとに再確認して、結果を D1 に保存します。アラートは webhook（フォールバックとして Email binding）で送信されます
- **ステータスページ**（`status.comicine.com`）：同じ Worker が D1 からサーバーサイドレンダリングし、4 言語と明示的な `?lang=` 上書きに対応、プローブのエラーコードは 4 言語の対応表を持ち、ブランド化された 404/503 の故障ページも表示します。日ごとの稼働率は `probe_uptime_daily` ロールアップから取得します
- **自動 IP ブロック**：
  - D1 の `blocked_ips` が権威データです。`sync-worker` が有効な行を Cloudflare IP List に反映し、エッジで遮断します（オリジンがないため ipset/iptables はありません）
  - フォールバックとしてアプリケーション層のグローバルフィルタ — ブロックされた IP は直接 403 になります
- **統一リダイレクトページ**（`redirect.comicine.com/?to=<https-url>`、`/r` も可）：任意の HTTPS 宛先へリダイレクトする前に中間ページを表示します
- **ポートフォリオ画像の扱い**：原本は一切公開されません。サイトではクリーンなサムネイルと静的アセットを使用します。ウォーターマーク Worker は直接アクセスや旧画像 URL 用に稼働を継続しますが、サイトのページからは呼び出しません。

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

これらのレイヤーがどのようにつながるか — リクエストパイプライン、identity ハンドオフ、ドキュメントサイトのビルド、独立した Workers、生成される成果物 — は、[ARCHITECTURE.md](https://github.com/ComiCine/ComiCine-website/blob/main/ARCHITECTURE.md) で説明しています。

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
├── ARCHITECTURE.md                                   # request flow, identity, Workers and build artifacts (English)
├── SECURITY.md                                       # threat model, trust tiers and key handling (English)
├── LICENSE.txt                                        # GNU AGPL v3 公式英文本文
├── ADDITIONAL_TERMS.txt                               # Section 7 の追加条項（英語）
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
└── docs/                                             # container: one directory per subdomain
    ├── docs/                                         # docs.comicine.com — VitePress root
    │   ├── .vitepress/                               # config.mts, rewrites.json, theme
    │   ├── zh-cn/                                    # one directory per language, same file tree in each
    │   ├── en-us/
    │   ├── ja-jp/
    │   ├── ko-kr/
    │   ├── functions/                                # docs Pages Functions: language-less entry routes
    │   └── public/                                   # static assets, _redirects, _routes.json, robots.txt
    ├── services/                                     # services.comicine.com — price-list CSVs
    └── lists/                                        # gate/crawler/bans lists and generated whitelist (not published)
        ├── README.md                                 # what each list is and how to apply a change
        ├── own-ips.txt                               # hand-written: your own IPs / extra trusted entries
        ├── whitelist.txt                             # generated from own-ips.txt; used by the edge gate and optional WAF tool
        └── blocklist.txt                             # hand-written: ban seed for src/auto_block.py (D1 is the authority)
```

## ブランド素材とフォント

- ホームページのヒーローと左上のナビゲーションでは、Delius Swash Caps を使って正確なブランド名 `ComiCine` をテキストで表示します。ポートフォリオを開くと、同じワードマーク要素が画面中央からナビゲーションへ移動します。色はテーマの文字色に従い、白黒で表示します。
- ブラウザーの Favicon と小さなウェブ用マークには `src/static/icons/comicine-favicon.svg` を使用します。横型ワードマークと主要なソーシャルプレビュー画像には `src/static/icons/comicine-xtext.svg` を使用します。PNG 版は Apple のタッチアイコンと、メールやソーシャルメディアなどラスター画像のみを使える場面に限ります。`src/static/icons/comicine-watermark.png` は画像ウォーターマーク処理の入力として引き続き使用します。
- 自ホストの Delius Swash Caps サブセットと OFL ライセンスは `src/static/fonts/delius-swash-caps/` にあります。ブランド表記の正確な名称 `ComiCine` にこのフォントを使います。Copyright 行の記号と年には従来のフォントを使い、`ComiCine` のみ Delius を適用し、周囲の Copyright 文字に対して `1.3em` で表示します。Status Worker には必要なサブセットを埋め込み、その他の本文は従来のフォントスタックを維持します。
- 本番ビルドでは同梱フォントサブセットを使い、開発マシン上の元フォントディレクトリには依存しません。

## クイックスタート

```bash
# Install the Node dependencies pinned by package-lock.json
npm ci

# Build the static site (Python venv + contract checks + public/ + preview/)
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
# Python tests
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
宣言された Worker Cron Triggers として動作します。`python3 ops/readme_facts.py` は、この表・保持期間・ツリー内のすべてのパスを読み直します：

| スケジュール | Worker | ジョブ |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 毎分の HTTP/D1 プローブ。プローブがダウンしている間は Durable Object のアラームが 10 秒ごとに再確認し、状態変化時にアラートします |
| `47 3 * * *` | `ops/status-worker` | D1 のデータ保持（`src/retention.ts`）：`ray_log_v2`（7 日）、`visitors_v2`（30 日）、`visitor_rollups`（30 日）、`heartbeats`（30 日）、`events`（90 日）、`probe_uptime_daily`（90 日）、`auth_sessions`（60 日）、`identity_handoffs`（1 日）を削除します。同じ実行でバケットごとの結果を `retention_state` に記録し、削除の失敗時にはアラートを発し、アカウント単位の D1 読み取り／書き込みの予算チェックも実行します |
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

デプロイ対象は本番 Pages プロジェクト `comicine`、Docs プロジェクト `comicine-docs`、および独立した Workers です。本番プロジェクトは `comicine.pages.dev` とすべての本番カスタムドメインを提供し、暗号化済みランタイム設定を保持します。Docs のエイリアスは `comicine-docs.pages.dev`、Workers のアカウントサブドメインは `comicine.workers.dev` です。Cloudflare へのデプロイは設定済みの API トークンを使用します。
リポジトリのルートから：

```bash
cd site
bash ops/deploy.sh              # with no arguments = --all (full deploy, see below)
bash ops/deploy.sh --all        # commit + push + deploy Pages + docs + Workers
bash ops/deploy.sh --pages      # deploy production Pages
bash ops/deploy.sh --docs       # deploy docs.comicine.com only
bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker
bash ops/deploy.sh --all --full             # same, but stream every step's output
```

`ops/deploy.sh` を**引数なしで実行すると、それは正確に `--all`** です：commit + push +
 Pages + docs + Workers、すなわち「完全デプロイ（full deploy）」の契約です。すでにローカルでコミット済みのものだけを配信するには、
`--pages` / `--docs` を明示的に指定します。

出力は既定で静かです（1 ステップにつきステータス 1 行）。`--full` を付けると全工程を確認できます。
`--dry-run` は上記のフラグのどの組み合わせでも動作します。

認証情報はローカルの `secrets/webauthn.env` から読み込みます。すべてのステップは
Cloudflare API か Git 経由で実行されます。

### ドキュメントサイト（docs.comicine.com）

`site/docs/` は**サブドメインごとのコンテナ**です：`docs/` には docs.comicine.com の
VitePress ルートが、`services/` には services.comicine.com の価格表 CSV が入ります。`docs/` 内の
ソースは言語ごとに分類され、`zh-cn/`、`en-us/`、`ja-jp/`、`ko-kr/` がそれぞれ同じファイルツリー
（`<lang>/<page>.md`）を持ち、共有の `.vitepress/`、`functions/`、`public/` ディレクトリと並びます。
言語コードは URL の**最後**のセグメントで、内容ページは常に明示的に付けます（`/README/zh-cn`、
`/README/en-us`）。サフィックスなしの `/README` はドキュメントサイトの Pages Function が
メインサイトと同じ順序（言語 cookie、`Accept-Language`、Cloudflare の国情報、最後に契約の既定言語）で
解決します。ドキュメントサイトにホームページはありません。`/`、`/docs-home/*`、以前のローカライズ済みホームページのパスは、いずれも直接 404 を返します。

`.vitepress/rewrites.json` が各 `<lang>/<page>.md` ソースをサフィックス付きルートにマッピングし、
`.vitepress/config.mts` が `additionalConfig` を通じて各言語ディレクトリに固有の `lang` / `themeConfig` を与えます。
ページを追加するには、4 つの言語ディレクトリすべてに作成し、rewrites のエントリを 4 つ追加し、
サフィックスなしパス用に `functions/<page>.js` エントリと `_routes.json` の include を追加します。
markdown ファイルに HTML が出力されない、言語ディレクトリの外にある、または翻訳が欠けている場合、
`ops/docs_check_output.py` がビルドを失敗させます。

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

- セッション cookie の名前は `__Host-comicine_session`（契約上の `session_cookie`）で、ホスト限定（host-only）であり、`Secure` + `HttpOnly` + `SameSite=Lax` + `Path=/` を設定し、`Domain` はありません。`__Host-` プレフィックスにより、ブラウザーは `Domain` なし + `Secure` + `Path=/` の部分を強制するため、サブドメインがプレフィックス付きの cookie を上書きすることはできません。改名以前の名前 `comicine_session` で提示されたセッションは、移行期間中に限り、かつ 2026-11-08T16:00Z より前に認証された場合にのみ受理されるため、新しく発行されたトークンを `Domain=.comicine.com` で注入することはできません。旧 cookie の読み取りとそのクリアは、2026-12-07（セッション TTL 1 回分）以降に削除されます。`/logout` は両方の名前を削除します。
  すべてのセッションは D1 `auth_sessions` に記録されたランダムな `sid` を持ち、`requireAuth` は
  失効・期限切れのセッションを拒否します。実行時に HMAC 鍵がない場合や `auth_sessions` テーブルが利用できない場合は、
  503 でフェイルクローズ（fail closed）します。
- ゲートも同様にフェイルクローズします。`TURNSTILE_SECRET`、`GATE_HMAC_KEY`、
  `SESSION_HMAC_KEY` のいずれかが空の場合、エッジはページをレンダリングしたり署名のない
   cookie を発行したりせず、503 を返します。
- `__gate` cookie は `<issued-at>.<expires-at>.<HMAC-SHA256 hex>` です（TTL 1 時間、`HttpOnly`、
  そのリクエストの現在または旧ルートドメインで共有）。発行と検証はすべてエッジで行います。
- 未認証で保護ページを開くと、送信元サイトは短時間有効な state cookie を設定しつつ 302 で `identity.comicine.com/login` へ遷移します（中間ページや外部スクリプトはありません）。Cloudflare Access が `comicine.cloudflareaccess.com` 経由でログインさせます。API の認証失敗は JSON 401 のままです。identity ホストの Pages Function は `Cf-Access-Jwt-Assertion`（RS256、JWKS は 1 時間キャッシュ）を検証し、送信元ホストと state に結び付いたハッシュ化済みの 1 回限りの D1 ハンドオフを保存します。送信元サイトの callback がそれをサーバー間で交換し、`identity_sites` からローカル設定のロールを適用します。handoff にロールは含まれません。現在の visitor と account の両サイトでは API が admin セッションを要求します。
- 鍵と暗号文は別々に保管し、リポジトリには決してコミットしません
- ブロックの層：アプリ層の D1 ブロックリストがエッジで 403 を返し、`ops/sync-worker` が
  有効な行を Cloudflare IP List `comicine_blocklist` に追随させます（WAF ルールが使う想定ですが、
  そのカスタムルールは現在デプロイされていません）
- 管理操作（作成／更新／削除）には admin ロールが必要で、viewer は読み取り専用です
- すべての書き込み系エンドポイントは `functions/_lib/request.ts`（`readJsonBody`）経由で JSON ボディを読み取ります。ボディの上限は 8 KB（identity exchange は 2 KB、Apple Account の並べ替えは最大 1000 個の id を受け付けるため 32 KB）で、上限を超えたリクエストは途中でキャンセルされ、全体をバッファーせずに 413 を返します。宣言された `Content-Length` はあくまで高速パスのヒントで、実際に適用されるのはストリーミングされたバイト数です。
- 訪問者の IP を一覧系 API が返すことはありません。完全な IP は `visitor_rollups.ip_enc` に
   Fernet で暗号化して保存し、admin 向けに 1 行ずつ復号します
- 脅威モデルの全体像 — 信頼ティア、identity／セッションの境界、フェイルクローズなシークレットの扱い、訪問者 IP のパイプライン — は [SECURITY.md](https://github.com/ComiCine/ComiCine-website/blob/main/SECURITY.md) にあります。脆弱性の開示は、この文書がリンクするドキュメントサイトのポリシーに従って扱われます。

## ホワイトリスト

信頼するソースは [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt) で管理し、デプロイ時に生成ファイル [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt) へ 1 行につき 1 エントリで反映します。

| エントリ | 効果 |
| --- | --- |
| `ASN/<number>` | `ops/waf_whitelist.sh --apply` で手動管理するゾーン単位の Cloudflare Access Rule 向けの任意エントリです。ASN エントリは Pages Functions のゲートを迂回しません。 |
| `IP-CIDR/<ip>/<mask>` | Pages エッジで完全に許可されるソースです（例：`IP-CIDR/97.64.18.11/32`）。IPv4 は `/24`–`/32`、IPv6 は `/64`–`/128` のプレフィックスのみ許可され、ブロックリストとチャレンジゲートの両方をスキップします。 |

現在の生成リストには **ASN エントリが 0 件**、**完全に許可された IP が 2 件**含まれます。通常のデプロイはローカルのホワイトリストを生成しますが、ゾーン単位の ASN Access Rules は変更しません。これらのルールを変更する意図がある場合は `ops/waf_whitelist.sh --apply` を手動で実行してください。

クローラーは**別系統のより弱いティア**（チャレンジのみで、完全な信頼はなし）であり、そのリストはサイト自身の [`docs/lists/robots.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/robots.txt) です — この 1 つのファイルには 2 つの役割があります：`src/build.py` がクローラールールを `/robots.txt` として公開し、`config-contract.json` から `Sitemap` の URL を追記します。`ops/check_gate_trust.py` は明示的に列挙されたすべての `User-agent:`（`*` 以外）を `functions/_data/gateTrust.ts` の `GATE_TRUST_CRAWLER_UAS` に変換し、`functions/_lib/bots.ts` が `User-Agent` ヘッダーの先頭 512 文字と大文字小文字を区別せずに照合します。クローラーの追加は `User-agent:` 1 行だけで、キルスイッチは `config-contract.json` の `gate_trust.ua_allowlist_enabled` です。コンパイル済みリストは現在 **101 トークン**（99 個の User-Agent に加え、実際のリクエストには決して一致しない robots 専用の `Google-Extended` / `Applebot-Extended`）を保持しています。すべてのエントリが部分文字列一致であるため、実際のブラウザーの User-Agent に現れるトークンを含めることはできません。WeChat/QQ のアプリ内ブラウザー、Sogou のモバイルブラウザー、CUBOT の端末、Spider 8 タブレット、プレビュービルド、AKAI/Funai の TV ブラウザーはすべてゲートの内側に残り、汎用マーカーは `crawler`、`fetcher`、`LLM` に限られています。User-Agent は自己申告であるため、このティアは D1 ブロックリストを決してスキップせず、`__gate` cookie も受け取らず、訪問者としてもカウントされません — [ゲートの挙動](#ゲートの挙動)を参照してください。

ランタイムごとの信頼：エッジコードが信頼するのは `IP-CIDR` エントリのみです（`isGateTrustedIp` → `functions/_data/gateTrust.ts`）。`docs/lists/own-ips.txt` または `docs/lists/robots.txt` を編集した後は、ビルドでエッジ用のコピーを再生成してください（`bash ops/build.sh` が `ops/check_gate_trust.py --emit` を実行します）。

## 唯一の情報源

- ユーザー向けの文字列：`locales/*.json`。`functions/_data/*` と API の i18n ルートはそこから生成されます。
- 共有ランタイム定数：`config-contract.json` がランタイム横断で合意された契約です。`src/config.py` と生成物 `functions/_lib/config.ts` の双方がこれを消費し、`ops/check_config_contract.py` が一致を強制します。
- ゲートの文言とリダイレクトのプリロードアセット：`locales/*.json` を `functions/_data/runtime.ts` 経由で。`src/build.py` がそれを組み立てます。リダイレクトページの文言は、同じロケールファイルから `public/<lang>/redirect.html` に事前レンダリングされます。
- D1 のスキーマとマイグレーション：`ops/migrations/*.sql`。ブロックの権威は `blocked_ips` のみです。
- セキュリティレスポンスヘッダーの基準（有効時）：`ops/security-headers.json`。
- デプロイとランタイムの境界：`ops/deploy.sh`。ランタイムは Cloudflare Pages と Workers のみです。

## Cloudflare Pages ランタイム

公開サイト（ホーム／サービス／お問い合わせ、ゲート、訪問者パネル、Apple Account 管理、`images.comicine.com` 静的アセットホスト、リダイレクト中継）は本番 Pages プロジェクト `comicine` で動作し、ステータスページとすべての定期ジョブも同様です。本番プロジェクトは `comicine.pages.dev` とすべての本番カスタムドメインを提供し、暗号化済みランタイム設定を保持します。Docs Pages プロジェクトは `comicine-docs.pages.dev` を使用します。Worker の URL は `comicine.workers.dev` を使用します。

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
   `functions/_data/runtime.ts`（ゲートの i18n + リダイレクトのプリロードアセット）を生成します
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

すべてのリクエストで署名済み `__gate` cookie を確認します。ゲートを通過する方法は 3 つあり、本人性に基づくのは最初の 2 つだけです：

| ソース | バイパス |
| --- | --- |
| IP 許可リスト（`docs/lists/whitelist.txt` の `IP-CIDR` エントリ → `functions/_data/gateTrust.ts`） | 完全バイパス：チャレンジ**と** D1 ブロックリストの両方をスキップ |
| Cloudflare `botManagement.verifiedBot` | 完全バイパス（検証済み検索エンジンの署名） |
| 自己申告のクローラー User-Agent（`docs/lists/robots.txt` の明示的な `User-agent:` 行 → `GATE_TRUST_CRAWLER_UAS`） | チャレンジのみ：ブロックリストの対象のまま、`__gate` cookie は発行されず、訪問者としてもカウントされない |

これにより、クローラーや AI エージェント（GPTBot、ClaudeBot、PerplexityBot、Bytespider、CCBot、
DeepSeekBot など）は実際のページを読み取れますが、許可リストにない送信元のブラウザーには
引き続き Turnstile ゲートが表示されます。`cf_clearance` は決して受理されず、User-Agent リストは
**自己申告**です — 正直なクローラーとブラウザーを区別するものであり、認証ではありません
（`functions/_lib/bots.ts` にもそのように明記されています）。

ゲートは 2 層あるうちの 1 層です。その手前のエッジには独自の AI ボットポリシーがあります：
Cloudflare の既定（`ai_bots_protection: only_on_ad_pages`）では、マネージドルールセットが
GPTBot/ClaudeBot/CCBot/Amazonbot/Bytespider に対して、Worker のコードが動く**前**に
`403 Your request was blocked.` を返し、`functions/` のロジックでは打ち消せません。
`ops/ai_bots.py --apply` はそのポリシーをすべての AI 挙動（Search / Agent / Training）について
「ブロックしない」に設定し、AI Labyrinth（`crawler_protection`）を無効化し、Cloudflare が管理する
`robots.txt` を先頭に付加しないようにします。`--show` / `--snapshot` / `--dry-run` はその状態を
読み取り・記録します。2026-10-12 に適用済み — ポリシーは正常に適用され、アーカイブした
スナップショットは 2026-10-31 に削除されました。トークンには **Bot Management: Edit** が付与され、
更新の HTTP メソッドは `PUT` です（PATCH は `405 / code 10405` を返します）。再試行すべきでない
2 つの方法も記しておきます：`phases: ["http_request_firewall_managed"]` に対して `action: skip` を
指定した WAF カスタムルールは、この Free ゾーンでは受理されますが AI ボットのブロックを解除できません。
また、ゾーンの `/settings/*` キーのどれもこのポリシーを公開していません。

ディスカバリーファイルは `src/build.py` が生成し、`_routes.json` で Functions から除外されるため、
クローラーはゲートに遭遇せずに取得できます：`/robots.txt` — `docs/lists/robots.txt` のクローラールールで、
エンドポイント／管理パス以外はすべて許可し、歓迎するクローラーを明示的に列挙します（robots 専用の
`Google-Extended` / `Applebot-Extended` トークンを含む。この同じファイルが上記のゲート許可リストです）—
`/llms.txt`（メインサイトと `docs.comicine.com` の厳選インデックス）— `/sitemap.xml`（正規のホーム、
サービス、お問い合わせの URL。`docs.comicine.com` は独自の sitemap を持ちます）。

`POST https://comicine.com/mcp` は `functions/mcp.ts` に実装された読み取り専用の MCP サーバーです（JSON-RPC 2.0、ツールは `get_public_page` と `search_public_pages`）。`ASSETS` バインディングを通じて、事前レンダリング済みの公開ページを読むだけです。**公開 API ではなく**、許可リストに載ったクライアントと内部クライアント専用です：`/llms.txt` は意図的にこれを掲載せず、`/robots.txt` でも disallow にしているため公には案内されておらず、`functions/_lib/routing.ts` の `isExemptPath("/mcp")` は false を返すため、未検証のクライアントは通常どおり 403 の Turnstile ページを受け取ります。ここでいうアクセスとはゲートを通過することを意味し、許可リストの IP、Cloudflare の検証済みボット、有効な `__gate` cookie のいずれかが必要です。自己申告のクローラー User-Agent リストは人間検証をスキップするだけで、認証ではありません。

読み取りには上限があります：リクエストボディは 64 KiB（`MAX_BODY_BYTES`）、1 回の読み取りあたりのページテキストは 12,000 文字（`MAX_PAGE_TEXT`）、検索ヒットは最大 5 件、言語は 4 つ、読み取り可能なパスは 4 つです。エッジ／ゲート以外にクライアント単位のレート制限はなく、各読み取りは事前レンダリング済みページに対する 1 回の `ASSETS` フェッチです。

現行の `2026-07-28` プロトコルバージョンでは `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` ヘッダーと `params._meta` が必要です。旧 `2025-11-25` / `2025-06-18` / `2025-03-26` の各バージョンではこれらのヘッダーは不要で、未対応のバージョンには `supportedVersions` とともに `-32022` を返します。このポリシーは `functions/mcp.test.ts`（ゲート／ポリシーの表明）と `tests/test_build.py`（ディスカバリーファイル）で固定されています。

未検証のリクエストには Turnstile ゲートページを**その場で**返します。ホストもパスも変わりません。ミドルウェアは要求された URL に `public/<lang>/auth.html` をステータス `403` でレンダリングし、`POST /__gate/verify` が同じオリジンで `Set-Cookie: __gate=…`（1 時間、そのリクエストの現在または旧ルートドメインに限定）を返し、その後ページが元のターゲットを再読み込みします。`auth.comicine.com` はゲートのホストです — 自身のルートで同じページを配信し、`/__gate/config|diag|verify` エンドポイントを持ちます。

ゲートをレンダリングするすべてのホストは同じエッジコードで配信されるため、同期させる 2 つ目のゲート実装はありません。

ミドルウェアは正規化された D1 ブロックリストも適用し、プライバシーを最小化した訪問者分析を記録します。ゲートページは `no-store`/`noindex` で、ダーク／ライトテーマの切り替えに対応します。Turnstile ウィジェットは、ゲートをレンダリングするすべてのホスト（`comicine.com` のゲート用サブドメインで、`auth`、`status`、`visitor`、`apple`、`images` を含む）を登録しておく必要があります。

**認証のレート制限（`/login` と `/logout`）。** どちらのパスも D1 ブロックリストの対象外で、ブロックされた IP の管理者でもサインイン／サインアウトできます。そのため、最も低コストなフラッドの標的にもなります。`/logout` はさらに D1 のセッション失効更新を 1 回書き込むことがあります。Pages Functions はどちらのパスも送信元アドレス（`CF-Connecting-IP`）ごとにスロットリングします：

| パス | 上限 | ウィンドウ | 超過時 |
| --- | --- | --- | --- |
| `/login` | 10 リクエスト | 60 秒 | `429` |
| `/logout` | 20 リクエスト | 60 秒 | `429` |

- 固定ウィンドウは UTC の分に揃えて区切ります。固定ウィンドウでは、任意のローリング 1 分間に最大で上限の 2 倍まで通ります。これは乱用対策のスロットルであり課金用のカウンターではなく、アイソレート間の read-modify-write 競合によって過少にカウントされる可能性があります。
- 429 には `Retry-After` と `Cache-Control: no-store` が付き、`Location` は決して付きません（3xx は返しません）。既定では HTML で、クライアントが `application/json` のみを要求したときは JSON（`{"error":"rate_limited","retry_after":N}`）になります。`text/html` も併記したヘッダーの場合は HTML のままです。
- 制限されるのは完全一致するパスのみです。`/login/entra`、`/login/callback`、`/identity/callback`、`/api/identity/exchange` は Access のログインコールバックであり、スロットルされることはありません。`IP-CIDR` で許可リストに入っている送信元は対象外です（管理者自身のアドレスだからです）。自己申告のクローラー User-Agent は対象外では**ありません**。そのヘッダーは自己申告だからです。
- カウンターは D1 に一切触れません：コロ内で共有される Cache API に置かれ、ローカル開発時（およびテスト内のカウンター）にはアイソレートメモリのフォールバックを使います。読み取りも書き込みもできないカウンターはフェイルオープンするため、キャッシュ障害で管理者が締め出されることはありません。
- 実装：`functions/_lib/rate-limit.ts`。`functions/_middleware.ts` から、ゲートの前およびデータベース処理の前に呼び出されます。ユニットテスト：`functions/_lib/rate-limit.test.ts`。
- しきい値の根拠：2026-11-07 より前の 7 日間に、サイトが計測したのは `/login` 6 件、`/logout` 2 件で、いずれも 1 つの送信元アドレスからでした。したがってこの上限は、通常のサインインに影響を与えずにフラッドを止めます。
- ゾーン単位のレート制限ルールは使用していません。Free プランではルールは 1 つまで、カウント期間は 10 秒、式は Path／Verified-Bot のみ、カウントは IP 単位に限られるため、パスごとに異なる 2 つのしきい値や IP 許可リストの除外を表現できず、内容交渉に対応した 429 ではなく Cloudflare 自身のページで応答します。後から追加する場合は、より広い多層防御のレイヤーとして残し、これらの Worker 側のしきい値はそのままにしてください。

### ページ配信（クリーン URL、言語パスプレフィックスなし）

`src/build.py` が `public/<lang>/` を 4 言語で事前レンダリングします。ゲート通過後、ミドルウェアは **cookie > Accept-Language > CF region > en-US** の順で言語を選び、`env.ASSETS.fetch()` で該当ページを取得して URL をクリーンに保ちます：

- `comicine.com/` → ホームページ、`comicine.com/services` / `comicine.com/contact` → それぞれ対応するページ
- `services.comicine.com/` → サービスページ、`contact.comicine.com/` → お問い合わせページ（サブドメインはメインサイトへの 301 なしで直接コンテンツを配信します）
- `visitor.comicine.com/` → ビジターパネル（要ログイン）、`account.comicine.com/apple` → Apple Account マネージャー（要ログイン）
- `images.comicine.com/` → `comicine.com/` へ 301、その他のパスはポートフォリオ画像、favicon、ロゴ、QR などの静的アセットを配信します。`image.comicine.com/portfolio/<img>` → 正規化 Worker によるウォーターマーク版（そのルートも `comicine.com/` へ 301）
- `www.comicine.com` → メインサイトへ 301
- `comicine.com`、`www`、`images`、`services`、`contact`、`visitor`、`account` の各ホストでは、旧 `/<name>.html` エイリアスとして `www`、`images`、`portfolio`、`services`、`contact`、`visitor`、`apple-account`、`redirect`、`docs`、`status` を認識し、それぞれ設定済みの転送先へ案内します。`docs.html` はメインサイトのルートへ、`/index.html` はそのホストに設定されたルートへ転送します。形式に合う未登録名は 404 を返します。
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
  （キーは host + 言語）。レスポンスは `private, max-age=300, stale-while-revalidate=3600` と
  `Vary: Accept-Language` を通知します。`private` はゲートで保護された HTML を共有キャッシュから
  遠ざけます。というのも、そのバリアントは `Vary` ではカバーされない言語 cookie に依存するからです。
  ここで**エッジキャッシュは主張しません**：
  Cloudflare は Pages Functions のレスポンスをキャッシュしないため
  （同じ URL への連続リクエストでも `cf-cache-status` は `DYNAMIC` のまま）、
  共有キャッシュ向けの寿命ディレクティブは死んだ設定になります。言語 cookie も `Vary` に入れません
  （ブラウザキャッシュが細分化されるだけだからです）。
- ファーストパーティのポートフォリオサムネイル、QR コード、favicon は
  `images.comicine.com/static/...`（静的エッジキャッシュ、Functions を迂回）を使用します。
  サイトのページからウォーターマーク Worker は呼び出しません。Worker は直接アクセスや旧画像 URL 用に稼働を継続します。
- ポートフォリオの原本は一切公開されません：`/static/portfolio/<img>` は 404 を返します。
  公開されるのはクリーンなサムネイル（`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`）と、
  `image.comicine.com` の正規化・ウォーターマーク済み `/portfolio/<img>` だけです。
  原本は git 管理外の `src/static/portfolio/` とプライベート R2 バケット
   `comicine-originals`（`ops/upload_originals.sh`）に残ります。
- Turnstile の検証にはサーバー側で 3 秒のタイムアウトがあるため、
  Cloudflare のチャレンジ基盤の障害時はユーザーを最大 8 秒待たせず、
  素早くフェイルクローズします。

### 現在のデプロイと移行状況

現在のデプロイと外部リソースの状態です。`python3 ops/readme_facts.py --live` でいつでも読み直せます：

1. **Pages**：本番プロジェクト `comicine` が `comicine.com`、`www`、`services`、`contact`、`auth`、`visitor`、`account`、`identity`、`images`、`redirect` を配信し、暗号化済みランタイム設定とともに `comicine.pages.dev` を所有します。廃止済みの `comicine-production` プロジェクトには本番カスタムドメインがなく、ユーザーによる削除のために保持されています。Docs プロジェクトは `comicine-docs` で `comicine-docs.pages.dev`、`docs.comicine.com` がそれを配信します。`image.comicine.com` は透かし Worker、`fonts.comicine.com` は R2 を使用し、`status.comicine.com` / `sink.comicine.com` は Worker のカスタムドメインです
2. **D1**：新しい `comicine` データベース（APAC）はプロビジョニング済みで、稼働中の運用テーブルが取り込まれています。Pages の本番・プレビューのバインディング設定はこのデータベースを参照し、独立 Worker のバインディングも今回のリリースに含まれます。最終インポートでは Apple Account のレコードを変更せずに保持し、古い訪問者ハッシュと詳細テレメトリーは取り込んでいません。`blocked_ips` がブロックの権威であり続け、ソフト削除された行は監査用に残ります
3. **シークレット**は **Pages → Settings → Environment variables → Encrypt** にあります：9 つのランタイムシークレットには Turnstile の 2 つ、`GATE_HMAC_KEY`、`SESSION_HMAC_KEY`、`OBSERVABILITY_HMAC_KEY`、`VISITOR_IP_KEY`、`APPLE_ACCOUNT_ENCRYPTION_KEY`、`ACCESS_TEAM_DOMAIN`、`ACCESS_IDENTITY_AUD` が含まれます。廃止された `ACCESS_ADMIN_AUDS` と `ACCESS_VIEWER_AUDS` は、ランタイムコードが読み取らないためコピーしていません。引退した AppleID と Authentik のシークレットは設定されていません
4. **Access**：`ComiCine` が `identity.comicine.com/login` を保護し、`visitor.comicine.com` と `account.comicine.com` は共有 identity ハンドオフと自ホスト専用の Pages セッションを使用します。廃止された `identity.limooo.cn/login` の宛先は、アプリケーションの AUD とポリシーを維持したまま 2026-10-29 に削除しました。`admin.limooo.cn` 用の未使用の `ComiCine-Admin` アプリも削除済みで、このホスト名には DNS レコードも Pages カスタムドメインもありません。セルフホストの IdP や独自のログインフォームはありません
5. **Worker** は独立して稼働します：`comicine-status`、`comicine-blocklist-sync`、`comicine-d1-archive`、`comicine-image-watermark`、`comicine-sink`。アカウントのサブドメインは `comicine.workers.dev` になりました。`status.comicine.com`、`image.comicine.com`、`sink.comicine.com` は Worker のカスタムドメインです。Status Worker は `comicine-status_ComiCineProbeStateV2` を使用し、新しいバインディングの確認後に旧名前空間を削除しました。`comicine-sink` データベースはインポート済みで、`comicine_sink` データセットが設定され、Sink Worker もデプロイ済みです。有効なショートリンクは Location ヘッダー付きの 302 を返しました
6. **Cloudflare のルール**：有効な WAF ルールと Cache Rules はありません。稼働中の IP List は `comicine_blocklist` です。`.com` ゾーンの動的リダイレクトフェーズは空で、旧 `.cn` ゾーンは GET/HEAD を 301、他のメソッドを 308 で対応する `.com` URL に転送し、パスとクエリを保持します。その後、`comicine.com/feishu/<path>` と `/lark/<path>` は Pages 経由で 302 を返し、`https://comicine.feishu.cn/<path>` に転送してパスとクエリを保持します
7. **スモークチェック**：`https://comicine.com/_health` → 200、`https://comicine.com/?challenge=1` → 403、`https://docs.comicine.com/` → 404、`https://status.comicine.com/` → 200

Cloudflare アカウントの表示名は、設定済みの API トークンに `Account Settings Write` がないため、まだ更新されていません。Sink の対象 D1 データベースは `comicine-sink` で、`comicine_sink` Analytics Engine データセットを使用します。Status の Durable Object の対象は上記のとおりです。

ゲートはどのホストでもその場でレンダリングされ、ゲートページとログに実際の訪問者 IP が表示され、Access が唯一のアイデンティティ源であり続けます。2026-10-27 に提供された Cloudflare ダッシュボードのスクリーンショットでは、Turnstile ウィジェットの Hostname Management に `comicine.com` が表示されています。`Turnstile Sites Write` 権限は現在有効で、ウィジェット API は HTTP 200 を返し、そのホスト名一覧には `comicine.com` が含まれています。2026-10-29 のスクリーンショットは `comicine.pages.dev/?challenge=1` で撮影されました：Turnstile は成功を表示しましたが、D1 には `/gate/verify` が 403 `hostname_rejected` を返した記録があります。サーバーは Pages ホストを公開ホストとして意図的に拒否するためです。`comicine.com` での実ブラウザーチャレンジ成功はまだ確認されていません。検証を迂回・弱体化したり、Pages ホストを公開ホストの allowlist に追加したりしないでください。

## ライセンス

ComiCine が所有し、ComiCine がライセンスするオリジナルのソフトウェア資料は、GNU Affero General Public License 第 3 版またはそれ以降のバージョン（AGPL-3.0-or-later）に基づいて提供されます。GNU AGPL v3 のライセンス本文は [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt) にあり、参考訳として[簡体字中国語](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_zh_CN.txt)、[日本語](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ja_JP.txt)、[韓国語](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ko_KR.txt)があります。GNU AGPL v3 第 7 条に基づく追加条項は [ADDITIONAL_TERMS.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS.txt) にあり、参考訳として[簡体字中国語](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_zh_CN.txt)、[日本語](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ja_JP.txt)、[韓国語](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ko_KR.txt)があります。これらの追加条項は、本作品を GNU AGPL v3 に基づいて利用する場合に適用され、後続のライセンスバージョンでの適用はそのバージョンの条件によります。追加条項の英語版が正式であり、翻訳は参考のために提供されています。

ComiCine は、本プロジェクトの開発ブランドおよび公開上の表示です。著作権は、実際の権利者に帰属します。適用される作者表示および著作権表示（合理的な出典表示を含む）を保持してください。著作権の範囲については [COPYRIGHT.md](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT.md) を、特定された第三者素材とプラットフォーム標章については [THIRD_PARTY_NOTICES.md](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES.md) を参照してください。適用される AGPL バージョンの条件に従う限り、商用利用が認められます。

追加の許諾または商標許可に関するお問い合わせ：[contact@comicine.com](mailto:contact@comicine.com)。適用される GNU AGPL バージョンに従う商用利用に追加の許諾申請は必要ありません。
