# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Pure-function tests for the build script; these do not write public/ artifacts."""

import json
import re
from pathlib import Path

import pytest

import build
from render_app import RENDER_APP


def test_preview_i18n_patch_contains_all_languages():
    patch = build.preview_i18n_patch()
    assert "zh-cn" in patch
    assert "en-us" in patch
    assert "ja-jp" in patch
    assert "ko-kr" in patch
    assert "window.__PREVIEW_I18N__" in patch


def test_render_page_switches_language():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    assert '<html lang="zh-cn">' in html
    assert "/static/" in html
    html_en = build.render_page(RENDER_APP, "index.html", "/", "en-us")
    assert '<html lang="en-us">' in html_en


def test_not_found_page_is_localized_without_a_quote_in_every_language(tmp_path):
    expected_home_labels = {
        "zh-cn": "带我回首页",
        "en-us": "Take me home",
        "ja-jp": "ホームに戻る",
        "ko-kr": "홈으로 돌아가기",
    }

    for lang, home_label in expected_home_labels.items():
        html = build.render_page(RENDER_APP, "404.html", "/404", lang)
        assert f'<html lang="{lang}">' in html
        assert home_label in html
        assert "not-found-message" not in html
        assert 'href="https://comicine.com/"' in html
        assert "not-found-countdown" not in html
        assert "/static/js/404.js" not in html

    build.write_not_found_fallback(RENDER_APP, str(tmp_path))
    fallback = (tmp_path / "404.html").read_text(encoding="utf-8")
    assert '<html lang="en-us">' in fallback


def test_services_page_defers_currency_metadata_until_needed():
    """Currency metadata is fetched on demand instead of blocking the services page first paint."""
    html = build.render_page(RENDER_APP, "services.html", "/services", "en-us")
    assert "currency-data.js" not in html

    services_js = (Path(build.BASE_DIR) / "src/static/js/services.js").read_text(encoding="utf-8")
    assert "CURRENCY_DATA_URL = '/static/js/currency-data.js?v=2'" in services_js
    assert "createElement('script')" in services_js
    # The loader is reached from the picker button and from the shared opener used by the card
    # click, the deep link, and back/forward navigation.
    assert services_js.count("loadCurrencySearchData()") >= 3
    assert services_js.count("openServiceModal(") >= 3


def test_services_currency_selection_is_persisted_and_failures_are_distinguished():
    """The chosen currency survives reloads and cached rates get their own status copy."""
    services_js = (Path(build.BASE_DIR) / "src/static/js/services.js").read_text(encoding="utf-8")
    assert "comicine-services-currency" in services_js
    assert "function readStoredCurrency" in services_js
    assert "function writeStoredCurrency" in services_js
    assert "addEventListener('storage'" in services_js
    assert "currency_cached_rates" in services_js
    assert "currency_saved_unavailable" in services_js
    # Cross-tab sync must not write the value back, or the two tabs echo it forever.
    assert "reconcileSelection(currencyData, false)" in services_js
    # A nested picker closes before the dialog underneath it on back/forward.
    assert "closeNestedLayer" in services_js

    for lang in build.LANGS:
        locale = json.loads((Path(build.LOCALES_DIR) / f"{lang}.json").read_text(encoding="utf-8"))
        for key in ("currency_cached_rates", "currency_saved_unavailable"):
            assert key in locale, (lang, key)


def test_visitor_page_reports_refresh_status_and_timeout():
    """The dashboard shows a classified failure reason and a retry button, with no refresh timestamp."""
    html = build.render_page(RENDER_APP, "visitor.html", "/visitor", "en-us")
    assert 'id="visitor-status"' in html and 'role="status"' in html
    assert 'id="visitor-status"' in html and 'aria-live="polite"' in html
    assert 'id="visitor-retry"' in html and 'data-action="refresh"' in html

    visitor_js = (Path(build.BASE_DIR) / "src/static/js/visitor.js").read_text(encoding="utf-8")
    assert "REQUEST_TIMEOUT_MS" in visitor_js
    assert "AbortController" in visitor_js
    assert "classifyFailure" in visitor_js
    # The refresh timestamp was removed on request; the status row only carries failures.
    assert "visitor_updated_at" not in visitor_js

    keys = (
        "visitor_error_timeout",
        "visitor_error_network",
        "visitor_error_auth",
        "visitor_error_forbidden",
        "visitor_error_server",
        "visitor_retry",
    )
    for lang in build.LANGS:
        locale = json.loads((Path(build.LOCALES_DIR) / f"{lang}.json").read_text(encoding="utf-8"))
        for key in keys:
            assert key in locale, (lang, key)


