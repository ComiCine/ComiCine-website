<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# ComiCine Cloudflare resource inventory

This directory is the declarative description of ComiCine's Cloudflare resources, used
for deploys, rollbacks and external audits. Real tokens, secrets and reproducible IDs
are **not** written here; they come from the sources listed below.

| Resource | Name / type | Source of truth | Notes |
| --- | --- | --- | --- |
| Pages production project | `comicine` (`comicine.pages.dev`) | `site/ops/pages_deploy.sh` | Production custom domains and encrypted runtime configuration |
| Retired Pages project | `comicine-production` | User-controlled deletion | Retained without production custom domains until the user deletes it |
| Docs Pages project | `comicine-docs` (`comicine-docs.pages.dev`) | `site/ops/docs_deploy.sh` | Recreated and deployed under the ComiCine alias; `docs.comicine.com` now serves this project |
| Pages Functions | `functions/**` | Git | Gate, login, Apple Account, visitor stats, Ray lookup |
| D1 database | `DB` binding | `site/wrangler.toml` (`database_id`) | Shared by Pages and the cron Workers |
| D1 migrations | `ops/migrations/*.sql` | Git | Entry point `ops/migrate_d1.sh`, with checksums in `migration_checksums` (024) and `--repair` for an interrupted 004; `018_worker_runs.sql` / `019_worker_runs_dry_run.sql` hold the Worker run history |
| Worker: probes / status page | `comicine-status` | `ops/status-worker/wrangler.toml` | Probes every minute + 10 s re-check after down; `status.comicine.com`; D1 retention **and the daily checks** (run history + blocklist invariant) daily at 03:47 |
| Worker: blocklist sync | `comicine-blocklist-sync` | `ops/sync-worker/wrangler.toml` | Daily 03:30, D1 active rows -> Cloudflare IP List; run history + `GET /?health=1` (see "Blocklist chain") |
| Worker: image watermark | `comicine-image-watermark` | `ops/image-watermark/wrangler.toml` | `image.comicine.com/*` normalising proxy, `/portfolio/*` always returns the watermark (A2) |
| Worker: D1 archive | `comicine-d1-archive` | `ops/d1-archive/wrangler.toml` | Daily 00:00: archive of the previous UTC day into `comicine-analytics/` **plus** the configuration/schema snapshot into `backup/`; run history + `GET /?health=1` (see "Worker run history" and "Disaster-recovery snapshot") |
| Worker: Sink link shortener | `comicine-sink` | `ComiCine/Sink` repository | `sink.comicine.com`; target D1 is `comicine-sink`, target analytics dataset is `comicine_sink`; imported and deployed, retaining the existing KV namespace; short-link smoke check pending |
| Workers account subdomain | `comicine.workers.dev` | Cloudflare Workers account settings | Replaced the former account subdomain; custom domains stayed attached, and the Sink Worker keeps its workers.dev route disabled |
| R2 private bucket (originals) | `comicine-originals` | `ops/upload_originals.sh` | After A2 the portfolio originals live only locally + in this private bucket, never in Pages |
| R2 bucket (fonts) | `comicine-fonts` | `ops/fonts/README.md` | Public font objects copied and verified; `fonts.comicine.com` serves the new bucket |
| R2 bucket (analytics / archive) | `comicine-analytics` | `ops/d1-archive/wrangler.toml` | D1 snapshots and daily analytics archives |
| D1 database (main) | `comicine` | Pages and Worker D1 bindings | Provisioned and loaded with in-use tables; Pages production/preview settings target it, and standalone Worker bindings ship in this release. Retired analytics and detail history were not copied |
| D1 database (Sink) | `comicine-sink` | Sink Worker binding | Created and imported with 29 rows; Worker binding is deployed |
| Durable Object namespace | `comicine-status_ComiCineProbeStateV2` | `ops/status-worker/wrangler.toml` | The old namespace was deleted after the new class binding was confirmed live |
| WAF IP List | `comicine_blocklist` | `ops/sync-worker` | Live list name; no custom WAF filter currently references it |
| DNS zone | `comicine.com` | Cloudflare Dashboard | Main Pages records target `comicine.pages.dev`; `docs.comicine.com` targets `comicine-docs.pages.dev` |
| WAF rules | custom rules | Cloudflare Dashboard | The custom-firewall phase is currently **empty**; no local snapshot is retained. Zone-level ASN Access Rules are managed separately and only change when `ops/waf_whitelist.sh --apply` is run explicitly. |
| Cache Rules | none | Cloudflare API / Dashboard | No Cache Rules are currently active; cache behavior comes from Worker logic and response headers |
| Cloudflare account display name | Not yet updated | Cloudflare Account Settings | The configured API token can read the account but cannot update its name (HTTP 403, error 9109 / missing Account Settings Write) |
| Zone settings | `comicine.com` settings | Cloudflare Dashboard | HSTS/HTTPS enforcement, minimum TLS, Security Level, Web Analytics injection. `ops/zone_settings.py` can display live values and optionally write a local snapshot (see below) |
| AI bot policy | `bot_management` | Cloudflare Dashboard / `ops/ai_bots.py` | Which AI behaviours (Search / Agent / Training) are blocked, whether AI Labyrinth is on, and whether Cloudflare manages `robots.txt`. The zone default blocks Training **on pages with ads**, i.e. GPTBot/ClaudeBot/CCBot/Amazonbot/Bytespider get a managed-ruleset `403` before any Worker runs. `ops/ai_bots.py --show/--snapshot/--apply` is the switch; the REST endpoint needs the token to carry **Bot Management: Read/Edit**. See "AI bots and crawlers" below |

## Dashboard-only resources (this repository is not fully reproducible)

Everything below exists **only in the Cloudflare Dashboard**. The files listed above
declare the Worker code and its bindings, but they do **not** declare the routes, so a
fresh `wrangler deploy` will not recreate them:

- Worker **custom domains and routes**: `image.comicine.com/*` -> `comicine-image-watermark`,
  `status.comicine.com/*` -> `comicine-status`, plus the `sync-worker` route. They live
  under Workers & Pages -> (worker) -> Settings -> Domains & Routes and are
  deliberately absent from every `wrangler.toml` (`ops/image-watermark/wrangler.toml`
  says so explicitly): a `routes` block would make each deploy rewrite the live route
  set, which this repository cannot diff or roll back.
- Pages **custom domains** (`comicine.com`, `www`, `services`, `contact`, `visitor`,
  `account`, `admin`, ...) and their certificates.
- **DNS records** in `comicine.com`.
- **WAF custom rules** and the access rules for the `comicine_blocklist` IP List.
- **Cache Rules** and any manual edge cache purge.
- **AI bot policies** (`Security > Settings > Configure AI bot policies`): they decide
  whether a crawler is answered with `403` by the managed ruleset, which no Pages
  Function can override. `ops/ai_bots.py` can read and change them through the API when
  the token has the Bot Management permission; otherwise the Dashboard is the only
  interface.

Treat the Dashboard as authoritative for those; this file is the inventory that makes
them traceable, not a reproducible manifest.

## Zone settings

