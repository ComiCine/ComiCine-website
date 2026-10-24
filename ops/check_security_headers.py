#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Verify that ops/security-headers.json matches functions/_lib/security.ts on Pages.

This uses only the standard library. The security-headers JSON from task 05 is the sole copy
source; this script prevents the two representations from drifting.

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


def main() -> int:
    expected = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    if not isinstance(expected, dict):
        print("FATAL: security-headers.json must be a JSON object", file=sys.stderr)
        return 1

    ts = TS_PATH.read_text(encoding="utf-8")
    errors: list[str] = []
    for name, value in expected.items():
        pattern = re.compile(
            rf'"{re.escape(name)}"\s*:\s*"((?:\\.|[^"\\])*)"',
        )
        match = pattern.search(ts)
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
                if match and "https://limooo.cn" in match.group(1):
                    errors.append(f"CSP {section} still allows https://limooo.cn, use 'self' instead")

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
            # cloudflareinsights.com（connect-src）。
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

    if errors:
        print("FATAL: security headers validation failed", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("security headers: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
