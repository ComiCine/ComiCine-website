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
- **공유 로그인 이동**: 인증되지 않은 브라우저 페이지 요청은 HTTP 401 HTML을 반환하고, 같은 출처의 외부 스크립트가 `identity.comicine.com/login`으로 이동합니다. 이후 Cloudflare Access가 브라우저를 `comicine.cloudflareaccess.com` 로그인으로 보냅니다. API 인증 실패는 JSON 401로 유지됩니다.
- **모니터링**: `comicine-status` Worker가 매분 HTTP/D1 대상을 프로브(probe)하고, 프로브가 다운된 동안에는 10초마다 다시 확인하며 결과를 D1에 저장합니다. 알림은 webhook으로 나가고 Email binding이 대체 수단입니다
- **상태 페이지**(`status.comicine.com`): 같은 Worker가 D1에서 서버 렌더링하며, 4개 언어와 명시적 `?lang=` 재정의를 지원하고, 프로브 오류 코드에 대한 4개 언어 대조표와 브랜드가 적용된 404/503 장애 페이지를 제공합니다. 일별 가동률은 `probe_uptime_daily` 롤업(rollup)에서 가져옵니다
- **자동 IP 차단**:
  - D1 `blocked_ips`가 권위 데이터이고, `sync-worker`가 활성 행을 Cloudflare IP List로 미러링해 엣지에서 차단합니다(원본 서버가 없으므로 ipset/iptables도 없음)
  - 대체 수단으로 애플리케이션 계층 전역 필터가 있으며, 차단된 IP는 곧바로 403을 받습니다
- **통합 리다이렉트 페이지**(`redirect.comicine.com/?to=<https-url>`, `/r`도 허용): 모든 HTTPS 목적지로 리다이렉트하기 전에 중간 안내 페이지를 보여 줍니다
- **포트폴리오 이미지 처리**: 원본은 절대 공개하지 않으며, 워터마크가 들어간 전체 이미지(`image.comicine.com/portfolio/*`)와 깨끗한 썸네일만 공개됩니다

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
├── LICENSE.txt                                        # GNU AGPL v3 공식 영문 본문
├── ADDITIONAL_TERMS.txt                               # Section 7 추가 조건
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

## 브랜드 리소스와 글꼴

- 홈페이지 히어로와 왼쪽 상단 내비게이션은 Delius Swash Caps로 정확한 브랜드명 `ComiCine`을 텍스트로 표시합니다. 포트폴리오가 열릴 때 같은 워드마크 요소가 화면 중앙에서 내비게이션으로 이동합니다. 색상은 테마의 텍스트 색상을 따라 흑백으로 표시됩니다.
- 브라우저 파비콘과 작은 웹 표식에는 `src/static/icons/comicine-favicon.svg`를 사용합니다. 가로형 워드마크와 기본 소셜 미리보기 이미지에는 `src/static/icons/comicine-xtext.svg`를 사용합니다. PNG 파일은 Apple 터치 아이콘과 이메일·소셜 미디어처럼 래스터 이미지가 필요한 경우에만 사용합니다. `src/static/icons/comicine-watermark.png`는 이미지 워터마크 파이프라인 입력으로 계속 사용합니다.
- 자체 호스팅 Delius Swash Caps 서브셋과 OFL 라이선스는 `src/static/fonts/delius-swash-caps/`에 있습니다. 브랜드 표기의 정확한 단어 `ComiCine`에 이 글꼴을 사용합니다. Copyright 영역은 기호와 연도에 기존 글꼴을 유지하고 `ComiCine`에만 Delius를 적용합니다. 상태 Worker에는 필요한 서브셋을 포함하며 나머지 텍스트는 기존 글꼴 스택을 유지합니다.
- 프로덕션 빌드는 번들된 글꼴 서브셋을 사용하므로 개발 컴퓨터의 원본 글꼴 디렉터리에 의존하지 않습니다.

## 빠른 시작

```bash
# package-lock.json으로 고정된 Node 의존성을 설치합니다
npm ci

# 정적 사이트를 빌드합니다(Python 가상 환경 + 계약 검증 + public/ + preview/)
npm run build
```

