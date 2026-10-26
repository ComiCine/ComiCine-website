#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Validate docs.comicine.com build output: every Markdown file must produce an HTML file.

Sources are stored in language directories (en-us/video-platform.md), while
.vitepress/rewrites.json changes URLs to put the language code last (/video-platform/en-us).
This script and the VitePress configuration read the same rewrites.json, ensuring that every
added Markdown file produces a page.

<docs-dir> is the VitePress content root, site/docs/docs/. site/docs/ is organized by subdomain:
docs/ belongs to docs.comicine.com and services/ belongs to services.comicine.com. The .vitepress/
directory is a sibling of the content root.

Usage:
    python3 ops/docs_check_output.py <docs-dir> <dist-dir>
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: docs_check_output.py <docs-dir> <dist-dir>", file=sys.stderr)
        return 2
    docs = Path(sys.argv[1])
    dist = Path(sys.argv[2])
    if not docs.is_dir() or not dist.is_dir():
        print("FATAL: docs-dir or dist-dir not found", file=sys.stderr)
        return 1

    rewrites_path = docs / ".vitepress" / "rewrites.json"
    rewrites: dict[str, str] = {}
    if rewrites_path.is_file():
        rewrites = json.loads(rewrites_path.read_text(encoding="utf-8"))

    missing: list[tuple[str, str]] = []
    routes: list[tuple[str, str]] = []
    for md in sorted(docs.rglob("*.md")):
        rel = md.relative_to(docs).as_posix()
        if rel.startswith(".vitepress/") or rel.startswith("node_modules/"):
            continue
        route = rewrites.get(rel, rel)
        if route.endswith(".md"):
            route = route[: -len(".md")]
        html = dist / f"{route}.html"
        routes.append((rel, "/" + route))
        if not html.is_file():
            missing.append((rel, "/" + route))

    for rel, route in routes:
        print(f"  {rel:<32} -> {route}")
    print(f"[docs-check] {len(routes)} markdown file(s), {len(missing)} missing")

    if missing:
        for rel, route in missing:
            print(f"FATAL: {rel} produced no {route}.html", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
