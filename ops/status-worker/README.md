<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# status-worker

Cloudflare Worker behind `status.comicine.com`: uptime probes, the public status page
and the alert channel that replaced Uptime Kuma.

- Cron `* * * * *` runs one round of probes, starting each due probe at its
  deterministic 0-30 s offset, and writes D1 (`heartbeats`, `probe_state`,
  `probe_uptime_daily`).
- Cron `47 3 * * *` runs the D1 retention pass (`retention.ts`), records one
  `retention_state` row per bucket, and then the **daily checks**
  (`runDailyChecks()`), see below.
- A probe that crosses `FAIL_THRESHOLD` is handed to the `ComiCineProbeStateV2` Durable
  Object, which re-checks it every `RETRY_INTERVAL_S` seconds and records recovery;
  retry samples keep the live state fresh but do not count toward uptime.
- The status page is cached explicitly per language for 60 s (`caches.default`), so at
  most one render and one D1 read happen per language per minute.
- Alerts go to `ALERT_WEBHOOK_URL` first (Feishu bot format by default) and fall
  back to the `EMAIL` binding; with neither configured they are only logged.

## Probes

The every-minute cron runs one probe round; a probe is due once its configured
`interval_s` has elapsed since its last check.

### Probe scheduling

Each due probe gets a deterministic offset in 0-30 s derived from the probe id (a
stable hash, no `Math.random()`), and `scheduled()` starts probes at those slots. This
spreads out a cron tick that used to start every probe in the same second. The total
added wall time per cron run is bounded by 30 s (the cron trigger limit is 15 minutes),
and the sampling interval semantics are unchanged. Manual `POST /run` never jitters.

`interval_s` below 60 or non-numeric is rejected by the read path and treated as 60;
the invalid configuration is logged once per isolate. Migrations and manual probe
inserts must use `interval_s >= 60`. The jitter does not change SLA math or alert
timing.

### Uptime sampling

`record()` takes the sample source (`cron`/`manual` vs `retry`). Durable Object retry
samples still write `heartbeats` and update `probe_state`, so the current state, latency
and reason stay fresh, but they no longer increment `probe_uptime_daily.total`. The
7-day uptime therefore counts scheduled samples only (one per `interval_s`), not
retries. This is effective with the 2026-11-07 change; historical rows are not
recomputed because the daily rollup cannot be rebuilt. No read-side window changed:
`statusPayload` still sums seven full UTC day buckets.

## Daily checks (`47 3 * * *`, once a day)

`47 3 * * *` sits after the archive cron (`0 0 * * *`) and the blocklist sync cron
(`30 3 * * *`), so both have already recorded their run for the day. The retention
results are recorded first (see Retention bookkeeping), then three checks run; each
check fails open when it cannot run (log only, no alert, never throws):

| Step | Source | What it checks |
| --- | --- | --- |
| cron run failures | `runwatch.ts` | the latest `worker_runs` row for each job in `WATCHED_JOBS` (`blocklist_sync`, `d1_archive`, `config_backup`; migration 018) is `ok`/`skipped`; `failed`, an unknown outcome, or a `running` row older than `STALE_RUNNING_S` (2 h) alerts |
| D1 budget | `d1budget.ts` | account-level D1 usage for the last complete UTC day: warns at 70% of either free-plan limit (5,000,000 rows read, 100,000 rows written) and is critical at 90%; one `d1AnalyticsAdaptiveGroups` GraphQL call, **0 D1 reads**; missing credentials or **Account Analytics Read**, a 5xx/429/network failure (retried once) or a malformed body only logs a warning; the request times out after 10 s |
| blocklist drift | `blocklist.ts` | the Cloudflare IP List `comicine_blocklist` equals the `active = 1` rows of D1 `blocked_ips`; a non-empty `to_add`/`to_remove` alerts, agreement stays silent |

