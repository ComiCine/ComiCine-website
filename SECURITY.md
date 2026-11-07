<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms may apply where validly authorized.
See ADDITIONAL_TERMS.txt.
-->

# Security design and threat model

This document describes the security model implemented by the code in this repository: what the edge trusts,
where identity comes from, how secrets and visitor IP data are handled, and which layer actually enforces
blocking. It describes the implementation, not live configuration. Settings that exist only in the Cloudflare
dashboard are identified as runtime configuration, and values that change predictably (cookie lifetimes,
schedules, list sizes) are not repeated here; read them from the Security design and Environment variables
sections of [README.md](README.md), or re-read them with `python3 ops/readme_facts.py`.

## Trust model

The gate in [functions/_middleware.ts](functions/_middleware.ts) runs before any content page is served. A request
must either prove something about its origin or prove that this browser completed a challenge. The table below
lists every path past the gate and what each one is worth.

| Path past the gate | Basis | Strength | What it grants |
| --- | --- | --- | --- |
| IP-CIDR allowlist from [docs/lists/own-ips.txt](docs/lists/own-ips.txt), generated into [docs/lists/whitelist.txt](docs/lists/whitelist.txt) and compiled into [functions/_data/gateTrust.ts](functions/_data/gateTrust.ts), matched by `isGateTrustedIp()` in [functions/_lib/routing.ts](functions/_lib/routing.ts) | The request comes from an address or network the operator controls | Identity based: passing it requires controlling the address, not merely claiming it | Full bypass: no challenge and no D1 blocklist lookup |
| Cloudflare `botManagement.verifiedBot`, read by `isTrustedCrawler()` in [functions/_lib/tracking.ts](functions/_lib/tracking.ts) | Cloudflare's own verification of a known crawler's network and signature | Signature based: the caller cannot self-declare it | Full bypass, and excluded from visitor statistics |
| A declared crawler User-Agent from the explicit `User-agent:` lines in [docs/lists/robots.txt](docs/lists/robots.txt), compiled into `GATE_TRUST_CRAWLER_UAS` and matched by `declaredCrawlerToken()` in [functions/_lib/bots.ts](functions/_lib/bots.ts) | The `User-Agent` header, matched as a substring | Self-declared, therefore **not authentication**. Any client can send `GPTBot` | Challenge exemption only. It still passes the D1 blocklist, is never issued a `__gate` cookie, and is never counted as a visitor |
| A valid `__gate` cookie | An HMAC-signed edge token, minted after Turnstile verification or issued to a trusted source at `/gate` | Possession of a short-lived signed token, not identity | Passes the gate for the token lifetime; still subject to the blocklist |

Only the allowlist and verified-bot rows are identity based or signature based. The User-Agent row is a
declaration: `sourceTrusted` deliberately excludes it, so a blocked crawler cannot escape `blocked_ips` by
renaming its agent, and `resolveGateTrust()` in [functions/_lib/gate.ts](functions/_lib/gate.ts) records it in a
separate `declaredCrawler` field so it can never be confused with `trusted`. `cf_clearance` is never read or
accepted, and a User-Agent string proves nothing about the client that sends it.

`docs/lists/own-ips.txt` is the operator's manual allowlist of fixed egress addresses. `docs/lists/robots.txt` is
both the published robots file and the crawler allowlist: [ops/check_gate_trust.py](ops/check_gate_trust.py)
compiles its explicit `User-agent:` lines into the generated `functions/_data/gateTrust.ts`, so adding a crawler
is one line in one file. The `gate_trust` switches in [config-contract.json](config-contract.json) disable a tier
without deleting its list.

## Human verification with Turnstile

A request that proves nothing gets the gate page rendered in place: `renderGatePage()` renders
`public/<lang>/auth.html` at the requested URL with status 403, so the host and path never change, and a successful
verification reloads the original target. The response is `Cache-Control: no-store` and the template carries
`noindex, nofollow` ([src/templates/auth.html](src/templates/auth.html)).

The widget's allowed hostnames are set in the Cloudflare Turnstile dashboard and are runtime configuration; the
repository cannot enforce them. What the code does enforce is the verification result. `POST /__gate/verify` calls
Turnstile siteverify server-side from `verifyTurnstile()`, with a short abort timeout, and then requires the echoed
`hostname` to satisfy `isPublicHost()` from [functions/_lib/routing.ts](functions/_lib/routing.ts); when siteverify
echoes an action, it must also match the gate action. `isPublicHost()` reads `public_hosts` from
[config-contract.json](config-contract.json), which lists the site's own hosts and the `*.comicine.com` wildcard
and contains no Pages hostname. A token minted on `comicine.pages.dev` is rejected with `hostname_rejected` even
when siteverify reports success.