def test_service_and_account_pages_share_one_dialog_helper():
    """Both pages load the same classic-script helper; the Apple modals carry dialog semantics."""
    services_html = build.render_page(RENDER_APP, "services.html", "/services", "en-us")
    account_html = build.render_page(RENDER_APP, "apple-account.html", "/apple-account", "en-us")
    for html in (services_html, account_html):
        assert "/static/js/dialog.js?v=1" in html
    dialog_tag = '<script src="/static/js/dialog.js?v=1" defer></script>'
    assert services_html.index(dialog_tag) < services_html.index('<script src="/static/js/services.js')
    assert account_html.index(dialog_tag) < account_html.index('<script src="/static/js/apple-account.js')

    assert account_html.count('role="dialog"') >= 2
    assert account_html.count('aria-modal="true"') >= 2
    assert 'aria-labelledby="modal-title"' in account_html
    assert 'aria-labelledby="delete-modal-title"' in account_html
    assert 'id="toast"' in account_html and 'role="status"' in account_html

    dialog_js = (Path(build.BASE_DIR) / "src/static/js/dialog.js").read_text(encoding="utf-8")
    for token in ("window.ComiCineDialog", "Escape", "inert", "closeAll", "attr-hidden", "class-hidden"):
        assert token in dialog_js, token
    # The helper must not create announcement nodes; templates own the live regions.
    assert "createElement" not in dialog_js

    account_js = (Path(build.BASE_DIR) / "src/static/js/apple-account.js").read_text(encoding="utf-8")
    # Escape closes through the helper, so every close path must run the same cleanup.
    assert "onClose: resetAccountModal" in account_js
    assert "onClose: resetDeleteTarget" in account_js
    assert "document.body.style.overflow" not in account_js
    # Escape is delegated to the helper instead of closing both modals at once.
    assert "e.key === 'Escape'" not in account_js


def test_body_translation_dict_does_not_collide_with_i18n_markers():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    body_start = html.index("<body")
    body_open = html[body_start:html.index(">", body_start) + 1]

    assert "data-i18n-dict='" in body_open
    assert "data-i18n='" not in body_open

    base_js = Path(build.BASE_DIR) / "src/static/js/base.js"
    assert "getAttribute('data-i18n-dict')" in base_js.read_text(encoding="utf-8")


def test_home_image_urls_use_edge_cached_asset_host():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    assert "https://images.comicine.com/static/portfolio/thumbs/" in html
    assert "https://image.comicine.com/portfolio/thumbs/" not in html


def test_contact_prerenders_all_qr_images():
    html = build.render_page(RENDER_APP, "contact.html", "/contact", "zh-cn")
    preloads = re.findall(
        r'<link rel="preload" as="image" type="image/png"[^>]*href="([^"]+)"',
        html,
    )

    assert len(preloads) == 5
    assert set(preloads) == {
        "https://images.comicine.com/static/qr-codes/bilibili.png",
        "https://images.comicine.com/static/qr-codes/qq.png",
        "https://images.comicine.com/static/qr-codes/wechat.png",
        "https://images.comicine.com/static/qr-codes/mail-services-zh-cn.png",
        "https://images.comicine.com/static/qr-codes/form-services-zh-cn.png",
    }
    assert html.count('(hover: hover) and (pointer: fine)') == 5
    assert "https://image.comicine.com" not in html


def test_contact_survey_block_uses_comicine_shortlink_and_qr():
    """The survey block uses the comicine.com short link and the current language's QR code in all four locales."""
    for lang in ("zh-cn", "en-us", "ja-jp", "ko-kr"):
        html = build.render_page(RENDER_APP, "contact.html", "/contact", lang)
        block = html[html.index('id="surveyBlock"'):]
        block = block[:block.index("</a>")]

        assert f'href="https://comicine.com/link/photograph-form-{lang}"' in block
        assert f'data-qr="https://images.comicine.com/static/qr-codes/form-services-{lang}.png"' in block
        assert "https://image.comicine.com" not in html
        assert "qr-trigger" in block
        assert "lime-official.feishu.cn" not in block