Cost per day: **4 rows read** (one index seek per watched job on
`idx_worker_runs_job_started`, one `SELECT cidr FROM blocked_ips WHERE active = 1`
on `idx_blocked_ips_active`) plus two read-only Cloudflare API calls (list lookup by
name, one items page), one GraphQL call for the budget check with **0 D1 reads**, and
at most **8 D1 writes** for the `retention_state` bookkeeping. Adding a job to
`WATCHED_JOBS` costs exactly one more row per day; leaving it out costs the visibility
this Worker exists to provide. Nothing here is read from the every-minute probe cron or
from the status page — the status page renders at most once per minute per language, so
a `worker_runs` read there would cost thousands of rows per day.

The checks are checked *and* alerted from the same place: an alert is one message
listing every finding. Alert copy is English only (`ALERT_I18N` has a single `en-us`
entry; `ALERT_KINDS` lists every kind: `down`, `up`, `runs`, `blocklist`, `retention`,
`budget`). Missing Cloudflare credentials (`CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID`) is a skip, not a failure: a fresh clone without those secrets
must not start alerting.

### Retention bookkeeping

The retention pass runs before the checks. Every bucket in `BUCKETS` gets one upserted
row in `retention_state (name PK, last_run_at, last_success_at, last_error)`, at most
8 D1 writes per day. A success clears `last_error`. On a prune failure the row keeps
the previous `last_success_at`, updates `last_run_at` and stores a truncated error
summary in `last_error`; the alert path logs `retention_alert_sent` / `retention_alert_skipped`
/ `retention_alert_suppressed`, and a failed state write logs `retention_state_write_failed`. Failures send one English alert
(kind `retention`, one row per failed table with the table name and error summary, no
row contents or IPs). The in-isolate dedupe window is one alert per table per 3600
seconds; a successful pass clears that table's dedupe entry and sends no separate
recovery alert. Alert delivery failure never throws, and the retention pass always
continues.

Inspect the latest result without deploying:

```sql
SELECT name, datetime(last_run_at,'unixepoch'), datetime(last_success_at,'unixepoch'), last_error
  FROM retention_state ORDER BY name;
```

### D1 budget runbook

The budget check decides on the last complete UTC day: at 03:47 the current day bucket
is only about four hours old and would false-alarm. The current day's partial usage
raises an early warn only once at least one third of the day has elapsed and it has
already spent at least 50% of the read budget. At most one alert is sent per daily run;
the detail names the evaluated day, the level, `rows_read N% of 5000000 (rows)`,
`rows_written N% of 100000 (rows)` and a per-database breakdown (database totals are
summed because the limit is account-level).

- At 70%, first check recent `/api/visitors` polling, visitor/status page refresh
  intervals, deploys that added D1 reads, and that the status page cache/edge cache is
  still effective.
- At 90%, shrink the `visitors` query window or refresh interval, or temporarily
  upgrade to Workers Paid.
- Re-check with `wrangler d1 info comicine` (`rows_read_24h` / `rows_written_24h`) or
  the GraphQL dataset.

## Endpoints

