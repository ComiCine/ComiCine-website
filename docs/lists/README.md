<!--
Copyright (C) 2026-Present ComiCine
SPDX-License-Identifier: AGPL-3.0-or-later
Section 7 additional terms apply when the work is used under GNU AGPL v3.
See ADDITIONAL_TERMS.txt.
-->

# List Directory (Allowlist / Blocklist)

This directory contains lists used by the access gate and blocking flow. It is not included in the docs.comicine.com deployment artifacts.

## Files

| File | Source | How to maintain it |
| --- | --- | --- |
| `own-ips.txt` | Manual | Edit fixed IPs, CIDRs, or ASNs that need to be registered manually. |
| `whitelist.txt` | Generated from `own-ips.txt` by `ops/sync_whitelist.py` | Do not edit it manually. Deployment regenerates it; you can also run the sync script directly. |
| `robots.txt` | Manual, standard robots.txt format | Used both for the live `/robots.txt` rules and as the gate's crawler User-Agent list. |
| `blocklist.txt` | Handwritten section plus a managed section pulled from D1 | Add manual blocks to the handwritten section. D1 `blocked_ips` is the source of truth. |

Lists are no longer fetched from external ASN directories. `ASN/<number>` remains valid as a manual allowlist entry, but a full deployment does not automatically change Cloudflare zone-level ASN Access Rules. To change those rules, explicitly run `bash ops/waf_whitelist.sh --apply`.

## Crawler allowlist: `robots.txt`

`docs/lists/robots.txt` has two uses:

1. `src/build.py` publishes its crawler rules at `https://comicine.com/robots.txt` and appends the Sitemap line from the configuration contract.
2. `ops/check_gate_trust.py` parses every explicit `User-agent:` entry except `*` and generates `GATE_TRUST_CRAWLER_UAS` in `functions/_data/gateTrust.ts`. These User-Agents bypass only human verification: they remain subject to D1 blocks, receive no `__gate` cookie, and are not counted as visitors.

To add a crawler, add one `User-agent:` line to `robots.txt`. `Allow`, `Disallow`, and comments are not used to build the gate allowlist. `Google-Extended` and `Applebot-Extended` are robots.txt-only markers and do not correspond to request User-Agents.

User-Agent values are self-reported and are not authentication. Register only crawlers with public documentation and contact information. Do not add generic client identifiers such as `curl`, `python-requests`, `Go-http-client`, or `HeadlessChrome`.

| Source | Bypasses human verification | Bypasses D1 blocks | Receives `__gate` cookie | Counted as visitor |
| --- | --- | --- | --- | --- |
| `IP-CIDR` (`whitelist.txt`) | Yes | Yes | Yes | Yes |
| Cloudflare verified bot | Yes | Yes | Yes | No |
| Explicit User-Agent in `robots.txt` | Yes | No | No | No |

## Format

Use one allowlist entry per line. Text after `#` is a comment, and blank lines are ignored:

```text
# Fixed IP or network
IP-CIDR/97.64.18.11/32
IP-CIDR/203.0.113.0/24
# IPv4 accepts only /24–/32; IPv6 accepts only /64–/128

# Manual ASN entry (used only by the manual WAF sync script)
ASN/64500
```

The allowlist sync parses IP addresses and CIDRs and rejects prefixes shorter than IPv4 `/24` or IPv6 `/64`, preventing overly broad ranges from receiving full trust. ASN values must be between `1` and `4294967295`.

`blocklist.txt` uses bare IPs and CIDRs, unlike the allowlist syntax:

```text
1.2.3.4
5.6.7.0/24
```

## After editing

| Goal | Command |
| --- | --- |
| Regenerate the allowlist from `own-ips.txt` | `python3 ops/sync_whitelist.py` |
| Generate the gate edge copy and run build checks | `bash ops/ci_check.sh` |
| Update the crawler list | Edit `robots.txt`, then run the normal deployment |
| Manually sync ASN entries to Cloudflare zone rules | Run `bash ops/waf_whitelist.sh --dry-run`, review the result, then run `bash ops/waf_whitelist.sh --apply` |
| Reconcile the blocklist with D1 | First run `python3 src/auto_block.py reconcile --dry-run`; remove `--dry-run` after review |
| Push blocklist entries only | `python3 src/auto_block.py d1 --dry-run` |
| View or update the edge AI bot policy | `python3 ops/ai_bots.py --show` / `--apply` |

## Blocklist reconciliation

`python3 src/auto_block.py reconcile --dry-run` shows differences between the file and D1:

- **+N**: present in the file but missing from D1; these entries will be written to D1.
- **-N**: missing from the file but still present in D1; only records managed by `auto_block` or `blocklist.txt` will be soft-deleted. Administrator-sourced records are left alone.
- **pull=N**: active in D1 but missing from the file; these entries will be restored to the managed section.

`blocklist.txt` has a handwritten section and a managed section. D1 active records generate the managed section; the handwritten section above its marker is preserved as-is. The file is an audit snapshot, not the source of truth for blocking, and soft-deleting a D1 record does not automatically remove handwritten entries.

## Maintenance rules

1. `whitelist.txt` is generated output. Edit `own-ips.txt` to change trusted IPs.
2. `robots.txt` is public, and its explicit User-Agent entries are also parsed by the gate as crawler bypass markers.
3. `blocklist.txt` is a snapshot of D1 `blocked_ips`; reconcile it with D1 after changes.
