<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms may apply where validly authorized.
See ../ADDITIONAL_TERMS.txt.
-->

# Architecture

ComiCine is a pre-rendered website with a thin application layer at the edge. Everything runs on Cloudflare: Pages serves the generated HTML and hosts the Functions bundle, D1 is the only database, R2 keeps private originals and archives, and standalone Workers own whatever has to run on a schedule or on its own hostname. There is no origin server and no long-running process. This document describes the design that is in the repository; the deployed side is reported by the Production status section of [README.md](../README.md).

Values that are expected to change are deliberately not repeated here. Cron schedules, retention windows, cookie lifetimes, cache lifetimes, list sizes and host inventories are owned by the code and re-read by `python3 ops/readme_facts.py` (`--check` compares [README.md](../README.md) with the code, `--live` reads the deployed side).

## Request flow

Two Cloudflare features sit in front of this repository and are configured in Cloudflare rather than in this tree: account-level Bulk Redirects, which retire Pages preview aliases and former hostnames, and zone-level Single Redirects, which retire the legacy zone. Both answer with a redirect before Pages Functions are invoked, so no code here sees those requests. Everything after that point is `functions/_middleware.ts` and the library it calls, in the order below. The order is security-relevant and is kept deliberately.

| Stage | Code | Decision |
| --- | --- | --- |
| Contract check | `runtimeConfigError` in [functions/_lib/session.ts](../functions/_lib/session.ts) | A missing gate or session secret answers 503 before any page, cookie or database read. |
| Health probe | [functions/_middleware.ts](../functions/_middleware.ts) | `/_health` returns a short text 200 and is never gated or tracked. |
| Host shape | same file | The identity host serves only its allowlisted paths and answers 404 otherwise; the image host is static-only, so `/api/*` there is a 404. |
| Static fast path | `isPublicAssetPath`, `PUBLIC_FILES_PREFIX` in [functions/_lib/routing.ts](../functions/_lib/routing.ts) | Versioned assets and `/files/<path>` (served from the generated `/public/files/<path>`) return before the blocklist, so they cost no D1 read. |
| Blocklist | `isBlocked` in [functions/_lib/gate/index.ts](../functions/_lib/gate/index.ts) | An `active = 1` row in `blocked_ips` answers 403 with the gate page and the `blocked` reason; exempt paths and trusted sources skip the read. |
| API dispatch | [functions/api](../functions/api) | `/api/*` reaches its endpoint only after the blocklist check has passed. |
| Redirect relay and gate endpoints | `_lib/redirect.ts`, `_middleware.ts` | The redirect host renders its interstitial; `/gate` and the legacy `/__gate/*` paths handle entry, config, diagnostics and Turnstile verification. |
| Edge redirects | `_middleware.ts` | A forced challenge on the `www` host, the image-host landing paths, legacy `/<name>.html` aliases and the `/feishu` / `/lark` aliases all terminate as an explicit 301, 302 or 308. |
| Gate decision | `resolveGateTrust` in [functions/_lib/gate/index.ts](../functions/_lib/gate/index.ts) | Trusted source, declared crawler or a valid `__gate` cookie; anything else receives the gate page rendered in place at the requested URL. |
| Page and session | `pageAsset` in `routing.ts`, `requireAuth` in [functions/_lib/session.ts](../functions/_lib/session.ts) | A `page_routes` hit fetches the localized page through `env.ASSETS.fetch()`; a protected host without a session answers 401 HTML, or 302 to `/login` for non-navigation requests. |
| Fallthrough | `env.ASSETS` / `next()` | The Pages asset server serves real assets; unmatched HTML gets the branded 404, while API and asset 404s keep their native format. |