`npm run build`는 `ops/build.sh`입니다. 저장소 외부에
`/tmp/comicine-build-venv`를 만들고 `requirements.lock`의 고정 의존성을 설치한 뒤,
렌더링 전에 런타임 간 설정을 검증합니다. 작품 워터마크는 Pillow와
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
# Python 테스트
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
Worker Cron Triggers로 동작합니다:

| 스케줄 | Worker | 작업 |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | 매분 HTTP/D1 프로브; 프로브가 다운된 동안 Durable Object 알람이 10초마다 다시 확인하고 상태가 바뀌면 알립니다 |
| `47 3 * * *` | `ops/status-worker` | D1 보존(`src/retention.ts`): `ray_log_v2`(7일), `visitors_v2`(30일), `visitor_rollups`(30일), `heartbeats`(30일), `events`(90일), `probe_uptime_daily`(90일), `auth_sessions`(60일), `identity_handoffs`(1일) 정리 |
| `30 3 * * *` | `ops/sync-worker` | 활성 D1 `blocked_ips` 행을 Cloudflare IP List `comicine_blocklist`로 미러링 |
| `0 0 * * *` | `ops/d1-archive` | D1 스냅샷/아카이브 |

`python3 ops/readme_facts.py --check`는 위 스케줄, 보존 기간, TTL, 디렉터리 트리를
저장소에서 다시 읽어 이 페이지와 어긋나면 실패합니다. `--live`는 배포된 상태
(D1 카운트, Pages 호스트와 시크릿, DNS, WAF, Worker 스케줄)를 Cloudflare에서 읽습니다.

TLS 인증서는 Pages 사용자 지정 도메인에 대해 Cloudflare가 발급하고 갱신합니다.
`ops/migrate_d1.sh`와 `ops/workers_deploy.sh`는 수동 실행하는
`--dry-run` 지원 유지보수 진입점입니다.

## 배포

배포 대상은 프로덕션 Pages 프로젝트 `comicine`, Docs 프로젝트 `comicine-docs` 및 독립 Worker입니다. 프로덕션 프로젝트는 `comicine.pages.dev`와 모든 프로덕션 사용자 지정 도메인을 제공하며 암호화된 런타임 설정을 보유합니다. Docs 별칭은 `comicine-docs.pages.dev`이며 Workers 계정 하위 도메인은 `comicine.workers.dev`입니다.
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
Pages + docs, 즉 "전체 배포" 계약입니다. 로컬에 이미 커밋된 것만 배포하려면
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
결정하며, docs 루트 `/`는 `https://comicine.com`으로 302됩니다.

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
프로젝트(`comicine-docs`)이므로 메인 사이트 산출물을 절대 건드리지 않으며, 메인
사이트와 `user_lang_preference` / `comicine_theme` 쿠키를 공유합니다.

```bash
bash ops/docs_deploy.sh --build-only   # build + validate only
bash ops/docs_deploy.sh --dev          # local VitePress dev server
```

## 보안 설계

- 세션 쿠키는 `Secure` + `HttpOnly` + `SameSite=Lax`를 사용하고 현재 호스트에만
  제한됩니다. 따라서 세션 쿠키를 다른 사이트에서 재사용할 수 없습니다. 모든 세션은 D1 `auth_sessions`에 기록된 무작위 `sid`를 가지며,
  `requireAuth`는 폐기되거나 만료된 세션을 거부합니다. 런타임 HMAC 키가 없거나
  `auth_sessions` 테이블을 사용할 수 없으면 503으로 fail closed 합니다.
- 게이트도 fail closed입니다: `TURNSTILE_SECRET`, `GATE_HMAC_KEY`,
  `SESSION_HMAC_KEY`가 비어 있으면 엣지는 페이지를 렌더링하거나 서명 없는 쿠키를
  발급하는 대신 503을 응답합니다.
- `__gate` 쿠키는 `<unix-expiry>.<HMAC-SHA256 hex>`(TTL 1시간, `HttpOnly`,
  `Domain=.comicine.com`)이며 전적으로 엣지에서 발급하고 검증합니다.
