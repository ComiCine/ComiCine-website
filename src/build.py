#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Static-site build script for ComiCine on Cloudflare Pages.

Prerender Jinja templates as static HTML in public/ for four languages, and generate:
  - public/<lang>/index.html, services.html, contact.html, and not-found.html
    (middleware serves these at clean language-aware URLs)
  - A static asset mirror under public/static/
  - functions/api/i18n/[lang].ts and functions/_data/i18n.ts for frontend language switching

Run with: python3 build.py
Output directory: public/ (Git keeps only .gitkeep; deployment uploads it with wrangler pages deploy)

The rendering, discovery, generated-artifact, and image helpers live in the build_*.py
modules; this file keeps the page table, main(), the command-line entry point, and the
compatibility re-exports used by tests and ops scripts.
"""

import os
import re
import shutil
import subprocess
import sys

# Set build mode before importing config.py, which otherwise creates the runtime data directory.
if __name__ == "__main__":
    os.environ.setdefault("COMICINE_BUILD", "1")

from flask import g, render_template

import build_assets as _assets
import build_discovery as _discovery
import build_generated as _generated
from build_assets import (
    _PARALLEL_ARTIFACT_RE,
    _STATIC_EXCLUDE_NAMES,
    PORTFOLIO_THUMB_AVIF_QUALITY,
    PORTFOLIO_THUMB_QUALITY,
    Image,
    _remove_bad_artifacts,
    copy_portfolio_thumb_fallbacks,
    generate_portfolio_thumbs,
    generate_watermarks,
    remove_public_portfolio_originals,
    restore_qr_png_compatibility,
)
from build_discovery import (
    publish_brand_assets,
    rewrite_preview_srcsets,
    write_pages_edge_config,
)
from build_generated import (
    GATE_I18N,
    GATE_I18N_KEYS,
    LICENSE_HEADER_TS,
    REDIRECT_I18N_KEYS,
    _app_instance,
    _load_gate_i18n,
    _sha256_file,
    preview_i18n_patch,
    render_gate,
    render_page,
    validate_locale_completeness,
    write_not_found_fallback,
)
from build_paths import CONTRACT_PATH, FUNCTIONS_DIR, ROBOTS_SOURCE
from config import (
    APPLE_ACCOUNT_HOST,
    BASE_DIR,
    CONTACT_HOST,
    DEFAULT_LANG,
    GATE_HOST,
    IMAGE_ASSET_HOST,
    IMAGE_WATERMARK_HOST,
    KEY_FALLBACK_LANG,
    LOCALES_DIR,
    PREVIEW_DIR,
    PUBLIC_DIR,
    REDIRECT_PRELOAD_IMAGES,
    ROOT_DOMAIN,
    SERVICES_HOST,
    STATIC_DIR,
    VISITOR_HOST,
    load_translations,
)
from config import (
    SUPPORTED_LANGS as LANGS,
)
from portfolio import (
    FALLBACK_PORTFOLIO_IMAGES,
    PORTFOLIO_THUMB_WIDTHS,
    list_portfolio_images,
)

# Compatibility layer: tests and ops scripts reach these names through `build`, and some
# of them monkeypatch build globals (load_translations, FUNCTIONS_DIR, PUBLIC_DIR,
# STATIC_DIR, ROBOTS_SOURCE, the domain constants, and Image). The thin wrappers below
# pass the current module globals into the moved implementations so those patches still
# take effect; every other name is re-exported unchanged.
#
# The names below were module attributes before the split and stay importable from build
# even though only the generated modules use them.
__all__ = [
    "CONTRACT_PATH",
    "DEFAULT_LANG",
    "FALLBACK_PORTFOLIO_IMAGES",
    "GATE_HOST",
    "GATE_I18N",
    "GATE_I18N_KEYS",
    "Image",
    "KEY_FALLBACK_LANG",
    "LICENSE_HEADER_TS",
    "LOCALES_DIR",
    "PORTFOLIO_THUMB_AVIF_QUALITY",
    "PORTFOLIO_THUMB_QUALITY",
    "PORTFOLIO_THUMB_WIDTHS",
    "REDIRECT_I18N_KEYS",
    "REDIRECT_PRELOAD_IMAGES",
    "VISITOR_HOST",
    "_PARALLEL_ARTIFACT_RE",
    "_STATIC_EXCLUDE_NAMES",
    "_app_instance",
    "_load_gate_i18n",
    "_sha256_file",
]


def preview_localization_patterns() -> dict[str, re.Pattern[str]]:
    """Forward to build_discovery with this module's current domain constants."""
    return _discovery.preview_localization_patterns(
        ROOT_DOMAIN, IMAGE_ASSET_HOST, IMAGE_WATERMARK_HOST
    )


