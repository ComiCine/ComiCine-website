<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# ComiCine email templates

Transactional-mail layout and four-language copy for ComiCine.

**Status: deprecated (2026-10-11, tasks/22 W7-13).** Nothing in the running system
calls the Python renderer any more: the VPS Flask app that used it was retired and
Cloudflare Access replaced the login mail flow. The only production mail that still
goes out is the **status-worker alert**, which owns its own copy.

## Owner map (do not duplicate copy)

| Mail | Owner | Notes |
| --- | --- | --- |
| Status / health alert | `ops/status-worker/src/index.ts` (`ALERT_I18N` + `buildAlertEmail`) | The single source. Four languages, asserted by `ops/status-worker/src/index.test.ts`. |
| Shared HTML framework | `framework.html` + `framework.i18n.json` + `render.py` (this directory) | Deprecated, uncalled, kept working by `tests/test_email_templates.py`. |
| Alert copy (Python) | - | `health-alert.i18n.json` is a tombstone: it carries no copy, so it cannot drift again. |

If a new mail sender is ever added, either reuse this framework or delete it. Never
add a third copy of the same copy.

## Shared framework (deprecated)

- `framework.html`: the HTML layout (logo, title, body, optional highlight block,
  optional CTA button, optional hint, footer). Placeholders are documented at the
  top of the file.
- `framework.i18n.json`: four-language defaults (`footer_rights`, `default_hint`,
  `default_button`, `common_title`).
- `render.py`: the renderer entry point. It still works and is tested, but has no
  caller in production. Example:

  ```python
  from render import render_email
  html, plain = render_email(
      lang="en-us",                    # zh-cn / en-us / ja-jp / ko-kr
      title="Your verification code",
      body="Thanks for using ComiCine.",
      code="654321",                   # optional: highlight block
      cta_label="Open",                # optional: primary button
      cta_url="https://comicine.com",
      hint="If you did not request this, you can ignore this mail.",
      preheader="Your code is 654321",
  )
  ```

  CLI debug (prints a `plain` block and an `html` block, no decorative banners):

  ```sh
  python3 render.py --lang en-us --title 'Hi' --body 'Hello' --code 123456
  ```

## Verification-code case (unused)

- `verification-code.i18n.json`: four-language copy for a verification-code mail
  (subject / title / body / hint / plain / footer).
- `verification-code.html`: notes only; the actual layout comes from the framework.

No running service sends a verification-code mail today (Cloudflare Access handles
login), so this case is kept for reference only.

## Sending notes

- **Preferred channel after the VPS retirement**: the status-worker's
  `ALERT_WEBHOOK_URL` (HTTP webhook, Feishu bot format by default).
- **Fallback**: the Workers `send_email` binding (requires Email Sending). Sender
  domain `comicine.com`; DNS changes stay on the `cf-bounce` subdomain, the root SPF
  record is untouched.
- Recipients are injected with `wrangler secret put ALERT_TO` and never committed;
  with no recipient configured an alert is only logged and does not fail.
- The email copyright footer uses the xtext PNG fallback because SVG rendering is
  inconsistent across email clients.
- The header logo comes from `images.comicine.com` (keeps the alpha channel);
  `image.comicine.com` drops alpha and renders a black background.

## Known issues

- Feishu's sending egress IPs (`71.18.227.x` / `163.181.x`) are on Spamhaus
  blocklists, so some providers (iCloud, for example) hard-reject them with
  `554 5.7.1 [HM08] local policy` even though SPF/DKIM pass.
  Workaround for recipients: add the sender to contacts / allowlist. A real fix
  needs Feishu to delist the IPs, or a provider with cleaner egress.