Zone-level settings change externally observable behaviour — whether `http://` redirects,
the minimum TLS version, whether Cloudflare injects its Web Analytics beacon — yet nothing
in this repository pinned them, so a Dashboard change could alter the live site with no
reviewable diff.

`ops/zone_settings.py` reads live values and can optionally write a local snapshot. No snapshot is currently committed:

```
python3 ops/zone_settings.py --dry-run    # offline: print a local snapshot, if one exists
python3 ops/zone_settings.py --show       # live: print current values, write nothing
python3 ops/zone_settings.py --snapshot   # live: write or refresh a local snapshot
```

The snapshot covers the keys in `SNAPSHOT_KEYS` (26 settings: transport, TLS, caching,
hotlink and bot-protection switches). It records `value` and `editable` per key, so a
plan-gated or renamed setting shows up as `unavailable` instead of vanishing.
`tests/test_zone_settings.py` verifies the snapshot schema and guarded-key coverage using
synthetic data, so CI does not depend on a saved snapshot file.

`--show` and `--snapshot` print a `<- review` note when a setting holds the *unwanted*
value (for example `ssl = flexible`, `development_mode = on`). They deliberately do not
flag correct values: the first draft flagged `always_use_https=on`, which is how a review
note turns into noise.

**One open item**: `security_level` is `essentially_off`, which disables Cloudflare's
threat score, IP reputation and Browser Integrity Check for the whole zone. The Worker
gate and the `blocked_ips` blocklist remain the only filters, and no record anywhere says
this was deliberate. Flagged in `## Open items / external confirmations`.

## AI bots and crawlers (`ops/ai_bots.py`)

`comicine.com` is deliberately readable by crawlers and AI agents: `docs/lists/robots.txt`
lets them past the Pages-Functions Turnstile gate, and `src/build.py` generates an
allow-everything `/robots.txt` plus an `/llms.txt` index. The edge in front of the Worker
has its own opinion, and it wins first:

- Cloudflare's managed ruleset contains `block-ai-on-ads` ("Block AI bots on ad pages"),
  which answers GPTBot / ClaudeBot / CCBot / Amazonbot / Bytespider and friends with
  `403` and the body `Your request was blocked.` **before** any Function runs. It shows up
  in the firewall analytics as `source: firewallManaged`, `ruleId
  eb4f2dedc16c49f9bf27a5170989fb0f`, and there is no custom rule that could disable it.
- The switch is the zone's Bot Management configuration
  (`GET` / `PUT /zones/<zone_id>/bot_management`; the update verb is **PUT**, PATCH answers
  `405 / code 10405`): `ai_bots_protection` (the legacy "Block AI bots" toggle, `block` /
  `only_on_ad_pages` / `disabled`) plus the per-behaviour policies `ai_search`, `ai_user`,
  `ai_training`, the AI Labyrinth switch `crawler_protection`, and `is_robots_txt_managed`
  (Cloudflare prepending a managed `robots.txt` derived from those policies — unwanted here,
  because `robots.txt` is owned by `src/build.py`).

```sh
python3 ops/ai_bots.py --dry-run    # offline: print a local snapshot + the plan
python3 ops/ai_bots.py --show       # live: print the AI-related keys, write nothing
python3 ops/ai_bots.py --snapshot   # live: refresh ops/ai-bots.snapshot.json
python3 ops/ai_bots.py --apply      # live: set every AI behaviour to "do not block"
```

`--apply` only writes keys the zone actually reports, prints the before/after, re-reads the
configuration and exits non-zero if anything still differs. It also prints the keys it
never touches (`fight_mode`, `content_bots_protection`, `bot_preference_sync_enabled`,
`stale_zone_configuration`) and flags the ones that block automated traffic — flipping
those is a product decision, not a cleanup.

**Applied on 2026-10-12**: the zone had the legacy
`ai_bots_protection: only_on_ad_pages` plus `crawler_protection: enabled` (AI Labyrinth,
i.e. AI crawlers were being sent into a link maze) and `is_robots_txt_managed: true`; all
six managed keys now hold the allow value. Verified from a non-allow-listed egress:
GPTBot / ClaudeBot / CCBot / Bytespider / Amazonbot / PerplexityBot get `200` on
`comicine.com`, `services.`, `contact.`, `images.` and `docs.comicine.com`, while a browser
User-Agent still gets the `403` Turnstile gate. Two dead ends worth remembering:
`PATCH` is rejected (`405`), and a WAF custom rule with `action: skip` over
`phases: ["http_request_firewall_managed"]` is *accepted* by the API on a Free zone but
does **not** lift the AI-bot block.

The endpoint is gated by the **Bot Management** permission. The token in
`secrets/webauthn.env` carries "Bot Management: Edit" since 2026-10-12 (the Dashboard path
is `Security > Settings > Configure AI bot policies` -> *Allow* for Search, Agent and
Training). Before that the API answered `403 Authentication error`; `--apply` reports that
condition precisely instead of pretending the zone was fixed.

## Pages environment variables (key names only, never values)

Configured in the Pages project under `Environment variables -> Encrypt (Secret)`:

- `TURNSTILE_SITEKEY` / `TURNSTILE_SECRET`
- `GATE_HMAC_KEY`, `SESSION_HMAC_KEY`
- `GATE_HMAC_KEY_PREVIOUS` (optional; only during a gate-key rotation, see below)
- `ACCESS_TEAM_DOMAIN`, `ACCESS_IDENTITY_AUD`
- `APPLE_ACCOUNT_ENCRYPTION_KEY`, `VISITOR_IP_KEY`
- `OBSERVABILITY_HMAC_KEY`

Local development copies `.dev.vars.example`; production values are read from the
local `secrets/webauthn.env` and the Pages project secrets (never committed, never
echoed). There is no server-side credential source any more.

## Gate HMAC key rotation (`GATE_HMAC_KEY`)

`__gate` is an HMAC-SHA256 cookie signed with `GATE_HMAC_KEY`. Rotation does not change the cookie
name, the `issued.expires.signature` value format, the contract TTL, `Domain=.comicine.com`,
`SameSite=Lax`, `Path=/`, or the renewal threshold. `GATE_HMAC_KEY_PREVIOUS` is an optional Pages
Secret accepted for validation only: old cookies keep working while new cookies are signed with the
new current key, and issuance never uses the previous key.

- Validation tries the current key first, then the previous key. A blank previous key counts as
  absent; the current key remains required.
- A malformed previous key fails closed at runtime with `invalid_GATE_HMAC_KEY_PREVIOUS` (HTTP 503):
  a value shorter than 32 characters or containing whitespace means the fallback you think you have
  does not exist. The current key's requirements are unchanged.
- Logs carry field names only; never print or copy key values into the repository.
- `GATE_HMAC_KEY_PREVIOUS` is deliberately absent from `.dev.vars.example`.

Pages Secrets are write-only after upload, so keep the old value in the git-ignored
`secrets/webauthn.env` (or a temporary file outside the repository) before changing anything.

### Planned rotation (no user-visible re-challenge)

The contract sets `GATE_TTL_SECONDS` to 3600 and renewal happens after 2700 seconds. A cookie
signed with the old key is therefore either expired or renewed with the new key within one hour of
the switch; one full TTL plus a safety margin is enough before the old key can be removed.

