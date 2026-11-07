# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Edge routing, brand assets, and crawler discovery files for the site build.

The caller supplies the contract domain values as arguments, so this module never
reads build globals and stays free of import cycles.
"""

from __future__ import annotations

import json
import os
import re
import shutil

from build_paths import ROBOTS_SOURCE
from config import (
    CONTACT_HOST,
    IMAGE_ASSET_HOST,
    ROOT_DOMAIN,
    SERVICES_HOST,
    STATIC_DIR,
)


def preview_localization_patterns(
    root_domain: str, image_asset_host: str, image_watermark_host: str
) -> dict[str, re.Pattern[str]]:
    """Return preview-localization patterns for the given domain constants.

    The previous implementation hard-coded escaped domain literals for the root and
    image hosts, so contract changes did not reach preview output. Callers pass
    ROOT_DOMAIN, IMAGE_ASSET_HOST, and IMAGE_WATERMARK_HOST on each call, so changing
    config-contract.json is sufficient for previews too.
    """
    asset_hosts = "|".join(
        [
            re.escape(root_domain) + r"/static",
            re.escape(image_asset_host) + r"/static",
            re.escape(image_watermark_host),
        ]
    )
    return {
        "asset": re.compile(r'(data-src|src|href|data-qr)="https://(?:' + asset_hosts + r")/"),
        "asset_url": re.compile(r"https://(?:" + asset_hosts + r")/"),
        "root_asset": re.compile(r'(?<![\w:-])(data-src|src|href|data-qr)="/static/'),
        "root_asset_url": re.compile(r"(?<![\w:./])/(static/)"),
        "root_href": re.compile(rf'href="https://{re.escape(root_domain)}/?"'),
        "root_url": re.compile(rf"url=https://{re.escape(root_domain)}/"),
    }


def rewrite_preview_srcsets(html: str, patterns: dict[str, re.Pattern[str]]) -> str:
    """Rewrite URLs in normal and deferred srcset attributes for local previews."""
    return re.sub(
        r'''(?<![\w:-])((?:data-)?srcset)(\s*=\s*)(["'])(.*?)\3''',
        lambda match: match.group(1)
        + match.group(2)
        + match.group(3)
        + patterns["root_asset_url"].sub(
            r"../\1", patterns["asset_url"].sub("../static/", match.group(4))
        )
        + match.group(3),
        html,
    )


def preview_subdomain_pages(
    services_host: str, contact_host: str, visitor_host: str, apple_account_host: str
) -> tuple[tuple[str, str], ...]:
    """Map preview subdomain pages to local filenames using hostnames from the contract."""
    return (
        (services_host, "services.html"),
        (contact_host, "contact.html"),
        (visitor_host, "visitor.html"),
        (apple_account_host, "apple-account.html"),
    )


def write_pages_edge_config(out_dir: str) -> None:
    """Generate Pages _routes.json and _headers so static assets bypass Functions."""
    with open(os.path.join(out_dir, "_routes.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": 1,
                "include": ["/*"],
                "exclude": [
                    "/static/*",
                    "/public/files/*",
                    "/favicon.svg",
                    "/comicine.svg",
                    "/comicine-xtext.svg",
                    "/comicine-favicon.svg",
                    # These historical URLs remain aliases to the current brand artwork.
                    "/ComiCine-xtext.svg",
                    # Crawler and AI entry files (2026-10-12): bypass Functions entirely.
                    # These three files must be reachable **without the gate**; otherwise an unverified crawler receives a
                    # 403 challenge page. The gate previously replaced `/robots.txt` in place,
                    # preventing crawlers from reading the rules and causing them to index the site as inaccessible.
                    "/robots.txt",
                    "/llms.txt",
                    "/sitemap.xml",
                ],
            },
            f,
            indent=2,
        )
        f.write("\n")
    with open(os.path.join(out_dir, "_headers"), "w", encoding="utf-8") as f:
        f.write(
            "/static/*\n"
            "  Cache-Control: public, max-age=86400, stale-while-revalidate=86400\n"
            "/public/files/*\n"
            "  Cache-Control: public, max-age=86400, stale-while-revalidate=86400\n"
            "/static/*.css\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.js\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.woff2\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.webp\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.svg\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.avif\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.png\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.jpg\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.jpeg\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/*.gif\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/static/icons/comicine-favicon.svg\n"
            "  ! Cache-Control\n"
            "  Cache-Control: public, max-age=0, must-revalidate\n"
            "/static/icons/comicine-favicon.png\n"
            "  ! Cache-Control\n"
            "  Cache-Control: public, max-age=0, must-revalidate\n"
            "/comicine-favicon.svg\n"
            "  Cache-Control: public, max-age=0, must-revalidate\n"
            "/favicon.svg\n"
            "  Cache-Control: public, max-age=0, must-revalidate\n"
            "/static/*.ico\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/robots.txt\n"
            "  Cache-Control: public, max-age=86400\n"
            "/llms.txt\n"
            "  Cache-Control: public, max-age=86400\n"
            "/sitemap.xml\n"
            "  Cache-Control: public, max-age=86400\n"
        )


def publish_brand_assets(out_dir: str) -> None:
    """Publish canonical root-level brand assets and current-art legacy aliases."""
    icon_dir = os.path.join(STATIC_DIR, "icons")
    root_brand_assets = {
        "comicine.svg": "comicine-xtext.svg",
        "comicine-xtext.svg": "comicine-xtext.svg",
        "comicine-favicon.svg": "comicine-favicon.svg",
        "favicon.svg": "comicine-favicon.svg",
        "ComiCine-xtext.svg": "comicine-xtext.svg",
    }
    os.makedirs(out_dir, exist_ok=True)
    for public_name, source_name in root_brand_assets.items():
        source_path = os.path.join(icon_dir, source_name)
        output_path = os.path.join(out_dir, public_name)
        shutil.copy2(source_path, output_path)


# Crawler and AI entry files (2026-10-12)
#
# The site is **open** to crawlers and AI tools (user decision on 2026-10-12); the gate is reserved for
# browsers and unknown sources. The robots.txt rules serve **two purposes**:
#
#   1. The live crawler rules in `/robots.txt`, copied from the source file here.
#   2. The **only source** of gate allowlist entries: `ops/check_gate_trust.py` parses each explicit
#      `User-agent:` entry except `*` and generates `GATE_TRUST_CRAWLER_UAS`.
#      These user agents bypass human verification (see functions/_lib/bots.ts).
# This function adds the `Sitemap` line using root_domain from config-contract.json, avoiding duplicate domain configuration.
#
# Before 2026-10-12 there were two sources: docs/lists/crawlers.txt and a crawler list hardcoded in the builder.
# Adding a crawler required editing both and could miss one. There is now only
# `docs/lists/robots.txt`; add a crawler by adding one `User-agent:` line.


def write_discovery_files(
    out_dir: str,
    robots_source: str = ROBOTS_SOURCE,
    root_domain: str = ROOT_DOMAIN,
    services_host: str = SERVICES_HOST,
    contact_host: str = CONTACT_HOST,
    image_asset_host: str = IMAGE_ASSET_HOST,
) -> None:
    """Write robots.txt, llms.txt, and sitemap.xml to the output root.

    Crawler rules for robots.txt come from `docs/lists/robots.txt`; the Sitemap line
    uses root_domain from the contract. All three files must be at the output root:
    placing them under `static/` would serve `/static/robots.txt`, which crawlers do
    not check.
    """
    with open(robots_source, encoding="utf-8") as f:
        robots = f.read()
    # If the source is invalid (empty or missing a User-agent group), **fail the build**. The live robots.txt
    # also supplies the gate allowlist, so an empty list would silently put all crawlers behind the gate.
    if "User-agent: *" not in robots or "User-agent: GPTBot" not in robots:
        raise RuntimeError(f"{robots_source} does not look like the robots.txt source any more")
    with open(os.path.join(out_dir, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"{robots.rstrip()}\n\nSitemap: https://{root_domain}/sitemap.xml\n")

    sitemap_hosts = (root_domain, services_host, contact_host, image_asset_host)
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(
            f"  <url><loc>https://{host}/</loc></url>\n" for host in sitemap_hosts
        )
        + "</urlset>\n"
    )
    with open(os.path.join(out_dir, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write(sitemap)

    llms = (
        "# ComiCine\n"
        "\n"
        f"> ComiCine (https://{root_domain}) is a personal video-production studio site: a\n"
        "> portfolio, a services price list and a four-language documentation site.\n"
        "> All public pages are open to search engines, crawlers and AI agents; the\n"
        "> full-size portfolio originals are deliberately not published.\n"
        "\n"
        "## Main site\n"
        "\n"
        f"- [Home](https://{root_domain}/): studio introduction and portfolio highlights.\n"
        f"- [Services](https://{services_host}/): convention (studio) and outdoor\n"
        "  shoot pricing, per shoot type and head count.\n"
        f"- [Contact](https://{contact_host}/): how to get in touch.\n"
        f"- [Sitemap](https://{root_domain}/sitemap.xml)\n"
        "\n"
        f"## Documentation (docs.{root_domain})\n"
        "\n"
        f"- [README (en-us)](https://docs.{root_domain}/README/en-us): project documentation in\n"
        "  zh-cn, en-us, ja-jp and ko-kr; every content page carries its language as\n"
        "  the last path segment.\n"
        f"- [README (zh-cn)](https://docs.{root_domain}/README/zh-cn)\n"
        f"- [README (ja-jp)](https://docs.{root_domain}/README/ja-jp)\n"
        f"- [README (ko-kr)](https://docs.{root_domain}/README/ko-kr)\n"
        f"- [License](https://docs.{root_domain}/LICENSE/zh-cn)\n"
        f"- [Sitemap](https://docs.{root_domain}/sitemap.xml)\n"
        "\n"
        "## Notes\n"
        "\n"
        "- Languages: zh-cn, en-us, ja-jp, ko-kr (the same URL serves the language\n"
        "  picked from the `user_lang_preference` cookie, `Accept-Language`, then the\n"
        "  Cloudflare region; the default is en-us).\n"
        "- Crawling: `/robots.txt` allows everything except the endpoint and admin\n"
        "  paths; `/api/` is not content. Images are served from\n"
        f"  `{image_asset_host}` (thumbnails, watermarked copies, QR codes and icons).\n"
    )
    with open(os.path.join(out_dir, "llms.txt"), "w", encoding="utf-8") as f:
        f.write(llms)

