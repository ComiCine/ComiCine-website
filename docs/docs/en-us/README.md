---
aside: false
title: Project README
description: "The ComiCine website and admin system (fully serverless on Cloudflare) - project README"
---
<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->


# ComiCine

A fully serverless personal website and admin system running at [comicine.com](https://comicine.com). Public pages, the human-verification gate, the visitor panel, the Apple Account manager, monitoring and the status page all run on Cloudflare (Pages Functions, Workers, D1, R2).

## Features

- **Public pages**: Home, Services, Contact, Portfolio — pre-rendered in 4 languages with dark/light theme switching
- **Human verification**: the Turnstile gate page is rendered **in place** at the requested URL (no cross-domain hop) on every host — see [Gate behavior](#gate-behavior)
- **Visitor panel** (`visitor.comicine.com`): Pages Function + D1 analytics; shows a hashed visitor identifier (no raw IP in list APIs), country, ISP/ASN where available, status-code distribution, and is login-protected
- After the first load, visitor status chips filter locally with no new `/api/visitors` request; the API still accepts `?status=<3-digit>` for deep links.
- **Apple Account manager** (`account.comicine.com/apple`): Pages Function + D1 CRUD with drag-and-drop ordering; passwords are stored encrypted with Fernet, the list shows only masked passwords, with temporary plaintext reveal
- **Auth & roles**: one `ComiCine` Access application protects `identity.comicine.com/login`; the identity Pages Function verifies its JWT and returns a short-lived, one-time D1 handoff bound to the registered source host, then that host applies its local role. Both current protected hosts require admin sessions.
- **Shared login navigation**: an unauthenticated browser page request receives HTTP 401 HTML, then a same-origin external script navigates to `identity.comicine.com/login`; Cloudflare Access sends the browser through `comicine.cloudflareaccess.com`. API authentication failures remain JSON 401 responses.
- **Monitoring**: the `comicine-status` Worker probes HTTP/D1 targets every minute, re-checks every 10s while a probe is down, and stores results in D1; alerts go out over a webhook (Email binding as fallback)
- **Status page** (`status.comicine.com`): server-rendered from D1 by the same Worker in 4 languages with an explicit `?lang=` override, a four-language probe error-code table, branded 404/503 failure pages, and per-day uptime taken from the `probe_uptime_daily` rollup
- **Automatic IP blocking**:
  - D1 `blocked_ips` is the authority; `sync-worker` mirrors active rows to a Cloudflare IP List for edge interception (no origin, so no ipset/iptables)
  - Application-layer global filter as a fallback — banned IPs get a direct 403
- **Unified redirect page** (`redirect.comicine.com/?to=<https-url>`, `/r` also accepted): shows an interstitial before redirecting to any HTTPS destination
- **Portfolio image handling**: originals are never published; only watermarked full images (`image.comicine.com/portfolio/*`) and clean thumbnails are public

## Tech stack

| Layer | Technology | Runs on |
| --- | --- | --- |
| Public pages, gate, visitor panel, Apple Account manager, status page | Pages Functions (`functions/`) + pre-rendered static HTML | Cloudflare edge |
| Data | D1 (visitor analytics, blocklist, Apple Account accounts, auth sessions, probes/heartbeats) | Cloudflare |
| Human verification | Cloudflare Turnstile, gate page rendered in place | Cloudflare + browser |
| Auth | Cloudflare Access (Zero Trust JWT, verified by a Pages Function) | Cloudflare |
| Monitoring & retention | `ops/status-worker` (Cron Triggers + Durable Object alarms) | Cloudflare Workers |
| D1 archive | `ops/d1-archive` (daily cron) | Cloudflare Workers |
| Blocklist sync | `ops/sync-worker` (daily cron → Cloudflare IP List) | Cloudflare Workers |
| Image watermarking | `ops/image-watermark` (path-normalizing proxy) | Cloudflare Workers |
| Static assets / originals backup | Pages asset server + private R2 bucket `comicine-originals` | Cloudflare |
| Deployment | `ops/deploy.sh` (git + `ops/pages_deploy.sh` + `ops/workers_deploy.sh`) | local |

## Project structure

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
├── LICENSE.txt                                        # Official GNU AGPL v3 text
├── ADDITIONAL_TERMS.txt                               # Section 7 additional terms
├── ADDITIONAL_TERMS_zh_CN.txt                         # Simplified Chinese translation
├── ADDITIONAL_TERMS_ja_JP.txt                         # Japanese translation
├── ADDITIONAL_TERMS_ko_KR.txt                         # Korean translation
├── COPYRIGHT.md                                      # Copyright and licensing information (English)
├── COPYRIGHT_zh_CN.md                                # Simplified Chinese translation
├── COPYRIGHT_ja_JP.md                                # Japanese translation
├── COPYRIGHT_ko_KR.md                                # Korean translation
├── THIRD_PARTY_NOTICES.md                            # Third-party notices (English)
├── THIRD_PARTY_NOTICES_zh_CN.md                      # Simplified Chinese translation
├── THIRD_PARTY_NOTICES_ja_JP.md                      # Japanese translation
├── THIRD_PARTY_NOTICES_ko_KR.md                      # Korean translation
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

## Brand assets and typography

- The homepage hero and upper-left navigation render the exact word `ComiCine` in Delius Swash Caps. The same wordmark element animates from the center into the navigation as the portfolio opens. Its color follows the theme text color for a monochrome black-and-white appearance.
- `src/static/icons/comicine-favicon.svg` is used for the browser favicon and small web marks. The horizontal wordmark and primary social-preview image use `src/static/icons/comicine-xtext.svg`. PNG counterparts are reserved for Apple touch icons and raster-only email or social surfaces. `src/static/icons/comicine-watermark.png` remains the input to the image-watermark pipeline.
- The self-hosted Delius Swash Caps subset is under `src/static/fonts/delius-swash-caps/`, with its OFL license alongside it. Brand wordmarks use it for the exact word `ComiCine`; Copyright lines keep their existing font for the symbol and years and use Delius only for `ComiCine`, at `1.3em` relative to the surrounding footer text. The status Worker embeds the subset it needs; all other text keeps its existing font stack.
- Production builds use the bundled font subsets and do not depend on the development machine's original font-source directory.

## Quick start

```bash
# Install the Node dependencies pinned by package-lock.json
npm ci

# Build the static site (Python venv + contract checks + public/ + preview/)
npm run build
```

`npm run build` is `ops/build.sh`: it creates the external build virtualenv
`/tmp/comicine-build-venv`, installs the pinned dependencies from `requirements.lock`,
and validates the cross-runtime configuration before rendering. Portfolio watermarks
use Pillow and `src/static/icons/comicine-watermark.png`; no system Cairo library is required.
To run the renderer directly, install the locked Python dependencies and use
`COMICINE_BUILD=1 python3 src/build.py`.

For a local preview of the generated site, build and open the output from `preview/`.

## Build, testing and deploy

For a clean local build, use the same dependency set as the deployment script:

```bash
cd site
npm ci
npm run build
```

`src/build.py` regenerates `public/<lang>/*.html`, `public/static/`,
`functions/_data/i18n.ts`, `functions/_data/runtime.ts` and `preview/`.
Do not hand-edit those outputs; change `locales/*.json`, templates or static
sources and rebuild. `src/static/tailwind.css` is the checked-in prebuilt
Tailwind output. `npm run build` uses `ops/build.sh`, which creates `/tmp/comicine-build-venv`
and generates `public/manifest.json` (build-artifact hash evidence).

Deploy only the Pages output with:

```bash
# build + validate only, no Cloudflare writes
bash ops/pages_deploy.sh --build-only

# build + validate + deploy Pages + smoke test (/_health must be 200)
bash ops/pages_deploy.sh

# full deploy: (1) commit (2) push (3) deploy Pages + docs + Workers
bash ops/deploy.sh --all
```

**Deploy entry points**: `ops/deploy.sh` is the single deploy entry point — commit +
push + Pages + docs, plus `--worker=<name>` for one standalone Worker;
`ops/pages_deploy.sh` handles build + Pages. `--dry-run` prints the plan without
writing to any remote.

By default `deploy.sh` is **quiet**: one status line per step, and a step's full log
is dumped only if that step fails. Add `--full` to stream everything (build manifest,
artifact count, wrangler upload progress). The flags and the steps are identical
either way — `--full` changes verbosity only.

Credentials are read from the local `secrets/webauthn.env` (never committed, never
echoed); there are no ssh / rsync / remote systemd steps.
`ops/migrate_d1.sh` and `ops/workers_deploy.sh` also support `--dry-run`.

Automated test entry points are provided:

```bash
# Python tests
python3 -m pytest

# Pages Functions, Workers and image-watermark tests
npm test
```

## Environment variables

Read from `secrets/webauthn.env` by the deploy scripts, not committed to Git. The Pages runtime has its own secret set (see the edge section below).

| Variable | Description |
| --- | --- |
| `GATE_HMAC_KEY` | HMAC-SHA256 key for the `__gate` cookie, minted and validated at the edge |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Cloudflare API access for `ops/d1_client.py`, `ops/pages_deploy.sh` and `ops/workers_deploy.sh` |

Key material lives outside the repo; `apple_account_encryption.key` is the Fernet key
used for Apple Account passwords and the encrypted visitor IP column.

## Cron jobs

All scheduling lives on Cloudflare as Worker Cron Triggers declared in each Worker's
`wrangler.toml`. `python3 ops/readme_facts.py` re-reads this table, the retention
windows and every path in the tree below:

| Schedule | Worker | Job |
| --- | --- | --- |
| `* * * * *` | `ops/status-worker` | HTTP/D1 probes every minute; a Durable Object alarm re-checks every 10s while a probe is down, and alerts on state change |
| `47 3 * * *` | `ops/status-worker` | D1 retention (`src/retention.ts`): prunes `ray_log_v2` (7d), `visitors_v2` (30d), `visitor_rollups` (30d), `heartbeats` (30d), `events` (90d), `probe_uptime_daily` (90d), `auth_sessions` (60d) and `identity_handoffs` (1d) |
| `30 3 * * *` | `ops/sync-worker` | Mirrors active D1 `blocked_ips` rows to the Cloudflare IP List `comicine_blocklist` |
| `0 0 * * *` | `ops/d1-archive` | D1 snapshot/archive run |

TLS certificates are issued and renewed by Cloudflare for the Pages custom domains.
`ops/migrate_d1.sh` and `ops/workers_deploy.sh` are manual, `--dry-run`-capable
maintenance entry points.

`python3 ops/readme_facts.py --check` re-reads the schedules, retention windows, TTLs
and directory tree from this repository and fails when this page drifts; `--live` reads
the deployed side (D1 counters, Pages hosts and secrets, DNS, WAF, Worker schedules)
from Cloudflare.

## Deployment

The deploy targets are the production Pages project `comicine`, the docs project `comicine-docs`, and standalone Workers. The production project serves `comicine.pages.dev`, all production custom domains, and its encrypted runtime configuration. The docs alias is `comicine-docs.pages.dev`. Worker URLs use `comicine.workers.dev`. Cloudflare deploys use the configured API token. From the repository root:

```bash
cd site
bash ops/deploy.sh              # with no arguments = --all (full deploy, see below)
bash ops/deploy.sh --all        # commit + push + deploy Pages + docs + Workers
bash ops/deploy.sh --pages      # deploy production Pages
bash ops/deploy.sh --docs       # deploy docs.comicine.com only
bash ops/deploy.sh --worker=comicine-status   # deploy one standalone Worker
bash ops/deploy.sh --all --full             # same, but stream every step's output
```

Running `ops/deploy.sh` with **no arguments is exactly `--all`**: commit + push +
Pages + docs, the "full deploy" contract. To ship only what is already committed
locally, pass `--pages` / `--docs` explicitly.

Output is quiet by default (one status line per step); add `--full` to watch the whole
process. `--dry-run` works with any combination of the flags above.

Credentials are read from the local `secrets/webauthn.env`; every step runs over the
Cloudflare API or Git.

### Docs site (docs.comicine.com)

`site/docs/` is a **per-subdomain container**: `docs/` holds the docs.comicine.com
VitePress root, `services/` holds the services.comicine.com price-list CSVs. Inside
`docs/`, sources are grouped by language: `zh-cn/`, `en-us/`, `ja-jp/`, and `ko-kr/`
each hold the same file tree (`<lang>/<page>.md`), beside the shared `.vitepress/`,
`functions/`, and `public/` directories. The language code is the **last** URL segment and
content pages carry it explicitly (`/README/zh-cn`, `/README/en-us`). A suffix-less
`/README` is resolved by a docs Pages Function in the main site's order (language
cookie, `Accept-Language`, Cloudflare country, then the contract default). The bare docs
root `/` 302s to `https://comicine.com`.

`.vitepress/rewrites.json` maps each `<lang>/<page>.md` source onto its suffixed route, and
`.vitepress/config.mts` gives each language directory its own `lang` / `themeConfig`
through `additionalConfig`. To add a page, create it in all four language directories, add
four rewrites entries, and add a `functions/<page>.js` entry plus its `_routes.json`
include for the suffix-less path. `ops/docs_check_output.py` fails the build when a
markdown file has no HTML, sits outside a language directory, or lacks a translation.

The site is built with VitePress from the fork `ComiCine/vitepress`: the header
and footer live in the fork (`VPComiCineNav.vue` / `VPComiCineFooter.vue`) and mirror the
main site's `base.html` / `_footer.html` — edit them there and the next deploy picks it
up (the fork is rebuilt only when its commit changes; use `COMICINE_VITEPRESS_FETCH=0` to
build from a fork working tree). The site is a separate Cloudflare Pages project
(`comicine-docs`) so it never touches the main `comicine` artifact, and it shares the
`user_lang_preference` / `comicine_theme` cookies with the main site.

```bash
bash ops/docs_deploy.sh --build-only   # build + validate only
bash ops/docs_deploy.sh --dev          # local VitePress dev server
```

## Security design

- Session cookies use `Secure` + `HttpOnly` + `SameSite=Lax` and are host-only, so a session cookie cannot be reused by another site;
  every session has a random `sid` recorded in D1 `auth_sessions`, and `requireAuth`
  rejects revoked/expired sessions. Missing runtime HMAC keys or an unavailable
  `auth_sessions` table fail closed with 503.
- The gate fails closed too: with `TURNSTILE_SECRET`, `GATE_HMAC_KEY` or
  `SESSION_HMAC_KEY` empty, the edge answers 503 instead of rendering pages or
  issuing unsigned cookies.
- The `__gate` cookie is `<unix-expiry>.<HMAC-SHA256 hex>` (1h TTL, `HttpOnly`,
  `Domain=.comicine.com`), minted and validated entirely at the edge.
- An unauthenticated browser navigation to a protected page receives HTTP 401 HTML and sets the short-lived state cookie; a same-origin external script then navigates to `identity.comicine.com/login`. Cloudflare Access sends the browser through `comicine.cloudflareaccess.com`, while API authentication failures remain JSON 401 responses. The identity Pages Function verifies `Cf-Access-Jwt-Assertion` (RS256, JWKS cached 1h) and stores a hashed, single-use D1 handoff bound to the source host and state. The source callback exchanges it server-to-server and applies its role from `identity_sites`; the handoff contains no role. Both current protected hosts require admin sessions because their APIs require them.
- Keys and ciphertext stored separately, and never committed to the repository
- Blocking layers: the app-level D1 blocklist answers 403 at the edge, and
  `ops/sync-worker` keeps the Cloudflare IP List `comicine_blocklist` in step with the
  active rows for a WAF rule to consume (that custom rule is not deployed right now)
- Admin writes (create/update/delete) require the admin role; viewer is read-only
- Visitor IPs are never returned by list APIs; the full IP is Fernet-encrypted in
  `visitor_rollups.ip_enc` and decrypted one row at a time for admins

## Whitelist

Trusted sources are maintained in [`docs/lists/own-ips.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/own-ips.txt) and copied to the generated [`docs/lists/whitelist.txt`](https://github.com/ComiCine/ComiCine-website/blob/main/docs/lists/whitelist.txt) during deployment:

| Entry | Effect |
| --- | --- |
| `ASN/<number>` | Optional entry for a zone-level Cloudflare ASN Access Rule. Run `bash ops/waf_whitelist.sh --apply` manually to change zone rules; ASN entries do not bypass the Pages Functions gate. |
| `IP-CIDR/<ip>/<mask>` | Fully allowed source at the Pages edge (for example, `IP-CIDR/97.64.18.11/32`); IPv4 prefixes must be `/24`–`/32` and IPv6 `/64`–`/128`; skips both the blocklist and the challenge gate. |

The current generated list has **0 ASN entries** and **2 IP CIDRs**. A full deploy generates the local whitelist but does not change zone-level ASN Access Rules. After editing `own-ips.txt`, deployment runs `ops/sync_whitelist.py`; the build then runs `ops/check_gate_trust.py --emit` to generate the edge copy.

## Source of truth

- User-facing strings: `locales/*.json`; `functions/_data/*` and API i18n routes are generated from it.
- Shared runtime constants: `config-contract.json` is the agreed cross-runtime contract; `src/config.py` and the generated `functions/_lib/config.ts` both consume it, with `ops/check_config_contract.py` enforcing agreement.
- Gate/redirect copy: `locales/*.json` via `functions/_data/runtime.ts`; `src/build.py` assembles it.
- D1 schema and migrations: `ops/migrations/*.sql`; `blocked_ips` is the sole authority for blocking.
- Security response headers baseline (when enabled): `ops/security-headers.json`.
- Deployment and runtime boundaries: `ops/deploy.sh`; Cloudflare Pages and Workers are the only runtimes.

## Cloudflare Pages runtime

The public site (home / services / contact, the gate, the visitor panel, the Apple Account manager, the `images.comicine.com` static asset host and the redirect relay) runs on the production Pages project `comicine`, as do the status page and every scheduled job. The project serves `comicine.pages.dev`, all production custom domains, and its encrypted runtime configuration. The docs Pages project uses `comicine-docs.pages.dev`.

Runtime split:

| Layer | Technology |
| --- | --- |
| Edge / human verification | Pages Functions (`functions/_middleware.ts`) |
| Pages | Pre-rendered static HTML at build time (multi-language) |
| Data | D1 (visitor analytics, blocklist, Apple Account management, auth sessions) |
| Human verification | Cloudflare Turnstile, gate page rendered in place |
| Independent Workers | `status.comicine.com` (`comicine-status`: probes, status page, retention), `image.comicine.com` (`comicine-image-watermark`), `comicine-blocklist-sync` |

### Build & directory layout

- `python3 src/build.py`: pre-renders the pages in 4 languages into `public/`, inlines
  `locales/*.json` as `functions/api/i18n/[lang].ts`, and generates shared
  `functions/_data/runtime.ts` (gate/redirect i18n + preload assets)
- `ops/migrations/001_init.sql`: D1 initial schema (`apple_accounts` / `blocked_ips` / `visitors`)
- `ops/export_d1.py`: generate D1 import SQL (output in `ops/out/`, git-ignored)
- `ops/migrations/007_visitor_status_indexes.sql`: adds `(status, ts)` and `(status, ip_hash, ts)` indexes for visitor status filtering
- `ops/sync-worker/`: a daily 03:30 Worker cron syncs active D1 `blocked_ips` rows to the Cloudflare IP List; `auto_block.py cf` is for explicit maintenance only

### Environment variables

Configured under **Pages project settings → Environment variables → Encrypt (Secret)**, not committed to the repo:

| Variable | Purpose |
| --- | --- |
| `TURNSTILE_SITEKEY` | Public sitekey of the Turnstile widget on the gate page |
| `TURNSTILE_SECRET` | Server-side siteverify secret |
| `GATE_HMAC_KEY` | HMAC-SHA256 signing key for the `__gate` cookie (`openssl rand -hex 32`) |
| `ACCESS_TEAM_DOMAIN` | Cloudflare Access team domain; also the JWT `iss` used for verification |
| `ACCESS_IDENTITY_AUD` | AUD for the single `ComiCine` Access application; source-host roles are applied by each site callback from `config-contract.json` |
| `VISITOR_IP_KEY` | Fernet key for the encrypted full visitor IP column (`visitor_rollups.ip_enc`) |
| `OBSERVABILITY_HMAC_KEY` | HMAC key for the privacy-minimized visitor IP hash (`functions/_lib/tracking.ts`); the gate fails closed without it |
| `SESSION_HMAC_KEY` | Pages session-cookie signing key (separate from `GATE_HMAC_KEY`) |
| `APPLE_ACCOUNT_ENCRYPTION_KEY` | Fernet key (from `secrets/apple_account_encryption.key`) |

Local development: copy `.dev.vars.example` to `.dev.vars` and fill in real values (git-ignored). Configure `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` for `ops/sync-worker` via `wrangler secret put`.

### Gate behavior

Every request is checked for the signed `__gate` cookie. Cloudflare `botManagement.verifiedBot` is accepted as a verified search-engine trust signal; arbitrary `Googlebot`/`GPTBot` User-Agent strings and client-supplied `cf_clearance` cookies do not bypass the gate. Edge code trusts only the generated whitelist (`docs/lists/whitelist.txt` → `functions/_data/gateTrust.ts`) for a full bypass.

Unverified requests get the Turnstile gate page **in place**: the host and path never change. The middleware renders `public/<lang>/auth.html` at the requested URL with status `403`, and `POST /__gate/verify` answers on that same origin with `Set-Cookie: __gate=…` (1h, `Domain=.comicine.com`), after which the page reloads the original target. `auth.comicine.com` is the gate host: it serves the same page at its own root and owns the `/__gate/config|diag|verify` endpoints.

Every host that renders the gate is served by the same edge code, so there is no second gate implementation to keep in sync.

The middleware also enforces the normalized D1 blocklist and records privacy-minimized visitor analytics. The gate page is `no-store`/`noindex` and supports dark/light theme switching. The user granted `Turnstile Sites Write`, and the widget API now returns HTTP 200 with `comicine.com` in its hostname list. The user's 2026-10-29 screenshot is from `comicine.pages.dev/?challenge=1`: Turnstile displayed success, but D1 recorded `/gate/verify` returning 403 `hostname_rejected`, because the server intentionally rejects Pages hostnames as public hosts. A successful browser challenge on `comicine.com` has not yet been confirmed. `auth.js` exposes a manual retry button and logs Turnstile's numeric client error code in the browser console. Do not disable the gate or add Pages hostnames to the public-host allowlist.

### Page serving (clean URLs, no language path prefix)

`src/build.py` pre-renders `public/<lang>/` in 4 languages; after the gate passes, the middleware picks a language by **cookie > Accept-Language > CF region > en-US** and fetches the matching page via `env.ASSETS.fetch()`, keeping the URL clean:

- `comicine.com/` → home page; `comicine.com/services` / `comicine.com/contact` → corresponding pages
- `services.comicine.com/` → services page; `contact.comicine.com/` → contact page (subdomains serve content directly, no 301 to the main site)
- `visitor.comicine.com/` → visitor panel (login required); `account.comicine.com/apple` → Apple Account manager (login required)
- `images.comicine.com/` → 301 to `comicine.com/`; other paths serve static assets such as portfolio images, favicons, logos and QR codes. `image.comicine.com/portfolio/<img>` → watermarked variant from the normalization Worker (its root also 301s to `comicine.com/`)
- `www.comicine.com` → 301 to the main site
- Root-level `x.html` aliases return 302 to `x.comicine.com/` when `x` is an active public homepage subdomain (`services`, `contact`, `docs` or `status`); unknown names return 302 to the current site's homepage. `index.html` returns to the current host's canonical homepage.
- Nav links keep absolute subdomain URLs (`https://services.comicine.com` etc.); language switching is a pure frontend `applyLang()`, no reload, no URL change

### services.comicine.com pricing (CSV-driven)

The services price list is **data, not markup**: `src/build.py` reads
`docs/services/*.csv` on every render (`src/services_pricing.py`) and fills the
plan grids in `src/templates/services.html`. Changing a price means editing the
CSV and deploying — no template edit.

| file | columns | fills |
| --- | --- | --- |
| `docs/services/convention.csv` | `shots,price[,bookable]` | 01 Convention, one card per shot-count tier |
| `docs/services/outdoor.csv` | `type,people,price[,bookable]` | 02 Outdoor, studio/outdoor × solo/duo |

Only the numbers, the tier set and the availability come from the CSV; labels,
unit suffixes and the notes block still come from `locales/*.json`
(`plan_studio_solo`, `unit_per_shot`, …).

**`bookable` (optional column)** drives both the struck-through price style and
the studio row in the notes block:

- per tier: `no` → that tier's price renders with
  `class="plan-price strikethrough"`; `yes`, an empty cell, or the whole column
  absent → normal price
- notes block: if **every** studio tier is `no`, the studio row shows the paused
  wording (`studio_paused`); as soon as one studio tier is bookable it shows
  `studio_bookable` instead

So "temporarily not booking" is data end to end: flip studio from `no` to `yes` in
`outdoor.csv` and the strikethrough *and* the paused note both disappear on the
next deploy, with no template or locale edit. The two can never disagree. Any
other value (e.g. `maybe`) fails the build rather than silently guessing.

**A `price` cell that is not a positive integer renders as `-`.** There is no
placeholder whitelist: empty, `N/A`, `TBD`, a typo (`1OO`), `0` and negative
numbers all mean "price not published". The card keeps the `CNY` prefix and the
unit suffix and only the number becomes `-` (`CNY - / shot`), so the layout stays
identical to the numeric tiers. `-` is not `0` and not "free"; mixing such cells
with numeric rows in one file is fine.

The rest of the contract is:

- convention rows come from the CSV in **ascending shot-count order**; the number
  of tiers is not fixed (adding a 12-shot row needs no code change)
- a convention tier gets a unit suffix only if it is listed in
  `CONVENTION_UNIT_KEYS`; unlisted tiers render the bare price
- outdoor rows must cover all four `type/people` combinations; they render in a
  fixed order (studio solo/duo, then outdoor solo/duo) regardless of row order

A missing file, wrong column, duplicate tier, unknown tier or unrecognized
`bookable` value **fails the build** — a wrong price list is worse than a failed
build. The price cell alone never fails the build: anything that is not a
positive integer renders as `-`.
`tests/test_services_pricing.py` covers all of these cases plus a round-trip
check against the committed CSVs.

`docs/services/` is excluded from the VitePress build (`srcExclude` in
`docs/.vitepress/config.mts`), so the CSVs stay a data source and are never
published to docs.comicine.com.

### Performance / edge caching

- `public/_routes.json` excludes `/static/*` and root static assets from Pages
  Functions, so CSS/JS/fonts are served directly by the Pages asset server.
- Files in `src/static/files/` are mirrored to `/public/files/`, preserving nested paths, so `src/static/files/<path>` is served at `https://comicine.com/public/files/<path>`.
  `/public/files/*` bypasses Pages Functions and uses the same one-day cache as other static assets; missing paths return 404.
- `public/_headers` gives versioned static assets a long browser cache with
  `stale-while-revalidate`; `public/_routes.json` and `_headers` are both
  generated by `src/build.py`.
- Pre-rendered public HTML is reused through the in-process page cache
  (keyed by host + language), and responses advertise
  `public, max-age=300, stale-while-revalidate=3600` with
  `Vary: Accept-Language`. Edge caching is deliberately **not** claimed here:
  Cloudflare does not cache Pages Functions responses (`cf-cache-status` stays
  `DYNAMIC` on repeated requests), so a shared-cache lifetime directive would be
  dead configuration, and the language cookie stays out of `Vary` because it
  would only fragment the browser cache.
- First-party portfolio thumbnails and favicons use
  `images.comicine.com/static/...` (static edge cache, bypasses Functions)
  instead of the watermark Worker; QR codes and externally hotlinked images
  still use `image.comicine.com`.
- Portfolio originals are never published: `/static/portfolio/<img>` returns 404.
  Only clean thumbnails (`images.comicine.com/static/portfolio/thumbs/<img>-<width>.{webp,avif}`)
  and the normalized, watermarked `/portfolio/<img>` on `image.comicine.com` are public;
  originals stay in the git-ignored `src/static/portfolio/` and the private R2 bucket
  `comicine-originals` (`ops/upload_originals.sh`).
- Turnstile verification has a 3-second server-side timeout so Cloudflare
  challenge-platform incidents fail closed quickly instead of stalling users
  for up to 8 seconds.

### Production status

The live deployment and pending resource cutovers, re-read any time with
`python3 ops/readme_facts.py --live`:

1. **Pages**: the production project `comicine` serves the main-site Pages hosts and owns `comicine.pages.dev` with its encrypted runtime configuration. The docs project is `comicine-docs` at `comicine-docs.pages.dev`; `docs.comicine.com` serves it. `image.comicine.com` is the watermark Worker, `fonts.comicine.com` uses R2, and `status.comicine.com` / `sink.comicine.com` are Worker custom domains.
2. **D1**: the new `comicine` database (APAC) is provisioned and loaded with in-use operational tables. Pages production and preview binding settings now target it; standalone Worker bindings are included in this release. The final import preserves Apple Account records unchanged and omits old visitor hashes and detailed telemetry. Sink's `comicine-sink` database is imported, the `comicine_sink` Analytics Engine dataset is configured, and its Worker is deployed; the short-link smoke check is pending.
3. **Secrets** live under **Pages → Settings → Environment variables → Encrypt**: the Turnstile pair, `GATE_HMAC_KEY`, `SESSION_HMAC_KEY`, `OBSERVABILITY_HMAC_KEY`, `VISITOR_IP_KEY`, `APPLE_ACCOUNT_ENCRYPTION_KEY`, `ACCESS_TEAM_DOMAIN` and `ACCESS_IDENTITY_AUD`; the old `ACCESS_ADMIN_AUDS` and `ACCESS_VIEWER_AUDS` secrets remain configured but no runtime reads them, as do `APPLEID_ENCRYPTION_KEY` and the two `AUTHENTIK_*` entries
4. **Access**: `ComiCine` protects `identity.comicine.com/login`; visitor and account use the shared identity handoff. The unused `ComiCine-Admin` application for `admin.limooo.cn` was removed on 2026-10-29; that hostname has no DNS record or Pages custom domain.
5. **Workers** run standalone: `comicine-status`, `comicine-blocklist-sync`, `comicine-d1-archive`, `comicine-image-watermark` and `comicine-sink`; their account subdomain is now `comicine.workers.dev`. `status.comicine.com`, `image.comicine.com` and `sink.comicine.com` are Worker custom domains. The status Worker uses `comicine-status_ComiCineProbeStateV2`; its previous namespace was removed after the new binding was confirmed. Sink's D1 database and Analytics Engine dataset are migrated, and an active short link returned 302 with a Location header.
6. **Cloudflare rules**: no WAF or Cache Rules are active. The IP List is `comicine_blocklist` and currently has no WAF filter referencing it. The `.com` dynamic-redirect phase is empty. The legacy `.cn` zone redirects requests to matching `.com` URLs (GET/HEAD 301; other methods 308), preserving path and query. Then `comicine.com/feishu/<path>` and `/lark/<path>` return 302 through Pages to `https://comicine.feishu.cn/<path>`, preserving path and query.
7. **Smoke checks**: verify `https://comicine.com/_health`, `https://docs.comicine.com/`, `https://status.comicine.com/` and `https://sink.comicine.com/` after each release. A successful real browser challenge on `https://comicine.com/?challenge=1` has not yet been confirmed.

> The Cloudflare account display name has not yet been updated: Cloudflare denied the update for insufficient permission. The Turnstile API permission is active; a successful real browser challenge on the canonical `.com` host has not yet been confirmed.
Note: the `?challenge=1` 403 confirms only that the gate page rendered; it does not prove Turnstile verification works. The screenshot on `comicine.pages.dev` was rejected by the public-host check; verification must be confirmed on `comicine.com`.

The gate renders in place on every host, the real visitor IP is shown in the gate page
and logs, and Access remains the only identity source.

## License

Original materials owned and licensed by ComiCine are made available under the GNU Affero General Public License version 3 or any later version (AGPL-3.0-or-later). The GNU AGPL v3 text is in [LICENSE.txt](https://github.com/ComiCine/ComiCine-website/blob/main/LICENSE.txt). Additional terms under Section 7 of GNU AGPL v3 are in [ADDITIONAL_TERMS.txt](https://github.com/ComiCine/ComiCine-website/blob/main/ADDITIONAL_TERMS.txt). Those additional terms apply when the work is used under GNU AGPL v3; their application under a later version depends on that version's terms.

ComiCine is the project development brand and public attribution; copyright belongs to the actual rights holder. Preserve applicable author attributions and copyright notices, including reasonable source notices. Commercial use is permitted under the applicable AGPL version, subject to its terms and conditions.

For additional authorization or trademark permission inquiries, contact [contact@comicine.com](mailto:contact@comicine.com). No additional authorization is required for commercial use that complies with the applicable GNU AGPL version.

See [Third-Party Notices](https://github.com/ComiCine/ComiCine-website/blob/main/THIRD_PARTY_NOTICES.md) for identified third-party fonts, dependencies, and platform marks in QR-code images, and [Copyright](https://github.com/ComiCine/ComiCine-website/blob/main/COPYRIGHT.md) for copyright scope.
