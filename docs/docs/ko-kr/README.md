---
aside: false
title: 프로젝트 README
description: "ComiCine 웹사이트 및 관리 시스템(Cloudflare 완전 서버리스 구성) 프로젝트 README"
---
<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->


# ComiCine

[comicine.com](https://comicine.com)에서 운영되는 완전 서버리스(serverless) 개인 웹사이트 겸 관리 시스템입니다. 공개 페이지, 사람 확인 게이트, 방문자 패널, Apple Account 관리자, 모니터링, 상태 페이지가 모두 Cloudflare(Pages Functions, Workers, D1, R2)에서 실행됩니다.

## 기능

- **공개 페이지**: 홈, 서비스, 문의, 포트폴리오 — 4개 언어로 사전 렌더링되며 다크/라이트 테마 전환을 지원합니다
- **사람 확인**: Turnstile 게이트 페이지는 모든 호스트에서 요청된 URL에 **그 자리에서(in place)** 렌더링됩니다(도메인 간 이동 없음) — [게이트 동작](#게이트-동작) 참고
- **방문자 패널**(`visitor.comicine.com`): Pages Function + D1 분석. 해시 처리된 방문자 식별자(목록 API에 원본 IP가 없음), 국가, 가능한 경우 ISP/ASN, 상태 코드 분포를 보여 주며 로그인으로 보호됩니다
- 최초 로드 후 방문자 상태 칩은 새 `/api/visitors` 요청 없이 로컬에서 필터링합니다. 딥 링크를 위해 API는 여전히 `?status=<3-digit>`을 받습니다.
- **Apple Account 관리자**(`account.comicine.com/apple`): 드래그 앤 드롭 정렬을 지원하는 Pages Function + D1 CRUD. 비밀번호는 Fernet으로 암호화해 저장하고, 목록에는 마스킹된 비밀번호만 표시하며 임시로 평문을 공개할 수 있습니다
- **인증 및 역할**: 하나의 `ComiCine` Access 앱이 `identity.comicine.com/login`을 보호합니다. identity 호스트의 Pages Function은 JWT를 검증하고 등록된 원본 호스트에 바인딩된 짧은 수명의 일회용 D1 전달로 사용자 신원을 반환합니다. 원본 사이트의 callback이 로컬 설정에서 역할을 적용합니다. 현재 보호되는 두 사이트 모두 admin 세션이 필요합니다.
- **공유 로그인 이동**: 인증되지 않은 브라우저 페이지 요청은 중간 페이지나 스크립트 없이 302로 `identity.comicine.com/login`으로 이동합니다. 이후 Cloudflare Access가 브라우저를 `comicine.cloudflareaccess.com` 로그인으로 보냅니다. API 인증 실패는 JSON 401로 유지됩니다.
- **모니터링**: `comicine-status` Worker가 매분 HTTP/D1 대상을 프로브(probe)하고, 프로브가 다운된 동안에는 10초마다 다시 확인하며 결과를 D1에 저장합니다. 알림은 webhook으로 나가고 Email binding이 대체 수단입니다
- **상태 페이지**(`status.comicine.com`): 같은 Worker가 D1에서 서버 렌더링하며, 4개 언어와 명시적 `?lang=` 재정의를 지원하고, 프로브 오류 코드에 대한 4개 언어 대조표와 브랜드가 적용된 404/503 장애 페이지를 제공합니다. 일별 가동률은 `probe_uptime_daily` 롤업(rollup)에서 가져옵니다
- **자동 IP 차단**:
  - D1 `blocked_ips`가 권위 데이터이고, `sync-worker`가 활성 행을 Cloudflare IP List로 미러링해 엣지에서 차단합니다(원본 서버가 없으므로 ipset/iptables도 없음)
  - 대체 수단으로 애플리케이션 계층 전역 필터가 있으며, 차단된 IP는 곧바로 403을 받습니다
- **통합 리다이렉트 페이지**(`redirect.comicine.com/?to=<https-url>`, `/r`도 허용): 모든 HTTPS 목적지로 리다이렉트하기 전에 중간 안내 페이지를 보여 줍니다
- **포트폴리오 이미지 처리**: 원본은 공개하지 않습니다. 웹사이트는 깨끗한 썸네일과 정적 리소스를 사용합니다. 워터마크 Worker는 직접 및 이전 이미지 URL을 위해 계속 배포하지만, 사이트 페이지에서는 호출하지 않습니다.

## 기술 스택

| 계층 | 기술 | 실행 위치 |
| --- | --- | --- |
| 공개 페이지, 게이트, 방문자 패널, Apple Account 관리자, 상태 페이지 | Pages Functions (`functions/`) + 사전 렌더링된 정적 HTML | Cloudflare 엣지 |
| 데이터 | D1 (방문자 분석, 차단 목록, Apple Account 계정, 인증 세션, 프로브/하트비트) | Cloudflare |
| 사람 확인 | Cloudflare Turnstile, 게이트 페이지를 그 자리에서 렌더링 | Cloudflare + 브라우저 |
| 인증 | Cloudflare Access (Zero Trust JWT, Pages Function이 자체 검증) | Cloudflare |
| 모니터링 및 보존 | `ops/status-worker` (Cron Triggers + Durable Object 알람) | Cloudflare Workers |
| D1 아카이브 | `ops/d1-archive`(매일 cron) | Cloudflare Workers |
| 차단 목록 동기화 | `ops/sync-worker` (일일 cron → Cloudflare IP List) | Cloudflare Workers |
| 이미지 워터마킹 | `ops/image-watermark` (경로 정규화 프록시) | Cloudflare Workers |
| 정적 자산 / 원본 백업 | Pages 자산 서버 + 비공개 R2 버킷 `comicine-originals` | Cloudflare |
| 배포 | `ops/deploy.sh` (git + `ops/pages_deploy.sh` + `ops/workers_deploy.sh`) | 로컬 |

이 계층들이 서로 어떻게 연결되는지 — 요청 파이프라인, 신원 전달(identity handoff), 문서 사이트 빌드, 독립 Worker와 생성되는 산출물 — 는 [ARCHITECTURE.md](https://github.com/ComiCine/ComiCine-website/blob/main/ARCHITECTURE.md)에 설명되어 있습니다.

## 프로젝트 구조

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
├── ARCHITECTURE.md                                   # 요청 흐름, 신원, Worker, 빌드 산출물(영어)
├── SECURITY.md                                       # 위협 모델, 신뢰 등급, 키 처리(영어)
├── LICENSE.txt                                        # GNU AGPL v3 공식 영문 본문
├── ADDITIONAL_TERMS.txt                               # Section 7 추가 조건(영어)
├── ADDITIONAL_TERMS_zh_CN.txt                         # 중국어 간체 번역
├── ADDITIONAL_TERMS_ja_JP.txt                         # 일본어 번역
├── ADDITIONAL_TERMS_ko_KR.txt                         # 한국어 번역
├── COPYRIGHT.md                                      # 저작권 및 라이선스 안내(영어)
├── COPYRIGHT_zh_CN.md                                # 중국어 간체 번역
├── COPYRIGHT_ja_JP.md                                # 일본어 번역
├── COPYRIGHT_ko_KR.md                                # 한국어 번역
├── THIRD_PARTY_NOTICES.md                            # 제3자 고지(영어)
├── THIRD_PARTY_NOTICES_zh_CN.md                      # 중국어 간체 번역
├── THIRD_PARTY_NOTICES_ja_JP.md                      # 일본어 번역
├── THIRD_PARTY_NOTICES_ko_KR.md                      # 한국어 번역
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

## 브랜드 리소스와 글꼴

- 홈페이지 히어로와 왼쪽 상단 내비게이션은 Delius Swash Caps로 정확한 브랜드명 `ComiCine`을 텍스트로 표시합니다. 포트폴리오가 열릴 때 같은 워드마크 요소가 화면 중앙에서 내비게이션으로 이동합니다. 색상은 테마의 텍스트 색상을 따라 흑백으로 표시됩니다.
- 브라우저 파비콘과 작은 웹 표식에는 `src/static/icons/comicine-favicon.svg`를 사용합니다. 가로형 워드마크와 기본 소셜 미리보기 이미지에는 `src/static/icons/comicine-xtext.svg`를 사용합니다. PNG 파일은 Apple 터치 아이콘과 이메일·소셜 미디어처럼 래스터 이미지가 필요한 경우에만 사용합니다. `src/static/icons/comicine-watermark.png`는 이미지 워터마크 파이프라인 입력으로 계속 사용합니다.
- 자체 호스팅 Delius Swash Caps 서브셋과 OFL 라이선스는 `src/static/fonts/delius-swash-caps/`에 있습니다. 브랜드 표기의 정확한 단어 `ComiCine`에 이 글꼴을 사용합니다. Copyright 영역은 기호와 연도에 기존 글꼴을 유지하고 `ComiCine`에만 Delius를 적용하며 주변 Copyright 텍스트의 `1.3em`으로 표시합니다. 상태 Worker에는 필요한 서브셋을 포함하며 나머지 텍스트는 기존 글꼴 스택을 유지합니다.
- 프로덕션 빌드는 번들된 글꼴 서브셋을 사용하므로 개발 컴퓨터의 원본 글꼴 디렉터리에 의존하지 않습니다.

## 빠른 시작

```bash
# Install the Node dependencies pinned by package-lock.json
npm ci

# Build the static site (Python venv + contract checks + public/ + preview/)
npm run build
```

`npm run build`는 `ops/build.sh`입니다. 저장소 외부에
`/tmp/comicine-build-venv`를 만들고 `requirements.lock`의 고정 의존성을 설치한 뒤,
렌더링 전에 런타임 간 설정을 검증합니다. 포트폴리오 워터마크는 Pillow와
`src/static/icons/comicine-watermark.png`로 생성하므로 시스템 Cairo 라이브러리가 필요하지 않습니다.
렌더러를 직접 실행하려면 고정된 Python 의존성을 설치한 다음
`COMICINE_BUILD=1 python3 src/build.py`를 사용하세요.

생성된 사이트를 로컬에서 미리 보려면 빌드한 뒤 `preview/`의 결과물을 여세요.

## 빌드, 테스트 및 배포

깨끗한 로컬 빌드를 위해서는 배포 스크립트와 동일한 의존성 세트를 사용하세요:

```bash
cd site
npm ci
npm run build
```

`src/build.py`는 `public/<lang>/*.html`, `public/static/`,
`functions/_data/i18n.ts`, `functions/_data/runtime.ts`와 `preview/`를 다시 생성합니다.
이 결과물을 직접 수정하지 말고, `locales/*.json`이나 템플릿, 정적 소스를 바꾼 뒤
다시 빌드하세요. `src/static/tailwind.css`는 저장소에 커밋된 Tailwind 사전 빌드
결과물입니다. `npm run build`는 `ops/build.sh`를 사용하며, 이 스크립트가 `/tmp/comicine-build-venv`를
만들고 `public/manifest.json`(빌드 산출물 해시 증거)을 생성합니다.

Pages 결과물만 배포하려면:

```bash
# build + validate only, no Cloudflare writes
bash ops/pages_deploy.sh --build-only

# build + validate + deploy Pages + smoke test (/_health must be 200)
bash ops/pages_deploy.sh

# full deploy: (1) commit (2) push (3) deploy Pages + docs + Workers
bash ops/deploy.sh --all
```

**배포 진입점**: `ops/deploy.sh`가 유일한 배포 진입점으로 commit + push +
Pages + docs를 실행하고, `--worker=<name>`으로 단일 Worker도 배포합니다.
`ops/pages_deploy.sh`가 빌드 + Pages를 담당합니다.
`--dry-run`은 어떤 원격에도 쓰지 않고 계획만 출력합니다.

기본적으로 `deploy.sh`는 **조용합니다**: 단계마다 상태 한 줄만 출력하고, 해당 단계가
실패했을 때만 전체 로그를 덤프합니다. 모든 것을 스트리밍하려면 `--full`을 추가하세요
(빌드 매니페스트, 산출물 개수, wrangler 업로드 진행률). 플래그와 단계는 어느 쪽이든
동일하며, `--full`은 출력의 상세도만 바꿉니다.

자격 증명은 로컬 `secrets/webauthn.env`에서 읽으며(절대 커밋하지 않고, 절대
출력하지 않음), ssh / rsync / 원격 systemd 단계는 없습니다.
`ops/migrate_d1.sh`와 `ops/workers_deploy.sh`도 `--dry-run`을 지원합니다.

자동화된 테스트 진입점이 마련되어 있습니다:

```bash
# Python tests
python3 -m pytest

# Pages Functions, Workers and image-watermark tests
npm test
```

## 환경 변수

배포 스크립트가 `secrets/webauthn.env`에서 읽으며 Git에 커밋되지 않습니다. Pages 런타임은 자체 시크릿 세트를 사용합니다(아래 엣지 섹션 참고).

| 변수 | 설명 |
| --- | --- |
| `GATE_HMAC_KEY` | `__gate` 쿠키용 HMAC-SHA256 키로, 엣지에서 발급하고 검증합니다 |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | `ops/d1_client.py`, `ops/pages_deploy.sh`, `ops/workers_deploy.sh`를 위한 Cloudflare API 접근 |

키 자료는 저장소 밖에 있습니다. `apple_account_encryption.key`는 Apple Account 비밀번호와
암호화된 방문자 IP 컬럼에 사용하는 Fernet 키입니다.

## Cron 작업

모든 스케줄링은 Cloudflare에서, 각 Worker의 `wrangler.toml`에 선언된
Worker Cron Triggers로 동작합니다. `python3 ops/readme_facts.py`는 이 표, 보존 기간,
아래 트리의 모든 경로를 다시 읽습니다:

| 스케줄 | Worker | 작업 |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 매분 HTTP/D1 프로브; 프로브가 다운된 동안 Durable Object 알람이 10초마다 다시 확인하고 상태가 바뀌면 알립니다 |
| `47 3 * * *` | `ops/status-worker` | D1 보존(`src/retention.ts`): `ray_log_v2`(7일), `visitors_v2`(30일), `visitor_rollups`(30일), `heartbeats`(30일), `events`(90일), `probe_uptime_daily`(90일), `auth_sessions`(60일), `identity_handoffs`(1일) 정리; 같은 실행에서 버킷별 결과를 `retention_state`에 기록하고, 정리 실패 시 알림을 보내며, 계정 수준 D1 읽기/쓰기 예산 검사까지 수행합니다 |
| `30 3 * * *` | `ops/sync-worker` | 활성 D1 `blocked_ips` 행을 Cloudflare IP List `comicine_blocklist`로 미러링 |
| `0 0 * * *` | `ops/d1-archive` | D1 스냅샷/아카이브 |

`python3 ops/readme_facts.py --check`는 위 스케줄, 보존 기간, TTL, 디렉터리 트리를
저장소에서 다시 읽어 이 페이지와 어긋나면 실패합니다. `--live`는 배포된 상태
(D1 카운트, Pages 호스트와 시크릿, DNS, WAF, Worker 스케줄)를 Cloudflare에서 읽습니다.

TLS 인증서는 Pages 사용자 지정 도메인에 대해 Cloudflare가 발급하고 갱신합니다.
`ops/migrate_d1.sh`와 `ops/workers_deploy.sh`는 수동 실행하는
`--dry-run` 지원 유지보수 진입점입니다.

## 배포

배포 대상은 프로덕션 Pages 프로젝트 `comicine`, Docs 프로젝트 `comicine-docs` 및 독립 Worker입니다. 프로덕션 프로젝트는 `comicine.pages.dev`와 모든 프로덕션 사용자 지정 도메인을 제공하며 암호화된 런타임 설정을 보유합니다. Docs 별칭은 `comicine-docs.pages.dev`이며 Worker URL은 `comicine.workers.dev`를 사용합니다. Cloudflare 배포는 구성된 API 토큰을 사용합니다.
저장소 루트에서:

```bash
cd site
bash ops/deploy.sh              # with no arguments = --all (full deploy, see below)
bash ops/deploy.sh --all        # commit + push + deploy Pages + docs + Workers
bash ops/deploy.sh --pages      # deploy production Pages
bash ops/deploy.sh --docs       # deploy docs.comicine.com only
bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker
bash ops/deploy.sh --all --full             # same, but stream every step's output
```

`ops/deploy.sh`를 **인수 없이 실행하는 것은 정확히 `--all`**입니다: commit + push +
Pages + docs + Workers, 즉 "전체 배포" 계약입니다. 로컬에 이미 커밋된 것만 배포하려면
`--pages` / `--docs`를 명시적으로 넘기세요.

출력은 기본적으로 조용합니다(단계마다 상태 한 줄). 전체 과정을 지켜보려면 `--full`을
추가하세요. `--dry-run`은 위 플래그의 어떤 조합과도 함께 쓸 수 있습니다.

자격 증명은 로컬 `secrets/webauthn.env`에서 읽으며, 모든 단계는 Cloudflare API나
Git을 거칩니다.

### 문서 사이트(docs.comicine.com)

`site/docs/`는 **서브도메인별 컨테이너**입니다: `docs/`에는 docs.comicine.com
VitePress 루트가, `services/`에는 services.comicine.com 가격표 CSV가 들어 있습니다. `docs/` 안의
소스는 언어별로 분류되어 `zh-cn/`, `en-us/`, `ja-jp/`, `ko-kr/`가 각각 같은 파일 트리
(`<lang>/<page>.md`)를 가지며, 공용 `.vitepress/`, `functions/`, `public/` 디렉터리와 나란히 있습니다.
언어 코드는 URL의 **마지막** 세그먼트이고, 콘텐츠 페이지는 항상 명시적으로 붙입니다
(`/README/zh-cn`, `/README/en-us`). 접미사 없는 `/README`는 문서 사이트의 Pages Function이
메인 사이트와 같은 순서(언어 쿠키, `Accept-Language`, Cloudflare 국가 정보, 마지막으로 계약 기본 언어)로
결정합니다. 문서 사이트에는 홈 페이지가 없습니다. `/`, `/docs-home/*`, 이전의 현지화된 홈 경로는 모두 직접 404를 반환합니다.

`.vitepress/rewrites.json`이 각 `<lang>/<page>.md` 소스를 접미사가 붙은 라우트로 매핑하고,
`.vitepress/config.mts`가 `additionalConfig`를 통해 각 언어 디렉터리에 고유한 `lang` / `themeConfig`를
부여합니다. 페이지를 추가하려면 네 언어 디렉터리 모두에 만들고, rewrites 항목 네 개를 추가하고,
접미사 없는 경로용 `functions/<page>.js` 진입점과 `_routes.json` include를 추가합니다.
마크다운 파일에 대응하는 HTML이 없거나, 언어 디렉터리 밖에 있거나, 번역이 빠져 있으면
`ops/docs_check_output.py`가 빌드를 실패시킵니다.

이 사이트는 포크 `ComiCine/vitepress`의 VitePress로 빌드합니다: 헤더와
푸터는 포크(`VPComiCineNav.vue` / `VPComiCineFooter.vue`)에 있고 메인 사이트의
`base.html` / `_footer.html`을 그대로 반영합니다 — 포크에서 고치면 다음 배포에서
반영됩니다(포크는 커밋이 바뀔 때만 다시 빌드하며, 포크 작업 트리에서 빌드하려면
`COMICINE_VITEPRESS_FETCH=0`을 사용하세요). 이 사이트는 별도의 Cloudflare Pages
프로젝트(`comicine-docs`)이므로 메인 `comicine` 산출물을 절대 건드리지 않으며, 메인
사이트와 `user_lang_preference` / `comicine_theme` 쿠키를 공유합니다.

```bash
bash ops/docs_deploy.sh --build-only   # build + validate only
bash ops/docs_deploy.sh --dev          # local VitePress dev server
```

## 보안 설계

- 세션 쿠키의 이름은 `__Host-comicine_session`(계약 키 `session_cookie`)이고 호스트 전용이며,
  `Secure` + `HttpOnly` + `SameSite=Lax` + `Path=/`를 설정하고 `Domain`은 두지 않습니다. `__Host-`
  접두사는 브라우저가 `Domain` 없음 + `Secure` + `Path=/` 부분을 강제하도록 하므로, 하위 도메인이
  접두사가 붙은 쿠키를 덮어쓸 수 없습니다. 이름을 바꾸기 전의 `comicine_session`으로 제시된 세션은
  전환 기간에만, 그리고 2026-11-08T16:00Z 이전에 인증된 경우에만 허용되므로, 새로 발급된 토큰을
  `Domain=.comicine.com`으로 주입할 수는 없습니다. 레거시 읽기와 그 삭제는 2026-12-07(세션 TTL 한 번)
  이후 제거됩니다. `/logout`은 두 이름을 모두 지웁니다. 모든 세션은 D1 `auth_sessions`에 기록된
  무작위 `sid`를 가지며, `requireAuth`는 폐기되거나 만료된 세션을 거부합니다. 런타임 HMAC 키가 없거나
  `auth_sessions` 테이블을 사용할 수 없으면 503으로 fail closed 합니다.
- 게이트도 fail closed입니다: `TURNSTILE_SECRET`, `GATE_HMAC_KEY`,
  `SESSION_HMAC_KEY`가 비어 있으면 엣지는 페이지를 렌더링하거나 서명 없는 쿠키를
  발급하는 대신 503을 응답합니다.
- `__gate` 쿠키는 `<issued-at>.<expires-at>.<HMAC-SHA256 hex>`(TTL 1시간, `HttpOnly`,
  해당 요청의 현재 또는 레거시 루트 도메인에 공유)이며 전적으로 엣지에서 발급하고 검증합니다.
- 인증되지 않은 브라우저가 보호 페이지를 열면 원본 사이트가 짧은 state 쿠키를 설정하면서 302로 `identity.comicine.com/login`으로 이동합니다(중간 페이지나 외부 스크립트 없음). Cloudflare Access가 브라우저를 `comicine.cloudflareaccess.com` 로그인으로 보냅니다. API 인증 실패는 JSON 401로 유지됩니다. identity 호스트의 Pages Function이 `Cf-Access-Jwt-Assertion`(RS256, JWKS 1시간 캐시)을 검증하고 원본 호스트와 state에 바인딩된 해시 일회용 D1 코드를 만듭니다. 원본 사이트 callback이 서버 간 요청으로 코드를 소비하고 `identity_sites`의 역할을 적용합니다. 전달 데이터에는 역할이 포함되지 않습니다. 현재 visitor 및 account 사이트의 API는 모두 admin 세션을 요구합니다.
- 키와 암호문은 분리해 보관하며 저장소에 절대 커밋하지 않습니다
- 차단 계층: 애플리케이션 계층의 D1 차단 목록이 엣지에서 403을 반환하고,
  `ops/sync-worker`가 활성 행을 Cloudflare IP List `comicine_blocklist`에 맞춰 둡니다
  (WAF 규칙이 쓰도록 되어 있지만 그 사용자 지정 규칙은 현재 배포되어 있지 않습니다)
- 관리자 쓰기(생성/수정/삭제)에는 admin 역할이 필요하며, viewer는 읽기 전용입니다
- 모든 쓰기 엔드포인트는 `functions/_lib/request.ts`(`readJsonBody`)를 통해 JSON 본문을
  읽습니다. 본문 상한은 8 KB이고(ID 교환은 2 KB, Apple Account 순서 변경은 최대 1000개
  id를 받으므로 32 KB), 상한을 넘는 요청은 통째로 버퍼링하지 않고 스트리밍 도중 취소되어
  413으로 응답합니다. 선언된 `Content-Length`는 빠른 경로를 위한 힌트일 뿐이며, 실제로
  강제되는 값은 스트리밍된 바이트 수입니다.
- 방문자 IP는 목록 API에서 절대 반환하지 않습니다. 전체 IP는
  `visitor_rollups.ip_enc`에 Fernet으로 암호화하고 관리자에게 한 행씩 복호화합니다
- 전체 위협 모델 — 신뢰 등급, 신원/세션 경계, fail closed 방식의 시크릿 처리, 방문자 IP
  파이프라인 — 은 [SECURITY.md](https://github.com/ComiCine/ComiCine-website/blob/main/SECURITY.md)에 있으며, 취약점
  제보는 그 문서가 링크하는 문서 사이트 정책에서 처리합니다.

## 화이트리스트

신뢰할 소스는 [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt)에서 수동 관리하며, 배포할 때 생성 파일 [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt)에 한 줄에 하나씩 반영됩니다.

| 항목 | 효과 |
| --- | --- |
| `ASN/<number>` | `ops/waf_whitelist.sh --apply`로 수동 관리하는 zone 수준 Cloudflare Access Rule에 쓰는 선택 항목입니다. ASN 항목은 Pages Functions 게이트를 우회하지 않습니다. |
| `IP-CIDR/<ip>/<mask>` | 완전히 허용되는 소스입니다(예: `IP-CIDR/97.64.18.11/32`). IPv4는 `/24`–`/32`, IPv6는 `/64`–`/128` 프리픽스만 허용하며 차단 목록과 챌린지 게이트를 모두 건너뜁니다. |

현재 생성된 목록에는 **ASN 항목 0개**와 **완전히 허용된 IP 2개**가 있습니다. 전체 배포는 로컬 화이트리스트만 생성하고 zone 수준 ASN Access Rules는 변경하지 않습니다. 해당 규칙을 실제로 바꾸려면 `ops/waf_whitelist.sh --apply`를 수동으로 실행하세요.

크롤러는 **별도의 더 약한 등급**(챌린지만 면제, 완전 신뢰 없음)이며, 그 목록은 사이트가 직접 관리하는 [`docs/lists/robots.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/robots.txt)입니다. 이 파일 하나가 두 가지 일을 합니다. `src/build.py`가 그 크롤러 규칙을 `/robots.txt`로 게시하고 `config-contract.json`의 `Sitemap` URL을 덧붙입니다. `ops/check_gate_trust.py`는 명시적으로 이름이 적힌 `User-agent:`(`*` 제외 전부)를 `functions/_data/gateTrust.ts`의 `GATE_TRUST_CRAWLER_UAS`로 만들고, `functions/_lib/bots.ts`가 이를 `User-Agent` 헤더의 처음 512자와 대소문자 구분 없이 대조합니다. 크롤러를 추가하는 일은 `User-agent:` 한 줄을 더하는 것과 같고, 비상 스위치는 `config-contract.json`의 `gate_trust.ua_allowlist_enabled`입니다.
현재 컴파일된 목록에는 **토큰 101개**(User-Agent 99개와, 실제 요청에는 절대 매칭되지 않는 robots 전용 `Google-Extended` / `Applebot-Extended`)가 들어 있습니다. 모든 항목이 부분 문자열 대조이므로 실제 브라우저 User-Agent에 나타나는 토큰은 목록에 둘 수 없습니다. 그래서 WeChat/QQ 인앱 브라우저, Sogou 모바일 브라우저, CUBOT 휴대폰, Spider 8 태블릿, 미리보기 빌드, AKAI/Funai TV 브라우저는 모두 게이트 뒤에 남고, 일반 마커는 `crawler`, `fetcher`, `LLM`으로 제한됩니다. User-Agent는 스스로 밝히는 값이므로
이 등급은 D1 차단 목록을 절대 건너뛰지 않고, `__gate` 쿠키를 받지 않으며, 방문자로 집계되지도 않습니다 — [게이트 동작](#게이트-동작) 참고.

런타임별 신뢰: 엣지 코드는 `IP-CIDR` 항목만 신뢰합니다
(`isGateTrustedIp` → `functions/_data/gateTrust.ts`). `docs/lists/own-ips.txt`나
`docs/lists/robots.txt`를 수정한 뒤에는 빌드(`bash ops/build.sh`, 내부적으로
`ops/check_gate_trust.py --emit` 실행)로 엣지 사본을 다시 생성하세요.

## 신뢰의 원천(source of truth)

- 사용자 노출 문자열: `locales/*.json`; `functions/_data/*`와 API i18n 라우트는 여기서 생성됩니다.
- 공유 런타임 상수: `config-contract.json`은 런타임 간에 합의된 계약이며, `src/config.py`와 생성된 `functions/_lib/config.ts`가 이를 함께 사용하고 `ops/check_config_contract.py`가 일치를 강제합니다.
- 게이트 문구와 리다이렉트 프리로드 자산: `functions/_data/runtime.ts`를 통한 `locales/*.json`이며, `src/build.py`가 이를 조립합니다. 리다이렉트 페이지 문구는 같은 로케일 파일에서 `public/<lang>/redirect.html`로 사전 렌더링됩니다.
- D1 스키마와 마이그레이션: `ops/migrations/*.sql`; 차단에 관한 한 `blocked_ips`가 유일한 권위입니다.
- 보안 응답 헤더 기준선(활성화된 경우): `ops/security-headers.json`.
- 배포 및 런타임 경계: `ops/deploy.sh`. 런타임은 Cloudflare Pages와 Workers뿐입니다.

## Cloudflare Pages 런타임

공개 사이트(홈 / 서비스 / 문의, 게이트, 방문자 패널, Apple Account 관리자, `images.comicine.com` 정적 자산 호스트와 리디렉션 릴레이)는 `comicine` Cloudflare Pages 프로젝트에서 실행되며 상태 페이지와 모든 예약 작업도 마찬가지입니다. 프로젝트는 `comicine.pages.dev`와 모든 프로덕션 사용자 지정 도메인을 제공하며 암호화된 런타임 설정을 보유합니다. Docs Pages 프로젝트는 `comicine-docs.pages.dev`를 사용합니다. Worker URL은 `comicine.workers.dev`를 사용합니다.

런타임 구성:

| 계층 | 기술 |
| --- | --- |
| 엣지 / 사람 확인 | Pages Functions (`functions/_middleware.ts`) |
| Pages | 빌드 시 사전 렌더링된 정적 HTML (다국어) |
| 데이터 | D1 (방문자 분석, 차단 목록, Apple Account 관리, 인증 세션) |
| 사람 확인 | Cloudflare Turnstile, 게이트 페이지를 그 자리에서 렌더링 |
| 독립 Worker | `status.comicine.com` (`comicine-status`: 프로브, 상태 페이지, 보존), `image.comicine.com` (`comicine-image-watermark`), `comicine-blocklist-sync` |

### 빌드 및 디렉터리 구조

- `python3 src/build.py`: 4개 언어 페이지를 `public/`으로 사전 렌더링하고,
  `locales/*.json`을 `functions/api/i18n/[lang].ts`로 인라인하며, 공유
  `functions/_data/runtime.ts`(게이트 i18n + 리다이렉트 프리로드 자산)를 생성합니다
- `ops/migrations/001_init.sql`: D1 초기 스키마 (`apple_accounts` / `blocked_ips` / `visitors`)
- `ops/export_d1.py`: D1 가져오기용 SQL 생성 (출력은 `ops/out/`, git 제외)
- `ops/migrations/007_visitor_status_indexes.sql`: 방문자 상태 필터링을 위한 `(status, ts)`와 `(status, ip_hash, ts)` 인덱스를 추가합니다
- `ops/sync-worker/`: 매일 03:30 Worker cron이 활성 D1 `blocked_ips` 행을 Cloudflare IP List로 동기화합니다. `auto_block.py cf`는 명시적인 유지보수 용도로만 씁니다

### 환경 변수

저장소에 커밋하지 않고 **Pages 프로젝트 설정 → 환경 변수 → Encrypt (Secret)** 아래에 구성합니다:

| 변수 | 용도 |
| --- | --- |
| `TURNSTILE_SITEKEY` | 게이트 페이지의 Turnstile 위젯 공개 sitekey |
| `TURNSTILE_SECRET` | 서버 측 siteverify 시크릿 |
| `GATE_HMAC_KEY` | `__gate` 쿠키용 HMAC-SHA256 서명 키 (`openssl rand -hex 32`) |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access 팀 도메인이며, 검증에 쓰는 JWT `iss`이기도 합니다 |
| `ACCESS_IDENTITY_AUD` | 단일 `ComiCine` Access 앱의 AUD. 역할은 `config-contract.json`의 원본 호스트 매핑으로 결정됩니다 |
| `VISITOR_IP_KEY` | 암호화된 방문자 전체 IP 컬럼(`visitor_rollups.ip_enc`)용 Fernet 키 |
| `OBSERVABILITY_HMAC_KEY` | 프라이버시 최소화 방문자 IP 해시용 HMAC 키(`functions/_lib/tracking.ts`); 없으면 게이트가 fail-closed 합니다 |
| `SESSION_HMAC_KEY` | Pages 세션 쿠키 서명 키 (`GATE_HMAC_KEY`와 별개) |
| `APPLE_ACCOUNT_ENCRYPTION_KEY` | Fernet 키 (`secrets/apple_account_encryption.key`에서 가져옴) |

로컬 개발: `.dev.vars.example`을 `.dev.vars`로 복사하고 실제 값을 채우세요(git 제외). `ops/sync-worker`용 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`는 `wrangler secret put`으로 구성하세요.

### 게이트 동작

모든 요청은 서명된 `__gate` 쿠키를 검사합니다. 게이트를 통과하는 방법은 세 가지이며, 신원을 근거로 하는 것은 처음 두 가지뿐입니다:

| 소스 | 우회 범위 |
| --- | --- |
| IP 허용 목록(`docs/lists/whitelist.txt`의 `IP-CIDR` 항목 → `functions/_data/gateTrust.ts`) | 완전 우회: 챌린지**와** D1 차단 목록을 모두 건너뜁니다 |
| Cloudflare `botManagement.verifiedBot` | 완전 우회(검증된 검색 엔진 서명) |
| 선언된 크롤러 User-Agent(`docs/lists/robots.txt`의 명시적 `User-agent:` 줄 → `GATE_TRUST_CRAWLER_UAS`) | 챌린지만 면제: 차단 목록의 적용은 그대로 받고, `__gate` 쿠키를 받지 않으며, 방문자로 집계되지 않습니다 |

그래서 크롤러와 AI 에이전트(GPTBot, ClaudeBot, PerplexityBot, Bytespider, CCBot,
DeepSeekBot, …)는 실제 페이지를 읽을 수 있고, 허용 목록에 없는 소스의 브라우저는 여전히
Turnstile 게이트를 받습니다. `cf_clearance`는 절대 인정하지 않으며, User-Agent 목록은
**스스로 밝힌 값**입니다. 즉 정직한 크롤러와 브라우저를 구분할 뿐 인증 수단은 아닙니다
(`functions/_lib/bots.ts`에 이 점이 명시되어 있습니다).

게이트는 두 계층 중 하나입니다. 게이트 앞단의 엣지에는 자체 AI 봇 정책이 있습니다:
Cloudflare 기본값(`ai_bots_protection: only_on_ad_pages`)에서는 관리형 규칙 세트가
GPTBot/ClaudeBot/CCBot/Amazonbot/Bytespider에 `403 Your request was blocked.`를
응답하며, 이는 Worker 코드가 실행되기 **전에** 일어나므로 `functions/` 쪽 로직으로는
되돌릴 수 없습니다. `ops/ai_bots.py --apply`는 이 정책을 모든 AI 동작
(Search / Agent / Training)에 대해 "차단하지 않음"으로 설정하고, AI Labyrinth
(`crawler_protection`)를 끄며, Cloudflare가 관리형 `robots.txt`를 앞에 붙이지 않게
합니다. `--show` / `--snapshot` / `--dry-run`은 그 상태를 읽고 기록합니다. 2026-10-12에
적용했으며 정책 적용은 성공했고, 보관해 둔 스냅샷은 2026-10-31에 삭제했습니다. 토큰에는
**Bot Management: Edit** 권한이 있고, 갱신에 쓰는 메서드는 `PUT`입니다(PATCH는
`405 / code 10405`로 응답합니다). 다시 시도할 필요가 없는 두 가지 실패 사례:
`phases: ["http_request_firewall_managed"]`에 `action: skip`을 거는 WAF 사용자 지정
규칙은 이 Free zone에서 API가 받아 주지만 AI 봇 차단을 풀지 못하고, zone의
`/settings/*` 키 중 이 정책을 노출하는 것도 없습니다.

탐색 파일은 `src/build.py`가 생성하고 `_routes.json`에서 Functions 대상에서 제외하므로
크롤러는 게이트를 만나지 않고 이 파일들을 받습니다:
`/robots.txt` — `docs/lists/robots.txt`의 크롤러 규칙으로, 엔드포인트/관리 경로를 제외한
모든 것을 허용하고 환영하는 크롤러를 명시적으로 나열하며 robots 전용
`Google-Extended` / `Applebot-Extended` 토큰도 포함합니다(위의 게이트 허용 목록과 같은
파일입니다) — `/llms.txt`(메인 사이트와 `docs.comicine.com`의 선별된 색인) — 그리고
`/sitemap.xml`(정식 홈, 서비스, 문의 URL이며 `docs.comicine.com`은 자체 사이트맵을
가집니다).

`POST https://comicine.com/mcp`는 `functions/mcp.ts`에 구현된 읽기 전용 MCP 서버입니다(JSON-RPC 2.0, 도구 `get_public_page`와 `search_public_pages`). `ASSETS` 바인딩을 통해 미리 렌더링된 공개 페이지만 읽습니다. **공개 API가 아니며** 허용 목록에 있는 클라이언트와 내부 클라이언트만을 위한 것입니다: `/llms.txt`는 의도적으로 이 엔드포인트를 빼고 `/robots.txt`는 이를 disallow하므로 광고되지 않으며, `isExemptPath("/mcp")`가 `functions/_lib/routing.ts`에서 false를 반환하므로 검증되지 않은 클라이언트는 평소와 같은 403 Turnstile 페이지를 받습니다. 접근은 곧 게이트 통과를 뜻합니다: 허용 목록에 있는 IP, Cloudflare가 검증한 봇, 또는 유효한 `__gate` 쿠키입니다. 선언된 크롤러 User-Agent 목록은 사람 확인만 건너뛸 뿐 인증이 아닙니다.

읽기에는 상한이 있습니다: 요청 본문 64 KiB(`MAX_BODY_BYTES`), 읽기 한 번에 페이지 텍스트 12,000자(`MAX_PAGE_TEXT`), 검색 결과 최대 5건, 언어 4개, 읽을 수 있는 경로 4개입니다. 엣지/게이트 외에 클라이언트별 속도 제한은 없으며, 모든 읽기는 이미 사전 렌더링된 페이지에 대한 `ASSETS` fetch 한 번입니다.

최신 `2026-07-28` 프로토콜 버전은 `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` 헤더와 `params._meta`를 요구합니다. 레거시 `2025-11-25` / `2025-06-18` / `2025-03-26` 버전에는 그런 헤더가 필요 없으며, 지원하지 않는 버전에는 `supportedVersions`와 함께 `-32022`로 응답합니다. 이 정책은 `functions/mcp.test.ts`(게이트/정책 단언)와 `tests/test_build.py`(탐색 파일)가 고정합니다.

검증되지 않은 요청은 Turnstile 게이트 페이지를 **그 자리에서** 받습니다: 호스트와 경로는 절대 바뀌지 않습니다. 미들웨어(middleware)는 요청된 URL에 `public/<lang>/auth.html`을 상태 `403`으로 렌더링하고, `POST /__gate/verify`가 같은 오리진에서 `Set-Cookie: __gate=…`(1시간, 해당 요청의 현재 또는 레거시 루트 도메인에 한정)와 함께 응답하면 페이지가 원래 목적지로 다시 로드합니다. `auth.comicine.com`은 게이트 호스트로, 자체 루트에서 같은 페이지를 제공하며 `/__gate/config|diag|verify` 엔드포인트를 소유합니다.

게이트를 렌더링하는 모든 호스트는 동일한 엣지 코드가 처리하므로, 동기화해야 할 두 번째 게이트 구현이 없습니다.

미들웨어는 정규화된 D1 차단 목록도 강제하고 프라이버시를 최소화한 방문자 분석을 기록합니다. 게이트 페이지는 `no-store`/`noindex`이며 다크/라이트 테마 전환을 지원합니다. Turnstile 위젯에는 게이트를 렌더링하는 모든 호스트(예: `auth`, `status`, `visitor`, `apple`, `images`를 포함한 `comicine.com` 게이트 서브도메인)가 등록되어 있어야 합니다.

**인증 속도 제한(`/login`과 `/logout`).** 두 경로는 D1 차단 목록에서 제외되어 차단된 IP의 관리자도 로그인·로그아웃할 수 있는데, 그래서 가장 값싼 플러드 대상이기도 합니다. `/logout`은 D1 세션 폐기 업데이트를 한 번 기록할 수도 있습니다. Pages Functions는 두 경로를 소스 주소(`CF-Connecting-IP`)별로 제한합니다:

| 경로 | 한도 | 창 | 초과 시 |
| --- | --- | --- | --- |
| `/login` | 10 요청 | 60초 | `429` |
| `/logout` | 20 요청 | 60초 | `429` |

- UTC 분 경계에 맞춘 고정 창(fixed window)입니다. 고정 창은 롤링 1분 동안 한도의 최대 두 배까지 허용하며, 이것은 어뷰즈 스로틀이지 과금 카운터가 아니고, isolate 간 read-modify-write 경쟁으로 실제보다 적게 셀 수 있습니다.
- 429 응답은 `Retry-After`와 `Cache-Control: no-store`를 가지며 `Location`(3xx)은 절대 넣지 않습니다. 기본은 HTML이고, 클라이언트가 `application/json`만 요청하면 JSON(`{"error":"rate_limited","retry_after":N}`)입니다. `text/html`도 함께 나열한 헤더는 HTML을 유지합니다.
- 제한되는 것은 정확히 그 두 경로뿐입니다. `/login/entra`, `/login/callback`, `/identity/callback`, `/api/identity/exchange`는 Access 로그인 콜백이므로 스로틀하지 않습니다. `IP-CIDR` 허용 목록 소스는 제외됩니다(관리자 본인의 주소이기 때문입니다). 선언된 크롤러 User-Agent는 제외되지 않습니다. 그 헤더는 스스로 신고한 값이기 때문입니다.
- 카운터는 D1을 건드리지 않습니다. 같은 colo 안에서 공유되는 Cache API에 있고, 로컬 개발(과 테스트의 카운터)을 위한 isolate 메모리 대체 경로가 있습니다. 읽거나 쓸 수 없는 카운터는 fail open 하므로, 캐시 장애가 관리자를 잠그지는 못합니다.
- 구현: `functions/_lib/rate-limit.ts`이며, 게이트보다 앞에서 그리고 어떤 데이터베이스 작업보다도 앞에서 `functions/_middleware.ts`가 호출합니다. 단위 테스트: `functions/_lib/rate-limit.test.ts`.
- 한도 근거: 2026-11-07 이전 7일 동안 사이트가 측정한 `/login` 요청은 6건, `/logout` 요청은 2건이었고 모두 하나의 소스 주소에서 왔습니다. 따라서 이 한도는 정상 로그인에 영향을 주지 않으면서 플러드를 막습니다.
- zone 수준 rate limiting 규칙은 쓰지 않습니다. Free 플랜은 규칙 1개, 10초 집계 주기, Path/Verified-Bot 전용 표현식, IP 집계만 허용하므로 경로별로 다른 두 임계값이나 IP 허용 목록 예외를 표현할 수 없고, 협상된 429 대신 Cloudflare 자체 페이지로 응답합니다. 나중에 규칙을 추가하더라도 더 넓은 심층 방어 계층으로만 두고 이 Worker 임계값은 그대로 유지하세요.

### 페이지 제공(clean URL, 언어 경로 접두사 없음)

`src/build.py`가 4개 언어로 `public/<lang>/`을 사전 렌더링합니다. 게이트를 통과하면 미들웨어가 **cookie > Accept-Language > CF region > en-US** 순으로 언어를 고르고 `env.ASSETS.fetch()`로 해당 페이지를 가져와 URL을 깔끔하게 유지합니다:

- `comicine.com/` → 홈 페이지; `comicine.com/services` / `comicine.com/contact` → 각각 해당 페이지
- `services.comicine.com/` → 서비스 페이지; `contact.comicine.com/` → 문의 페이지(서브도메인이 콘텐츠를 직접 제공하며 메인 사이트로 301하지 않음)
- `visitor.comicine.com/` → 방문자 패널(로그인 필요); `account.comicine.com/apple` → Apple Account 관리자(로그인 필요)
- `images.comicine.com/` → `comicine.com/`으로 301, 다른 경로에서는 포트폴리오 이미지, favicon, logo, QR 코드 등의 정적 자산 제공. `image.comicine.com/portfolio/<img>` → 정규화 Worker가 만든 워터마크 버전(이 호스트의 루트도 `comicine.com/`으로 301)
- `www.comicine.com` → 메인 사이트로 301
- `comicine.com`, `www`, `images`, `services`, `contact`, `visitor`, `account` 호스트에서는 레거시 `/<name>.html` 별칭으로 `www`, `images`, `portfolio`, `services`, `contact`, `visitor`, `apple-account`, `redirect`, `docs`, `status`를 인식해 각각 설정된 대상으로 전달합니다. `docs.html`은 메인 사이트 루트로, `/index.html`은 해당 호스트에 설정된 루트로 이동합니다. 별칭 형식에 맞지만 등록되지 않은 이름은 404를 반환합니다.
- 내비게이션 링크는 절대 서브도메인 URL(`https://services.comicine.com` 등)을 유지합니다. 언어 전환은 순수 프런트엔드 `applyLang()`이며 새로고침도, URL 변경도 없습니다

### services.comicine.com 가격(CSV 기반)

서비스 가격표는 **마크업이 아니라 데이터**입니다: `src/build.py`가 렌더링할 때마다 `docs/services/*.csv`를 읽어(`src/services_pricing.py`) `src/templates/services.html`의 플랜 그리드를 채웁니다. 가격을 바꾸려면 CSV를 수정하고 배포하면 되며, 템플릿은 고칠 필요가 없습니다.

| 파일 | 컬럼 | 채우는 곳 |
| --- | --- | --- |
| `docs/services/convention.csv` | `shots,price[,bookable]` | 01 Convention, 촬영 장수 티어마다 카드 하나 |
| `docs/services/outdoor.csv` | `type,people,price[,bookable]` | 02 Outdoor, 스튜디오/야외 × 1인/2인 |

숫자, 티어 구성, 예약 가능 여부만 CSV에서 오고, 레이블·단위 접미사·설명 블록은 여전히 `locales/*.json`에서 옵니다
(`plan_studio_solo`, `unit_per_shot`, …).

**`bookable`(선택 컬럼)** 은 취소선 가격 스타일과 설명 블록의 스튜디오 행을 모두 제어합니다:

- 티어별: `no` → 해당 티어 가격이
  `class="plan-price strikethrough"`로 렌더링됩니다. `yes`, 빈 셀, 또는 컬럼 자체가
  없는 경우 → 일반 가격
- 설명 블록: **모든** `studio` 티어가 `no`이면 스튜디오 행에 예약 중단
  문구(`studio_paused`)가 표시되고, 스튜디오 티어 하나라도 예약 가능해지면 곧바로
  `studio_bookable`이 대신 표시됩니다

따라서 "일시적으로 예약을 받지 않음"은 처음부터 끝까지 데이터입니다: `outdoor.csv`에서 `studio`를 `no`에서 `yes`로 바꾸면 다음 배포에서 취소선과 예약 중단 안내가 *둘 다* 사라지며, 템플릿이나 로케일을 고칠 필요가 없습니다. 둘은 결코 어긋날 수 없습니다. 다른 값(예: `maybe`)은 조용히 추측하지 않고 빌드를 실패시킵니다.

**`price`가 양의 정수가 아니면 `-`로 렌더링됩니다.** 자리 표시자 허용 목록은 없습니다.
빈 칸, `N/A`, `TBD`, 잘못 입력한 숫자(`1OO`), `0`, 음수는 모두 "가격 미공개"를
뜻합니다. 카드는 `CNY` 접두사와 단위 접미사를 유지한 채 숫자만 `-`가 되어
(`CNY - / 장`), 레이아웃이 숫자 티어와 똑같이 유지됩니다. `-`는 `0`도 "무료"도
아니며, 한 파일에 이런 셀과 숫자 행을 섞어도 됩니다.

나머지 계약은 다음과 같습니다:

- convention 행은 CSV에서 **촬영 장수 오름차순**으로 옵니다. 티어 수는
  고정이 아닙니다(12장 행을 추가해도 코드 변경이 필요 없음)
- convention 티어는 `CONVENTION_UNIT_KEYS`에 등록된 경우에만 단위 접미사를
  받습니다. 등록되지 않은 티어는 숫자만 렌더링합니다
- outdoor 행은 네 가지 `type/people` 조합을 모두 포함해야 하며, 행 순서와 무관하게
  고정된 순서(스튜디오 1인/2인, 그다음 야외 1인/2인)로 렌더링됩니다

파일 누락, 잘못된 컬럼, 중복 티어, 알 수 없는 티어, 인식할 수 없는 `bookable` 값은
**빌드를 실패**시킵니다 — 잘못된 가격표는 빌드 실패보다 나쁩니다. 가격 셀만은
빌드를 실패시키지 않습니다: 양의 정수로 해석되지 않는 내용은 모두 `-`로
렌더링됩니다. `tests/test_services_pricing.py`가 이런 모든 경우와
커밋된 CSV에 대한 왕복(round-trip) 검사까지 커버합니다.

`docs/services/`는 VitePress 빌드에서 제외되므로(`docs/.vitepress/config.mts`의
`srcExclude`) CSV는 데이터 소스로 남고 docs.comicine.com에 게시되지 않습니다.

### 성능 / 엣지 캐싱

- `public/_routes.json`은 `/static/*`과 루트 정적 자산을 Pages
  Functions에서 제외하므로 CSS/JS/폰트는 Pages 자산 서버가 직접 제공합니다.
- `src/static/files/`의 파일은 원래 하위 경로를 유지한 채 빌드 결과물의 `/public/files/`에 복사되므로 `src/static/files/<path>`는 `https://comicine.com/public/files/<path>`에서 제공됩니다.
  `/public/files/*`는 Pages Functions를 우회하고 정적 자산과 같은 1일 캐시 정책을 사용하며, 존재하지 않는 경로는 404를 반환합니다.
- `public/_headers`는 버전이 지정된 정적 자산에
  `stale-while-revalidate`와 함께 긴 브라우저 캐시를 부여합니다.
  `public/_routes.json`과 `_headers`는 모두 `src/build.py`가 생성합니다.
- 사전 렌더링된 공개 HTML은 **프로세스 내 페이지 캐시**로 재사용됩니다
  (키: host + 언어). 응답은
  `private, max-age=300, stale-while-revalidate=3600`과
  `Vary: Accept-Language`를 알립니다. `private`는 게이트로 보호되는 HTML이 공유
  캐시에 들어가지 않게 하는데, 그 변형이 `Vary`로는 다루지 않는 언어 쿠키에
  달려 있기 때문입니다. 여기서 **엣지 캐싱을 주장하지 않습니다**:
  Cloudflare는 Pages Functions 응답을 캐시하지 않으므로(반복 요청에서도
  `cf-cache-status`는 `DYNAMIC`에 머뭅니다) 공유 캐시 수명 지시문은 죽은 설정이 되고,
  언어 쿠키는 브라우저 캐시만 잘게 쪼갤 뿐이므로 `Vary`에 넣지 않습니다.
- 자사 포트폴리오 썸네일, QR 코드와 favicon은
  `images.comicine.com/static/...`(정적 엣지 캐시, Functions 우회)을 사용합니다.
  사이트 페이지는 워터마크 Worker를 호출하지 않으며, Worker는 직접 및 이전 이미지 URL을 위해 계속 배포됩니다.
- 포트폴리오 원본은 절대 공개하지 않습니다: `/static/portfolio/<img>`는 404를 반환합니다.
  깨끗한 썸네일(`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`)과
  `image.comicine.com`의 정규화·워터마크된 `/portfolio/<img>`만 공개되며,
  원본은 git에서 제외된 `src/static/portfolio/`와 비공개 R2 버킷
  `comicine-originals`(`ops/upload_originals.sh`)에 남습니다.
- Turnstile 검증에는 3초의 서버 측 타임아웃이 있어, Cloudflare
  챌린지 플랫폼 장애 시 사용자를 최대 8초까지 붙잡아 두는 대신 빠르게
  fail closed 합니다.

### 현재 배포 및 마이그레이션 상태

현재 배포 및 외부 리소스 상태입니다. `python3 ops/readme_facts.py --live`로 언제든 다시 읽을 수 있습니다:

1. **Pages**: 프로덕션 프로젝트 `comicine`이 `comicine.com`, `www`, `services`, `contact`, `auth`, `visitor`, `account`, `identity`, `images`, `redirect`를 제공하고, 암호화된 런타임 설정과 함께 `comicine.pages.dev`를 소유합니다. 사용을 중단한 `comicine-production` 프로젝트는 프로덕션 사용자 지정 도메인이 없으며 사용자가 직접 삭제하도록 남겨 두었습니다. Docs 프로젝트는 `comicine-docs`이고 `comicine-docs.pages.dev`에 있으며 `docs.comicine.com`이 이를 제공합니다. `image.comicine.com`은 워터마크 Worker, `fonts.comicine.com`은 R2를 사용하며, `status.comicine.com` / `sink.comicine.com`은 Worker 사용자 지정 도메인입니다
2. **D1**: 새 `comicine` 데이터베이스(APAC)가 프로비저닝되어 사용 중인 운영 테이블을 적재했습니다. Pages 프로덕션과 프리뷰 바인딩 설정이 이제 이 데이터베이스를 가리키며, 독립 Worker 바인딩도 이번 릴리스에 포함됩니다. 최종 가져오기는 Apple Account 레코드를 그대로 보존하고 이전 방문자 해시와 상세 텔레메트리는 제외합니다. `blocked_ips`가 계속 차단의 권위이며, 소프트 삭제된 행은 감사를 위해 남습니다
3. **시크릿**은 **Pages → Settings → Environment variables → Encrypt** 아래에 있습니다: 아홉 개의 런타임 시크릿에는 Turnstile 한 쌍, `GATE_HMAC_KEY`, `SESSION_HMAC_KEY`, `OBSERVABILITY_HMAC_KEY`, `VISITOR_IP_KEY`, `APPLE_ACCOUNT_ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_IDENTITY_AUD`가 포함됩니다. 더 이상 쓰지 않는 `ACCESS_ADMIN_AUDS`와 `ACCESS_VIEWER_AUDS` 변수는 런타임 코드가 읽지 않으므로 복사하지 않았고, 폐기된 AppleID 및 Authentik 시크릿도 구성되어 있지 않습니다
4. **Access**: `ComiCine`이 `identity.comicine.com/login`을 보호하며, `visitor.comicine.com`과 `account.comicine.com`은 공유 identity handoff와 각자의 호스트 전용 Pages 세션을 사용합니다. 더 이상 쓰지 않는 `identity.limooo.cn/login` 대상은 애플리케이션 AUD와 정책을 유지한 채 2026-10-29에 제거했습니다. `admin.limooo.cn`용으로 쓰지 않던 `ComiCine-Admin` 앱도 제거했고, 그 호스트 이름에는 DNS 레코드도 Pages 사용자 지정 도메인도 없습니다. 자체 호스팅 IdP나 사용자 지정 로그인 폼은 없습니다
5. **Worker**는 독립 실행됩니다: `comicine-status`, `comicine-blocklist-sync`, `comicine-d1-archive`, `comicine-image-watermark`, `comicine-sink`이며, 이들의 계정 하위 도메인은 이제 `comicine.workers.dev`입니다. `status.comicine.com`, `image.comicine.com`, `sink.comicine.com`은 Worker 사용자 지정 도메인입니다. 상태 Worker는 `comicine-status_ComiCineProbeStateV2`를 사용하며, 새 바인딩을 확인한 뒤 이전 네임스페이스를 제거했습니다. `comicine-sink` 데이터베이스를 가져왔고 `comicine_sink` dataset을 구성했으며 Sink Worker를 배포했고, 유효한 단축 링크가 Location 헤더와 함께 302를 반환했습니다
6. **Cloudflare 규칙**: 활성화된 WAF 또는 Cache Rules가 없으며, 라이브 IP List는 `comicine_blocklist`입니다. `.com` 영역의 동적 리디렉션 단계는 비어 있고, 레거시 `.cn` 영역은 요청을 대응하는 `.com` URL로 리디렉션합니다(GET/HEAD 301, 다른 메서드 308). 경로와 쿼리는 유지됩니다. 이어서 `comicine.com/feishu/<path>`와 `/lark/<path>`는 Pages를 통해 302로 `https://comicine.feishu.cn/<path>`에 전달되며 경로와 쿼리를 유지합니다.
7. **스모크 검사**: `https://comicine.com/_health` → 200, `https://comicine.com/?challenge=1` → 403, `https://docs.comicine.com/` → 404, `https://status.comicine.com/` → 200

Cloudflare 계정 표시 이름은 구성된 API 토큰에 `Account Settings Write`가 없어서 아직 업데이트하지 못했습니다. Sink의 대상 D1 데이터베이스는 `comicine-sink`이고 `comicine_sink` Analytics Engine dataset을 함께 씁니다. 상태 Durable Object 대상은 위에 정리되어 있습니다.

게이트는 모든 호스트에서 그 자리에서 렌더링되고, 게이트 페이지와 로그에 실제 방문자 IP가 표시되며, Access가 유일한 신원 소스로 남습니다. 2026-10-27에 제공된 Cloudflare 대시보드 스크린샷에는 Turnstile 위젯의 Hostname Management에 `comicine.com`이 있습니다. `Turnstile Sites Write` 권한은 이제 활성화되어 위젯 API가 HTTP 200을 반환하며, 그 호스트 이름 목록에 `comicine.com`이 포함됩니다. 사용자의 2026-10-29 스크린샷은 `comicine.pages.dev/?challenge=1`에서 촬영되었습니다: Turnstile은 성공을 표시했지만 D1에는 `/gate/verify`가 403 `hostname_rejected`를 반환한 기록이 있습니다. 서버가 Pages 호스트 이름을 공개 호스트로 의도적으로 거부하기 때문입니다. 정식 `comicine.com`에서 실제 브라우저 챌린지가 성공하는지는 아직 확인되지 않았습니다. 검증을 우회하거나 약화하지 말고, Pages 호스트 이름을 공개 호스트 allowlist에 추가하지 마세요.

## 라이선스

ComiCine가 소유하고 라이선스하는 독창적 소프트웨어 자료는 GNU Affero General Public License 제3판 또는 그 이후 버전(AGPL-3.0-or-later)에 따라 제공됩니다. GNU AGPL v3 라이선스 전문은 [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt)에 있고, 참고용 번역은 [중국어 간체](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_zh_CN.txt), [일본어](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ja_JP.txt), [한국어](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE_ko_KR.txt)로 있습니다. GNU AGPL v3 제7조에 따른 추가 조건은 [ADDITIONAL_TERMS.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS.txt)에 있으며, 참고용 번역은 [중국어 간체](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_zh_CN.txt), [일본어](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ja_JP.txt), [한국어](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ko_KR.txt)로 있습니다. 이 추가 조건들은 저작물을 GNU AGPL v3로 사용하는 경우에 적용되며, 이후 버전으로 사용할 때의 적용 여부는 해당 버전의 조건에 따릅니다. 영어 추가 조건이 정본이며, 번역은 참고용으로 제공됩니다.

ComiCine는 프로젝트 개발 브랜드이자 공개 표기이며, 저작권은 실제 권리자에게 있습니다. 적용되는 저자 표시와 저작권 고지(합리적인 출처 고지 포함)를 보존하세요. 저작권 범위는 [COPYRIGHT.md](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT.md)를, 확인된 제3자 자료와 플랫폼 표장은 [THIRD_PARTY_NOTICES.md](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES.md)를 참고하세요. 적용되는 AGPL 버전의 조건을 준수하는 상업적 이용은 허용됩니다.

추가 승인 또는 상표 사용 허가 문의: [contact@comicine.com](mailto:contact@comicine.com). 적용되는 GNU AGPL 버전을 준수하는 상업적 이용에는 별도 승인이 필요하지 않습니다.
