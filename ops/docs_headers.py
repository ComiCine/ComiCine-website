#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

"""Generate Cloudflare Pages `_headers` for docs.limooo.cn.

VitePress inlines three scripts (theme bridge, check-dark-mode, and check-mac-os) and several
styles in HTML, so the main site's CSP that forbids inline content cannot be copied directly.
Scan the build output and add SHA-256 hashes for the inline <script>/<style> content that appears.
Do not enable unsafe-inline for scripts. Keep unsafe-inline in style-src because Vue's :style
bindings cannot be hashed.

Usage:
    python3 ops/docs_headers.py <dist-dir>
"""

from __future__ import annotations

import base64
import hashlib
import re
import sys
from pathlib import Path

SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)
STYLE_RE = re.compile(r"<style[^>]*>(.*?)</style>", re.S | re.I)

BASE_HEADERS = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=()"),
    ("X-Frame-Options", "SAMEORIGIN"),
    ("Strict-Transport-Security", "max-age=31536000; includeSubDomains"),
]


def digest(body: str) -> str:
    raw = hashlib.sha256(body.encode("utf-8")).digest()
    return "sha256-" + base64.b64encode(raw).decode("ascii")


def collect(dist: Path) -> tuple[list[str], list[str]]:
    scripts: set[str] = set()
    styles: set[str] = set()
    for html in dist.rglob("*.html"):
        text = html.read_text(encoding="utf-8", errors="replace")
        for body in SCRIPT_RE.findall(text):
            if body.strip():
                scripts.add(digest(body))
        for body in STYLE_RE.findall(text):
            if body.strip():
                styles.add(digest(body))
    return sorted(scripts), sorted(styles)


def csp(scripts: list[str], styles: list[str]) -> str:
    # Allow the Cloudflare Web Analytics beacon script in script-src
    # (static.cloudflareinsights.com). It sends RUM data to
    # cloudflareinsights.com, which must also be allowed in connect-src.
    insight_scripts = [
        "http://static.cloudflareinsights.com",
        "https://static.cloudflareinsights.com",
    ]
    insight_connect = [
        "http://cloudflareinsights.com",
        "https://cloudflareinsights.com",
    ]
    script_src = " ".join(["'self'", *scripts, *insight_scripts])
    style_src = " ".join(["'self'", "'unsafe-inline'", *styles])
    connect_src = " ".join(["'self'", *insight_connect])
    return "; ".join(
        [
            "default-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            f"script-src {script_src}",
            f"style-src {style_src}",
            "img-src 'self' data: https://image.limooo.cn https://images.limooo.cn",
            "font-src 'self' data:",
            f"connect-src {connect_src}",
            "frame-ancestors 'self'",
            "form-action 'self' https://*.limooo.cn",
        ]
    )


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: docs_headers.py <dist-dir>", file=sys.stderr)
        return 2
    dist = Path(sys.argv[1])
    if not dist.is_dir():
        print(f"FATAL: dist directory not found: {dist}", file=sys.stderr)
        return 1

    scripts, styles = collect(dist)
    lines: list[str] = ["/*"]
    for name, value in BASE_HEADERS:
        lines.append(f"  {name}: {value}")
    lines.append(f"  Content-Security-Policy: {csp(scripts, styles)}")
    lines.append("")
    lines.append("/assets/*")
    lines.append("  Cache-Control: public, max-age=31536000, immutable")
    lines.append("")
    lines.append("/logo.svg")
    lines.append("  Cache-Control: public, max-age=86400")

    (dist / "_headers").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(
        f"[docs-headers] wrote _headers (scripts={len(scripts)} styles={len(styles)}"
        f" inline hashes)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