That check is why Pages preview and alias hostnames must keep redirecting before Functions run. The account-level
Bulk Redirects rule that must perform that redirect is runtime configuration, so the hostname check is the code-side
guarantee. Never add a Pages hostname to `public_hosts` or reduce the check to `success` alone; otherwise the
sitekey configuration, not this repository, would decide who counts as a visitor. The remote address sent to
siteverify comes only from `CF-Connecting-IP`; forwarding headers are ignored.

## Identity and sessions

Cloudflare Access is the only identity source: no self-hosted IdP, no local credential table, no custom login
form. One Access application, `ComiCine`, fronts `identity.comicine.com/login` and the private docs routes; the
application, policies, identity providers and session duration are Cloudflare runtime configuration. The code
assumes only that Access runs before those routes and supplies `Cf-Access-Jwt-Assertion`.

`verifyAccessJwt()` in [functions/_lib/access.ts](functions/_lib/access.ts) verifies before it reads: decode the
header, accept RS256 only, select a key from the cached JWKS, verify the RSASSA-PKCS1-v1_5 signature, and only then
check `iss`, `aud`, `exp` and `nbf`. A failed verification returns null and the caller answers 401; there is no
fallback to the unverified payload.

Once Access succeeds, [functions/login.ts](functions/login.ts) creates a random handoff code and stores only its
SHA-256 hash in `identity_handoffs`, together with the hash of the state, the source host, target path, subject,
email and authentication time ([ops/migrations/020_identity_handoffs.sql](ops/migrations/020_identity_handoffs.sql)).
The row is short-lived, single-use and bound to the source host and state: the source callback exchanges it
server-to-server and the exchange deletes it. The handoff carries identity but no role.
[functions/identity/callback.ts](functions/identity/callback.ts) applies the role from `identity_sites` in
`config-contract.json` through `identityRoleForHost()` in
[functions/_lib/identity.ts](functions/_lib/identity.ts), so an Access identity can be an admin on one protected
host and a viewer on another without the role ever travelling in the handoff.

Sessions are host-only signed cookies (`__Host-comicine_session`) with a `sid` recorded in D1 `auth_sessions`
([ops/migrations/004_auth_sessions.sql](ops/migrations/004_auth_sessions.sql)). The `__Host-` prefix makes the
browser enforce `Secure`, `Path=/` and the absence of `Domain`, so a sibling subdomain cannot overwrite the cookie.
`requireAuth()` in [functions/_lib/session.ts](functions/_lib/session.ts) verifies the signature and then the
revocation row; a missing, revoked or expired row is rejected. When `auth_sessions` cannot be read it throws
`AuthSessionUnavailableError`, which callers map to 503 instead of trusting the signed cookie alone. Browser
navigations get a 401 HTML document from `identityRequiredResponse()` that navigates to Identity, while API
authentication failures remain JSON 401 responses from `requireAdminSession()`.

## Secrets and fail-closed behavior

Runtime secrets live only in Pages Secrets, the encrypted environment variables of the Pages project. They are
never committed: `secrets/` is git-ignored by [.gitignore](.gitignore), and the deploy scripts read credentials
from the local, git-ignored `secrets/webauthn.env`. Plain_text Pages project variables do not survive
`wrangler pages deploy`, so every runtime value must be a Secret rather than a plain setting.

`runtimeConfigError()` in [functions/_lib/session.ts](functions/_lib/session.ts) names the required keys (it
returns field names, never values). When `TURNSTILE_SECRET`, `GATE_HMAC_KEY` or `SESSION_HMAC_KEY` is empty,
`handleOnRequest()` returns a 503 configuration error before routing any request, and `handleVerify()` re-checks
its own keys so the standalone verify path cannot mint a cookie either. Consequently `gateCookieHeaders()` is never
called with an empty key, and no unsigned or empty-key HMAC cookie is issued. Missing Access configuration is
handled the same way by `accessConfigError()`.

## The __gate cookie

`mintGateCookie()` in [functions/_lib/gate.ts](functions/_lib/gate.ts) writes
`__gate=<issued-at>.<expires-at>.<HMAC-SHA256 hex>`, signing both unix timestamps so an old signature cannot be
replayed with a later expiry. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, scoped to the current
(or legacy) root domain, and short-lived; the lifetime comes from `gate_ttl_seconds` in the contract. Minting and
validation happen entirely at the edge, with no database access.

`readGateCookie()` rejects malformed values, bad signatures, expired tokens and future-issued tokens, and the
middleware then renders the challenge again instead of serving the page. Renewal is bounded: the cookie is
reissued only after most of its lifetime has elapsed, so a verification is not a sliding session. `cf_clearance`
is not consulted anywhere in this path.

## Visitor IP data