1. Save the current key outside the repository:

```bash
grep '^GATE_HMAC_KEY=' secrets/webauthn.env > /tmp/gate-key-previous.env
chmod 600 /tmp/gate-key-previous.env
```

2. Put the old key into the previous slot and deploy Pages; leave `GATE_HMAC_KEY` unchanged:

```bash
set -a; . /tmp/gate-key-previous.env; set +a
printf '%s' "$GATE_HMAC_KEY" | npx wrangler pages secret put GATE_HMAC_KEY_PREVIOUS --project-name comicine
bash ops/deploy.sh --pages
```

Verify step 2: `curl -o /dev/null -w '%{http_code}\n' 'https://comicine.com/?challenge=1'` is 403,
a normal visitor still receives the site (200 and no `cf-turnstile`), and no `gate_stale_cookie`
rows with `message = 'bad_signature'` appear. A missing previous key would only show up in step 3.

3. Switch the current key to a fresh value (64 lowercase hex characters, `openssl rand -hex 32`)
and deploy:

```bash
NEW_KEY="$(openssl rand -hex 32)"
printf '%s' "$NEW_KEY" | npx wrangler pages secret put GATE_HMAC_KEY --project-name comicine
bash ops/deploy.sh --pages
```

Verify step 3: a browser that held a cookie signed with the old key still reaches the site without
a challenge (that is the previous-key path). A fresh private window passes the gate, and its new
`__gate` value is accepted on the next request. Old cookies must not produce
`gate_stale_cookie` / `bad_signature` rows:

```bash
npx wrangler d1 execute comicine --remote --command \
  "SELECT date(ts,'unixepoch') AS day, count(*) AS n FROM events WHERE event='gate_stale_cookie' AND message='bad_signature' GROUP BY day ORDER BY day DESC LIMIT 7"
```

4. After one TTL plus margin (for example the next day), delete the previous key and deploy:

```bash
npx wrangler pages secret delete GATE_HMAC_KEY_PREVIOUS --project-name comicine
bash ops/deploy.sh --pages
rm -f /tmp/gate-key-previous.env
```

Verify step 4: the site still serves normally and `/gate?challenge=1` is still 403. Any cookie
issued before step 3 is now expired or was renewed with the new key, so nothing depends on the
previous key. The key removed in this step must never be reused.

### Rollback

- If step 3 causes unexpected challenges: restore `GATE_HMAC_KEY` to the old value and set
  `GATE_HMAC_KEY_PREVIOUS` to the value introduced in step 3, then deploy. Cookies minted under
  either key validate during the transition; remove the previous key one TTL later.
- If the current key leaks: switch to a fresh current key immediately (step 3 without step 2) and
  accept that every outstanding cookie fails verification once. Do not keep the leaked value
  configured; a hard rotation costs one gate challenge per visitor and no data.
- Never weaken validation to let mismatched or expired cookies through. A wrong key must fail
  closed; a failed verification is a challenge, not an outage.

### Preview drill

Before rotating production, run one drill in a preview deployment with throwaway keys: deploy
`GATE_HMAC_KEY=A` plus `GATE_HMAC_KEY_PREVIOUS=B` (A != B), confirm the gate still works, switch
to `GATE_HMAC_KEY=C` with `GATE_HMAC_KEY_PREVIOUS=A`, and confirm a cookie minted under A still
passes while issuance uses C. Never copy production key values into a preview environment.

## Shared ComiCine Access application

The existing `ComiCine` application is the only Cloudflare Access application for
internal services. Add service routes as destinations on it; never create a separate
application for an internal service. It protects `identity.comicine.com/login`,
`docs.comicine.com/private/*`, `comicine-docs.pages.dev/private/*`, and
`*.comicine-docs.pages.dev/private/*`, plus generated article bundles under
`/assets/private_articles_*` on those production and preview hosts, with one shared policy.
Cloudflare Access sends
the browser through the `comicine.cloudflareaccess.com` team domain and back to the
requested route with its signed JWT. The Pages Function verifies the single application AUD
and returns a short-lived, one-use code containing the verified user identity and
registered source host. The source host consumes that code server-to-server, applies
its local role from `identity_sites`, and sets its own host-only session cookie. Both
current protected hosts use the admin role because their APIs require administrator
sessions. This registration path supports `.comicine.com` subdomains in the main Pages
project: add the host to `managed_hosts`, `page_routes`, and `identity_sites` in
`config-contract.json`, make its pages and APIs enforce the local role, and add its DNS
and Pages custom domain. The host must use the shared Pages Functions bundle, D1
database, and Secrets so its callback can create a host-only session. Adding a host already
supported by the shared identity broker does not require another Access application. Add any
other internal host, root domain, or Pages project as a destination on this same Access
application. If it needs the host-only identity handoff, implement its callback, session, and
contract support before connecting it to the broker.

The docs Pages project uses those destinations on the shared application; docs requests do not
use the host-only identity handoff. `ops/docs_deploy.sh` verifies the shared policy, protects the
private article bundles before publishing, adds the docs destinations, and removes redundant
docs-specific applications after migration. The MU5735 report is private: its four language sources
live under each language's `private/articles/` directory and rewrite to
`/private/articles/mu5735-report/<lang>`. Its figures use
`/assets/private_articles_mu5735_*`. Protect these pages and assets with the shared application on
production and preview hosts; private pages are marked `noindex, nofollow` and excluded from
navigation and the sitemap. The AMC 10 and UK majors sources remain private under
`private/articles/` with the same protection. Former public MU5735 URLs and figure assets return direct HTTP 404 responses from
`comicine-docs-legacy-404` before Pages static caching; they do not redirect or use Access.
Former public AMC 10 and UK majors article routes also return direct HTTP 404. The
deploy script removes former edge redirects and retired Worker routes after publishing the current
Pages build; Pages middleware handles the resulting HTML 404s. Leave unassigned `/articles/*` paths
available for future public articles, and keep `/private/*` outside those routes so the production
Access application protects it.
User-facing HTML 404s across docs Pages, the main Pages subdomains, the status Worker, and the image
Worker keep HTTP 404 and send the browser to `https://comicine.com/404` with a Refresh navigation,
not a 3xx response. The main site's `/404` remains the canonical localized page. API and asset 404s
retain their native response formats.
An unauthenticated browser navigation to a protected page receives HTTP 401 HTML,
sets the host-bound state cookie, and loads a same-origin external script that
navigates to the shared identity URL. Cloudflare Access then redirects the browser
through its team-domain login. API authentication failures remain JSON 401 responses.
Manage the Access application and its policy in Cloudflare Zero Trust → Access controls →
Applications. Source-host role mappings stay in `site/config-contract.json`; there is no
ComiCine-hosted administration page for this identity flow.

## Blocklist chain

Banning is carried by three layers, all driven by the same D1 table:

| Layer | Source | What it does |
| --- | --- | --- |
| Authority | D1 `blocked_ips` | The only authoritative record; `active = 1` means banned, `active = 0` is a soft-delete tombstone |
| Edge | Cloudflare IP List `comicine_blocklist` | Written by `ops/sync-worker` (cron `30 3 * * *`); no live WAF rule currently references it, so D1-backed Worker checks remain the active block path |
| Worker | `functions/_lib/gate.ts` | `BLOCKED_LIST_SQL` also filters `WHERE active = 1`, so both layers agree; returns 403 |