def preview_subdomain_pages() -> tuple[tuple[str, str], ...]:
    """Forward to build_discovery with this module's current subdomain hosts."""
    return _discovery.preview_subdomain_pages(
        SERVICES_HOST, CONTACT_HOST, VISITOR_HOST, APPLE_ACCOUNT_HOST
    )


def write_discovery_files(out_dir: str) -> None:
    """Forward to build_discovery with this module's current discovery settings."""
    _discovery.write_discovery_files(
        out_dir,
        robots_source=ROBOTS_SOURCE,
        root_domain=ROOT_DOMAIN,
        services_host=SERVICES_HOST,
        contact_host=CONTACT_HOST,
        image_asset_host=IMAGE_ASSET_HOST,
    )


def _require_locale_keys(
    lang: str, keys: tuple[tuple[str, str], ...]
) -> dict[str, str]:
    """Forward to build_generated with the current load_translations() result."""
    return _generated._require_locale_keys(load_translations(), lang, keys)


def validate_redirect_copy() -> None:
    """Forward to build_generated with the current load_translations() result."""
    _generated.validate_redirect_copy(load_translations())


def _static_ignore(dirpath: str, names: list[str]) -> set[str]:
    """Forward to build_assets with this module's current STATIC_DIR."""
    return _assets._static_ignore(dirpath, names, STATIC_DIR)


def check_image_prerequisites(
    source_root: str | None = None, wm_path: str | None = None
) -> bool:
    """Forward to build_assets with this module's current optional Pillow module."""
    return _assets.check_image_prerequisites(source_root, wm_path, Image)


def write_config_functions() -> None:
    """Forward to build_generated with this module's current FUNCTIONS_DIR."""
    _generated.write_config_functions(FUNCTIONS_DIR)


def write_i18n_functions() -> None:
    """Forward to build_generated with this module's current FUNCTIONS_DIR."""
    _generated.write_i18n_functions(FUNCTIONS_DIR)


def write_runtime_functions() -> None:
    """Forward to build_generated with this module's current FUNCTIONS_DIR."""
    _generated.write_runtime_functions(FUNCTIONS_DIR)


def write_manifest() -> dict:
    """Forward to build_generated with this module's current PUBLIC_DIR."""
    return _generated.write_manifest(PUBLIC_DIR)


def verify_manifest(out_dir: str | None = None) -> int:
    """Forward to build_generated, defaulting to this module's current PUBLIC_DIR."""
    return _generated.verify_manifest(out_dir if out_dir is not None else PUBLIC_DIR)


# (template, output filename, render path). Render with Host: comicine.com (is_prod=True),
# preserving absolute subdomain links (comicine.com, services.comicine.com, contact.comicine.com) in navigation.
# Middleware serves the matching language page at a clean URL based on the hostname, without a language path prefix.
PAGES = (
    ("index.html", "index.html", "/", None),
    ("services.html", "services.html", "/services", None),
    ("contact.html", "contact.html", "/contact", None),
    ("404.html", "not-found.html", "/404", None),
    # Subdomain-specific admin pages (visitor.comicine.com / account.comicine.com/apple) are served by middleware based on the hostname.
    ("visitor.html", "visitor.html", "/visitor", None),
    ("apple-account.html", "apple-account.html", "/apple-account", None),
    # Shared redirect page (redirect.comicine.com): prerender the default target (the main home page); middleware adds the actual redirect parameters.
    ("redirect.html", "redirect.html", "/r", "redirect"),
    # Login is handled by Pages Functions; no static login page is generated.
)