def test_theme_challenge_uses_gate_url_and_skips_gate_page():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    assert 'data-gate-url="https://auth.comicine.com/__gate"' in html
    gate_html = build.render_gate(RENDER_APP, "zh-cn")
    assert 'data-gate-url=' not in gate_html
    assert 'id="nav-logo"' not in gate_html
    assert 'class="logo"' in gate_html
    assert 'class="gate-page"' in gate_html


def test_gate_mobile_logo_and_home_wordmark_fit_small_screens():
    root = Path(build.BASE_DIR)
    auth_css = (root / "src/static/css/auth.css").read_text(encoding="utf-8")
    home_css = (root / "src/static/css/index.css").read_text(encoding="utf-8")

    assert ".hero-wordmark { font-size: clamp(2.5rem, 12vw, 4rem); }" in home_css
    assert "max-width: calc(100vw - 32px);" in home_css
    assert ".logo { width: 240px; max-width: 100%; height: auto; }" in auth_css
    assert "html.gate-page" in auth_css
    assert "body.gate-page" in auth_css
    assert "overflow-y: auto" in auth_css


def test_gate_turnstile_failure_offers_a_manual_retry_and_error_code():
    root = Path(build.BASE_DIR)
    auth_js = (root / "src/static/js/auth.js").read_text(encoding="utf-8")

    assert "retry: 'never'" in auth_js
    assert "console.error('Turnstile client error', errorCode)" in auth_js
    assert "showRetry();" in auth_js


def test_visitor_inherits_base_nav_logo():
    html = build.render_page(RENDER_APP, "visitor.html", "/visitor", "zh-cn")
    logo_start = html.index('id="nav-logo"')
    logo_open_end = html.index(">", logo_start) + 1

    assert "ComiCine" in html[logo_start:html.index("</a>", logo_open_end)]
    assert 'href="https://comicine.com"' in html[html.rindex("<a", 0, logo_start):logo_open_end]


def test_static_ignore_skips_parallel_artifacts():
    ignored = build._static_ignore("/tmp/static", [
        "visitor.js",
        "visitor 2.js",
        "visitors 3.ts",
        ".DS_Store",
        "legacy.bak",
        "normal.css",
    ])
    assert ignored == {
        "visitor 2.js",
        "visitors 3.ts",
        ".DS_Store",
        "legacy.bak",
        "__pycache__",
    }


def test_nested_qr_pngs_keep_existing_public_paths(tmp_path):
    nested = tmp_path / "png"
    nested.mkdir()
    source = nested / "bilibili.png"
    source.write_bytes(b"qr-png")

    assert build.restore_qr_png_compatibility(str(tmp_path)) == 1
    assert (tmp_path / "bilibili.png").read_bytes() == b"qr-png"
    assert source.read_bytes() == b"qr-png"


def test_pages_edge_config_excludes_static_assets(tmp_path):
    build.write_pages_edge_config(str(tmp_path))

    routes = json.loads((tmp_path / "_routes.json").read_text(encoding="utf-8"))
    assert routes["version"] == 1
    assert "/static/*" in routes["exclude"]
    assert "/favicon.svg" in routes["exclude"]
    assert "/comicine.svg" in routes["exclude"]
    assert "/comicine-xtext.svg" in routes["exclude"]
    assert "/comicine-favicon.svg" in routes["exclude"]

    headers = (tmp_path / "_headers").read_text(encoding="utf-8")
    assert "Cache-Control: public, max-age=86400" in headers
    assert "Cache-Control: public, max-age=31536000, immutable" in headers
    assert "/static/icons/comicine-favicon.svg\n  ! Cache-Control\n  Cache-Control: public, max-age=0, must-revalidate" in headers
    assert "/static/icons/comicine-favicon.png\n  ! Cache-Control\n  Cache-Control: public, max-age=0, must-revalidate" in headers
    assert "/favicon.svg\n  Cache-Control: public, max-age=0, must-revalidate" in headers
    assert "stale-while-revalidate=86400" in headers


def test_brand_asset_aliases_use_the_matching_comicine_svg(tmp_path):
    build.publish_brand_assets(str(tmp_path))
    source = Path(build.STATIC_DIR) / "icons"
    expected = {
        "comicine.svg": "comicine-xtext.svg",
        "comicine-xtext.svg": "comicine-xtext.svg",
        "comicine-favicon.svg": "comicine-favicon.svg",
        "favicon.svg": "comicine-favicon.svg",
        "ComiCine-xtext.svg": "comicine-xtext.svg",
    }
    for public_name, source_name in expected.items():
        assert (tmp_path / public_name).read_bytes() == (source / source_name).read_bytes()


