<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# status-worker

Cloudflare Worker behind `status.comicine.com`: uptime probes, the public status page
and the alert channel that replaced Uptime Kuma.

- Cron `* * * * *` runs one round of probes and writes D1
  (`heartbeats`, `probe_state`, `probe_uptime_daily`).
- Cron `47 3 * * *` runs the D1 retention pass (`retention.ts`) and then the
  **daily checks** (`runDailyChecks()`), see below.
- A probe that crosses `FAIL_THRESHOLD` is handed to the `ProbeState` Durable
  Object, which re-checks it every `RETRY_INTERVAL_S` seconds and records recovery.
- Alerts go to `ALERT_WEBHOOK_URL` first (Feishu bot format by default) and fall
  back to the `EMAIL` binding; with neither configured they are only logged.

## Daily checks (`47 3 * * *`, once a day)

`47 3 * * *` sits after the archive cron (`0 0 * * *`) and the blocklist sync cron
(`30 3 * * *`), so both have already recorded their run for the day. Two invariants
are checked there, and each step fails open (log only, no alert, never throws):

| Step | Source | What it checks |
| --- | --- | --- |
| cron run failures | `runwatch.ts` | the latest `worker_runs` row for each job in `WATCHED_JOBS` (`blocklist_sync`, `d1_archive`, `config_backup`; migration 018) is `ok`/`skipped`; `failed`, an unknown outcome, or a `running` row older than `STALE_RUNNING_S` (2 h) alerts |
| blocklist drift | `blocklist.ts` | the Cloudflare IP List `comicine_blocklist` equals the `active = 1` rows of D1 `blocked_ips`; a non-empty `to_add`/`to_remove` alerts, agreement stays silent |

Cost per day: **4 rows read** (one index seek per watched job on
`idx_worker_runs_job_started`, one `SELECT cidr FROM blocked_ips WHERE active = 1`
on `idx_blocked_ips_active`) plus two read-only Cloudflare API calls (list lookup by
name, one items page). Adding a job to `WATCHED_JOBS` costs exactly one more row per
day; leaving it out costs the visibility this Worker exists to provide. Nothing here is read from the every-minute probe cron or
from the status page — the status page is served once per minute per language, so a
`worker_runs` read there would cost thousands of rows per day.

The checks are checked *and* alerted from the same place: an alert is one message
listing every finding, in `ALERT_LANG` (four languages in `ALERT_I18N`). Missing
Cloudflare credentials (`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`) is a
skip, not a failure: a fresh clone without those secrets must not start alerting.

## Endpoints

| Path | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/` , `/status` | GET | public | Server-rendered status page, 4 languages, `?lang=` override (edge-cached, `Vary: Accept-Language`) |
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
| `src/page.ts` | markup, CSS, client scripts, the three page shapes (status / 404 / render failure) |
| `src/i18n.ts` | four-language table, language detection, probe-error classification |
| `src/brand-font.ts` | generated: inlined Baloo 2 wordmark subset |

The header and footer mirror the main site's `src/templates/base.html` and
`src/templates/_footer.html` (same class names, same SVG, same `tokens.css` palette,
Baloo 2 wordmark, language flyout, dark/light pill, GitHub/Bilibili links). The
implementation is **self-contained on purpose**: `status.comicine.com` is a separate
origin, so linking the main site's `/static/**` would need a relaxed CSP *and* would
make the status page depend on the very site it monitors being reachable. The
trade-off is that this markup is duplicated by hand — the docs fork
(`VPComiCineNav.vue` / `VPComiCineFooter.vue`) is the second copy. Change both when the
main site header changes.

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

- Unknown path with `Accept: text/html` -> branded 404 page; every other client keeps
  the plain-text `Not Found`.
- D1 unreadable -> the Worker's own 503 page with `Cache-Control: no-store`, instead
  of a generic Cloudflare error page; `/api/status` answers
  `503 {"error":"unavailable"}`.

### CSP and the brand font

The status page ships the tightest CSP in the project: `default-src 'none'`,
`style-src 'self'`, `script-src 'self'`, `font-src 'self' data:`, `img-src 'self'
data: https://images.comicine.com`, `connect-src 'self'`, `base-uri 'none'`,
`form-action 'none'`, `frame-ancestors 'none'`. There is no inline script or
style, so the theme class is applied before paint by the blocking
`/status-theme.js` in `<head>`. The Baloo 2 wordmark is a 2.2 KB woff2 subset
inlined in `src/brand-font.ts` (the regeneration command lives in that file)
because the main site's copy is cross-origin and the main site sends no CORS
header for fonts.

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
#  "blocklist":{"ok":true,"issues":0,"alerted":false}}
# ok=false means "this step could not run" (missing secret, D1/API error), not
# "something is broken"; issues/alerted report what was found.
```

`/alert-test` has a second layer on top of the token: one call per client IP per
60 seconds (in-isolate map, best effort, `429` + `Retry-After` beyond that). The
`Authorization` header is checked first, so unauthenticated requests never reach
that map.

## Secrets

| Secret | Required for | Without it |
| --- | --- | --- |
| `STATUS_TOKEN` | `/run`, `/alert-test`, `/daily-checks` | those endpoints return 401 (fail closed) |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | the blocklist-drift step | that step is skipped and logged (fail open, no alert) |
| `ALERT_TO`, `ALERT_FROM` | any alert reaching a human | alerts are logged only |

`CLOUDFLARE_API_TOKEN` only needs read access to the `comicine_blocklist` IP List
(`Account > Account Rulesets > Read` or the equivalent). It is the same value the
sync Worker uses; this check never writes, never creates the list and never issues
`bulk_operations`.

## Deploy

```sh
bash ops/deploy.sh --worker=comicine-status
```

The token is a Worker secret, not a `[vars]` entry: environment variables in
`wrangler.toml` are public and are wiped on some deploy paths, secrets are not.
