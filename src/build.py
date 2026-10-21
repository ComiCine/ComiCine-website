#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026 Limooo <https://limooo.cn/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Static-site build script for Limooo on Cloudflare Pages.

Prerender Jinja templates as static HTML in public/ for four languages, and generate:
  - public/<lang>/index.html, services.html, contact.html, and not-found.html
    (middleware serves these at clean language-aware URLs)
  - A static asset mirror under public/static/
  - functions/api/i18n/[lang].ts and functions/_data/i18n.ts for frontend language switching

Run with: python3 build.py
Output directory: public/ (Git keeps only .gitkeep; deployment uploads it with wrangler pages deploy)
"""

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys

from flask import Flask, g, render_template

# These are **optional dependencies**: use None when they are unavailable. Whether to fail is decided by
# check_image_prerequisites before public/ is modified; that function raises when needed.
# `x = None` conflicts with the Module type inferred from the import. This is the only place in the repository that needs an exception,
# limited to this assignment rather than a blanket ignore or a global check override.
try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore[assignment]

try:
    # The repository provides the cairosvg types in typings/cairosvg/__init__.pyi.
    # Allow only for this package lacking py.typed; do not use ignore_missing_imports to
    # disable checks for all third-party packages. Its svg2png call site still has real types.
    # cairosvg does not include py.typed; the repository stub at typings/cairosvg/__init__.pyi
    # provides its types. mypy recognizes this stub, so no ignore is needed here.
    import cairosvg
except (ImportError, OSError):
    # cairosvg depends on the local libcairo library. When it is missing, cairocffi raises OSError rather than
    # ImportError, which is common on Linux or systems without Homebrew. Treat both cases as unavailable,
    # and let generate_watermarks decide whether watermarking is required.
    cairosvg = None  # type: ignore[assignment]


from config import (
    APPLE_ACCOUNT_HOST,
    BASE_DIR,
    CONTACT_HOST,
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

FUNCTIONS_DIR = os.path.join(BASE_DIR, "functions")

# Generated files (functions/_lib/config.ts, functions/_data/*.ts, and functions/api/i18n/[lang].ts)
# must get their AGPL headers from the generator or the next build will remove them (tasks/22 W8-7).
# The wording matches headers in handwritten files such as src/config.py; only the comment syntax changes to a TypeScript block comment.
# ops/check_gate_trust.py has a matching copy for functions/_data/gateTrust.ts.
# Update both copies together.
LICENSE_HEADER_TS = """\
/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
"""


def preview_localization_patterns() -> dict[str, re.Pattern[str]]:
    """Return preview-localization patterns built from contract domain constants.

    The previous implementation hard-coded escaped domain literals for the root and
    image hosts, so contract changes did not reach preview output. Build patterns from
    ROOT_DOMAIN, IMAGE_ASSET_HOST, and IMAGE_WATERMARK_HOST on each call, so changing
    config-contract.json is sufficient for previews too.
    """
    return {
        "asset": re.compile(
            r'(src|href|data-qr)="https://(?:'
            + "|".join(
                [
                    re.escape(ROOT_DOMAIN) + r"/static",
                    re.escape(IMAGE_ASSET_HOST) + r"/static",
                    re.escape(IMAGE_WATERMARK_HOST),
                ]
            )
            + r")/"
        ),
        "root_href": re.compile(rf'href="https://{re.escape(ROOT_DOMAIN)}/?'),
        "root_url": re.compile(rf"url=https://{re.escape(ROOT_DOMAIN)}/"),
    }


def preview_subdomain_pages() -> tuple[tuple[str, str], ...]:
    """Map preview subdomain pages to local filenames using hostnames from the contract."""
    return (
        (SERVICES_HOST, "services.html"),
        (CONTACT_HOST, "contact.html"),
        (VISITOR_HOST, "visitor.html"),
        (APPLE_ACCOUNT_HOST, "apple-account.html"),
    )


CONTRACT_PATH = os.path.join(BASE_DIR, "config-contract.json")

# Portfolio card thumbnails: keep only resolutions large enough for the cards, so the first view does not download 1080×1440 originals.
PORTFOLIO_THUMB_WIDTHS = (480, 640, 800)
PORTFOLIO_THUMB_AVIF_QUALITY = 55

# Parallel or backup processes may create copies with spaces, such as “visitor 2.js” or “visitors 3.ts”.
# These are not site assets; skip them during the build so they are not deployed to public/.
_PARALLEL_ARTIFACT_RE = re.compile(r"\s\d+\.(?:ts|js|py|sql|json|md|map)$")

# Source file used only as Tailwind CLI input; do not publish it with the site.
# The live /static/tailwind.input.css would contain only a 59-byte @tailwind directive,
# which is useless to visitors and exposes build details. The precompiled asset is tailwind.css.
_STATIC_EXCLUDE_NAMES = frozenset({"tailwind.input.css"})


def _static_ignore(dirpath: str, names: list[str]) -> set[str]:
    ignored = {".DS_Store", "__pycache__"}
    ignored.update(_STATIC_EXCLUDE_NAMES.intersection(names))
    if os.path.normcase(os.path.abspath(dirpath)) == os.path.normcase(
        os.path.abspath(STATIC_DIR)
    ) and "portfolio" in names:
        ignored.add("portfolio")
    ignored.update(
        name for name in names
        if name.endswith((".bak", ".orig", ".rej"))
        or _PARALLEL_ARTIFACT_RE.search(name)
    )
    return ignored


def _remove_bad_artifacts(root: str) -> None:
    """After the build, remove .DS_Store files or parallel copies that external processes may have written."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for name in filenames:
            if (
                name == ".DS_Store"
                or name.endswith((".bak", ".orig", ".rej"))
                or _PARALLEL_ARTIFACT_RE.search(name)
            ):
                try:
                    os.remove(os.path.join(dirpath, name))
                except OSError:
                    pass
        for name in dirnames:
            if name == "__pycache__":
                shutil.rmtree(os.path.join(dirpath, name), ignore_errors=True)