def test_templates_use_the_correct_logo_variant():
    home = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    services = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")
    contact = build.render_page(RENDER_APP, "contact.html", "/contact", "zh-cn")
    gate = build.render_page(RENDER_APP, "auth.html", "/gate", "zh-cn")

    assert '<span class="nav-brand brand-word">ComiCine</span>' in home
    assert '<span class="brand-word hero-wordmark">ComiCine</span>' in home
    assert "hero-logo" not in home
    assert 'content="https://images.comicine.com/static/icons/comicine-xtext.svg?v=5"' in home
    assert 'content="https://images.comicine.com/static/icons/comicine-xtext.png?v=5"' in home
    assert home.count('property="og:image:width" content="5250"') == 2
    assert 'href="/static/icons/comicine-favicon.svg?v=13"' in gate
    assert 'src="https://images.comicine.com/static/icons/comicine-xtext.svg?v=5" alt="ComiCine" width="525" height="150"' in gate
    assert "https://image.comicine.com" not in home + services + contact + gate
    assert "data-image-watermark-base" not in home
    assert "/static/js/base.js?v=22" in home
    assert 'data-brandify="ComiCine"' in gate
    assert 'href="/static/fonts-round75.css?v=5"' in home
    # Both fonts are embedded in fonts-round75.css, so the old Delius preload (and its separate
    # network fetch that flashed the fallback face) is gone on purpose.
    assert 'delius-swash-caps-copyright.woff2' not in home
    font_css = (Path(build.BASE_DIR) / "src/static/fonts-round75.css").read_text(encoding="utf-8")
    assert "font-family: 'Delius Swash Caps'" in font_css
    assert "data:font/woff2;base64," in font_css
    assert '<span class="footer-item footer-copyright">&copy; <span data-copyright-years data-copyright-start-year="2026">2026</span> <span class="brand-word">ComiCine</span></span>' in services
    assert "-ComiCine-" not in contact
    assert '<span class="brand-word">ComiCine</span>' in contact
    base_css = (Path(build.STATIC_DIR) / "css" / "base.css").read_text(encoding="utf-8")
    home_css = (Path(build.STATIC_DIR) / "css" / "index.css").read_text(encoding="utf-8")
    assert "font-family: 'Delius Swash Caps'" in base_css
    assert ".nav-brand" in base_css and "color: var(--text)" in base_css
    assert ".footer-copyright .brand-word" in base_css
    auth_css = (Path(build.STATIC_DIR) / "css" / "auth.css").read_text(encoding="utf-8")
    assert ".foot .brand-word" in auth_css and "font-size: 1.3em;" in auth_css
    assert ".hero-wordmark" in home_css and "color: var(--text)" in home_css
    assert 'rel="icon" href="https://images.comicine.com/static/icons/comicine-favicon.svg?v=13"' in home
    assert 'rel="apple-touch-icon" href="https://images.comicine.com/static/icons/comicine-favicon.png?v=13"' in home
    assert 'ComiCine</span>' in home


def test_delius_brand_font_is_self_hosted():
    font = Path(build.STATIC_DIR) / "fonts" / "delius-swash-caps" / "delius-swash-caps-copyright.woff2"
    stylesheet = Path(build.STATIC_DIR) / "fonts-round75.css"

    assert font.is_file()
    assert font.stat().st_size < 5000
    assert "font-family: 'Delius Swash Caps'" in stylesheet.read_text(encoding="utf-8")