`docs/lists/blocklist.txt` is a snapshot for auditing only. The WAF custom-firewall phase is
currently **empty** (see the table above), so the IP List is the only edge-level
enforcement.

Both layers read `active = 1`, which makes "the IP List is empty" ambiguous: it can
mean "nothing is banned" (correct) or "the sync silently stopped writing" (a fault).
Until migration 018 there was no way to tell the two apart from the outside. Now
`ops/check_blocklist_sync.py` is the diagnostic entry point:

```sh
python3 ops/check_blocklist_sync.py            # text report, exit 1 on drift
python3 ops/check_blocklist_sync.py --json     # one JSON object, for cron/alerting
python3 ops/check_blocklist_sync.py --record   # also log this check into worker_runs
```

It prints the desired set (D1 `blocked_ips` with `active = 1`), the actual set (the
Cloudflare IP List API), the delta (`to_add` / `to_remove`), and the last recorded run
per job. **Exit 0** means both layers agree and every reported job finished `ok` /
`skipped`; **exit 1** means drift or a failed job; **exit 2** means the check itself
could not complete (credentials, D1, Cloudflare) and says nothing about drift.

Cost: two reads, both indexed and tiny -- `SELECT cidr FROM blocked_ips WHERE
active = 1` (`idx_blocked_ips_active`) and one `LIMIT 1` per job on `worker_runs`
(`idx_worker_runs_job_started`). It never touches the large tables. The script is
read-only: it only ever issues `GET` on the Cloudflare side, and `--record` (opt-in)
appends at most one row to `worker_runs`.

**This check also runs by itself.** `ops/status-worker` performs the same
comparison once a day inside its `47 3 * * *` task (TypeScript -- a Worker has no
python): `SELECT cidr FROM blocked_ips WHERE active = 1` (one indexed row) against
one page of IP List items, alerted only when `to_add`/`to_remove` is non-empty. The
script stays the manual entry point -- it can `--record`, prints the full delta and
handles paging the same way -- and both sides use one definition of the invariant
(the `/32` and `/128` normalisation is duplicated in `ops/status-worker/src/blocklist.ts`
on purpose; change one, change the other). Missing `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` on the status Worker is a logged skip, never an alert.

**Not implemented on purpose.** `ops/sync-worker` is the only job that compares the
two layers. A Cloudflare-side change that silently drops entries (account migration,
API regression, someone editing the list by hand) still leaves both sides "consistent"
from D1's point of view, so this script would report `to_add=0 to_remove=0` while the
ban is gone. The run history fixes the "did the sync run at all" question; it does not
make the IP List self-verifying.

## Worker run history (`worker_runs`, migration 018)

Both cron Workers used to call `ctx.waitUntil(asyncWork(env))`, so a rejected promise
was swallowed and the Cloudflare cron panel still showed the run as fine. A sync or
archive failure produced no record anywhere. Migration `018_worker_runs.sql` closes
that gap:

| column | meaning |
| --- | --- |
| `job` | `blocklist_sync` / `d1_archive` / `config_backup` (cron Workers) or `blocklist_sync_check` (`ops/check_blocklist_sync.py --record`). `d1_archive` and `config_backup` are the two stages of the same cron run and are recorded separately on purpose: `?health=1` reports one row per job, so "the archive is fine" cannot hide "the snapshot has been failing for a week" |
| `started_at` / `finished_at` | UTC epoch seconds; `finished_at` is NULL while a run is in flight |
| `outcome` | `running`, `ok`, `skipped` (no credentials), or `failed` |
| `added` / `removed` | Delta of that run. `d1_archive` puts the archived row total in `added`; `config_backup` puts the **measured D1 rows read** in `added` (its cost) and the number of R2 objects deleted by rotation in `removed` |
| `error` | Failure text, verbatim |
| `dry_run` | 1 = the run only computed the diff and sent no write request (`?dry-run=1`); 0 = a real sync. Added by `019_worker_runs_dry_run.sql`, because otherwise a rehearsal is indistinguishable from a sync that really ran -- the exact question this table exists to answer |

Both Workers also emit a structured single-line JSON log with `outcome:"failed"` on
failure, so `wrangler tail` and the Workers log panel can be searched for it. The
Worker hot paths (sync, archive) only ever **write** to this table; the reads happen in
the `?health=1` endpoint, in the operator script and in the daily check below, which
keeps the D1 read budget untouched (see AGENTS.md "D1 read budget").

**Somebody is now watching.** A record nobody reads is not visibility. Since the
daily checks landed in `ops/status-worker`, cron failures no longer just sit in the
table: `comicine-status` reads the latest row per job at 03:47 UTC -- after the archive
(`0 0 * * *`) and the sync (`30 3 * * *`) have both recorded their run -- and pushes
**one** alert through the normal channel (webhook -> Email binding -> SMTP) whenever
the outcome is not `ok`/`skipped`, or a row is stuck in `running` for more than two
hours. Cost is one index seek per job per day (`idx_worker_runs_job_started`,
measured `rows_read=2` for two jobs); this table is never read from the every-minute
probe cron, and adding it to the status page was rejected on purpose (that page is
re-rendered every minute per language, which would turn a 2-row read into thousands
of rows per day). `POST /daily-checks` on `status.comicine.com` runs the same check on
demand.

Health endpoints (both require `Authorization: Bearer <SYNC_TOKEN>` and fail closed
with 401 when the secret is unset):

```sh
# blocklist sync: last run only, does NOT trigger a sync
curl -H "Authorization: Bearer $SYNC_TOKEN" \
  'https://comicine-blocklist-sync.comicine.workers.dev/?health=1'

# d1 archive: last run only, does NOT archive anything
curl -H "Authorization: Bearer $SYNC_TOKEN" \
  'https://comicine-d1-archive.comicine.workers.dev/?health=1'
```

Both return `{ ok, job, lastRun }`. The sync Worker also returns `last_success_at` and
`lag_seconds`: UTC epoch seconds of the most recent real sync that finished `ok`
(`dry_run=0`, so a dry run cannot reset the metric; `null` when none has succeeded yet)
and the seconds elapsed since then (`null` when there is no success to measure from).
A later failure does not erase the last good timestamp, so the lag keeps growing until
the next success. The archive Worker also returns
`backup: { job: "config_backup", lastRun }`, because both stages of its cron need to be
visible from one call. `GET /` on the sync Worker still triggers a sync
and keeps its original `{ ok, toAdd, toRemove }` shape (the `.zshrc` helper
`_comicine_sync_cf` depends on it); `?dry-run=1` is unchanged. The archive Worker
answers 404 for anything except `?health=1` -- it exists only so a failure becomes
visible, never to be triggered over HTTP.

## Disaster-recovery snapshot (`backup/`)