- 인증되지 않은 브라우저가 보호 페이지를 열면 원본 사이트가 짧은 state 쿠키를 설정한 HTTP 401 HTML을 반환합니다. 같은 출처의 외부 스크립트가 `identity.comicine.com/login`으로 이동하고, Cloudflare Access가 브라우저를 `comicine.cloudflareaccess.com` 로그인으로 보냅니다. API 인증 실패는 JSON 401로 유지됩니다. identity 호스트의 Pages Function이 `Cf-Access-Jwt-Assertion`(RS256, JWKS 1시간 캐시)을 검증하고 원본 호스트와 state에 바인딩된 해시 일회용 D1 코드를 만듭니다. 원본 사이트 callback이 서버 간 요청으로 코드를 소비하고 로컬 설정의 역할을 적용합니다. 전달 데이터에는 역할이 포함되지 않습니다. 현재 visitor 및 account 사이트의 API는 모두 admin 세션을 요구합니다.
- 키와 암호문은 분리해 보관하며 저장소에 절대 커밋하지 않습니다
- 차단 계층: 애플리케이션 계층의 D1 차단 목록이 엣지에서 403을 반환하고,
  `ops/sync-worker`가 활성 행을 Cloudflare IP List `comicine_blocklist`에 맞춰 둡니다
  (WAF 규칙이 쓰도록 되어 있지만 그 사용자 지정 규칙은 현재 배포되어 있지 않습니다)
- 관리자 쓰기(생성/수정/삭제)에는 admin 역할이 필요하며, viewer는 읽기 전용입니다
- 방문자 IP는 목록 API에서 절대 반환하지 않습니다. 전체 IP는
  `visitor_rollups.ip_enc`에 Fernet으로 암호화하고 관리자에게 한 행씩 복호화합니다

## 화이트리스트

신뢰할 소스는 [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt)에서 수동 관리하며, 배포할 때 생성 파일 [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt)에 반영됩니다.

| 항목 | 효과 |
| --- | --- |
| `ASN/<number>` | 선택 항목이며 Cloudflare zone 수준 ASN Access Rule에 사용됩니다. zone 규칙을 바꾸려면 `bash ops/waf_whitelist.sh --apply`를 수동 실행하세요. ASN 항목은 Pages Functions 게이트를 우회하지 않습니다. |
| `IP-CIDR/<ip>/<mask>` | Pages 엣지에서 완전히 허용되는 소스입니다(예: `IP-CIDR/97.64.18.11/32`). IPv4는 `/24`–`/32`, IPv6는 `/64`–`/128` 프리픽스만 허용하며 차단 목록과 챌린지 게이트를 모두 건너뜁니다. |

현재 생성 목록에는 **ASN 항목 0개**와 **IP-CIDR 2개**가 있습니다. 전체 배포는 로컬 화이트리스트만 생성하고 zone 수준 ASN Access Rules는 변경하지 않습니다. `own-ips.txt`를 수정한 뒤 배포하면 `ops/sync_whitelist.py`가 실행되고, 빌드에서 `ops/check_gate_trust.py --emit`이 엣지 사본을 생성합니다.

## 신뢰의 원천(source of truth)

- 사용자 노출 문자열: `locales/*.json`; `functions/_data/*`와 API i18n 라우트는 여기서 생성됩니다.
- 공유 런타임 상수: `config-contract.json`은 런타임 간에 합의된 계약이며, `src/config.py`와 생성된 `functions/_lib/config.ts`가 이를 함께 사용하고 `ops/check_config_contract.py`가 일치를 강제합니다.
- 게이트/리다이렉트 문구: `functions/_data/runtime.ts`를 통한 `locales/*.json`이며, `src/build.py`가 이를 조립합니다.
- D1 스키마와 마이그레이션: `ops/migrations/*.sql`; 차단에 관한 한 `blocked_ips`가 유일한 권위입니다.
- 보안 응답 헤더 기준선(활성화된 경우): `ops/security-headers.json`.
- 배포 및 런타임 경계: `ops/deploy.sh`. 런타임은 Cloudflare Pages와 Workers뿐입니다.

## Cloudflare Pages 런타임

공개 사이트(홈 / 서비스 / 문의, 게이트, 방문자 패널, Apple Account 관리자, `images.comicine.com` 정적 자산 호스트와 리디렉션 릴레이)는 프로덕션 Pages 프로젝트 `comicine`에서 실행되며 상태 페이지와 모든 예약 작업도 마찬가지입니다. 프로덕션 프로젝트는 `comicine.pages.dev`와 모든 프로덕션 사용자 지정 도메인을 제공하며 암호화된 런타임 설정을 보유합니다. Docs Pages 프로젝트는 `comicine-docs.pages.dev`를 사용합니다.

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
  `functions/_data/runtime.ts`(게이트/리다이렉트 i18n + 프리로드 자산)를 생성합니다
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