```text
request
  |
  v
Cloudflare edge --- Bulk Redirects / zone redirects --------> 301 / 302 / 308, ends here
  |
  v
functions/_middleware.ts
  |-- secret missing ---------------------------------------> 503 configuration error
  |-- /_health ---------------------------------------------> 200 text
  |-- static asset or /files/ ------------------------------> served, no D1 read
  |-- blocked_ips match ------------------------------------> 403 gate page, reason "blocked"
  |-- redirect.<root_domain> -------------------------------> redirect interstitial page
  |-- /gate, /__gate/* -------------------------------------> gate entry, config, diag, verify
  |-- forced challenge, www, image landing, alias ----------> 301 / 302 / 308
  |-- not (trusted | crawler | valid __gate cookie) --------> 403 gate page rendered in place
  |-- protected host without a session ---------------------> 401 identity document
  |-- page_routes hit --------------------------------------> 200 pre-rendered HTML from ASSETS
  |-- /api/* -----------------------------------------------> API JSON
  `-- anything else ----------------------------------------> asset server or branded 404
```

The ordering exists to keep a few properties that are easy to break by moving a branch. The blocklist runs before the API dispatch, because an earlier design returned `/api/*` first and let every endpoint except static assets bypass blocking; the exempt list (`isExemptPath` in `routing.ts`) keeps sign-in, sign-out, the admin pages and their APIs reachable from a blocked address, so an administrator never has to wait for the next Cloudflare IP List sync. The blocklist also runs before the gate decision and uses `sourceTrusted` (allowlisted IP or Cloudflare verified bot), never cookie validity, so an ordinary visitor holding a `__gate` cookie is still subject to blocking, and the crawler User-Agent list is deliberately excluded from trust because a User-Agent is self-reported and would otherwise let a blocked crawler change its name and walk through.

Blocking itself is cheap by construction. `isBlocked` reads the active rows once per isolate and matches prefixes in memory, keeps the last successful list when a read fails, and only falls back to the per-prefix query before that first success. Database trouble therefore skips application blocking rather than turning a brief outage into a site-wide 503, and the gate page that a blocked request receives is the same page every host renders, so there is no second gate implementation to keep in sync.

The gate cookie is `<issued-at>.<expires-at>.<HMAC-SHA256>`: the signature covers both timestamps, so a cookie cannot be extended with an older signature, renewal happens only after a bounded fraction of its life, and same-name cookies in different scopes are all validated so an old host-only value cannot shadow a fresh one. `POST /gate/verify` calls Turnstile siteverify with `remoteip` taken only from `CF-Connecting-IP`, requires the returned `hostname` to be a public host, rejects a token minted for another widget through its `action`, and times out server-side instead of stalling the visitor. The gate page is rendered in place at the requested host and path with `no-store`, so verifying never changes the URL and a reload never replays a cached challenge.

Passing the gate only selects content. `detectLang` resolves the language from the cookie, then `Accept-Language`, then the Cloudflare country, then the contract default, and `pageAsset` maps host plus clean path to `/<lang>/<page>.html`. Rendered pages are reused from an in-process cache keyed by host, language and asset path, because Pages Functions responses are not cached by Cloudflare; the browser cache lifetime is short and `private`, and the edge-caching section of [README.md](../README.md) records why `s-maxage` is not used. Hosts listed in `identity_sites` are the exception and are always `private, no-store`, since serving a stale admin page after Access expires would leave the browser with failed API calls instead of a login prompt.

Generated `_routes.json` keeps the pipeline small: `/static/*`, `/public/files/*`, the brand favicons and the discovery files (`/robots.txt`, `/llms.txt`, `/sitemap.xml`) are excluded from Pages Functions and served by the asset server. The middleware keeps its own early-return list for those paths plus `/static/*` and `/files/*`, as defense in depth for crawlers if the exclude list ever drifts. Visitor and Ray recording happens in the outer `onRequest` through `waitUntil`, and a 403 is never recorded, so scanning traffic cannot spend the write budget.

## Identity

Cloudflare Access is the only identity source. One Access application named `ComiCine` protects `identity.comicine.com/login`, and the same application also carries the private docs destinations described below; there is no second application per service. The access layer never sees a password: an unauthenticated browser navigation to a protected host receives an HTTP 401 HTML document with a same-origin script that navigates to the shared identity URL, and Cloudflare Access then sends the browser through the team domain login. API authentication failures stay JSON 401 responses, and non-navigation requests are redirected to the local `/login` route.

`functions/login.ts` runs on the identity host and is the only place that reads `Cf-Access-Jwt-Assertion`. [functions/_lib/access.ts](../functions/_lib/access.ts) verifies the token itself rather than trusting the header: the algorithm must be RS256, the key is selected from a cached team-domain JWKS and re-fetched once when an unknown `kid` appears, and the issuer, audience, expiry and clock-skewed `nbf` / `iat` are all checked. The signature is verified before any claim is read, and every failure returns null instead of throwing. The team domain and application audience come from encrypted Pages variables, not from the contract, because Access is an edge-only capability and should not appear in build output.

The verified identity is not turned into a session on the identity host. Instead the login endpoint issues a short-lived, single-use handoff into D1 `identity_handoffs`, and the handoff is bound to the source host and to the state value that the source host generated:

1. The source host builds the identity login URL with its own `/identity/callback?state=...&next=...` as the `next` parameter, and sets a host-scoped state cookie for that callback path.
2. The identity endpoint verifies the Access JWT, hashes the one-time code and the state with SHA-256, and inserts the row with the source host, target path, subject, email and authentication time. The code, never the hash, travels in the redirect.
3. The browser is sent to `https://<source-host>/identity/callback`, where `functions/identity/callback.ts` compares the state cookie in constant time, exchanges the code server-to-server with `POST /api/identity/exchange` on the identity host, and validates that the returned host and target path match its own.
4. [functions/api/identity/exchange.ts](../functions/api/identity/exchange.ts) consumes the row with a single `DELETE ... RETURNING`, so concurrent exchanges cannot both win; an unreachable store answers 503, which is deliberately distinct from the 401 for an unknown, expired, already consumed or wrong-host code.

The handoff carries the identity but no role. The role is applied by the source host's callback from `identity_sites` in [config-contract.json](../config-contract.json), which is what makes the same identity an administrator on one host and potentially a reader on another. The callback then creates a host-only session: a random `sid` row in `auth_sessions` plus the signed `__Host-comicine_session` cookie, which the browser enforces as secure, path-scoped to `/` and free of a `Domain` attribute, so no sibling subdomain can overwrite or reuse it. The schema for the handoff is [ops/migrations/020_identity_handoffs.sql](../ops/migrations/020_identity_handoffs.sql), and its lifecycle is documented in [functions/_lib/identity.ts](../functions/_lib/identity.ts).

`requireAuth` validates the cookie signature first and then the D1 row, comparing `sid`, `sub`, `role` and expiry and rejecting `revoked_at`; if the table is missing or unreadable it throws so the caller returns 503 instead of trusting a signed cookie alone. Logout does both halves of the job in [functions/logout.ts](../functions/logout.ts): it revokes the `sid`, clears the session cookie plus the pre-rename cookie name and the pending cookie, and redirects through the Access logout endpoint so the remaining `CF_Authorization` cannot silently authenticate the next request. The private docs routes authenticate through Access only and do not participate in this handoff.

## Docs site

`docs.comicine.com` is a separate Pages project, `comicine-docs`, built from `site/docs/docs/` by `ops/docs_deploy.sh`; it never touches the main `comicine` artifact or its Functions bundle. The generator is VitePress from the `ComiCine/vitepress` fork, so the header and footer live in the fork rather than in overrides here. Sources are grouped one directory per supported language with an identical file tree in each, and [docs/docs/.vitepress/rewrites.json](../docs/docs/.vitepress/rewrites.json) maps every `<lang>/<page>.md` source to a route whose last segment is the language code. [docs/docs/.vitepress/config.mts](../docs/docs/.vitepress/config.mts) layers each page's `lang` and theme configuration by source directory through `additionalConfig`, because VitePress locales only support prefixes and cannot express a language suffix; that data must stay serializable, since it is shipped to the client.

Language-less entry routes are Pages Functions, not rewrite rules: the handlers under [docs/docs/functions](<../docs/docs/functions>) resolve the language in the same order as the main site (cookie, then `Accept-Language`, then Cloudflare country, then the contract default) and redirect with 302 to the suffixed URL, so search results and existing links keep working without duplicating content. The docs site has no home page: `/` returns 404, `/docs-home/*` and the retired localized home routes return 404 directly through `functions/_lib/removed-home.js`, and the docs middleware converts an HTML 404 into a body that keeps the 404 status while navigating to `https://comicine.com/404` with a `Refresh` header and a meta refresh. [docs/docs/public/_redirects](../docs/docs/public/_redirects) only retires the old prefix-style URLs.

Cloudflare Access protects `/private/*` and the generated private article bundles under `/assets/private_articles_*` on production and preview hostnames, as destinations on the same `ComiCine` application. `ops/docs_deploy.sh` reconciles those destinations and removes redundant docs-specific applications; it never creates one. Private pages are excluded from the sitemap and marked `noindex, nofollow`, and [docs/docs/public/_routes.json](../docs/docs/public/_routes.json) keeps the built assets, fonts and favicons out of Pages Functions.

## Workers and scheduled jobs

Standalone Workers own everything that is not a page request. Each one is a directory with its own `wrangler.toml`, deployed through [ops/workers_deploy.sh](../ops/workers_deploy.sh).

| Worker | Source | Responsibility |
| --- | --- | --- |
| `comicine-status` | [ops/status-worker](../ops/status-worker) | HTTP and D1 probes, the Durable Object re-check that runs while a probe is down, the server-rendered status page on `status.comicine.com` with `/api/status` and `/_health`, alert delivery over webhook with email as fallback, D1 retention, and the daily checks over run history and the blocklist invariant. |
| `comicine-blocklist-sync` | [ops/sync-worker](../ops/sync-worker) | Mirrors the active `blocked_ips` rows into the Cloudflare IP List, records each run in `worker_runs`, and exposes `GET /?health=1` without triggering a sync. |
| `comicine-d1-archive` | [ops/d1-archive](../ops/d1-archive) | Writes the previous day's analytics to the private R2 bucket as gzipped JSONL and takes a configuration and schema snapshot for disaster recovery; both stages are independent and recorded in `worker_runs`. |
| `comicine-image-watermark` | [ops/image-watermark](../ops/image-watermark) | Normalizes `image.comicine.com` paths and proxies the matching static asset, always returning the watermarked variant for portfolio originals, serving clean thumbnails and icons, and refusing `/api/*`. |

All scheduling lives in Cloudflare Cron Triggers declared under `[triggers]` in each Worker's `wrangler.toml`; there is no crontab, scheduler process or external runner in this repository. The schedules themselves are listed in the Cron jobs section of [README.md](../README.md) and must be read there rather than copied, because `ops/readme_facts.py` parses that table and fails when it drifts from the `wrangler.toml` files. The same holds for retention windows: [ops/status-worker/src/retention.ts](../ops/status-worker/src/retention.ts) owns the policy, and [ops/prune_d1.py](../ops/prune_d1.py) imports it and refuses to run when its own copy disagrees.

The link shortener `comicine-sink` is built from a separate repository and is not part of this tree; [ops/cloudflare/README.md](../ops/cloudflare/README.md) records it as an external resource next to the resources this repository does manage.

## Data model and D1 read budget

D1 holds every stateful thing in the system. [ops/migrations](../ops/migrations) is the schema of record, and the table families fall into a small number of groups.

| Family | Tables | Purpose |
| --- | --- | --- |
| Visitor analytics and rollups | `visitor_rollups`, `visitors_v2`, `visitors_daily`, `ray_log_v2` | Hourly rollup rows keyed by hashed visitor, country, status and page slug with exact request counts, beside per-request detail rows and the per-request Ray record, both pruned on a short window. |
| Blocklist and audit | `blocked_ips`, `blocklist_audit` | The authoritative blocking data with normalized network and prefix columns and an `active` flag for soft deletes, plus one audit row per administrative change. |
| Apple Account records | `apple_accounts` | Email, Fernet-encrypted password, notes and manual sort order; the list endpoint returns only a masked password. |
| Auth sessions and handoffs | `auth_sessions`, `identity_handoffs` | The revocation table `requireAuth` consults, and the hashed single-use codes that carry a verified identity between hosts. |
| Probes, heartbeats, uptime rollup | `probes`, `heartbeats`, `probe_state`, `probe_uptime_daily` | Probe definitions, raw results, the current state used for retries and alerting, and the per-day up/total rollup the status page actually reads. |
| Operations bookkeeping | `events`, `worker_runs`, `schema_version` | Structured event log, one row per scheduled run, and the migration version marker. |

Reads are designed around rollups, not detail scans. The status page reads `probe_uptime_daily` instead of counting `heartbeats`, the visitor list unions `visitor_rollups` with the detail table inside the retention window and relies on covering indexes added in [ops/migrations/011_d1_read_reduction.sql](../ops/migrations/011_d1_read_reduction.sql), and the blocklist keeps its per-isolate cache so a page view never issues one query per prefix. That migration's header records the reason: the free-plan row-read ceiling was exceeded once, by page polling that amplified a handful of aggregations by orders of magnitude. The rule that came out of it is the five-minute floor for any page that polls D1, applied to the status page and the visitor panel, whose refresh constants live in [ops/status-worker/src/page.ts](../ops/status-worker/src/page.ts) and `src/static/js/visitor.js`. Any new polled view is expected to read an aggregate or a rollup and to stay at or above that floor.

Privacy is a schema property, not a promise. Analytics stores a truncated HMAC of the visitor IP under a dedicated observability key and never stores the raw address, the User-Agent or the query string; `ray_log_v2` keeps only a coarse client family. The encrypted full address exists in one column of `visitor_rollups`, written with a separate Fernet key, never returned by a list endpoint and decrypted one row at a time only for an administrator. Missing keys degrade to "no IP available" rather than to a weaker identifier. Retention is enforced by the scheduled Worker, so detail rows disappear on their documented windows while the daily aggregates survive.

## Failure behavior

The system prefers a visible failure over a silently weaker decision, and the exceptions are chosen deliberately. Knowing which side a component fails on is part of the design, so the table below is the short version; the code cited in it is the authority.

| Condition | Behavior | Owner |
| --- | --- | --- |
| A required gate or session secret is empty | 503 before any page, cookie or database read; no unsigned cookie is ever issued | [functions/_lib/session.ts](../functions/_lib/session.ts) |
| `auth_sessions` is missing or unreadable | 503 on protected endpoints, never "trust the signed cookie only" | `requireAuth` in the same file |
| A blocklist read fails | Keep the last successful list, fall back to the per-prefix query, and skip application blocking only before any list has loaded | [functions/_lib/gate/index.ts](../functions/_lib/gate/index.ts) |
| Turnstile verification fails or times out | No cookie; the gate page reports the failure or the temporary unavailability and keeps the visitor on the same URL | `verifyTurnstile`, `handleVerify` |
| The Access JWT is invalid | 401 from the identity endpoint, no handoff row is written | [functions/login.ts](../functions/login.ts) |
| The handoff store is unavailable | 503, kept distinct from the 401 for an invalid or already consumed code | [functions/api/identity/exchange.ts](../functions/api/identity/exchange.ts) |
| A docs page is missing | HTTP 404 with a navigation to the main site 404, never a 3xx | [docs/docs/functions/_middleware.js](<../docs/docs/functions/_middleware.js>) |

## Build artifacts

Pages has no server-side render at request time, so the build produces every HTML page ahead of time and the Functions only choose among the artifacts.

| Artifact | Produced by | Rule |
| --- | --- | --- |
| `public/<lang>/*.html`, `public/404.html`, `public/static/`, the `/public/files/` mirror, `public/_routes.json`, `public/_headers`, `public/manifest.json`, `public/robots.txt`, `public/llms.txt`, `public/sitemap.xml` | [src/build.py](../src/build.py) | Generated into a git-ignored output directory on every build; never hand-edited, never committed. |
| `functions/_data/i18n.ts`, `functions/_data/runtime.ts`, `functions/api/i18n/[lang].ts` | [src/build.py](../src/build.py) | Generated from `locales/*.json` and tracked in the same commit as the build source. |
| `functions/_data/gateTrust.ts` | `ops/check_gate_trust.py --emit`, run by the build | Generated from the lists under `docs/lists/`; the build regenerates it so edge trust cannot drift from the published lists. |
| `functions/_lib/config.ts` | [src/build.py](../src/build.py) | The TypeScript mirror of [config-contract.json](../config-contract.json); regenerated after any contract change. |
| `src/config.py` | Hand-written, checked against the contract | The Python reader of the same contract, compared field by field by `ops/check_config_contract.py`, which the build runs before and after rendering. |
| `src/static/tailwind.css` | Checked-in prebuilt artifact | Regenerated with the pinned tooling when utility classes change; not produced by the site build. |

The build order matters more than it looks. It validates locale completeness and redirect copy, checks image prerequisites before touching the output directory, then clears and recreates the output so a failed earlier run cannot leave stale files or unwatermarked originals behind. `public/manifest.json` hashes every file in the output, and [ops/pages_deploy.sh](../ops/pages_deploy.sh) refuses to deploy when the manifest is missing or does not match, which is what catches an edit made after the build.

Nothing generated by the build is edited by hand. Change [config-contract.json](../config-contract.json), `locales/*.json`, the templates, the static sources or the lists under `docs/lists/`, then rebuild; a direct edit is overwritten and is caught locally before it ships. `src/config.py` is the exception in kind rather than in intent: it is tracked source, but its constants must come from the contract that `ops/check_config_contract.py` compares them against, not from values typed into the module.

Deployment has one entry point. [ops/deploy.sh](../ops/deploy.sh) runs the local CI gate, commits and pushes, then hands off to [ops/pages_deploy.sh](../ops/pages_deploy.sh) for the main project, [ops/docs_deploy.sh](../ops/docs_deploy.sh) for `comicine-docs`, and [ops/workers_deploy.sh](../ops/workers_deploy.sh) for the standalone Workers. Each helper also runs on its own: `--build-only` for the Pages builds and `--dry-run` for each step. [ops/build.sh](../ops/build.sh) is the `npm run build` entry that prepares the pinned Python environment and calls the same builder. The Pages deploy must run from the repository root so Wrangler can find `functions/`, and it finishes by checking that `/_health` answers 200.

## Where to look

- [config-contract.json](../config-contract.json) decides the domains, languages, cookies, lifetimes and host routing tables; every runtime derives its constants from it.
- [functions/_middleware.ts](../functions/_middleware.ts) decides the order of every request-level check described above.
- [ops/deploy.sh](../ops/deploy.sh) decides what a deployment actually does, and which helper runs for which target.
- [ops/readme_facts.py](../ops/readme_facts.py) decides whether the documented facts still match the code that owns them.
- [README.md](../README.md) holds the current operational facts: schedules, retention, hostnames, secrets and status.