Until 2026-10-11 the same D1 database had only two automatic paths: this Worker's
`analytics/YYYY_MM_DD/` archive (four analytics tables, previous UTC day) and the
retention job in `ops/status-worker`. **Neither covered a single configuration table**, so
a full-database loss would have taken `blocked_ips` (the authoritative block list),
`apple_accounts`, `auth_credentials`, `schema_version` (migration bookkeeping) and every
`CREATE TABLE` with it. The only other route was a hand-run export, and the newest of
those was 2026-09-26 -- a manual path nobody runs is not a path.

The daily 00:00 cron therefore has a **second stage**. It is deliberately a separate
`worker_runs` job (`config_backup`, not a re-labelled `d1_archive`), because
`GET /?health=1` reports one row per job: a shared job value would let "the archive is
fine" hide "the snapshot has been failing for a week".

### What it writes

One prefix per UTC **run** day (not per data day):

```
backup/2026_10_10/ddl.sql               replayable skeleton: every CREATE TABLE / INDEX
backup/2026_10_10/schema.jsonl.gz       every sqlite_master row verbatim (lossless)
backup/2026_10_10/manifest.json         complete flag, per-object/table SHA-256, row counts, gaps, restore hints
backup/2026_10_10/<table>.jsonl.gz      one object per table below
```

13 objects per day: `ddl.sql`, `schema.jsonl.gz`, ten table objects, and `manifest.json`, which is written last. The count follows `CONFIG_TABLES`; the `objects` array in each manifest is the measured record of what the day actually contains.

Rows are JSONL -- one JSON object per line -- gzipped, values taken verbatim from D1's
response objects. That is what keeps `active` an integer 0/1, keeps epoch timestamps
integers, and keeps `NULL` distinguishable from `''`.

`ddl.sql` is the *replayable* subset of `sqlite_master`: `sqlite_sequence` (a reserved
name; SQLite creates it itself for `AUTOINCREMENT`) and `_cf_KV` (Cloudflare-managed;
D1 rejects reads and writes with `SQLITE_AUTH`, code 7500) are left out but **listed in
the file header**, and both are kept verbatim in `schema.jsonl.gz` so nothing is lost.

### Tables in and out

| Table | Rows (2026-10-10) | Why |
| --- | --- | --- |
| `schema_version` | 19 | `migrate_d1.sh` skips already-applied files by these rows |
| `blocked_ips` | 83 | authoritative block list; `docs/lists/blocklist.txt` is only a snapshot of it |
| `apple_accounts` | 5 | account records, copied verbatim, never decrypted |
| `auth_credentials` | 1 | pbkdf2 hashes and lockouts, copied verbatim |
| `probes` / `probe_state` | 3 / 3 | probe definitions and alert state |
| `retention_state` | 5 | retention bookkeeping per bucket |
| `blocklist_audit` | 192 | the rollback basis for every block/unblock |
| `worker_runs` | 6 | whether the cron jobs actually ran |

Total **321 data rows + 107 `sqlite_master` rows = 428 rows read per run**, measured from
`meta.rows_read` (the sum is recorded as `d1_rows_read` in `manifest.json` and as `added`
on the `config_backup` row of `worker_runs`). Against the 5,000,000 rows/day free-tier
budget that is 0.009%, and it stays inside the "single-digit hundreds of rows" rule.

`probe_uptime_daily` joined the allowlist on 2026-10-11 and added ~75 rows, taking the
snapshot to roughly 503 rows per run (0.01%); `d1_rows_read` in each manifest is the
current measurement, not the 2026-10-10 figure above.

Deliberately **not** read, with the reason recorded in `manifest.json` next to the data:

- `visitors` (~13.9k rows) -- legacy VPS-era table with plaintext IPs; no code has read it
  since the 2026-09-17 edge migration, and copying it would create a second store of
  plaintext IPs.
- `visitors_daily` (~11.3k rows) -- derived aggregate, rebuilt by
  `ops/prune_d1.py --mode aggregate` from `visitors_v2` + `visitor_rollups`.
- `visitor_rollups`, `visitors_v2`, `ray_log_v2`, `events` -- already archived daily into
  `analytics/` by this same Worker.
- `heartbeats`, `ray_log`, `gate_failures`, `auth_sessions`, `identity_handoffs`,
  `_cf_KV` -- bulk telemetry, superseded tables, self-healing counters, re-loginable
  sessions, and a platform-internal table.

`visitors` and `visitors_daily` are the two places where this snapshot is knowingly not a
full backup; each one is listed with its reason in `manifest.json`.

Two of the included tables grow without bound (`worker_runs` by one row per Worker run,
`blocklist_audit` by one row per block/unblock), so the daily read cost creeps upward.
`d1_rows_read` is in every manifest, which makes the drift a number rather than a guess;
if it ever approaches ~2,000, window those two tables instead of dropping the snapshot.

### Retention: `backup/` rotates, `analytics/` does not

At the end of a run the stage keeps the newest **14** `backup/YYYY_MM_DD/` prefixes and
deletes older ones **as whole snapshots** -- never object by object, which could leave a
`ddl.sql` with no rows beside it. Rotation is time-based rather than
completeness-based: a day whose table failed still counts as a day, otherwise a
permanently broken table would pin the bucket to unbounded growth. What that day actually
contains is in its `manifest.json` and in the `failed` run record.

`analytics/` is untouched by this, and structurally so:

1. the directory listing is issued with `prefix: "backup/"`, so R2 cannot return an
   `analytics/` prefix at all;
2. every key is re-checked against `isBackupKey()` immediately before the delete call;
3. only `backup/YYYY_MM_DD/`-shaped prefixes rotate, so anything hand-placed under
   `backup/` (`backup/notes.txt`, `backup/manual/`) is never auto-deleted.

`backup/` and `analytics/` also differ in meaning, not just in name:

| | `analytics/YYYY_MM_DD/` | `backup/YYYY_MM_DD/` |
| --- | --- | --- |
| Day means | the UTC day the **data** belongs to (yesterday) | the UTC day the **snapshot** was taken (today) |
| Content | 4 analytics tables, that day's rows only | DDL + 10 configuration/small tables, current state |
| Retention | none in R2 (D1 prunes the source tables) | newest 14 prefixes, older ones deleted |
| Purpose | investigate a day after the detail left D1 | rebuild the database |

One deliberate difference in the object metadata: `analytics/` objects carry
`contentEncoding: gzip`, and both the R2 REST API and `wrangler r2 object get` then
**silently inflate** them on download (measured: a 624-byte object arrives as 1,290 bytes
of plain JSONL under a `.jsonl.gz` name). `backup/` objects declare
`contentType: application/gzip` with no `contentEncoding`, so the bytes that arrive are
the bytes that were stored -- which is the only thing that makes a restore script work.

### Restoring from a snapshot

Replace `<database>` with `comicine` (or the D1 database name you are restoring into). The
target should be a **fresh** database; the rendered SQL uses plain `INSERT`.