| Path | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/` , `/status` | GET | public | Server-rendered status page, 4 languages, `?lang=` override (cached per language through `caches.default`, `X-Status-Cache` header) |
| `/_health` | GET | public | Liveness probe used by external monitors |
| `/status.css` | GET | public | Status page styles (design tokens + inlined brand font) |
| `/status.js`, `/status-theme.js` | GET | public | Page interactions / pre-paint theme class |
| `/api/status` | GET | public | Status payload as JSON (normalised error codes, no raw exception text) |
| `/alert-preview` | GET | public | Renders one alert mail; never sends anything |
| `/run` | POST | **Bearer token** | Runs one round of probes and returns the fresh status |
| `/alert-test` | POST | **Bearer token** | Really sends one alert through the configured channel |
| `/daily-checks` | POST | **Bearer token** | Runs the daily checks now and returns each step's result; **really sends alerts** |

## Status page

`/` and `/status` are server-rendered by this Worker: `renderStatusPage()` in
`src/index.ts` reads D1, `src/page.ts` builds the markup. Responses are cached with
`public, max-age=30, s-maxage=60, stale-while-revalidate=300` and
`Vary: Accept-Language`. The language comes from an explicit `?lang=` parameter
first, then `Accept-Language`, then `zh-cn`.

The shared `user_lang_preference` cookie is deliberately **not** part of the cache
key (no `Vary: Cookie`): that would fragment the edge cache by cookie text and
multiply D1 reads. Instead `/status.js` redirects once per session to
`?lang=<cookie>` when the shared preference differs from the rendered page.

| File | Role |
| --- | --- |
| `src/page.ts` | markup, CSS, client scripts, the two page shapes (status / render failure) |
| `src/statuscache.ts` | explicit Cache API read/write for the rendered page, keyed per language |
| `src/i18n.ts` | four-language table, language detection, probe-error classification |
| `src/brand-font.ts` | generated: inlined Delius Swash Caps subset for ComiCine brand words |

The header and footer mirror the main site's `src/templates/base.html` and
`src/templates/_footer.html` (same class names, same SVG controls, same `tokens.css` palette,
monochrome Delius Swash Caps ComiCine text in the upper-left brand position, Delius on only the
ComiCine word in copyright text,
language flyout, dark/light pill, GitHub/Bilibili links). The
implementation is **self-contained on purpose**: `status.comicine.com` is a separate
origin, so linking the main site's `/static/**` would need a relaxed CSP *and* would
make the status page depend on the very site it monitors being reachable. The
trade-off is that this markup is duplicated by hand — the docs fork
(`VPComiCineNav.vue` / `VPComiCineFooter.vue`) is the second copy. Change both when the
main site header changes.

### Status page cache

The rendered page is cached explicitly through `caches.default`: the key is
`https://status.comicine.com/__status-page/<lang>` and the TTL is the response's
existing `s-maxage=60`, so there is at most one render and D1 read per language per
minute. Every page response carries `X-Status-Cache: hit|miss|bypass` (`bypass` when
the Cache API is unavailable or the method is not GET). Non-GET requests, 404s, the 503
render-failure page and every other endpoint are not cached. Data can be at most about
one minute stale, aligned with the one-minute probe cron. If the Cache API is
unavailable (local tests, unusual runtime) the page renders directly.

### Error text is table-driven, and complete

Probes store raw English machine codes in `heartbeats.msg` (`http_503`,
`d1_error: Error: ...`, `fetch_error: AbortError: ...`). `msgCode()` reduces them to
a public code (`http_<code>`, `d1_error`, `fetch_timeout`, `fetch_error`,
`missing_target`, `unexpected_result`, `no_data`, `unknown`) and `probeDetail()`
renders it in the visitor's language. Two guarantees:

- **Nothing falls back to English.** Curated statuses (4xx, 5xx, Cloudflare 520-530)
  get a full sentence; any other three-digit code falls into the `http_other`
  template with the code interpolated; unknown non-HTTP codes land on
  `err_unknown_code`, which still shows the code for triage.
- **A missing translation cannot ship.** The table is typed as
  `Record<Lang, Record<UiKey, string>>` with `UiKey = keyof typeof ZH_CN`, so a key
  missing in any language is a `tsc` error (`npm run typecheck`).

The same table renders the alert-mail body through `alertDetail()`, which keeps the
raw exception text on purpose: the operator needs it, the public page does not.
`/api/status` exposes the normalised code only, never the raw text.

### Failure pages

- Unknown path from a browser navigation -> HTTP 404 that keeps its status and moves the
  browser to `https://comicine.com/404` through a `Refresh` header and a `<meta
  http-equiv="refresh">`; every other client keeps the plain-text `Not Found`.
- D1 unreadable -> the Worker's own 503 page with `Cache-Control: no-store`, instead
  of a generic Cloudflare error page; `/api/status` answers
  `503 {"error":"unavailable"}`.

### CSP and the brand font

The status page ships the tightest CSP in the project: `default-src 'none'`,
`style-src 'self'`, `script-src 'self'`, `font-src 'self' data:`, `img-src 'self'
data: https://images.comicine.com`, `connect-src 'self'`, `base-uri 'none'`,
`form-action 'none'`, `frame-ancestors 'none'`. There is no inline script or
style, so the theme class is applied before paint by the blocking
`/status-theme.js` in `<head>`. The Delius Swash Caps brand subset is inlined
in `src/brand-font.ts` because the main site's font files are cross-origin and the main site sends
no CORS header for fonts. Regenerate its data URL from the self-hosted subset at
`src/static/fonts/delius-swash-caps/delius-swash-caps-copyright.woff2`.
The subset is used for the navigation wordmark and the ComiCine copyright name; the rest of the status
page retains its existing font stack.

## STATUS_TOKEN

`/run`, `/alert-test` and `/daily-checks` are operator write endpoints and all
require `Authorization: Bearer $STATUS_TOKEN`. `/run` writes D1 rows (looping it
can burn the free-plan daily write quota) and `/alert-test` / `/daily-checks` send
real alerts, so none of them may stay open on a Worker that is reachable from the
public internet.

The check fails closed: with no `STATUS_TOKEN` bound, every call to those
endpoints returns 401 regardless of the header. That is deliberate, and it means:

> **After deploying this Worker you must run `wrangler secret put STATUS_TOKEN`,
> otherwise `/run` and `/alert-test` keep returning 401 forever.**

Local copy of the token lives in `secrets/webauthn.env` (git-ignored, never
committed). Create or rotate it with:

```sh
# 1. write the secret into the Worker (reads the credential from secrets/webauthn.env)
cd ops/status-worker
CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' ../../secrets/webauthn.env | tail -1)" \
CLOUDFLARE_ACCOUNT_ID="$(sed -n 's/^CLOUDFLARE_ACCOUNT_ID=//p' ../../secrets/webauthn.env | tail -1)" \
  /tmp/wrangler-env/node_modules/.bin/wrangler secret put STATUS_TOKEN --config wrangler.toml

# 2. keep the same value locally (append or replace the STATUS_TOKEN= line)
```

Smoke test after a deploy:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://status.comicine.com/run
# 401 without a token
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $STATUS_TOKEN" \
  -X POST https://status.comicine.com/run
# 200 with the token
curl -s -o /dev/null -w '%{http_code}\n' https://status.comicine.com/_health
# 200
```

The daily checks can be exercised without waiting for 03:47 UTC:

```sh
curl -s -H "Authorization: Bearer $STATUS_TOKEN" -X POST \
  https://status.comicine.com/daily-checks
# {"runs":{"ok":true,"issues":0,"alerted":false},
#  "budget":{"ok":true,"issues":0,"alerted":false},
#  "blocklist":{"ok":true,"issues":0,"alerted":false}}
# ok=false means "this step could not run" (missing secret, D1/API error), not
# "something is broken"; issues/alerted report what was found. The budget step adds
# a `reason` when usage could not be read.
```

`/alert-test` has a second layer on top of the token: one call per client IP per
60 seconds (in-isolate map, best effort, `429` + `Retry-After` beyond that). The
`Authorization` header is checked first, so unauthenticated requests never reach
that map.

## Secrets

| Secret | Required for | Without it |
| --- | --- | --- |
| `STATUS_TOKEN` | `/run`, `/alert-test`, `/daily-checks` | those endpoints return 401 (fail closed) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the blocklist-drift step and the D1 budget step | those steps are skipped and logged (fail open, no alert) |
| `ALERT_TO`, `ALERT_FROM` | any alert reaching a human | alerts are logged only |

`CLOUDFLARE_API_TOKEN` needs read access to the `comicine_blocklist` IP List
(`Account > Account Rulesets > Read` or the equivalent) and **Account Analytics Read**
for the budget step's GraphQL query. It is the same value the sync Worker uses; this
check never writes, never creates the list and never issues `bulk_operations`.

## Deploy

```sh
bash ops/deploy.sh --worker=comicine-status
```

The token is a Worker secret, not a `[vars]` entry: environment variables in
`wrangler.toml` are public and are wiped on some deploy paths, secrets are not.
