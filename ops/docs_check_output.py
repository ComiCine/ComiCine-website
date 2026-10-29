#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Validate docs.comicine.com output routes, language coverage, and generated HTML.

Sources are grouped by language: every page lives at <lang>/<page>.md (zh-cn/video-platform.md,
en-us/video-platform.md, ...), and a markdown file outside a language directory is an error.
.vitepress/rewrites.json then changes URLs to put the language code last (/video-platform/en-us).
This script and the VitePress configuration read the same rewrites.json. It also checks that
every localized content route ends in a supported language code and every source page has all
supported language copies.

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
    contract_path = Path(__file__).resolve().parents[1] / "config-contract.json"
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    languages = tuple(contract["supported_langs"])
    missing: list[tuple[str, str]] = []
    invalid_routes: list[tuple[str, str]] = []
    routes: list[tuple[str, str]] = []
    language_copies: dict[str, set[str]] = {}
    unscoped: list[str] = []
    for md in sorted(docs.rglob("*.md")):
        rel = md.relative_to(docs).as_posix()
        if rel.startswith(".vitepress/") or rel.startswith("node_modules/"):
            continue
        source_parts = rel.split("/")
        if source_parts[0] not in languages:
            unscoped.append(rel)
            continue
        source_language = source_parts[0]
        logical_page = "/".join(source_parts[1:])
        language_copies.setdefault(logical_page, set()).add(source_language)

        route = rewrites.get(rel, rel)
        if route.endswith(".md"):
            route = route[: -len(".md")]
        if route.rstrip("/").rsplit("/", 1)[-1] not in languages:
            invalid_routes.append((rel, "/" + route))
        html = dist / f"{route}.html"
        routes.append((rel, "/" + route))
        if not html.is_file():
            missing.append((rel, "/" + route))

    incomplete: list[tuple[str, str]] = []
    for logical_page, present in sorted(language_copies.items()):
        for language in languages:
            if language not in present:
                incomplete.append((logical_page, language))

    width = max((len(rel) for rel, _ in routes), default=0)
    for rel, route in routes:
        print(f"  {rel:<{width}} -> {route}")
    print(
        f"[docs-check] {len(routes)} markdown file(s), {len(missing)} missing HTML, "
        f"{len(invalid_routes)} invalid routes, {len(incomplete)} missing translations, "
        f"{len(unscoped)} outside a language directory"
    )

    for rel in unscoped:
        print(f"FATAL: {rel} is not inside a language directory ({', '.join(languages)})", file=sys.stderr)

    if missing:
        for rel, route in missing:
            print(f"FATAL: {rel} produced no {route}.html", file=sys.stderr)
    if invalid_routes:
        for rel, route in invalid_routes:
            print(f"FATAL: {rel} route does not end in a supported language code: {route}", file=sys.stderr)
    if incomplete:
        for logical_page, language in incomplete:
            print(f"FATAL: {logical_page} has no {language} source copy", file=sys.stderr)
    if missing or invalid_routes or incomplete or unscoped:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