```sh
DAY=2026_10_10
DEST=/tmp/comicine-restore-$DAY
mkdir -p "$DEST"

# 1. download the day (13 objects: ddl.sql, schema.jsonl.gz, ten table objects, manifest.json)
for t in schema_version blocked_ips apple_accounts auth_credentials probes \
         probe_state retention_state blocklist_audit worker_runs probe_uptime_daily; do
  wrangler r2 object get "comicine-analytics/backup/$DAY/$t.jsonl.gz" --remote --file "$DEST/$t.jsonl.gz"
done
wrangler r2 object get "comicine-analytics/backup/$DAY/ddl.sql"        --remote --file "$DEST/ddl.sql"
wrangler r2 object get "comicine-analytics/backup/$DAY/schema.jsonl.gz" --remote --file "$DEST/schema.jsonl.gz"
wrangler r2 object get "comicine-analytics/backup/$DAY/manifest.json"  --remote --file "$DEST/manifest.json"

# 2. check what you got before touching anything (row counts, gaps, byte sizes)
cat "$DEST/manifest.json"

# 3. render DDL + INSERTs into one replayable file
python3 ops/d1-archive/restore.py --dir "$DEST" --out "$DEST/restore.sql"

# 4. apply it
wrangler d1 execute <database> --remote --file "$DEST/restore.sql"

# 5. verify
wrangler d1 execute <database> --remote \
  --command "SELECT COUNT(*) FROM blocked_ips; SELECT COUNT(*) FROM schema_version"
```

`restore.py` verifies the download before it renders anything. It refuses unless
`manifest.json` exists and `complete` is true, the required fields are valid, the local
directory holds exactly the manifest's `objects` plus `manifest.json` (the `--out` file is
excluded when it is the output path), `ddl.sql` and `schema.jsonl.gz` are listed, every
file's size and SHA-256 match, and each table entry matches its object and parsed row
count. A failure prints English `FATAL:` lines, writes no output and exits 1; a missing
object or a partial download is a refusal, never a warning.

The checksum is over the bytes R2 stored. `backup/` objects carry no `contentEncoding`, so
a client that inflates a `.jsonl.gz` on the way down changes its SHA-256 and the restore is
refused; re-download the object instead. `--allow-incomplete` is not the fix -- it is the
explicit manual-rescue bypass for legacy or incomplete snapshots, prints `WARNING:` lines,
and never relaxes parse errors, a missing `ddl.sql`, invalid identifiers or symlink escapes.
Legacy archives without `complete` are rejected by default. To re-apply data on top of an
existing database use `--data-only --replace`; to emit only INSERTs, `--data-only`. The
full field reference lives in [`../d1-archive/README.md`](../d1-archive/README.md).

Because the snapshot only holds the tables listed above, a **full** point-in-time copy
still needs `wrangler d1 export <database> --remote` before a risky migration (see
"Migration and rollback"); the snapshot is what you have when nobody ran that.

### Failure visibility

The stage is a separate `worker_runs` job with the same structured single-line JSON log as
the rest of the Worker: `{"event":"config_backup","job":"config_backup","outcome":"failed",...}`
on `console.error`, searchable from `wrangler tail` and the Workers log panel. Both stages
run inside their own `try`/`catch` in `scheduled()`: a snapshot failure never fails the
archive, and an archive failure never skips the snapshot. One table failing does not
discard the other nine -- it is recorded in `manifest.json`, in the run row and in the
log, and rotation still runs so a bad table cannot pin the bucket.

## Migration and rollback

`ops/migrate_d1.sh` is the only migration entry point; D1's `schema_version` table is the
source of truth, and the local `.d1-migrations/applied` file is only an offline cache. A key
is `version * 1000 + sequence` (1-based among files sharing a number): `004_auth_sessions.sql`
= 4001, `004_blocklist_sync.sql` = 4002, `004_schema_version.sql` = 4003. A legacy plain row
`4` counts as applied for all three.

### Back up first

- **Daily snapshot** -- `comicine-d1-archive` writes `backup/YYYY_MM_DD/` to the R2 bucket
  `comicine-analytics` at 00:00 UTC: DDL, the allowlisted tables and a `manifest.json` with
  counts and hashes. It is the fast path for `blocked_ips` and the other listed tables but not
  the `migration_checksums` rows, which the first post-restore run re-baselines; a full export
  is the copy that includes them. Check `complete: true` and follow "Restoring from a snapshot"
  above.
- **Full point-in-time copy** -- `wrangler d1 export` covers every table, including the
  analytics tables the snapshot excludes:

  ```sh
  wrangler d1 export comicine --remote --output=/tmp/comicine-export-$(date -u +%Y%m%dT%H%M%S).sql
  ```

  It contains account and credential rows: keep it outside the repository.

### Checksums (`migration_checksums`)

`024_migration_checksums.sql` creates the table (the script also creates it defensively). A row
holds the migration key, file name, SHA-256 and recording time. The first run after the upgrade
baselines every applied file with no row; run it from a clean, committed worktree (`git status`
empty) because that baseline trusts the files on disk. A normal apply records what it applied after
success, printing `[d1] checksums: recorded <N> sha256 rows`; a no-op run with all rows matching
prints `[d1] checksums: verified <N> applied migrations` and writes nothing.

A changed applied file stops the run before any migration statement and prints the file, its
key and both hashes. Restore it from Git (`git checkout -- ops/migrations/<file>`) and rerun;
an intentional change is a new numbered migration. Only after a reviewed edit of an applied
file, update the row by hand:

```sh
wrangler d1 execute comicine --remote --command \
  "UPDATE migration_checksums SET sha256='<new-sha256>', recorded_at=datetime('now') WHERE version=<key>"
```

### Preview, apply and check the schema

```sh
bash ops/migrate_d1.sh --dry-run                 # offline plan, no D1 contact
bash ops/migrate_d1.sh --remote                  # apply pending files
bash ops/migrate_d1.sh --check-schema --remote   # read-only table check
```

`--dry-run` prints the per-file plan (`key=`, `cache=`) and writes nothing; confirm the next
pending file and its key before applying. `--remote` is required to apply (otherwise exit 2):
statements run one at a time and the `schema_version` row is written only after every
statement succeeds. The schema check expects `migration_checksums` in its table list.

### Interrupted 004: symptoms and repair

`004_blocklist_sync.sql` rebuilds `blocked_ips` through `blocked_ips_new` (create, copy, drop,
rename) and never drops a table before the copy succeeds. A run interrupted after the rename
leaves the post-004 schema with no `schema_version` row for 4002; a normal `--remote` apply
refuses that state -- `blocked_ips` present, `blocked_ips_new` absent or empty, no 4002/legacy
`4`, post-004 columns in `PRAGMA table_info(blocked_ips)` -- and exits 1 without executing a
migration statement:

```text
FATAL: interrupted blocklist migration detected: blocked_ips already has the post-004 schema
run: bash ops/migrate_d1.sh --repair --remote
```

Preview offline, then apply:

```sh
bash ops/migrate_d1.sh --repair --dry-run
bash ops/migrate_d1.sh --repair --remote
```

The dry run prints the required state and contacts no D1. The real repair runs the dedicated,
non-versioned recovery tail `ops/migrations/repair/004_blocklist_sync_post004.sql` (post-004
columns only, never the main file) after validating the state. It refuses when combined with
`--check-schema` (exit 2), no `--remote` without `--dry-run` (exit 2), missing
`schema_version`, 4002 or legacy `4` already recorded, missing post-004 columns, or
`blocked_ips` missing. An empty `blocked_ips_new` left by an interrupted repair is dropped
automatically; one that holds rows next to `blocked_ips` is refused as ambiguous. If that copy
is the interrupted repair duplicate and `blocked_ips` is complete, drop the copy and rerun
(`DROP TABLE blocked_ips_new;` then `--repair --remote`); otherwise compare both tables and
keep the one that holds the data to preserve.

