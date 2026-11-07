#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Verify that ops/security-headers.json matches functions/_lib/security.ts on Pages.

This uses only the standard library. The security-headers JSON from task 05 is the sole copy
source; this script prevents the two representations from drifting in either direction:

* every header in the JSON must exist in the runtime table with the same value;
* every header in the runtime table must exist in the JSON, because the JSON is the only
  source and a value that exists only in TypeScript would ship without a reviewable record.

It also validates the CSP reporting channel wired by `Content-Security-Policy-Report-Only`:
the Report-Only policy must be a subset of the enforced policy for every shared directive
(reporting may only tighten, never loosen), must carry `report-to csp` and
`report-uri /api/csp-report`, and that path must resolve to a real Pages Function handler.

Run:
    python3 ops/check_security_headers.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = ROOT / "ops" / "security-headers.json"
TS_PATH = ROOT / "functions" / "_lib" / "security.ts"

SECURITY_HEADERS_BLOCK_RE = re.compile(
    r"export\s+const\s+SECURITY_HEADERS\b[^=]*=\s*\{(?P<body>.*?)\n\}\s*;",
    re.DOTALL,
)
# Line-anchored header keys only: a key inside a comment or a value string never matches.
HEADER_KEY_RE = re.compile(r'^\s*"(?P<name>[A-Za-z0-9!#$%&\'*+.^_`|~-]+)"\s*:', re.MULTILINE)

REPORT_GROUP = "csp"
REPORT_URI = "/api/csp-report"


def parse_directives(policy: str) -> dict[str, list[str]]:
    """Split a CSP header into {lowercase directive: [sources]}; a repeated directive keeps the last."""
    directives: dict[str, list[str]] = {}
    for section in policy.split(";"):
        tokens = section.split()
        if not tokens:
            continue
        directives[tokens[0].lower()] = tokens[1:]
    return directives


def check_csp_reporting_channel(expected: dict[str, str], errors: list[str]) -> None:
    """Validate that the Report-Only policy reports to the endpoint the handler serves."""
    enforced = expected.get("Content-Security-Policy")
    report_only = expected.get("Content-Security-Policy-Report-Only")
    endpoints = expected.get("Reporting-Endpoints")
    if not enforced or not report_only or not endpoints:
        errors.append(
            "security-headers.json must define Content-Security-Policy, "
            "Content-Security-Policy-Report-Only and Reporting-Endpoints"
        )
        return

    groups = dict(re.findall(r'([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"', endpoints))
    endpoint_url = groups.get(REPORT_GROUP)
    if not endpoint_url:
        errors.append(
            f'Reporting-Endpoints lacks the "{REPORT_GROUP}" group; '
            f'the Report-Only policy cannot resolve "report-to {REPORT_GROUP}"'
        )
        return
    endpoint_path = re.sub(r"^[a-z][a-z0-9+.-]*://[^/]+", "", endpoint_url) or "/"
    if endpoint_path != REPORT_URI:
        errors.append(
            f'Reporting-Endpoints "{REPORT_GROUP}" points at {endpoint_url}, '
            f"but the collector path is {REPORT_URI}"
        )

    report_only_directives = parse_directives(report_only)
    if REPORT_GROUP not in report_only_directives.get("report-to", []):
        errors.append(
            f'Report-Only CSP lacks "report-to {REPORT_GROUP}"; violations never reach the collector'
        )
    if report_only_directives.get("report-uri") != [REPORT_URI]:
        errors.append(
            f"Report-Only CSP report-uri must be {REPORT_URI} "
            "(kept for browsers without the Reporting API)"
        )

    handler = ROOT / "functions" / (f"{REPORT_URI.strip('/')}.ts")
    if not handler.is_file():
        errors.append(
            f"report-uri {REPORT_URI} has no Pages Function handler at {handler.relative_to(ROOT)}"
        )

    enforced_directives = parse_directives(enforced)
    for name, sources in enforced_directives.items():
        if name not in report_only_directives:
            errors.append(
                f"Report-Only CSP omits directive {name}, so it silently falls back to default-src; "
                "keep both policies aligned"
            )
            continue
        looser = set(report_only_directives[name]) - set(sources)
        if looser:
            errors.append(
                f"Report-Only CSP {name} is looser than Content-Security-Policy: it allows "
                f"{', '.join(sorted(looser))}; report-only may only tighten"
            )