모든 요청은 서명된 `__gate` 쿠키를 검사합니다. Cloudflare `botManagement.verifiedBot`은 검증된 검색 엔진 신뢰 신호로 인정합니다. 임의의 `Googlebot`/`GPTBot` User-Agent 문자열과 클라이언트가 제공한 `cf_clearance` 쿠키는 게이트를 우회하지 못합니다. 엣지 코드는 생성된 화이트리스트(`docs/lists/whitelist.txt` → `functions/_data/gateTrust.ts`)의 IP-CIDR 항목만 완전 우회 대상으로 신뢰합니다.

검증되지 않은 요청은 Turnstile 게이트 페이지를 **그 자리에서** 받습니다: 호스트와 경로는 절대 바뀌지 않습니다. 미들웨어(middleware)는 요청된 URL에 `public/<lang>/auth.html`을 상태 `403`으로 렌더링하고, `POST /__gate/verify`가 같은 오리진에서 `Set-Cookie: __gate=…`(1시간, `Domain=.comicine.com`)와 함께 응답하면 페이지가 원래 목적지로 다시 로드합니다. `auth.comicine.com`은 게이트 호스트로, 자체 루트에서 같은 페이지를 제공하며 `/__gate/config|diag|verify` 엔드포인트를 소유합니다.

게이트를 렌더링하는 모든 호스트는 동일한 엣지 코드가 처리하므로, 동기화해야 할 두 번째 게이트 구현이 없습니다.

미들웨어는 정규화된 D1 차단 목록도 강제하고 프라이버시를 최소화한 방문자 분석을 기록합니다. 게이트 페이지는 `no-store`/`noindex`이며 다크/라이트 테마 전환을 지원합니다. 사용자가 `Turnstile Sites Write` 권한을 부여했으며, 위젯 API는 이제 HTTP 200을 반환하고 허용 호스트 목록에 `comicine.com`이 있습니다. 사용자의 2026-10-29 스크린샷은 `comicine.pages.dev/?challenge=1`에서 촬영되었습니다. Turnstile은 성공을 표시했지만 D1에는 `/gate/verify`가 403 `hostname_rejected`를 반환한 기록이 있습니다. 서버는 Pages 호스트를 공개 호스트로 의도적으로 거부합니다. 정식 `comicine.com`에서 실제 브라우저 챌린지가 성공하는지는 아직 확인되지 않았습니다. `auth.js`는 수동 재시도 버튼을 표시하고 브라우저 콘솔에 Turnstile 숫자 오류 코드를 기록합니다. 게이트를 끄거나 Pages 호스트를 공개 호스트 allowlist에 추가하지 마세요.

### 페이지 제공(clean URL, 언어 경로 접두사 없음)

`src/build.py`가 4개 언어로 `public/<lang>/`을 사전 렌더링합니다. 게이트를 통과하면 미들웨어가 **cookie > Accept-Language > CF region > en-US** 순으로 언어를 고르고 `env.ASSETS.fetch()`로 해당 페이지를 가져와 URL을 깔끔하게 유지합니다:

- `comicine.com/` → 홈 페이지; `comicine.com/services` / `comicine.com/contact` → 각각 해당 페이지
- `services.comicine.com/` → 서비스 페이지; `contact.comicine.com/` → 문의 페이지(서브도메인이 콘텐츠를 직접 제공하며 메인 사이트로 301하지 않음)
- `visitor.comicine.com/` → 방문자 패널(로그인 필요); `account.comicine.com/apple` → Apple Account 관리자(로그인 필요)
- `images.comicine.com/` → `comicine.com/`으로 301, 다른 경로에서는 포트폴리오 이미지, favicon, logo, QR 코드 등의 정적 자산 제공. `image.comicine.com/portfolio/<img>` → 정규화 Worker가 만든 워터마크 버전(이 호스트의 루트도 `comicine.com/`으로 301)
- `www.comicine.com` → 메인 사이트로 301
- 루트의 `x.html` 별칭은 `x`가 실제 공개 홈페이지 하위 도메인(`services`, `contact`, `docs`, `status`)이면 `x.comicine.com/`으로 302 전달되고, 알 수 없는 이름이면 현재 사이트의 홈페이지로 302 전달됩니다. `index.html`은 현재 호스트의 표준 홈페이지로 이동합니다.
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
  (키: host + 언어). 응답은 브라우저 프라이빗 캐시용으로
  `public, max-age=300, stale-while-revalidate=3600`과 `Vary: Accept-Language`를 알립니다.
  여기서 **엣지 캐싱을 주장하지 않습니다**: 실측 `cf-cache-status`는 항상 `DYNAMIC`이며,
  Pages Functions 응답은 Cloudflare 엣지 캐시에 저장되지 않으므로 공유 캐시 수명 지시문은 죽은 설정입니다.
  `Vary: Cookie`도 넣지 않습니다——언어 cookie는 브라우저 캐시를 잘게 쪼갤 뿐입니다.
- 자사 포트폴리오 썸네일과 favicon은 워터마크 Worker 대신
  `images.comicine.com/static/...`(정적 엣지 캐시, Functions 우회)을
  사용합니다. QR 코드와 외부에서 핫링크한 이미지는 여전히 `image.comicine.com`을
  사용합니다.
- 포트폴리오 원본은 절대 공개하지 않습니다: `/static/portfolio/<img>`는 404를 반환합니다.
  깨끗한 썸네일(`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`)과
  `image.comicine.com`의 정규화·워터마크된 `/portfolio/<img>`만 공개되며,
  원본은 git에서 제외된 `src/static/portfolio/`와 비공개 R2 버킷
  `comicine-originals`(`ops/upload_originals.sh`)에 남습니다.
- Turnstile 검증에는 3초의 서버 측 타임아웃이 있어, Cloudflare
  챌린지 플랫폼 장애 시 사용자를 최대 8초까지 붙잡아 두는 대신 빠르게
  fail closed 합니다.

### 현재 배포 및 마이그레이션 상태

현재 배포 및 마이그레이션 상태입니다. `python3 ops/readme_facts.py --live`로 언제든 다시 읽을 수 있습니다:

1. **Pages**: 프로덕션 프로젝트 `comicine`이 메인 사이트 Pages 호스트를 제공하며 `comicine.pages.dev`와 모든 프로덕션 사용자 지정 도메인을 소유합니다. Docs 프로젝트는 `comicine-docs`이며 `comicine-docs.pages.dev`와 `docs.comicine.com`에서 제공됩니다. `image.comicine.com`은 워터마크 Worker, `fonts.comicine.com`은 R2, `status.comicine.com`과 `sink.comicine.com`은 Worker 사용자 지정 도메인입니다.
2. **D1**: 새 메인 데이터베이스 `comicine`(APAC)은 생성되어 사용 중인 운영 테이블을 가져왔습니다. Pages 프로덕션과 프리뷰 바인딩 설정은 새 데이터베이스를 가리키며, 독립 Worker 바인딩은 이번 릴리스에서 전환합니다. 최종 가져오기는 Apple Account 레코드를 그대로 보존하고 이전 방문자 해시와 상세 텔레메트리는 제외합니다. Sink의 `comicine-sink` 데이터베이스에는 29개 행을 가져왔고 `comicine_sink` Analytics Engine dataset 및 Worker 전환도 완료했습니다.
3. **시크릿**은 **Pages → Settings → Environment variables → Encrypt** 아래에 있습니다: Turnstile 두 개, `GATE_HMAC_KEY`, `SESSION_HMAC_KEY`, `OBSERVABILITY_HMAC_KEY`, `VISITOR_IP_KEY`, `APPLE_ACCOUNT_ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN`, `ACCESS_IDENTITY_AUD`. 이전 `ACCESS_ADMIN_AUDS`와 `ACCESS_VIEWER_AUDS` 시크릿은 설정에 남아 있지만 런타임에서 읽지 않습니다. `APPLEID_ENCRYPTION_KEY`와 두 개의 `AUTHENTIK_*`도 사용되지 않는 잔재입니다
4. **Access**: `ComiCine`은 `identity.comicine.com/login`을 보호하고 visitor/account는 공유 identity handoff를 사용합니다. 사용하지 않는 `ComiCine-Admin` 앱은 2026-10-29에 삭제되었습니다. `admin.limooo.cn`에는 DNS 레코드나 Pages 도메인이 없습니다.
5. **Worker**는 독립 실행됩니다: `comicine-status`, `comicine-blocklist-sync`, `comicine-d1-archive`, `comicine-image-watermark`, `comicine-sink`. Workers 계정 하위 도메인은 `comicine.workers.dev`입니다. `status.comicine.com`, `image.comicine.com`, `sink.comicine.com`은 Worker 사용자 지정 도메인입니다. 상태 Worker는 `comicine-status_ComiCineProbeStateV2`를 사용하며 새 바인딩이 작동하는 것을 확인한 뒤 이전 네임스페이스를 삭제했습니다. Sink의 유효한 단축 링크가 Location 헤더와 함께 302를 반환했습니다.
6. **Cloudflare 규칙**: 현재 활성화된 WAF 또는 Cache Rules가 없습니다. IP List는 `comicine_blocklist`이며 참조하는 WAF 필터가 없습니다. `.com` 동적 리디렉션 단계는 비어 있습니다. 기존 `.cn` 영역은 요청을 해당 `.com` URL로 리디렉션합니다(GET/HEAD 301, 다른 메서드 308). 경로와 쿼리는 유지됩니다. 이어서 `comicine.com/feishu/<path>`와 `/lark/<path>`는 Pages를 통해 302로 `https://comicine.feishu.cn/<path>`에 전달되며 경로와 쿼리를 유지합니다.
7. **스모크 검사**: 각 배포 후 `https://comicine.com/_health`, `https://docs.comicine.com/`, `https://status.comicine.com/`, `https://sink.comicine.com/`을 확인합니다. `https://comicine.com/?challenge=1`에서 실제 브라우저 챌린지가 성공하는지는 아직 확인되지 않았습니다.