Never apply a migration or the recovery tail with `wrangler d1 execute --file` or any
continue-on-error client. Those keep going after a failed copy and then execute the `DROP`;
`ops/migrate_d1.sh` stops at the first failed statement, which is what makes the order safe.

A legacy `blocked_ips` row whose `cidr` is `NULL` cannot satisfy the new `network NOT NULL`
column. `ops/migrate_d1.sh` refuses before 004 when one exists; the old file silently skipped
it. Check `SELECT COUNT(*) FROM blocked_ips WHERE cidr IS NULL` and fix those rows first.

If a completed rebuild survives only as `blocked_ips_new` (with `blocked_ips` missing), verify
and rename it first:

```sh
wrangler d1 execute comicine --remote --command "SELECT COUNT(*) FROM blocked_ips_new"
wrangler d1 execute comicine --remote --command "PRAGMA table_info(blocked_ips_new)"
wrangler d1 execute comicine --remote --command "ALTER TABLE blocked_ips_new RENAME TO blocked_ips"
```

Then rerun `--repair --remote`: it requires an unchanged row count, then records key 4002 and
the `004_blocklist_sync.sql` checksum; a changed count prints
`FATAL: --repair row count changed` and records nothing.

### Verify

```sh
wrangler d1 execute comicine --remote --command "SELECT version FROM schema_version ORDER BY version" --json
wrangler d1 execute comicine --remote --command "SELECT version, filename, sha256 FROM migration_checksums ORDER BY version" --json
wrangler d1 execute comicine --remote --command "SELECT COUNT(*) AS blocked_ips_rows FROM blocked_ips" --json
wrangler d1 execute comicine --remote --command "PRAGMA table_info(blocked_ips)" --json
```

`migration_checksums` should have one row per applied file -- the three legacy 004 files are
4001-4003 even where `schema_version` still holds the plain `4` -- and every `sha256` must
match the file on disk. `blocked_ips` should match the pre-change export or manifest, and
`PRAGMA` must list `cidr, network, prefix, reason, source, created_at, updated_at,
updated_by, active`; no `updated_by` means the table is still legacy.

### Rollback

Applied migrations are not reverted automatically; restore data and revert the code together.
An export is DDL plus `INSERT`, not idempotent: replay it into a fresh database (or one whose
affected tables were dropped), then point the bindings at it.

- **Daily snapshot** -- download the prefix bytes unchanged, check `complete: true` and the
  hashes in `manifest.json`, render with the `restore.py` command above, then apply. `--replace`
  keeps it idempotent on a populated database; `--data-only` skips the DDL. Only allowlisted
  tables are restored.
- **Reconcile** -- run `bash ops/migrate_d1.sh --remote`, then `--check-schema --remote`, so
  `schema_version` matches the restored state and `migration_checksums` is re-baselined.

## Deploy order

```sh
# 1. build and validate (no deploy)
bash ops/pages_deploy.sh --build-only

# 2. preview the migrations and the Cloudflare commands
bash ops/pages_deploy.sh --dry-run
bash ops/workers_deploy.sh --dry-run

# 3. the real deploys (need credentials; book them in docs/parallel-actions.md)
bash ops/pages_deploy.sh
bash ops/workers_deploy.sh
```

## Cache Rules

No Cloudflare Cache Rules are active in the `comicine.com` zone (verified 2026-10-27). The former
public cache ruleset and its HTML rules are historical records, not live configuration.
Those HTML rules were disabled because their
`cache_key` was empty, so the edge cached by URL only, while the public page language
is decided by the `user_lang_preference` cookie. The first visitor's language was then
served to everyone at the same URL, and switching language still returned the old one.
The free plan does **not** support a custom cache key (it fails with
`not entitled to use the custom cache key override`), so the cookie cannot be part of
the key; the rules were disabled and the Worker's Cache API now buckets by `lang`
(`cachedPageAsset` in `functions/_middleware.ts`) with
`Vary: Accept-Language, Cookie`. The page TTL is still 300 s, so behaviour is unchanged.

Historical records:

- Public HTML: used to match `/`, `/services`, `/contact` on `comicine.com`,
  `services.comicine.com`, `contact.comicine.com` when the request carried the
  `user_lang_preference` cookie; edge/browser TTL 300 s.
- Static assets: used to match `/static/*` on the hosts above plus the main-site
  favicon and ComiCine copyright wordmark; edge/browser TTL 1 year.

> After A2, `/static/portfolio/**` is no longer a public image path (the originals
> were removed; only `/static/wm/portfolio/**` watermarks and
> `/static/portfolio/thumbs/**` thumbnails remain), but older deployments cached the
> clean originals with `immutable` (1 year). Switching to A2 therefore requires
> **purging the Cloudflare edge cache for `/static/portfolio/*` by hand**, otherwise
> the edge can keep serving the old clean originals.

If cache rules are recreated, manage them through the Rulesets API phase
`http_request_cache_settings` or the Dashboard under `Rules -> Cache Rules`, and keep
them consistent with the language-aware Worker cache. No such rules are active now.

## D1 retention and cleanup

The **owner of the retention policy is `ops/status-worker/src/retention.ts`**; it runs
on the Worker cron at 03:47. `ops/prune_d1.py` is the manual operator entry point and
reads the same windows from that file (it fails loudly if the two ever disagree):

| Table | Window | Timestamp column | Notes |
| --- | --- | --- | --- |
| `ray_log_v2` | 7 days | `ts` | Per-request edge log detail |
| `visitors_v2` | 30 days | `ts` | Visitor detail |
| `visitor_rollups` | 30 days | `last_ts` | Hourly rollups (HMAC `ip_hash` + Fernet `ip_enc`) |
| `heartbeats` | 30 days | `ts` | Probe heartbeats, 3 rows per minute |
| `auth_sessions` | 60 days | `exp` | Must stay **longer** than `session_ttl_seconds` (30 days), otherwise live sessions are deleted |
| `identity_handoffs` | 1 day | `expires_at` | Single-use login codes expire after two minutes; unused records are pruned |
| `events` | 90 days | `ts` | Audit and operational events |
| `probe_uptime_daily` | 90 days | `day` | Daily uptime rollups (the status page reads at most 7 days) |
| `visitors_daily` | permanent | - | Daily aggregate; written by `ops/prune_d1.py --mode aggregate --apply` |

`visitors_daily` is only ever written for **complete UTC days** and upserted with
`ON CONFLICT ... DO UPDATE SET x = MAX(x, excluded.x)`, so re-running the aggregation
can never shrink a day that was already correct (tasks/22 W7-5).

Production scheduling is entirely Worker Cron Triggers: probes every minute, retention
daily at 03:47 (`ops/status-worker`), blocklist sync daily at 03:30 (`ops/sync-worker`),
D1 archive daily at 00:00 (`ops/d1-archive`). There is no VPS crontab any more;
`install_retention_cron.sh` was deleted with the VPS. What each of those runs actually
did is recorded in `worker_runs` (see "Worker run history" above); failures are
retrievable from the Workers log as single-line JSON with `outcome:"failed"`.