def test_discovery_files_are_ungated_and_allow_crawlers(tmp_path):
    """robots.txt and llms.txt bypass Functions, and robots.txt allows crawlers (2026-10-12).

    Regression context: both files once returned 404 (unverified visitors instead saw
    a 403 challenge page), effectively announcing that the site could not be crawled.
    """
    build.write_pages_edge_config(str(tmp_path))
    build.write_discovery_files(str(tmp_path))

    routes = json.loads((tmp_path / "_routes.json").read_text(encoding="utf-8"))
    assert "/robots.txt" in routes["exclude"]
    assert "/llms.txt" in routes["exclude"]
    headers = (tmp_path / "_headers").read_text(encoding="utf-8")
    assert headers.count("/robots.txt\n") == 1
    assert headers.count("/llms.txt\n") == 1

    # Crawler rules are copied from docs/lists/robots.txt; the builder uses config-contract.json
    # to add the Sitemap line and avoid maintaining the domain in two places.
    source = Path(build.ROBOTS_SOURCE).read_text(encoding="utf-8")
    published = (tmp_path / "robots.txt").read_text(encoding="utf-8")
    assert published == f"{source.rstrip()}\n\nSitemap: https://{build.ROOT_DOMAIN}/sitemap.xml\n"
    assert "User-agent: *\nAllow: /\n" in source
    for agent in ("GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "Applebot-Extended"):
        assert f"User-agent: {agent}\n" in source
    assert "Disallow: /api/\n" in source

    llms = (tmp_path / "llms.txt").read_text(encoding="utf-8")
    assert llms.startswith("# ComiCine\n")
    assert "https://docs.comicine.com/sitemap.xml" in llms
    sitemap = (tmp_path / "sitemap.xml").read_text(encoding="utf-8")
    for host in (
        build.ROOT_DOMAIN,
        build.SERVICES_HOST,
        build.CONTACT_HOST,
        build.IMAGE_ASSET_HOST,
    ):
        assert f"https://{host}/" in sitemap


def test_mcp_is_not_advertised_and_stays_disallowed(tmp_path):
    """MCP stays private: llms.txt, robots.txt and the gate must keep saying so.

    The policy decision is minimum exposure, so this test pins the two discovery
    surfaces: /llms.txt must not advertise the endpoint, and /robots.txt must keep
    disallowing it in every rules group. The gate side is covered by
    functions/mcp.test.ts, which asserts /mcp stays non-exempt.
    """
    build.write_discovery_files(str(tmp_path))

    llms = (tmp_path / "llms.txt").read_text(encoding="utf-8")
    assert "mcp" not in llms.lower()

    source = Path(build.ROBOTS_SOURCE).read_text(encoding="utf-8")
    assert "Allow: /mcp" not in source
    assert source.count("Disallow: /mcp") == source.count("Allow: /")


def test_robots_source_guard_rejects_a_broken_file(tmp_path, monkeypatch):
    """The build must fail if the source is empty or malformed because it also controls crawler exemptions."""
    broken = tmp_path / "robots.txt"
    broken.write_text("# nothing here\n", encoding="utf-8")
    monkeypatch.setattr(build, "ROBOTS_SOURCE", str(broken))

    with pytest.raises(RuntimeError, match="robots.txt source"):
        build.write_discovery_files(str(tmp_path))


def test_remove_bad_artifacts(tmp_path):
    root = tmp_path / "static"
    root.mkdir()
    (root / ".DS_Store").write_bytes(b"")
    (root / "visitor 2.js").write_text("old", encoding="utf-8")
    (root / "visitor.js").write_text("new", encoding="utf-8")

    build._remove_bad_artifacts(str(root))

    assert not (root / ".DS_Store").exists()
    assert not (root / "visitor 2.js").exists()
    assert (root / "visitor.js").read_text(encoding="utf-8") == "new"


# W1: The contract is not active.


def test_html_lang_is_rendered_by_the_template_for_every_language():
    """W1-4: The template renders <html lang> directly and correctly for all four locales."""
    for lang in build.LANGS:
        html = build.render_page(RENDER_APP, "index.html", "/", lang)
        assert f'<html lang="{lang}">' in html
        assert f'data-lang="{lang}"' in html

        gate = build.render_gate(RENDER_APP, lang)
        assert f'<html lang="{lang}" class="gate-page">' in gate
        assert f'data-lang="{lang}"' in gate

    # Templates must not hardcode zh-cn; the contract default_lang is en-us.
    for name in ("base.html", "auth.html", "redirect.html", "preview.html"):
        source = (Path(build.BASE_DIR) / "src/templates" / name).read_text(encoding="utf-8")
        assert '<html lang="zh-cn">' not in source, name
        expected = (
            '<html lang="{{ g.lang }}" class="gate-page">'
            if name == "auth.html"
            else '<html lang="{{ g.lang }}">'
        )
        assert expected in source, name

    # The build script no longer replaces the <html lang> string.
    build_py = (Path(build.BASE_DIR) / "src/build.py").read_text(encoding="utf-8")
    assert '<html lang=\\"zh-cn\\">' not in build_py


def test_validate_redirect_copy_fails_loudly_on_missing_key(monkeypatch):
    """W1-2: Missing redirect copy must raise RuntimeError instead of silently falling back to Chinese."""
    complete = build.load_translations()
    broken = {lang: dict(data) for lang, data in complete.items()}
    del broken["en-us"]["redirect_title"]
    monkeypatch.setattr(build, "load_translations", lambda: broken)

    try:
        build.validate_redirect_copy()
    except RuntimeError as exc:
        assert "redirect_title" in str(exc)
        assert "en-us.json" in str(exc)
    else:  # pragma: no cover - Reached only when the contract is invalid.
        raise AssertionError("missing redirect_title must raise RuntimeError")


def test_validate_redirect_copy_fails_on_empty_value(monkeypatch):
    """An empty string is as unusable as a missing key; the redirect shell would render blank copy."""
    complete = build.load_translations()
    broken = {lang: dict(data) for lang, data in complete.items()}
    broken["ko-kr"]["redirect_text"] = ""
    monkeypatch.setattr(build, "load_translations", lambda: broken)

    try:
        build.validate_redirect_copy()
    except RuntimeError as exc:
        assert "redirect_text" in str(exc)
        assert "ko-kr.json" in str(exc)
    else:  # pragma: no cover - Reached only when the contract is invalid.
        raise AssertionError("empty redirect_text must raise RuntimeError")


def test_validate_redirect_copy_accepts_complete_locales():
    build.validate_redirect_copy()
    for lang in build.LANGS:
        redirect = build._require_locale_keys(lang, build.REDIRECT_I18N_KEYS)
        assert redirect["title"] and redirect["text"]
        assert redirect["footer_rights"] and redirect["footer_source"]
        assert redirect["footer_source_link"]
        gate = build._require_locale_keys(lang, build.GATE_I18N_KEYS)
        assert gate["title"] and gate["footer_rights"]


def test_write_runtime_functions_emits_no_redirect_table(tmp_path, monkeypatch):
    """The redirect shell is prerendered, so runtime.ts carries gate copy and preload assets only."""
    monkeypatch.setattr(build, "FUNCTIONS_DIR", str(tmp_path))

    build.write_runtime_functions()

    source = (tmp_path / "_data" / "runtime.ts").read_text(encoding="utf-8")
    assert "export const GATE_I18N" in source
    assert "export const REDIRECT_PRELOAD_IMAGES" in source
    assert "REDIRECT_I18N" not in source


def test_validate_locale_completeness_catches_html_footer_drift():
    """W1-2: Because _() in _footer.html falls back to Chinese, missing keys must fail the build."""
    complete = build.load_translations()
    broken = {lang: dict(data) for lang, data in complete.items()}
    del broken["ko-kr"]["footer_rights"]
    try:
        build.validate_locale_completeness(broken)
    except RuntimeError as exc:
        assert "ko-kr.json" in str(exc)
        assert "footer_rights" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("missing footer_rights must raise RuntimeError")

    # All four repository locales must be complete, or the build fails.
    build.validate_locale_completeness(complete)


def test_frontend_reads_contract_facts_from_data_attributes():
    """W1-3: The build injects the language list, cookie names and TTL, and root domain; JavaScript only reads them."""
    html = build.render_page(RENDER_APP, "index.html", "/", "en-us")
    body_open = html[html.index("<body"):html.index(">", html.index("<body")) + 1]

    assert f'data-supported-langs="{" ".join(build.LANGS)}"' in body_open
    assert f'data-root-domain="{build.ROOT_DOMAIN}"' in body_open
    assert 'data-lang-cookie="user_lang_preference"' in body_open
    assert 'data-theme-cookie="comicine_theme"' in body_open
    assert 'data-lang-cookie-max-age="31536000"' in body_open
    assert 'data-theme-cookie-max-age="31536000"' in body_open
    assert 'data-default-lang="en-us"' in body_open

    # The gate page (auth.html, which does not inherit base.html) must expose the same attributes.
    gate = build.render_gate(RENDER_APP, "en-us")
    gate_body = gate[gate.index("<body"):gate.index(">", gate.index("<body")) + 1]
    assert f'data-supported-langs="{" ".join(build.LANGS)}"' in gate_body
    assert 'data-lang-cookie="user_lang_preference"' in gate_body

    # The contract generates the language-menu entries: one entry for each supported_langs item.
    for lang in build.LANGS:
        page = build.render_page(RENDER_APP, "index.html", "/", lang)
        menu = page[page.index('id="langMenu"'):page.index("</nav>")]
        assert menu.count('data-action="setLang"') == len(build.LANGS)
        for code in build.LANGS:
            assert f'data-lang="{code}"' in menu
        assert f'class="theme-option selected" data-lang="{lang}"' in menu

    # The gate page language menu is generated from the contract too.
    gate_menu = gate[gate.index('id="langMenu"'):]
    assert gate_menu.count('data-action="setLang"') == 2 * len(build.LANGS)
    assert gate_menu.count('class="nav-screen-language-option') == len(build.LANGS)


def test_frontend_js_has_no_hardcoded_language_list_or_cookie_ttl():
    """W1-3: JavaScript must read data-* attributes instead of hard-coding languages, cookie names, or TTLs."""
    js_dir = Path(build.BASE_DIR) / "src/static/js"
    base_js = (js_dir / "base.js").read_text(encoding="utf-8")
    auth_js = (js_dir / "auth.js").read_text(encoding="utf-8")

    for source, name in ((base_js, "base.js"), (auth_js, "auth.js")):
        assert "data-default-lang" in source, name
        assert "data-lang-cookie" in source, name
        assert "data-theme-cookie" in source, name
        assert "data-root-domain" in source, name
        assert "['zh-cn', 'en-us', 'ja-jp', 'ko-kr']" not in source, name
        assert "max-age=31536000; SameSite=Lax" not in source, name
        assert "'user_lang_preference='" not in source, name
        assert "'comicine_theme='" not in source, name
    # Only base.js needs the language list for prefetching; it also comes from data-*.
    assert "data-supported-langs" in base_js


def test_preview_localization_uses_contract_domains(monkeypatch):
    """W1-5: Preview rewrites use contract constants, so domain changes propagate instead of hard-coding comicine.com."""
    patterns = build.preview_localization_patterns()
    sample = (
        '<img src="https://comicine.com/static/icons/comicine-xtext.svg">'
        '<img src="https://images.comicine.com/static/icons/comicine-xtext.svg">'
        '<img src="https://image.comicine.com/portfolio/IMG_0115.webp">'
        '<a href="https://services.comicine.com/services">x</a>'
        '<a href="https://comicine.com/services">y</a>'
    )
    localized = patterns["asset"].sub(r'\1="../static/', sample)
    localized = build.rewrite_preview_srcsets(localized, patterns)
    assert 'src="../static/icons/comicine-xtext.svg"' in localized
    assert 'src="../static/portfolio/IMG_0115.webp"' in localized
    assert "https://" not in localized.split("<a")[0]

    srcset = (
        'srcset="https://images.comicine.com/static/portfolio/thumbs/a-480.avif 480w, '
        'https://images.comicine.com/static/portfolio/thumbs/a-640.avif 640w"'
    )
    localized_srcset = build.rewrite_preview_srcsets(srcset, patterns)
    assert localized_srcset == (
        'srcset="../static/portfolio/thumbs/a-480.avif 480w, '
        '../static/portfolio/thumbs/a-640.avif 640w"'
    )

    pages = dict(build.preview_subdomain_pages())
    assert pages[build.SERVICES_HOST] == "services.html"
    assert pages[build.CONTACT_HOST] == "contact.html"
    assert pages[build.APPLE_ACCOUNT_HOST] == "apple-account.html"
    for host in pages:
        assert host.endswith("." + build.ROOT_DOMAIN)

    # After changing the contract root domain, the old-domain rule must no longer rewrite the same HTML.
    monkeypatch.setattr(build, "ROOT_DOMAIN", "example.com")
    monkeypatch.setattr(build, "SERVICES_HOST", "services.example.com")
    monkeypatch.setattr(build, "IMAGE_ASSET_HOST", "images.example.com")
    monkeypatch.setattr(build, "IMAGE_WATERMARK_HOST", "image.example.com")
    swapped = build.preview_localization_patterns()
    assert swapped["asset"].sub(r'\1="../static/', sample) == sample
    assert dict(build.preview_subdomain_pages())[build.SERVICES_HOST] == "services.html"
    assert swapped["root_href"].search('href="https://example.com/"')
    assert not swapped["root_href"].search('href="https://comicine.com/"')


def test_lang_options_follow_the_contract_at_call_time(monkeypatch):
    """W1-3: Read the language list from the contract at call time and key the cache by that list.

    Regression context: `_cached_lang_options` used to be an argument-free maxsize=1
    cache and captured `SUPPORTED_LANGS` at import time. Rendering then kept using the
    old list after the contract was monkeypatched, producing a false pass.
    """
    import config
    import render_app

    monkeypatch.setattr(config, "SUPPORTED_LANGS", ("aa-aa", "bb-bb"))
    html = build.render_page(render_app.RENDER_APP, "index.html", "/", "aa-aa")

    assert 'data-supported-langs="aa-aa bb-bb"' in html
    assert html.count('class="theme-option') == 2
    assert html.count('class="nav-screen-language-option') == 2
    assert 'class="theme-option selected" data-lang="aa-aa"' in html
    assert 'class="theme-option" data-lang="bb-bb"' in html
    assert 'class="nav-screen-language-option selected" data-lang="aa-aa"' in html
    assert 'class="nav-screen-language-option" data-lang="bb-bb"' in html
    # Derive the flag from the region subtag and use the primary-language subtag for the copy key.
    options = render_app._cached_lang_options(("aa-aa", "bb-bb"))
    assert [o["code"] for o in options] == ["aa-aa", "bb-bb"]
    assert [o["label_key"] for o in options] == ["lang_aa", "lang_bb"]
    assert options[0]["flag"]  # Any regional indicator, such as 🇦🇦, is sufficient.

    # Restoring the contract value must not reuse the previous cache entry.
    monkeypatch.undo()
    options = render_app._cached_lang_options(tuple(config.SUPPORTED_LANGS))
    assert [o["code"] for o in options] == list(build.LANGS)


def test_shared_ui_loads_before_the_page_script_it_backs():
    """base.js and auth.js call window.ComiCineUI at load, so shared-ui.js must come first.

    The dependency is a plain classic script on purpose: it keeps CSP at script-src 'self'
    without a module graph, which makes execution order depend on the template order.
    """
    home = build.render_page(RENDER_APP, "index.html", "/", "en-us")
    gate = build.render_page(RENDER_APP, "auth.html", "/gate", "en-us")

    assert home.index("/static/js/shared-ui.js?v=2") < home.index("/static/js/base.js?v=22")
    assert gate.index("/static/js/shared-ui.js?v=2") < gate.index("/static/js/auth.js?v=14")


def test_navigation_menu_aria_contract_is_rendered():
    """Suggestion 44: triggers declare their menu, menus start hidden, current page is marked."""
    home = build.render_page(RENDER_APP, "index.html", "/", "en-us")

    assert 'aria-controls="langMenu"' in home
    lang_menu = home[home.index('id="langMenu"'):]
    lang_menu_open_tag = lang_menu[:lang_menu.index(">") + 1]
    assert 'aria-hidden="true"' in lang_menu_open_tag
    assert 'class="nav-link active" aria-current="page"' in home
    assert 'class="nav-screen-link active" aria-current="page"' in home


def test_current_page_marking_follows_the_served_template():
    """Task 44: each host serves its own prerendered page, so the baked nav marks that page.

    pageAsset() maps host + path to a template; the path baked into that template decides the
    current item. Marking Home active on services.comicine.com would make aria-current lie.
    """
    home = build.render_page(RENDER_APP, "index.html", "/", "en-us")
    services = build.render_page(RENDER_APP, "services.html", "/services", "en-us")

    def nav_link_tag(html, href):
        for match in re.finditer(r'<a href="([^"]+)" class="nav-link[^"]*"[^>]*>', html):
            if match.group(1) == href:
                return match.group(0)
        raise AssertionError("missing nav link " + href)

    assert 'aria-current="page"' in nav_link_tag(home, "https://comicine.com")
    assert 'aria-current="page"' not in nav_link_tag(services, "https://comicine.com")
    assert 'aria-current="page"' in nav_link_tag(services, "https://services.comicine.com")
    assert 'aria-current="page"' not in nav_link_tag(services, "https://contact.comicine.com")


def test_selected_language_carries_aria_current_in_rendered_markup():
    html = build.render_page(RENDER_APP, "index.html", "/", "en-us")
    selected = re.findall(r'<a [^>]*class="theme-option selected"[^>]*>', html)
    assert len(selected) == 1
    assert 'aria-current="page"' in selected[0]
    assert 'class="theme-option" data-lang="zh-cn"' in html