Analytics are privacy-minimized by default. `recordVisit()` in [functions/_lib/tracking.ts](functions/_lib/tracking.ts)
writes `visitor_rollups` with a truncated HMAC-SHA256 of the IP keyed by `OBSERVABILITY_HMAC_KEY` in `ip_hash`,
never the address itself. The full IP is stored only as Fernet ciphertext in `visitor_rollups.ip_enc`, encrypted
with the separate `VISITOR_IP_KEY` through [functions/_lib/visitor-ip.ts](functions/_lib/visitor-ip.ts) and
[functions/_lib/fernet.ts](functions/_lib/fernet.ts); the column arrives in
[ops/migrations/014_visitor_ip_enc.sql](ops/migrations/014_visitor_ip_enc.sql). The keys are not interchangeable:
the HMAC key cannot decrypt, and the encryption key is not used for hashing.

`GET /api/visitors` ([functions/api/visitors.ts](functions/api/visitors.ts)) returns aggregates keyed by `ip_hash`
and never a full IP. Decryption happens one row at a time in `GET /api/visitors/<hash>/ip` for an admin session,
and each reveal writes an audit event. When `VISITOR_IP_KEY` is missing, `encryptVisitorIp()` returns an empty
string so tracking continues without that column, while `decryptVisitorIp()` returns null and the endpoint answers
503 or 404. It never degrades to the hash or to another key. Rows written before the column existed have no
ciphertext and report that no IP is available.

## Blocking chain

D1 `blocked_ips` is the single authority ([ops/migrations/004_blocklist_sync.sql](ops/migrations/004_blocklist_sync.sql)).
The text file [docs/lists/blocklist.txt](docs/lists/blocklist.txt) is an auditable seed and snapshot only; it is
never read at request time.

Administrative changes go through [functions/api/blocklist.ts](functions/api/blocklist.ts), which requires an admin
session and a CSRF check. Every change is written to `blocklist_audit` in the same batch as the mutation, recording
actor, action, reason and previous values. Unblocking is a soft delete (`active = 0`, source `admin/unblock`), so
the row and its history remain for rollback and audit. CIDRs are normalized and validated in
[functions/_lib/cidr.ts](functions/_lib/cidr.ts) before storage, so a differently written prefix cannot evade a block.

Enforcement is layered. `isBlocked()` in the middleware answers with the gate page (403) for a blocked source
before any content page is served, except for the login, logout, admin and public rates paths listed in
`EXEMPT_PATH_PREFIXES` ([functions/_lib/routing.ts](functions/_lib/routing.ts)), so an administrator on a blocked
address can still sign in. [ops/sync-worker/src/index.ts](ops/sync-worker/src/index.ts) mirrors active rows into the
Cloudflare IP List for a WAF rule that is not always enabled, so the application-level 403 is the layer this
repository guarantees. The lookup is skipped for allowlisted and verified-bot sources, cached briefly, and fails
open when D1 cannot be read, because a database outage must not take the whole site down.

## Browser-side hardening

The enforced CSP contains no `unsafe-inline` for scripts or styles, so inline `script`, inline `style` and
`onclick`-style attributes are blocked; page templates ship no executable inline script and no inline handlers.
Interaction goes through `data-action` and `data-input` delegation in [src/static/js/actions.js](src/static/js/actions.js),
which dispatches to named global functions; markup names a handler, it does not carry code.

[ops/security-headers.json](ops/security-headers.json) is the single source of the security response headers.
[functions/_lib/security.ts](functions/_lib/security.ts) mirrors it for Pages, and
[ops/check_security_headers.py](ops/check_security_headers.py) fails when the two drift, when the CSP regains
`unsafe-inline`, or when a third-party script or frame origin has no matching `connect-src` entry. The gate page is
served `no-store` with a `noindex` template, and admin JSON responses are `no-store` as well.

## What this document does not cover

- Cloudflare account, token and API-key hygiene, including who holds the deploy token and how it is rotated.
- Dashboard-only settings: the Turnstile hostname list, the Access application and its policies, the Bulk
  Redirects rule, the WAF rule that consumes the IP List, and the zone's AI-bot policy. These are runtime
  configuration; this document only describes what the code does when they are configured as intended.
- Availability and denial-of-service resistance beyond the `/login` and `/logout` throttles described in
  [README.md](README.md), including D1 quotas and edge-level flood protection.
- Third-party platform guarantees: Cloudflare Access, Turnstile, D1, Pages and Workers availability, the identity
  providers behind Access, and the npm and Python dependency supply chain.
- The operator's workstation, browser profile and local `secrets/` directory.
- Privacy, retention and legal compliance beyond the code paths cited above.

This is a design description, not a full security audit, penetration test or certification.

## Reporting a vulnerability

Report vulnerabilities through the disclosure policy at
[https://docs.comicine.com/security/policy/en-us](https://docs.comicine.com/security/policy/en-us).