def main() -> int:
    expected = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    if not isinstance(expected, dict):
        print("FATAL: security-headers.json must be a JSON object", file=sys.stderr)
        return 1

    ts = TS_PATH.read_text(encoding="utf-8")
    errors: list[str] = []

    block = SECURITY_HEADERS_BLOCK_RE.search(ts)
    defined: list[str] = []
    if block is None:
        errors.append(
            "security.ts does not define an export const SECURITY_HEADERS { ... } object literal"
        )
    else:
        defined = [match.group("name") for match in HEADER_KEY_RE.finditer(block.group("body"))]
        if not defined:
            errors.append(
                "security.ts SECURITY_HEADERS parsed no header names; "
                "refusing to treat a parse failure as a pass"
            )
    runtime_table = block.group("body") if block else ts

    for name, value in expected.items():
        pattern = re.compile(
            rf'"{re.escape(name)}"\s*:\s*"((?:\\.|[^"\\])*)"',
        )
        match = pattern.search(runtime_table)
        if not match:
            errors.append(f"security.ts is missing field {name}")
            continue
        actual = json.loads(f'"{match.group(1)}"')
        if actual != value:
            errors.append(f"security.ts {name}: JSON={value!r} actual={actual!r}")
        if name == "Content-Security-Policy":
            if "'unsafe-inline'" in actual:
                errors.append("CSP still contains 'unsafe-inline', which tasks/14 forbids")
            script_src = re.search(r"script-src ([^;]+)", actual)
            style_src = re.search(r"style-src ([^;]+)", actual)
            for section, match in (("script-src", script_src), ("style-src", style_src)):
                if match and "https://comicine.com" in match.group(1):
                    errors.append(f"CSP {section} still allows https://comicine.com, use 'self' instead")

            # Third-party component consistency checks.
            #
            # Turnstile needs all three directives to allow the same source to complete a challenge:
            #   script-src  loads api.js
            #   frame-src   embeds the challenge iframe
            #   connect-src submits the solution and retrieves the token
            # Allowing only the first two produces a widget that displays but cannot be used or obtain a token,
            # resulting in an endless challenge. The gate was previously unusable because connect-src omitted
            # challenges.cloudflare.com.
            def origins(header: str, section: str) -> set[str]:
                match = re.search(rf"{section} ([^;]+)", header)
                if not match:
                    return set()
                return {
                    token
                    for token in match.group(1).split()
                    if token.startswith(("http://", "https://"))
                }

            connect_origins = origins(actual, "connect-src")
            if "https://api.frankfurter.dev" not in connect_origins:
                errors.append(
                    "CSP connect-src lacks https://api.frankfurter.dev: "
                    "the services page cannot load currency reference rates"
                )

            # Some third-party components load scripts from one host and send data to another,
            # so do not require every script-src source to also appear in connect-src. Registered exception:
            # Cloudflare Web Analytics loads its beacon script from
            # static.cloudflareinsights.com (script-src), while RUM data is sent to
            # cloudflareinsights.com (connect-src).
            script_connect_pairs = {
                "static.cloudflareinsights.com": "cloudflareinsights.com",
            }
            connect_hosts = {o.split("://", 1)[-1] for o in connect_origins}

            for section in ("script-src", "frame-src"):
                for origin in origins(actual, section):
                    if origin in connect_origins:
                        continue
                    paired = script_connect_pairs.get(origin.split("://", 1)[-1])
                    if paired and paired in connect_hosts:
                        continue
                    errors.append(
                        f"CSP {section} allows {origin} but connect-src lacks it: "
                        f"the third-party component will hang forever because CSP blocks "
                        f"its requests (Turnstile shows an endless challenge); "
                        f"add {origin} to connect-src"
                    )

    # Reverse direction: the runtime table must not define a header the JSON lacks.
    for name in defined:
        if name not in expected:
            errors.append(
                f"security.ts defines header {name} that security-headers.json lacks; "
                "the JSON is the only source"
            )

    if "Content-Security-Policy" in expected:
        check_csp_reporting_channel(expected, errors)

    if errors:
        print("FATAL: security headers validation failed", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("security headers: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