> Cloudflare 계정 표시 이름은 아직 업데이트되지 않았습니다. 권한 부족으로 이름 변경이 거부되었습니다. Turnstile API 권한은 활성화되었지만 정식 `.com` 호스트에서 실제 브라우저 챌린지가 성공하는지는 아직 확인되지 않았습니다.
참고: `?challenge=1`의 403은 게이트 페이지가 렌더링됐다는 뜻일 뿐 Turnstile 검증 성공을 증명하지 않습니다. 스크린샷의 `comicine.pages.dev`는 정식 호스트 검사에서 거부되었습니다. 확인하려면 `comicine.com`을 사용해야 합니다.

게이트는 모든 호스트에서 그 자리에서 렌더링되고, 게이트 페이지와 로그에 실제 방문자 IP가 표시되며, Access가 유일한 신원 소스로 남습니다.
## 라이선스

ComiCine가 저작권을 보유하고 라이선스할 권한이 있는 독창적 자료는 GNU Affero General Public License 제3판 또는 그 이후 버전(AGPL-3.0-or-later)에 따라 제공됩니다. GNU AGPL v3 제7조에 따른 추가 조건은 [ADDITIONAL_TERMS_ko_KR.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS_ko_KR.txt)에, GNU AGPL v3 전문은 [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt)에 있습니다. 추가 조건은 GNU AGPL v3를 적용하는 경우에 적용되며, 이후 버전에 적용되는지는 해당 버전의 조건에 따릅니다.

ComiCine는 프로젝트에서 사용하는 개발 브랜드이자 공개 표기입니다. 저작권은 법적으로 해당 권리를 보유한 실제 권리자에게 있습니다. 재배포 시 적용되는 저자 표시와 저작권 고지(합리적인 출처 고지 포함)를 보존해야 합니다. 적용되는 AGPL 버전의 조건을 준수하면 상업적 이용이 허용됩니다.

추가 승인 또는 상표 사용 허가 문의: [contact@comicine.com](mailto:contact@comicine.com). 적용되는 GNU AGPL 버전을 준수하는 상업적 이용에는 별도 승인이 필요하지 않습니다.

제3자 글꼴, 종속 항목 및 QR 코드 이미지에 표시된 플랫폼 표장은 [제3자 고지](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES_ko_KR.md)를, 저작권 범위는 [저작권 안내](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT_ko_KR.md)를 참조하세요.
