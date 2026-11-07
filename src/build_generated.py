# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""HTML rendering, locale validation, and generated Functions artifacts.

These helpers write the prerendered pages, the gate page, and the TypeScript
modules under functions/. Callers pass the translations and Functions directory
explicitly, so monkeypatching the build facade still controls them.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys

from flask import Flask, g, render_template

from build_paths import CONTRACT_PATH
from config import (
    DEFAULT_LANG,
    GATE_HOST,
    KEY_FALLBACK_LANG,
    LOCALES_DIR,
    REDIRECT_PRELOAD_IMAGES,
    ROOT_DOMAIN,
    load_translations,
)
from config import (
    SUPPORTED_LANGS as LANGS,
)

# Generated files (functions/_lib/config.ts, functions/_data/*.ts, and functions/api/i18n/[lang].ts)
# must get their AGPL headers from the generator or the next build will remove them (tasks/22 W8-7).
# The wording matches headers in handwritten files such as src/config.py; only the comment syntax changes to a TypeScript block comment.
# ops/check_gate_trust.py has a matching copy for functions/_data/gateTrust.ts.
# Update both copies together.
LICENSE_HEADER_TS = """\
/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */
"""


def _app_instance(appmod) -> Flask:
    """Accept either a Flask module (legacy tests) or a Flask app (build-time rendering)."""
    return appmod.app if hasattr(appmod, "app") else appmod