def write_pages_edge_config(out_dir: str) -> None:
    """Generate Pages _routes.json and _headers so static assets bypass Functions."""
    with open(os.path.join(out_dir, "_routes.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "version": 1,
                "include": ["/*"],
                "exclude": [
                    "/static/*",
                    "/favicon.svg",
                    "/Limooo-xtext.svg",
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
            "/static/*.ico\n"
            "  Cache-Control: public, max-age=31536000, immutable\n"
            "/robots.txt\n"
            "  Cache-Control: public, max-age=86400\n"
            "/llms.txt\n"
            "  Cache-Control: public, max-age=86400\n"
            "/sitemap.xml\n"
            "  Cache-Control: public, max-age=86400\n"
        )


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
ROBOTS_SOURCE = os.path.join(BASE_DIR, "docs", "lists", "robots.txt")


def write_discovery_files(out_dir: str) -> None:
    """Write robots.txt, llms.txt, and sitemap.xml to the output root.

    Crawler rules for robots.txt come from `docs/lists/robots.txt`; the Sitemap line
    uses root_domain from the contract. All three files must be at the output root:
    placing them under `static/` would serve `/static/robots.txt`, which crawlers do
    not check.
    """
    with open(ROBOTS_SOURCE, encoding="utf-8") as f:
        robots = f.read()
    # If the source is invalid (empty or missing a User-agent group), **fail the build**. The live robots.txt
    # also supplies the gate allowlist, so an empty list would silently put all crawlers behind the gate.
    if "User-agent: *" not in robots or "User-agent: GPTBot" not in robots:
        raise RuntimeError(f"{ROBOTS_SOURCE} does not look like the robots.txt source any more")
    with open(os.path.join(out_dir, "robots.txt"), "w", encoding="utf-8") as f:
        f.write(f"{robots.rstrip()}\n\nSitemap: https://{ROOT_DOMAIN}/sitemap.xml\n")

    sitemap_hosts = (ROOT_DOMAIN, SERVICES_HOST, CONTACT_HOST, IMAGE_ASSET_HOST)
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
        "# Limooo\n"
        "\n"
        "> Limooo (https://limooo.cn) is a personal video-production studio site: a\n"
        "> portfolio, a services price list and a four-language documentation site.\n"
        "> All public pages are open to search engines, crawlers and AI agents; the\n"
        "> full-size portfolio originals are deliberately not published.\n"
        "\n"
        "## Main site\n"
        "\n"
        "- [Home](https://limooo.cn/): studio introduction and portfolio highlights.\n"
        "- [Services](https://services.limooo.cn/): convention (studio) and outdoor\n"
        "  shoot pricing, per shoot type and head count.\n"
        "- [Contact](https://contact.limooo.cn/): how to get in touch.\n"
        f"- [Sitemap](https://{ROOT_DOMAIN}/sitemap.xml)\n"
        "\n"
        "## Documentation (docs.limooo.cn)\n"
        "\n"
        "- [Documentation home](https://docs.limooo.cn/): project documentation in\n"
        "  zh-cn, en-us, ja-jp and ko-kr; `/`, `/en-us`, `/ja-jp`, `/ko-kr` are the\n"
        "  per-language entry points and every content page carries its language as\n"
        "  the last path segment.\n"
        "- [README](https://docs.limooo.cn/README/zh-cn)\n"
        "- [License](https://docs.limooo.cn/LICENSE/zh-cn)\n"
        "- [Sitemap](https://docs.limooo.cn/sitemap.xml)\n"
        "\n"
        "## Notes\n"
        "\n"
        "- Languages: zh-cn, en-us, ja-jp, ko-kr (the same URL serves the language\n"
        "  picked from the `user_lang_preference` cookie, `Accept-Language`, then the\n"
        "  Cloudflare region; the default is en-us).\n"
        "- Crawling: `/robots.txt` allows everything except the endpoint and admin\n"
        "  paths; `/api/` is not content. Images are served from\n"
        "  `images.limooo.cn` (thumbnails, watermarked copies, QR codes and icons).\n"
    )
    with open(os.path.join(out_dir, "llms.txt"), "w", encoding="utf-8") as f:
        f.write(llms)


PORTFOLIO_THUMB_QUALITY = 75


def _app_instance(appmod) -> Flask:
    """Accept either a Flask module (legacy tests) or a Flask app (build-time rendering)."""
    return appmod.app if hasattr(appmod, "app") else appmod

# (template, output filename, render path). Render with Host: limooo.cn (is_prod=True),
# preserving absolute subdomain links (limooo.cn, services.limooo.cn, contact.limooo.cn) in navigation.
# Middleware serves the matching language page at a clean URL based on the hostname, without a language path prefix.
PAGES = (
    ("index.html", "index.html", "/", None),
    ("services.html", "services.html", "/services", None),
    ("contact.html", "contact.html", "/contact", None),
    ("404.html", "not-found.html", "/404", None),
    # Subdomain-specific admin pages (visitor.limooo.cn / account.limooo.cn/apple) are served by middleware based on the hostname.
    ("visitor.html", "visitor.html", "/visitor", None),
    ("apple-account.html", "apple-account.html", "/apple-account", None),
    # Shared redirect page (redirect.limooo.cn): prerender the default target (the main home page); middleware adds the actual redirect parameters.
    ("redirect.html", "redirect.html", "/r", "redirect"),
    # Login is handled by Pages Functions; no static login page is generated.
)

GATE_I18N_KEYS = (
    ("title", "gate_title"),
    ("heading", "gate_heading"),
    ("location", "gate_location"),
    ("ip", "gate_ip"),
    ("ray", "gate_ray"),
    ("foot", "gate_foot"),
    ("lang_aria", "gate_lang_aria"),
    ("theme_aria", "gate_theme_aria"),
    ("footer_rights", "footer_rights"),
    ("footer_source", "footer_source"),
    ("footer_source_link", "footer_source_link"),
    ("error_sitekey", "gate_error_sitekey"),
    ("error_invalid", "gate_error_invalid"),
    ("error_unavailable", "gate_error_unavailable"),
    ("error_failed", "gate_error_failed"),
    ("error_blocked", "gate_error_blocked"),
    ("error_blocked_detail", "gate_error_blocked_detail"),
    ("retry", "gate_retry"),
)


# Shared redirect-page copy (functions/_data/runtime.ts); footer_* keys are also used by the gate page.
REDIRECT_I18N_KEYS = (
    ("title", "redirect_title"),
    ("text", "redirect_text"),
    ("footer_rights", "footer_rights"),
    ("footer_source", "footer_source"),
    ("footer_source_link", "footer_source_link"),
)


def _require_locale_keys(
    lang: str, keys: tuple[tuple[str, str], ...]
) -> dict[str, str]:
    """Read copy for one language through an output-key-to-locale-key mapping.

    Gate and redirect pages share this check. The redirect page previously fell back
    to Chinese literals for redirect_title and redirect_text. If a locale missed a
    key, English, Japanese, or Korean redirects silently displayed Simplified Chinese
    while the build still passed. Missing keys violate the contract, so the build must
    fail.
    """
    path = os.path.join(LOCALES_DIR, f"{lang}.json")
    data = load_translations()[lang]
    texts: dict[str, str] = {}
    for output_key, locale_key in keys:
        value = data.get(locale_key)
        if not isinstance(value, str) or not value:
            raise RuntimeError(f"{path} is missing required locale field: {locale_key}")
        texts[output_key] = value
    return texts


def validate_locale_completeness(
    translations: dict[str, dict[str, str]] | None = None
) -> None:
    """Require every language to include all keys from key_fallback_lang.

    The HTML footer (footer_rights, footer_source, and footer_source_link in
    _footer.html) uses the template's `_()` helper. Missing keys fall back to
    key_fallback_lang, which caused English pages to silently show Chinese. Making
    missing keys fail the build enforces the contract.
    """
    translations = translations if translations is not None else load_translations()
    reference = translations[KEY_FALLBACK_LANG]
    for lang, data in translations.items():
        if lang == KEY_FALLBACK_LANG:
            continue
        missing = sorted(set(reference) - set(data))
        if missing:
            path = os.path.join(LOCALES_DIR, f"{lang}.json")
            preview = ", ".join(missing[:10])
            more = f" (+{len(missing) - 10} more)" if len(missing) > 10 else ""
            raise RuntimeError(
                f"{path} is missing {len(missing)} key(s) present in "
                f"{KEY_FALLBACK_LANG}.json: {preview}{more}"
            )


def _load_gate_i18n() -> dict[str, dict[str, str]]:
    """Read gate-page copy from locales/*.json instead of hard-coded dictionaries."""
    return {lang: _require_locale_keys(lang, GATE_I18N_KEYS) for lang in LANGS}

GATE_I18N = _load_gate_i18n()


def render_page(appmod, template: str, path: str, lang: str, extra=None) -> str:
    """Render one page with Flask context and Host fixed to limooo.cn."""
    app = _app_instance(appmod)
    kwargs = {}
    if extra == "redirect":
        # Prerender the shared redirect-page shell; middleware injects the actual target and preload images per request.
        kwargs = {
            "to": "{{to}}",
            "preload": False,
            "preload_images": [],
            "preload_placeholder": "{{preload}}",
            "preload_links": "{{preload_links}}",
        }
    with app.test_request_context(path, headers={"Host": ROOT_DOMAIN}):
        g.lang = lang
        html = render_template(template, **kwargs)
    # The template renders the language directly in <html lang="{{ g.lang }}">; no string replacement is needed here.
    # Add a leading slash to relative assets. A template path such as src="static/..." resolves incorrectly under a path like /zh-cn,
    # while /static/... works at every path with the middleware clean-URL routing.
    html = html.replace('src="static/', 'src="/static/')
    html = html.replace('href="static/', 'href="/static/')
    return html


def write_not_found_fallback(appmod, out_dir: str) -> None:
    """Build the Pages fallback with the branded 404 page and its client-side redirect."""
    html = render_page(appmod, "404.html", "/404", KEY_FALLBACK_LANG)
    with open(os.path.join(out_dir, "404.html"), "w", encoding="utf-8") as f:
        f.write(html)


def render_gate(appmod, lang: str) -> str:
    """Prerender the human-verification gate page for each language (auth.limooo.cn/__gate)."""
    app = _app_instance(appmod)
    t = GATE_I18N[lang]
    # /__gate/config provides the site key and full i18n data at runtime; do not write secret-related values into build output.
    turnstile_html = '<div id="turnstile-wrap" class="turnstile-wrap"></div>'
    gate_i18n_json = json.dumps(GATE_I18N, ensure_ascii=False).replace("</", "<\\/")
    with app.test_request_context("/__gate", headers={"Host": GATE_HOST}):
        g.lang = lang
        html = render_template(
            "auth.html",
            lang=lang,
            title=t["title"],
            heading=t["heading"],
            location=t["location"],
            ip=t["ip"],
            ray=t["ray"],
            foot=t["foot"],
            lang_aria=t["lang_aria"],
            theme_aria=t["theme_aria"],
            error_html="{{error}}",
            turnstile_html=turnstile_html,
            turnstile_src="",
            sitekey="",
            gate_i18n=GATE_I18N,
            gate_i18n_json=gate_i18n_json,
            host="{{host}}",
            next="{{next}}",
        )
    # The template also renders the language in <html lang="{{ g.lang }}">; do not replace it as a string.
    return html


def preview_i18n_patch() -> str:
    """Add the four-language dictionary inline for preview switching without /api/i18n."""
    data: dict[str, dict[str, str]] = load_translations()
    # Escape a closing </script> sequence before inlining content to prevent translated copy from closing the script unexpectedly.
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    return (
        "<script>"
        "(function(){"
        "var ALL=" + payload + ";"
        "window.__PREVIEW_I18N__=ALL;"
        "if (typeof I18N_CACHE === 'undefined') { window.I18N_CACHE = {}; }"
        "Object.keys(ALL).forEach(function(l){I18N_CACHE[l]=ALL[l];});"
        "window.fetchI18n=function(lang,cb){cb(window.__PREVIEW_I18N__[lang]||null);};"
        "})();"
        "</script>"
    )


def write_config_functions() -> None:
    """Generate the Pages-side constants module from the config-contract.json source of truth."""
    with open(CONTRACT_PATH, encoding="utf-8") as f:
        contract = json.load(f)

    lines = [
        LICENSE_HEADER_TS.rstrip("\n"),
        "",
        "/** Generated by build.py. Do not edit; change config-contract.json instead. */",
        "export const CONTRACT = " + json.dumps(contract, ensure_ascii=False, indent=2) + " as const;",
        "",
        "export const ROOT_DOMAIN = CONTRACT.root_domain;",
        "export const BASE_URL = `https://${ROOT_DOMAIN}`;",
        "export const WWW_HOSTNAME = `www.${ROOT_DOMAIN}`;",
        # Emit only constants referenced by functions/. A full scan found no references to the 15 CONTRACT field aliases below
        # in production code or test imports, so generation stopped. They only renamed
        # CONTRACT fields and re-exported them, which made them dead generated code. Read a field directly from
        # CONTRACT when needed; do not add aliases.
        #   Removed: SERVICES_HOSTNAME / CONTACT_HOSTNAME / GATE_HOST / REDIRECT_HOST /
        #   IMAGE_BASE / MANAGED_HOSTS / SHARED_LANG_HOSTS / IMAGE_ASSET_BASE /
        #   IMAGE_WATERMARK_BASE / OBSERVABILITY_HMAC_ENV / WHITELIST_FILE /
        #   KEY_FALLBACK_LANG / THEME_COOKIE / THEME_COOKIE_MAX_AGE /
        #   PENDING_TTL_SECONDS
        # Note: canonicalCidr in functions/_lib/cidr.ts is not included here because it is used by
        # cidr.test.ts; it is referenced and must remain.
        "export const VISITOR_HOSTNAME = `visitor.${ROOT_DOMAIN}`;",
        "export const APPLE_ACCOUNT_HOSTNAME = `account.${ROOT_DOMAIN}`;",
        "export const IDENTITY_HOSTNAME = CONTRACT.identity_host;",
        "export const IDENTITY_SITE_ROLES: Record<string, \"admin\" | \"viewer\"> = CONTRACT.identity_sites;",
        "export const REDIRECT_HOSTNAME = `redirect.${ROOT_DOMAIN}`;",
        "export const GATE_HOSTNAME = `auth.${ROOT_DOMAIN}`;",
        "export const IMAGES_HOSTNAME = `images.${ROOT_DOMAIN}`;",
        "export const APPLE_ACCOUNT_DOMAIN = `@${CONTRACT.apple_account_email_domain}`;",
        "export const PUBLIC_HOSTS: Set<string> = new Set(CONTRACT.public_hosts);",
        "export const PAGE_ROUTES: Record<string, Record<string, string>> = CONTRACT.page_routes;",
        "export const IMAGE_ASSET_HOSTNAME = CONTRACT.image_asset_host;",
        "export const IMAGE_WATERMARK_HOSTNAME = CONTRACT.image_watermark_host;",
        "export const GATE_TRUST = CONTRACT.gate_trust;",
        "export const SUPPORTED_LANGS = CONTRACT.supported_langs;",
        "export const DEFAULT_LANG = CONTRACT.default_lang;",
        "export const LANG_COOKIE = CONTRACT.lang_cookie;",
        "export const LANG_COOKIE_MAX_AGE = CONTRACT.lang_cookie_max_age;",
        "export const GATE_COOKIE = CONTRACT.gate_cookie;",
        "export const SESSION_COOKIE = CONTRACT.session_cookie;",
        "export const PENDING_COOKIE = CONTRACT.pending_cookie;",
        "export const CSRF_COOKIE = CONTRACT.csrf_cookie;",
        "export const GATE_TTL_SECONDS = CONTRACT.gate_ttl_seconds;",
        "export const SESSION_TTL_SECONDS = CONTRACT.session_ttl_seconds;",
        "export const REVEAL_MAX_AUTH_AGE_SECONDS = CONTRACT.reveal_max_auth_age_seconds;",
        "",
    ]
    ts_path = os.path.join(FUNCTIONS_DIR, "_lib", "config.ts")
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("[build] config functions generated", flush=True)


def write_i18n_functions() -> None:
    """Inline locales/*.json into functions/_data/i18n.ts and generate /api/i18n/<lang>."""
    data: dict[str, dict[str, str]] = load_translations()

    ts_path = os.path.join(FUNCTIONS_DIR, "_data", "i18n.ts")
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as f:
        f.write(
            LICENSE_HEADER_TS
            + "\n// Generated by build.py. Do not edit by hand.\n"
            "export const translations: Record<string, Record<string, string>> = "
            + json.dumps(data, ensure_ascii=False, indent=2)
            + ";\n"
        )

    route_dir = os.path.join(FUNCTIONS_DIR, "api", "i18n")
    os.makedirs(route_dir, exist_ok=True)
    with open(os.path.join(route_dir, "[lang].ts"), "w", encoding="utf-8") as f:
        f.write(
            LICENSE_HEADER_TS
            + '\n// Generated by build.py. Do not edit by hand.\n'
            'import { translations } from "../../_data/i18n";\n'
            "\n"
            "export const onRequestGet = ({ params }: { params: Record<string, string> }) => {\n"
            "  const lang = String((params as { lang?: string }).lang ?? \"\");\n"
            "  // Use hasOwnProperty because translations is a plain object literal.\n"
            "  // Direct lookup can return inherited members such as constructor,\n"
            "  // toString, valueOf, or __proto__, incorrectly treating them as\n"
            "  // supported languages. JSON.stringify on a function returns\n"
            "  // undefined, which could produce a cached 200 response with an empty body.\n"
            "  if (!Object.prototype.hasOwnProperty.call(translations, lang)) {\n"
            '    return new Response(JSON.stringify({ error: "unsupported language" }), {\n'
            "      status: 404,\n"
            '      headers: { "Content-Type": "application/json" },\n'
            "    });\n"
            "  }\n"
            "  const dict = translations[lang];\n"
            "  return new Response(JSON.stringify(dict), {\n"
            "    status: 200,\n"
            '    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" },\n'
            "  });\n"
            "};\n"
        )


def write_runtime_functions() -> None:
    """Generate a Pages module for shared gate/redirect copy and preload images to avoid middleware duplication."""
    # Raise RuntimeError for missing keys. Do not fall back to Chinese literals, or English, Japanese, and Korean redirect pages
    # could silently display Simplified Chinese while the build still passes.
    redirect_i18n = {lang: _require_locale_keys(lang, REDIRECT_I18N_KEYS) for lang in LANGS}
    output = [
        LICENSE_HEADER_TS.rstrip("\n"),
        "",
        "// Generated by build.py. Do not edit by hand.",
        "export const GATE_I18N: Record<string, Record<string, string>> = "
        + json.dumps(GATE_I18N, ensure_ascii=False, indent=2)
        + ";",
        "export const REDIRECT_I18N: Record<string, { title: string; text: string; footer_rights: string; footer_source: string; footer_source_link: string }> = "
        + json.dumps(redirect_i18n, ensure_ascii=False, indent=2)
        + ";",
        "export const REDIRECT_PRELOAD_IMAGES = "
        + json.dumps(REDIRECT_PRELOAD_IMAGES, ensure_ascii=False, indent=2)
        + ";",
    ]
    ts_path = os.path.join(FUNCTIONS_DIR, "_data", "runtime.ts")
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as f:
        f.write("\n".join(output) + "\n")
    print("[build] runtime functions generated", flush=True)


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest() -> dict:
    """Generate public/manifest.json and report differences from the previous build.

    The manifest contains file hashes but no timestamps, keeping output reproducible
    for the same source in a clean environment. The deployment script uploads it with
    public/ as build evidence.
    """
    files: dict[str, str] = {}
    for root, _dirs, names in os.walk(PUBLIC_DIR):
        for name in names:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, PUBLIC_DIR).replace(os.sep, "/")
            if rel == "manifest.json":
                continue
            files[rel] = _sha256_file(path)

    manifest_path = os.path.join(PUBLIC_DIR, "manifest.json")
    previous: dict | None = None
    try:
        with open(manifest_path, encoding="utf-8") as f:
            previous_data = json.load(f)
        if isinstance(previous_data, dict) and isinstance(previous_data.get("files"), dict):
            previous = previous_data
    except (OSError, json.JSONDecodeError):
        previous = None

    manifest = {
        "schema_version": 1,
        "tool": "limooo-build",
        "count": len(files),
        "files": files,
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")

    if previous is not None:
        old_files = previous.get("files", {})
        changed = sorted(k for k in files if old_files.get(k) != files[k])
        added = sorted(k for k in files if k not in old_files)
        removed = sorted(k for k in old_files if k not in files)
        if changed or added or removed:
            print(
                f"[build] manifest changed: +{len(added)} -{len(removed)} ~{len(changed)}",
                flush=True,
            )
    return manifest


def generate_portfolio_thumbs(source_dir=None, output_dir=None) -> int:
    """Generate 640/800px WebP portfolio thumbnails in the build output directory.

    Thumbnails are only for home-page card previews. Full-size originals stay in the
    private local source directory; the build publishes thumbnails only.
    """
    # Always generate thumbnails from source images in src/static/portfolio instead of relying on copies in the build output directory
    # that may already have been removed.
    source_dir = source_dir or os.path.join(STATIC_DIR, "portfolio")
    output_dir = output_dir or os.path.join(
        PUBLIC_DIR, "static", "portfolio", "thumbs"
    )
    if Image is None:
        raise RuntimeError(
            "Pillow is not installed, cannot generate portfolio thumbnails. Run "
            "`pip install -r ops/requirements.txt` before build.py."
        )

    # Portfolio originals are not tracked (.gitignore: src/static/portfolio/), so a clean CI checkout
    # has no such directory. Skip thumbnail generation when source images are missing so the build can succeed.
    if not os.path.isdir(source_dir):
        print(
            f"[build] portfolio originals dir missing: {source_dir}; skipping thumbnails",
            flush=True,
        )
        return 0

    os.makedirs(output_dir, exist_ok=True)
    resampling = getattr(Image, "Resampling", Image).LANCZOS
    count = 0

    for name in sorted(os.listdir(source_dir)):
        if not re.search(r"\.(png|jpe?g|webp)$", name, re.I):
            continue
        src_path = os.path.join(source_dir, name)
        try:
            with Image.open(src_path) as opened:
                image = opened.convert("RGB")
        except Exception as exc:
            print(f"[build] thumbnail skip {name}: {exc}", flush=True)
            continue

        base = os.path.splitext(name)[0]
        skipped: list[int] = []
        for width in PORTFOLIO_THUMB_WIDTHS:
            # Downscale only: enlarging a source image narrower than the target would create a blurrier, larger file.
            # src/static/portfolio/ is untracked and maintained manually; these sizes are tuned for typical 1080px-wide source images.
            if width > image.width:
                skipped.append(width)
                continue
            height = round(image.height * width / image.width)
            thumb = image.resize((width, height), resampling)
            out_path = os.path.join(output_dir, f"{base}-{width}.webp")
            # A parallel build may recreate public/ and remove this directory; ensure it exists again before saving.
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            thumb.save(
                out_path,
                "WEBP",
                quality=PORTFOLIO_THUMB_QUALITY,
                method=6,
            )
            avif_path = os.path.join(output_dir, f"{base}-{width}.avif")
            thumb.save(
                avif_path,
                "AVIF",
                quality=PORTFOLIO_THUMB_AVIF_QUALITY,
                method=6,
                speed=6,
            )
            count += 1
        if skipped:
            print(
                f"[build] thumbnail skip {name}: widths {skipped} exceed source width {image.width}",
                flush=True,
            )

    print(f"[build] portfolio thumbnails: {count}", flush=True)
    return count


def check_image_prerequisites(source_root=None, wm_path: str | None = None) -> bool:
    """Validate image prerequisites before touching public/; return whether portfolio sources exist.

    These checks were previously spread through generate_watermarks. If cairosvg was
    missing, the build failed after copytree had copied originals, leaving a public/
    directory with full portfolio images that could be deployed directly (W9-22).
    Run checks at the start of main() so a failure writes nothing.
    """
    source_root = source_root or STATIC_DIR
    wm_path = wm_path or os.path.join(STATIC_DIR, "icons", "Limooo-xtext.svg")
    portfolio_dir = os.path.join(source_root, "portfolio")
    has_portfolio = os.path.isdir(portfolio_dir) and any(
        name.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
        for name in os.listdir(portfolio_dir)
    )
    if not has_portfolio:
        return False

    if Image is None:
        raise RuntimeError(
            "Pillow is not installed, cannot generate portfolio thumbnails or watermarks. "
            "Run `pip install -r ops/requirements.txt` before build.py."
        )
    if cairosvg is None:
        raise RuntimeError(
            "portfolio source images are present but cairosvg (and local libcairo) is missing; "
            "install it before build.py, or remove src/static/portfolio to build without watermarks"
        )
    if not os.path.exists(wm_path):
        raise FileNotFoundError(f"missing watermark asset: {wm_path}")
    return True


def generate_watermarks(source_root=None, out_root=None) -> int:
    """Generate watermarked variants from source originals in public/static/wm/.

    Rules, matching shouldWatermark in the Worker:
      - Process only top-level png, jpg, jpeg, and webp files under portfolio/.
      - Do not create watermarked variants for other paths such as icons/ or qr-codes/.
    Use Limooo-xtext.svg, preserve its transparency, and overlay it at the lower-left
    corner without a background. The watermark is 25% of the image's shorter side
    (minimum 96px), with a margin of 2% of that side (minimum 12px).
    """
    # Size parameters; the SVG asset defines watermark color and opacity.
    WATERMARK_SCALE = 0.25       # Watermark width as a fraction of the image short edge
    WATERMARK_MIN_W = 96         # Minimum watermark width in pixels

    # A2: Generate watermarked variants from source originals in src/static/portfolio; the public bundle contains only
    # /static/wm/portfolio/*; originals are no longer public.
    source_root = source_root or STATIC_DIR
    out_root = out_root or os.path.join(PUBLIC_DIR, "static", "wm")

    # A clean CI checkout has no gitignored src/static/portfolio directory. Without source images, watermarking is unnecessary,
    # so skip it instead of failing. Fail only when watermarking is required but assets or dependencies are missing.
    wm_path = os.path.join(STATIC_DIR, "icons", "Limooo-xtext.svg")
    if not check_image_prerequisites(source_root, wm_path):
        print("[build] no portfolio files to watermark, skipping watermark generation", flush=True)
        return 0
    os.makedirs(out_root, exist_ok=True)

    wm = Image.open(io.BytesIO(cairosvg.svg2png(url=wm_path))).convert("RGBA")
    wm_w0, wm_h0 = wm.size
    count = 0

    for root, _dirs, files in os.walk(source_root):
        for name in files:
            rel = os.path.relpath(os.path.join(root, name), source_root)
            # Scan only top-level source images in portfolio/; subdirectories and other assets are not published.
            if os.path.dirname(rel) != "portfolio":
                continue
            if not re.search(r"\.(png|jpe?g|webp)$", name, re.I):
                continue
            try:
                with Image.open(os.path.join(root, name)) as opened:
                    im = opened.convert("RGBA")
            except Exception as exc:  # Skip images that cannot be decoded.
                print(f"[build] watermark skip {rel}: {exc}", flush=True)
                continue

            base = min(im.size)
            target_w = max(WATERMARK_MIN_W, round(base * WATERMARK_SCALE))
            wm_h = max(1, round(wm_h0 * target_w / wm_w0))
            margin = max(12, round(base * 0.02))
            resampling = getattr(Image, "Resampling", Image).LANCZOS
            wm_resized = wm.resize((target_w, wm_h), resampling)
            canvas = im.copy()
            canvas.alpha_composite(
                wm_resized,
                (margin, im.size[1] - wm_h - margin),
            )

            ext = name.rsplit(".", 1)[-1].lower()
            if ext == "png":
                fmt, save_im, kwargs = "PNG", canvas, {}
            elif ext in ("jpg", "jpeg"):
                fmt, save_im, kwargs = "JPEG", canvas.convert("RGB"), {"quality": 92}
            else:
                fmt, save_im, kwargs = "WEBP", canvas.convert("RGB"), {"quality": 92}

            out_path = os.path.join(out_root, rel)
            os.makedirs(os.path.dirname(out_path), exist_ok=True)
            save_im.save(out_path, fmt, **kwargs)
            count += 1

    print(f"[build] watermarked variants: {count}", flush=True)
    return count


def restore_qr_png_compatibility(qr_codes_dir: str) -> int:
    """Preserve existing static URLs for QR-code originals moved into png/."""
    source_dir = os.path.join(qr_codes_dir, "png")
    if not os.path.isdir(source_dir):
        return 0

    copied = 0
    for name in sorted(os.listdir(source_dir)):
        source_path = os.path.join(source_dir, name)
        if not os.path.isfile(source_path) or not name.lower().endswith(".png"):
            continue
        compatibility_path = os.path.join(qr_codes_dir, name)
        if os.path.exists(compatibility_path):
            continue
        shutil.copy2(source_path, compatibility_path)
        copied += 1

    if copied:
        print(f"[build] QR PNG compatibility aliases: {copied}", flush=True)
    return copied


def remove_public_portfolio_originals(
    portfolio_dir: str, *, keep_thumbs: bool = True
) -> int:
    """Delete everything under public/static/portfolio except thumbs/.

    A2: Full-size portfolio originals are no longer published. Only watermarked images
    (/static/wm/portfolio/*) and home-page thumbnails (/static/portfolio/thumbs/*) are
    public. Recursive cleanup also removes leftover subdirectories, SVGs, and duplicate
    copies such as "IMG_0064 2.webp".

    The first cleanup uses ``keep_thumbs=False`` to remove thumbnails from an older
    build. After generating thumbnails from current sources, clean again with the
    default value to preserve the new ``thumbs/`` directory.

    Call immediately after ``shutil.copytree(STATIC_DIR, public/static)``, before any
    step that can fail. If cairosvg or the watermark SVG is missing, or the build is
    interrupted, portfolio files in the previous public/ output have already been
    removed while wrangler.toml still points pages_build_output_dir at that directory.
    Watermarks and thumbnails are generated from the source directory
    (src/static/portfolio), not these copies, so early deletion does not affect output.
    """
    # A clean CI checkout has no originals, so public/static/portfolio may be absent; skip it when missing.
    if not os.path.isdir(portfolio_dir):
        print(
            f"[build] public portfolio originals dir missing: {portfolio_dir}; nothing to remove",
            flush=True,
        )
        return 0

    removed = 0
    for name in sorted(os.listdir(portfolio_dir)):
        full = os.path.join(portfolio_dir, name)
        if (
            keep_thumbs
            and name == "thumbs"
            and os.path.isdir(full)
            and not os.path.islink(full)
        ):
            continue
        try:
            if os.path.isdir(full) and not os.path.islink(full):
                removed += sum(len(files) for _root, _dirs, files in os.walk(full))
                shutil.rmtree(full)
            else:
                os.remove(full)
                removed += 1
        except OSError as exc:
            raise RuntimeError(
                f"cannot remove non-thumbnail portfolio output {full}: {exc}"
            ) from exc
    if removed:
        print(f"[build] removed public portfolio originals: {removed}", flush=True)
    return removed


def verify_manifest(out_dir: str | None = None) -> int:
    """Verify manifest.json byte-for-byte against the build output and return the mismatch count.

    The deployment script calls this before ``wrangler pages deploy`` with
    ``python src/build.py --verify-manifest``. Previously, the manifest was only
    checked for existence, so manual edits, added files, and removed files after the
    build went undetected. A missing manifest or any mismatch is a failure (nonzero exit).
    """
    out_dir = out_dir or PUBLIC_DIR
    manifest_path = os.path.join(out_dir, "manifest.json")
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            manifest = json.load(handle)
    except OSError:
        print(
            f"FATAL: {manifest_path} is missing; run a full build before deploying",
            file=sys.stderr,
        )
        return 1
    except json.JSONDecodeError as exc:
        print(f"FATAL: {manifest_path} is not valid JSON: {exc}", file=sys.stderr)
        return 1

    expected = manifest.get("files")
    if not isinstance(expected, dict):
        print(f"FATAL: {manifest_path} has no files map", file=sys.stderr)
        return 1

    actual: dict[str, str] = {}
    for root, _dirs, names in os.walk(out_dir):
        for name in names:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, out_dir).replace(os.sep, "/")
            if rel == "manifest.json":
                continue
            actual[rel] = _sha256_file(path)

    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(
        rel for rel in set(expected) & set(actual) if expected[rel] != actual[rel]
    )
    problems = len(missing) + len(extra) + len(changed)
    if problems:
        print(
            f"FATAL: {out_dir} does not match manifest.json "
            f"(missing {len(missing)} / extra {len(extra)} / changed {len(changed)})",
            file=sys.stderr,
        )
        for label, items in (("missing", missing), ("extra", extra), ("changed", changed)):
            for rel in items[:10]:
                print(f"  {label}: {rel}", file=sys.stderr)
        return problems

    print(f"[build] manifest verified: {len(actual)} files match", flush=True)
    return 0


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
    # Build-mode flag: use the minimal read-only Flask renderer without importing the business app or initializing databases or secrets.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    os.environ.setdefault("LIMOOO_BUILD", "1")
    from render_app import RENDER_APP as appmod

    # Validate prerequisites **before modifying public/**. If Pillow, cairosvg, or the watermark SVG is missing,
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
        # Human-verification gate page (auth.limooo.cn/__gate)
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
    generate_portfolio_thumbs(
        os.path.join(STATIC_DIR, "portfolio"),
        os.path.join(PUBLIC_DIR, "static", "portfolio", "thumbs"),
    )
    # 3.2) Watermarked variants (A2: the public bundle contains only full-size watermarked images at /static/wm/portfolio/*)
    generate_watermarks(STATIC_DIR, os.path.join(PUBLIC_DIR, "static", "wm"))
    # 3.3) Fallback cleanup in case originals or parallel copies reappear during the build; stay quiet if nothing is removed.
    remove_public_portfolio_originals(
        os.path.join(PUBLIC_DIR, "static", "portfolio")
    )
    # Root-level logo used by the gate page; one of the allowed paths.
    shutil.copy2(
        os.path.join(STATIC_DIR, "icons", "Limooo-xtext.svg"),
        os.path.join(PUBLIC_DIR, "Limooo-xtext.svg"),
    )

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
    # avoiding re-encoding 18 thumbnails (36 WebP and AVIF files) during one build.
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
            # Localize asset URLs: https://<root_domain>/static/... and
            # https://<image_asset_host>/static/... and <image_watermark_host>/....
            # → ../static/...
            # Replace HTML tag attributes only; leave absolute URLs in JavaScript untouched.
            #   Construct all three hostnames from contract values; do not hardcode limooo.cn.
            html = re.sub(preview_patterns["asset"], r'\1="../static/', html)
            # Also localize root-relative assets in inline CSS, such as the gate page @font-face url(/static/...).
            html = html.replace("url(/static/", "url(../static/")
            html = html.replace(
                'src="/Limooo-xtext.svg"',
                'src="../static/icons/Limooo-xtext.svg"',
            )
            # Localize site navigation: https://<subdomain>.<root_domain> becomes a local file in the same directory.
            # Subdomain hostnames also come from the contract; do not hardcode limooo.cn.
            for host, page in preview_pages:
                html = re.sub(
                    rf'href="https://{re.escape(host)}/?', f'href="{page}"', html
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
        sys.exit(verify_manifest())
    sys.exit(main())