### `ray_log_v2` `ip_hash` index: landed in migration 017

`ray_log_v2` used to have only a `ts` index, so `WHERE ip_hash = ...` -- used by
`ops/check_ip_rays.py` and `ops/check_visitor_id.py --requests` -- was a full scan of
the 7-day detail table, and mapping a plaintext IP to its hash decrypts every
`visitor_rollups.ip_enc` row. A troubleshooting script must not become the next D1
read incident, so those scripts print the query size before querying, and
`ops/check_ip_rays.py --hash <ip_hash>` skips the `ip_enc` scan entirely.

**Landed in `ops/migrations/017_ray_log_v2_ip_hash_index.sql`** (applied to production
on 2026-10-11 via `bash ops/migrate_d1.sh --remote`, `schema_version` key 17001):

```sql
CREATE INDEX IF NOT EXISTS idx_ray_log_v2_ip_hash_ts ON ray_log_v2 (ip_hash, ts DESC);
```

It is a retention-friendly composite index (the table is pruned by `ts`, so the index
stays small). Measured on production D1 (`ray_log_v2` = 2337 rows):

| query | before | after |
| --- | --- | --- |
| `WHERE ip_hash = ? ORDER BY ts DESC LIMIT n` | `SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts` | `SEARCH ray_log_v2 USING INDEX idx_ray_log_v2_ip_hash_ts (ip_hash=?)` |
| `WHERE ip_hash IN (...) ORDER BY ts DESC LIMIT n` | `SCAN ray_log_v2 USING INDEX idx_ray_log_v2_ts` | `SEARCH ray_log_v2 USING INDEX idx_ray_log_v2_ip_hash_ts (ip_hash=?)` |

`WHERE ray LIKE '...'` (`ops/check_ray_id.py`, `functions/api/ray/[id].ts`) still scans
`idx_ray_log_v2_ts`: the ray prefix is only known at runtime, so an index on `ray` would
not help -- `ray` is already the `PRIMARY KEY`, and the planner needs the leading column
to be constrained.

**Why `idx_ray_log_v2_host_ts` is still absent.** `005_retention.sql:33` creates it, but
`008_gate_failures.sql:23-25` deliberately drops it again ("the following indexes have no
production query using them, yet amplify every write"). That still holds: no query filters
`ray_log_v2` by `host` -- every `FROM ray_log_v2` site filters on `ts`, `ip_hash` or `ray`,
and `host` only appears in `SELECT` lists. Do not re-add it without a query that needs it.
Note that 005 cannot be "fixed in place": production records 005 as the legacy plain
version number `5`, so `migrate_d1.sh` skips the whole file (`skip (recorded legacy
version 5)`) -- an index added inside it would never run. Index changes need a new number.

## Open items / external confirmations

- The user decided not to restore the historical 1255 snapshots; the backups stay
  archived and are not imported into D1 or the CF List.
- Login is Cloudflare Access only; the authentik / Uptime Kuma entries are void since
  the VPS lease ended.
- WAF custom rules and DNS records should be changed through the Cloudflare API or the
  Dashboard; this file only keeps those states traceable.
- A2 image ownership is live: originals are private (`comicine-originals`), the public
  side serves only watermark variants and thumbnails.
- **Resolved 2026-10-11: `security_level` raised from `essentially_off` to `medium`.**
  `essentially_off` had disabled Cloudflare's threat score, IP reputation and Browser
  Integrity Check for the whole zone, leaving the Worker gate and the `blocked_ips`
  blocklist as the only filters; nothing recorded it as deliberate. `medium` is the
  Cloudflare default (challenge suspicious traffic, do not block outright). The zone
  snapshot now reads `medium` and the `--show` review note is gone. If legitimate traffic
  ever gets challenged, the value is one PATCH away and the snapshot will show the diff.
- **Historical change 2026-10-11: `identity.comicine.com` was temporarily removed** from both the Pages custom domains
  and the zone DNS (proxied `CNAME` to `comicine.pages.dev`). It returned 404 and nothing in
  the repository, the contract or the docs referenced it (authentik-era leftover). The
  other ten hostnames were re-checked and still answer. The host was later restored for the shared
  Access identity flow documented below.
- **Configured 2026-10-18: shared Access identity**. The former `ComiCine-Visitor` app was
  repurposed as `ComiCine` for `identity.comicine.com/login`, retaining its admin policy
  and AUD. Its `ComiCine-Admins` policy now also allows the `account.comicine.com` email domain,
  preserving the existing includes and exclusions. The old `ComiCine-Apple` app for
  `account.comicine.com` was deleted; visitor and account
  now start the shared Pages identity handoff and receive host-only sessions. The unused legacy
  `ComiCine-Admin` app for `admin.limooo.cn` was deleted on 2026-10-29; the hostname has no DNS
  record or Pages custom domain.
- **Consolidated 2026-11-05: internal Access destinations**. `identity.comicine.com/login`, the
  production docs private path, and both Pages preview aliases now share the existing `ComiCine`
  application and its unchanged admin policy. The two docs-specific Access applications were
  deleted. `ops/docs_deploy.sh` adds future internal docs routes to the shared application and
  removes redundant docs apps after verifying the same policy; it must not create an application.
- **Completed 2026-10-29: Pages production migration**. The production project is now
  `comicine` (`comicine.pages.dev`) and owns the production custom domains, D1 binding, and
  encrypted runtime configuration. Main Pages DNS records now target `comicine.pages.dev`.
  The retired `comicine-production` project is kept without production custom domains for the
  user-controlled deletion step. `site/ops/pages_deploy.sh` and the GitHub Actions Pages job now
  deploy only `comicine`. The Turnstile API permission is active and the widget API read returns
  HTTP 200. A browser screenshot on `comicine.pages.dev/?challenge=1` showed the widget success
  state, but D1 recorded `/gate/verify` returning 403 `hostname_rejected`; the public-host check
  intentionally rejects Pages hostnames. A successful browser challenge on `comicine.com` has
  not yet been confirmed. Do not weaken the gate or allow Pages hostnames as public hosts. The obsolete
  `identity.limooo.cn/login` Access destination was removed while preserving the `ComiCine` AUD and
  policy. The docs project remains `comicine-docs` with `docs.comicine.com` attached. The legacy
  `.cn` zone redirects to matching `.com` hosts; `/feishu/<path>` and `/lark/<path>` on
  `comicine.com` return 302 through Pages to `https://comicine.feishu.cn/<path>`, preserving path
  and query.
- **Checked 2026-10-27: Cloudflare account rename**. `GET /accounts/{account_id}` succeeds, but
  updating the account display name to `ComiCine` is rejected with HTTP 403 / error `9109` because
  the configured API token lacks `Account Settings Write`. The account name remains unchanged until
  a token with that permission is available. R2 now contains only `comicine-analytics`,
  `comicine-fonts` and `comicine-originals`; the pre-rename buckets are absent. The main D1 is
  provisioned; its binding cutover, the Sink resources and the status Durable Object migration
  remain pending as described above.