GATE_I18N_KEYS = (
    ("title", "gate_title"),
    ("heading", "gate_heading"),
    ("nav_home", "nav_home"),
    ("nav_services", "nav_services"),
    ("nav_contact", "nav_contact"),
    ("nav_menu_aria", "nav_menu_aria"),
    ("nav_appearance", "nav_appearance"),
    ("visit_bilibili", "visit_bilibili"),
    ("lang_zh", "lang_zh"),
    ("lang_en", "lang_en"),
    ("lang_ja", "lang_ja"),
    ("lang_ko", "lang_ko"),
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


# Redirect-page copy for the prerendered shell; footer_* keys are also used by the gate page.
# This table is consumed only by validate_redirect_copy below: the redirect page is rendered into
# public/<lang>/redirect.html at build time, so Functions no longer receive a copy of it.
REDIRECT_I18N_KEYS = (
    ("title", "redirect_title"),
    ("text", "redirect_text"),
    ("footer_rights", "footer_rights"),
    ("footer_source", "footer_source"),
    ("footer_source_link", "footer_source_link"),
)


def _require_locale_keys(
    translations: dict[str, dict[str, str]],
    lang: str,
    keys: tuple[tuple[str, str], ...],
) -> dict[str, str]:
    """Read copy for one language through an output-key-to-locale-key mapping.

    Gate and redirect pages share this check. The redirect page previously fell back
    to Chinese literals for redirect_title and redirect_text. If a locale missed a
    key, English, Japanese, or Korean redirects silently displayed Simplified Chinese
    while the build still passed. Missing keys violate the contract, so the build must
    fail.
    """
    path = os.path.join(LOCALES_DIR, f"{lang}.json")
    data = translations[lang]
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


def validate_redirect_copy(translations: dict[str, dict[str, str]]) -> None:
    """Require the prerendered redirect page copy in every language.

    The redirect shell is rendered at build time, so this is the only place that proves
    redirect_title and redirect_text exist. Without it a locale missing either key would
    silently fall back to Chinese while the build still passed, which is exactly the
    failure the removed runtime table used to catch.
    """
    for lang in LANGS:
        _require_locale_keys(translations, lang, REDIRECT_I18N_KEYS)


def _load_gate_i18n() -> dict[str, dict[str, str]]:
    """Read gate-page copy from locales/*.json instead of hard-coded dictionaries."""
    return {
        lang: _require_locale_keys(load_translations(), lang, GATE_I18N_KEYS)
        for lang in LANGS
    }

GATE_I18N = _load_gate_i18n()


def render_page(appmod, template: str, path: str, lang: str, extra=None) -> str:
    """Render one page with Flask context and Host fixed to comicine.com."""
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
    """Build the static Pages 404 fallback in the configured default language."""
    html = render_page(appmod, "404.html", "/404", DEFAULT_LANG)
    with open(os.path.join(out_dir, "404.html"), "w", encoding="utf-8") as f:
        f.write(html)


def render_gate(appmod, lang: str) -> str:
    """Prerender the human-verification gate page for each language (auth.comicine.com/__gate)."""
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


def write_config_functions(functions_dir: str) -> None:
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
        "export const LEGACY_ROOT_DOMAINS = CONTRACT.legacy_root_domains;",
        "export const ROOT_DOMAINS: readonly string[] = [ROOT_DOMAIN, ...LEGACY_ROOT_DOMAINS];",
        "export function rootDomainForHost(host: string): string | null {",
        "  const hostname = host.split(\":\")[0]?.toLowerCase() ?? \"\";",
        "  return ROOT_DOMAINS.find((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) ?? null;",
        "}",
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
        "export const IDENTITY_HOSTS: Set<string> = new Set([IDENTITY_HOSTNAME, ...LEGACY_ROOT_DOMAINS.map((domain) => `identity.${domain}`)]);",
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
    ts_path = os.path.join(functions_dir, "_lib", "config.ts")
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("[build] config functions generated", flush=True)


def write_i18n_functions(functions_dir: str) -> None:
    """Inline locales/*.json into functions/_data/i18n.ts and generate /api/i18n/<lang>."""
    data: dict[str, dict[str, str]] = load_translations()

    ts_path = os.path.join(functions_dir, "_data", "i18n.ts")
    os.makedirs(os.path.dirname(ts_path), exist_ok=True)
    with open(ts_path, "w", encoding="utf-8") as f:
        f.write(
            LICENSE_HEADER_TS
            + "\n// Generated by build.py. Do not edit by hand.\n"
            "export const translations: Record<string, Record<string, string>> = "
            + json.dumps(data, ensure_ascii=False, indent=2)
            + ";\n"
        )

    route_dir = os.path.join(functions_dir, "api", "i18n")
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


def write_runtime_functions(functions_dir: str) -> None:
    """Generate the Pages module for shared gate copy and preload images to avoid middleware duplication."""
    output = [
        LICENSE_HEADER_TS.rstrip("\n"),
        "",
        "// Generated by build.py. Do not edit by hand.",
        "export const GATE_I18N: Record<string, Record<string, string>> = "
        + json.dumps(GATE_I18N, ensure_ascii=False, indent=2)
        + ";",
        "export const REDIRECT_PRELOAD_IMAGES = "
        + json.dumps(REDIRECT_PRELOAD_IMAGES, ensure_ascii=False, indent=2)
        + ";",
    ]
    ts_path = os.path.join(functions_dir, "_data", "runtime.ts")
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


def write_manifest(public_dir: str) -> dict:
    """Generate public/manifest.json and report differences from the previous build.

    The manifest contains file hashes but no timestamps, keeping output reproducible
    for the same source in a clean environment. The deployment script uploads it with
    public/ as build evidence.
    """
    files: dict[str, str] = {}
    for root, _dirs, names in os.walk(public_dir):
        for name in names:
            path = os.path.join(root, name)
            rel = os.path.relpath(path, public_dir).replace(os.sep, "/")
            if rel == "manifest.json":
                continue
            files[rel] = _sha256_file(path)

    manifest_path = os.path.join(public_dir, "manifest.json")
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
        "tool": "comicine-build",
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


def verify_manifest(out_dir: str) -> int:
    """Verify manifest.json byte-for-byte against the build output and return the mismatch count.

    The deployment script calls this before ``wrangler pages deploy`` with
    ``python src/build.py --verify-manifest``. Previously, the manifest was only
    checked for existence, so manual edits, added files, and removed files after the
    build went undetected. A missing manifest or any mismatch is a failure (nonzero exit).
    """
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