def main() -> int:
    # Generate gate trust settings from docs/lists/whitelist.txt, the same source used by middleware.
    subprocess.run(
        [
            sys.executable,
            str(os.path.join(BASE_DIR, "ops", "check_gate_trust.py")),
            "--emit",
        ],
        check=True,
    )
    # Locale integrity: fail if any language is missing a key; English pages must not silently fall back to Chinese.
    validate_locale_completeness()
    # The redirect shell is prerendered, so its copy has no runtime table to prove it; validate it here.
    validate_redirect_copy()
    # Use the minimal read-only Flask renderer without importing the business app or initializing databases or secrets.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from render_app import RENDER_APP as appmod

    # Validate prerequisites **before modifying public/**. If Pillow or the watermark PNG is missing,
    # a partial output could retain full portfolio originals while wrangler.toml points pages_build_output_dir
    # at public/ (W9-22). Fail here before writing anything.
    check_image_prerequisites()

    # Clear and recreate the output directory; public/ contains generated files only.
    if os.path.isdir(PUBLIC_DIR):
        _remove_bad_artifacts(PUBLIC_DIR)
        shutil.rmtree(PUBLIC_DIR)
    os.makedirs(PUBLIC_DIR)

    # Pages edge routing: static assets bypass Functions entirely. Otherwise each request would cold-start
    # middleware before reading ASSETS. Middleware still routes public HTML by language and gate status.
    write_pages_edge_config(PUBLIC_DIR)
    # Crawler and AI entry files (robots.txt / llms.txt): these paths must match the
    # _routes.json exclude list; update both locations together.
    write_discovery_files(PUBLIC_DIR)

    # 1) Render all public pages in each language
    for lang in LANGS:
        lang_dir = os.path.join(PUBLIC_DIR, lang)
        os.makedirs(lang_dir, exist_ok=True)
        for template, filename, path, extra in PAGES:
            html = render_page(appmod, template, path, lang, extra)
            with open(os.path.join(lang_dir, filename), "w", encoding="utf-8") as f:
                f.write(html)
        # Human-verification gate page (auth.comicine.com/__gate)
        with open(os.path.join(lang_dir, "auth.html"), "w", encoding="utf-8") as f:
            f.write(render_gate(appmod, lang))
        print(f"[build] {lang} rendered", flush=True)

    write_not_found_fallback(appmod, PUBLIC_DIR)

    # 3) Mirror static assets
    shutil.copytree(
        STATIC_DIR,
        os.path.join(PUBLIC_DIR, "static"),
        dirs_exist_ok=True,
        ignore=_static_ignore,
    )
    # Publish src/static/files/ at the stable URL prefix /public/files/.
    public_files_source = os.path.join(STATIC_DIR, "files")
    if os.path.isdir(public_files_source):
        shutil.copytree(
            public_files_source,
            os.path.join(PUBLIC_DIR, "public", "files"),
            dirs_exist_ok=True,
            ignore=_static_ignore,
        )
    # 3.0) A2: **Immediately** remove old portfolio files from the public bundle after copying static assets.
    #      The source directory is excluded; clean any original-image copies left in public/
    #      so a failure cannot leave full originals that a bare `wrangler pages deploy` could publish.
    remove_public_portfolio_originals(
        os.path.join(PUBLIC_DIR, "static", "portfolio"), keep_thumbs=False
    )
    restore_qr_png_compatibility(
        os.path.join(PUBLIC_DIR, "static", "qr-codes")
    )
    # 3.1) Portfolio card thumbnails (the home page loads these instead of 1080×1440 originals)
    portfolio_source_dir = os.path.join(STATIC_DIR, "portfolio")
    portfolio_output_dir = os.path.join(
        PUBLIC_DIR, "static", "portfolio", "thumbs"
    )
    if list_portfolio_images(portfolio_source_dir):
        generate_portfolio_thumbs(portfolio_source_dir, portfolio_output_dir)
    else:
        copy_portfolio_thumb_fallbacks(output_dir=portfolio_output_dir)
    # 3.2) Watermarked variants (A2: the public bundle contains only full-size watermarked images at /static/wm/portfolio/*)
    generate_watermarks(STATIC_DIR, os.path.join(PUBLIC_DIR, "static", "wm"))
    # 3.3) Fallback cleanup in case originals or parallel copies reappear during the build; stay quiet if nothing is removed.
    remove_public_portfolio_originals(
        os.path.join(PUBLIC_DIR, "static", "portfolio")
    )
    # Keep legacy root URLs available, but serve current brand artwork from them.
    publish_brand_assets(PUBLIC_DIR)

    # 4) i18n Functions (frontend language-switching endpoint)
    write_config_functions()
    write_i18n_functions()
    write_runtime_functions()

    # 5) Subdomain previews (for local use, not tracked): write previews to preview/templates/.
    #    Create one file per subdomain page in the preview default language, without language subdirectories,
    #    and mirror static assets. Rewrite image references to local relative paths for offline viewing.
    PREVIEW_OUT = os.path.join(PREVIEW_DIR, "templates")
    if os.path.isdir(PREVIEW_DIR):
        shutil.rmtree(PREVIEW_DIR)
    os.makedirs(PREVIEW_OUT)
    shutil.copytree(
        STATIC_DIR,
        os.path.join(PREVIEW_DIR, "static"),
        dirs_exist_ok=True,
        ignore=_static_ignore,
    )
    # Reuse the thumbnails already generated in public/ for previews (same sources and parameters),
    # avoiding a second encode of every thumbnail (one WebP and one AVIF file per tier) during one build.
    _preview_thumbs = os.path.join(PREVIEW_DIR, "static", "portfolio", "thumbs")
    _public_thumbs = os.path.join(PUBLIC_DIR, "static", "portfolio", "thumbs")
    if os.path.isdir(_public_thumbs):
        shutil.copytree(_public_thumbs, _preview_thumbs, dirs_exist_ok=True)
        print(
            "[build] preview thumbnails reused: "
            f"{len(os.listdir(_preview_thumbs))} files",
            flush=True,
        )
    else:
        generate_portfolio_thumbs(
            os.path.join(STATIC_DIR, "portfolio"),
            _preview_thumbs,
        )
    # Preview output uses Chinese for local review; the actual site language list comes from the contract.
    # supported_langs. This setting only selects the language for preview/templates/*.html.
    PREVIEW_LANG = "zh-cn"
    preview_patterns = preview_localization_patterns()
    preview_pages = preview_subdomain_pages()
    # The language-switching patch is identical on every preview page, so compute it once and reuse it. Previously, the page loop
    # recomputed it for every page, rereading all four locale JSON files and serializing the entire
    # dictionary eight times. The output was identical, so this was redundant work.
    preview_i18n_html = preview_i18n_patch()
    src = os.path.join(PUBLIC_DIR, PREVIEW_LANG)
    for name in os.listdir(src):
        if name.endswith(".html"):
            html = open(os.path.join(src, name), encoding="utf-8").read()
            # Localize eager and deferred asset attributes plus srcset candidates, while leaving
            # absolute URLs in JavaScript untouched.
            #   Construct all three hostnames from contract values; do not hardcode comicine.com.
            html = re.sub(preview_patterns["asset"], r'\1="../static/', html)
            html = re.sub(preview_patterns["root_asset"], r'\1="../static/', html)
            html = rewrite_preview_srcsets(html, preview_patterns)
            # Also localize root-relative assets in inline CSS, such as the gate page @font-face url(/static/...).
            html = html.replace("url(/static/", "url(../static/")
            html = html.replace(
                'src="/comicine.svg"',
                'src="../static/icons/comicine-xtext.svg"',
            )
            # Localize site navigation: https://<subdomain>.<root_domain> becomes a local file in the same directory.
            # Subdomain hostnames also come from the contract; do not hardcode comicine.com.
            for host, page in preview_pages:
                html = re.sub(
                    rf'href="https://{re.escape(host)}/?"', f'href="{page}"', html
                )
            html = re.sub(preview_patterns["root_href"], 'href="index.html"', html)
            # Point the redirect preview default target to the local home page too.
            html = re.sub(preview_patterns["root_url"], "url=index.html", html)
            html = html.replace(f'"https://{ROOT_DOMAIN}/"', '"index.html"')
            # Fill runtime-injected gate and redirect placeholders with default values for local previews.
            html = html.replace("{{host}}", ROOT_DOMAIN)
            html = html.replace("{{next}}", "/")
            html = html.replace("{{error}}", "")
            html = html.replace("{{preload}}", "[]")
            html = html.replace("{{preload_links}}", "")
            html = html.replace("{{to}}", "index.html")
            # Redirect preview: show the page without automatically navigating.
            if name == "redirect.html":
                html = re.sub(r'<meta http-equiv="refresh"[^>]*>', '', html)
                html = html.replace(
                    "function go() { location.replace(target); }",
                    "function go() {}",
                )
            # Localize language switching: inline all four dictionaries so pages can switch languages without /api/i18n.
            # The shared patch was computed outside the loop as preview_i18n_html; replace it here.
            html = html.replace("</body>", preview_i18n_html + "</body>")
            with open(os.path.join(PREVIEW_OUT, name), "w", encoding="utf-8") as f:
                f.write(html)
    # Preview index listing all subdomain pages; template: site/src/templates/preview.html.
    with appmod.test_request_context("/", headers={"Host": ROOT_DOMAIN}):
        # Set the preview index language here; the template uses <html lang="{{ g.lang }}"> instead of hardcoding zh-cn.
        g.lang = PREVIEW_LANG
        index_html = render_template(
            "preview.html",
            pages=[
                "index.html",
                "services.html",
                "contact.html",
                "visitor.html",
                "apple-account.html",
                "redirect.html",
                "auth.html",
            ],
        )
    with open(os.path.join(PREVIEW_OUT, "preview.html"), "w", encoding="utf-8") as f:
        f.write(index_html)
    with open(os.path.join(PREVIEW_DIR, ".gitkeep"), "w", encoding="utf-8") as f:
        pass
    print(f"[build] preview generated for {len(LANGS)} languages", flush=True)

    # Keep .gitkeep; Git tracks it, while generated content remains untracked.
    with open(os.path.join(PUBLIC_DIR, ".gitkeep"), "w", encoding="utf-8"):
        pass

    # External processes may create .DS_Store files or copies such as “file 2.ext” during the build;
    # remove them before generating the manifest and deploying.
    _remove_bad_artifacts(PUBLIC_DIR)

    # Generate the build manifest; the deploy script verifies artifact hashes before upload.
    write_manifest()

    total = 0
    for _root, _dirs, files in os.walk(PUBLIC_DIR):
        total += len(files)
    print(f"[build] done, {total} files in public/", flush=True)
    return 0


if __name__ == "__main__":
    # --verify-manifest: check only whether existing artifacts match manifest.json. It is called before deployment by
    # ops/pages_deploy.sh and does not build anything.
    if "--verify-manifest" in sys.argv[1:]:
        # Exit codes wrap at 256: returning the raw problem count made 256 mismatches exit 0.
        sys.exit(1 if verify_manifest() else 0)
    sys.exit(main())
