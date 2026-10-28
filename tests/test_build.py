# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Pure-function tests for the build script; these do not write public/ artifacts."""

import json
import re
from html import unescape
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


def test_not_found_page_matches_reference_copy_in_every_language(tmp_path):
    expected_quotes = {
        "zh-cn": "但如果你不改变方向，仍继续寻找，最终可能会到达自己正前往的地方。",
        "en-us": "But if you don't change your direction, and if you keep looking, you may end up where you are heading.",
        "ja-jp": "しかし、進む方向を変えずに探し続けると、向かっている場所にたどり着くかもしれません。",
        "ko-kr": "하지만 방향을 바꾸지 않고 계속 찾아가면, 결국 자신이 향하던 곳에 도착할지도 모릅니다.",
    }
    expected_home_labels = {
        "zh-cn": "带我回首页",
        "en-us": "Take me home",
        "ja-jp": "ホームに戻る",
        "ko-kr": "홈으로 돌아가기",
    }

    for lang, quote in expected_quotes.items():
        html = build.render_page(RENDER_APP, "404.html", "/404", lang)
        assert f'<html lang="{lang}">' in html
        assert quote in unescape(html)
        assert expected_home_labels[lang] in html
        assert 'href="https://comicine.com/"' in html
        assert "not-found-countdown" not in html
        assert "/static/js/404.js" not in html

    build.write_not_found_fallback(RENDER_APP, str(tmp_path))
    fallback = (tmp_path / "404.html").read_text(encoding="utf-8")
    assert '<html lang="en-us">' in fallback


def test_services_page_loads_currency_metadata_before_currency_ui():
    html = build.render_page(RENDER_APP, "services.html", "/services", "en-us")

    metadata_script = html.index("/static/js/currency-data.js")
    currency_ui_script = html.index("/static/js/services.js")
    assert metadata_script < currency_ui_script


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
        r'<link rel="preload" as="image" type="image/webp"[^>]*href="([^"]+)"',
        html,
    )

    assert len(preloads) == 5
    assert set(preloads) == {
        "https://image.comicine.com/qr-codes/bilibili.webp",
        "https://image.comicine.com/qr-codes/qq.webp",
        "https://image.comicine.com/qr-codes/wechat.webp",
        "https://image.comicine.com/qr-codes/mail-services-zh-cn.webp",
        "https://image.comicine.com/qr-codes/form-services-zh-cn.webp",
    }
    assert html.count('(hover: hover) and (pointer: fine)') == 5


def test_contact_survey_block_uses_limooo_shortlink_and_qr():
    """The survey block uses the comicine.com short link and the current language's QR code in all four locales."""
    for lang in ("zh-cn", "en-us", "ja-jp", "ko-kr"):
        html = build.render_page(RENDER_APP, "contact.html", "/contact", lang)
        block = html[html.index('id="surveyBlock"'):]
        block = block[:block.index("</a>")]

        assert f'href="https://comicine.com/link/photograph-form-{lang}"' in block
        assert f'data-qr="https://image.comicine.com/qr-codes/form-services-{lang}.webp"' in block
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


def test_gate_mobile_logo_matches_home_and_page_can_scroll():
    root = Path(build.BASE_DIR)
    auth_css = (root / "src/static/css/auth.css").read_text(encoding="utf-8")
    home_css = (root / "src/static/css/index.css").read_text(encoding="utf-8")

    assert ".hero-title { width: 144px; }" in home_css
    assert "aspect-ratio: 1 / 1;" in home_css
    assert ".logo { width: 144px; height: auto; max-width: 144px; }" in auth_css
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
    assert "stale-while-revalidate=86400" in headers


def test_brand_asset_aliases_use_the_matching_comicine_svg(tmp_path):
    build.publish_brand_assets(str(tmp_path))
    source = Path(build.STATIC_DIR) / "icons"
    expected = {
        "comicine.svg": "comicine.svg",
        "comicine-xtext.svg": "comicine-xtext.svg",
        "comicine-favicon.svg": "comicine-favicon.svg",
        "favicon.svg": "comicine-favicon.svg",
        "Limooo-xtext.svg": "comicine-xtext.svg",
        "ComiCine-xtext.svg": "comicine-xtext.svg",
    }
    for public_name, source_name in expected.items():
        assert (tmp_path / public_name).read_bytes() == (source / source_name).read_bytes()


def test_templates_use_the_correct_logo_variant():
    home = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    gate = build.render_page(RENDER_APP, "auth.html", "/gate", "zh-cn")

    assert 'src="https://images.comicine.com/static/icons/comicine-favicon.svg?v=3"' not in home
    assert 'src="https://images.comicine.com/static/icons/comicine.svg?v=5"' in home
    assert 'class="hero-logo" src="https://images.comicine.com/static/icons/comicine.svg?v=5" alt="ComiCine" width="288" height="288"' in home
    assert 'src="https://images.comicine.com/static/icons/comicine-xtext.svg?v=2"' in home
    assert 'content="https://images.comicine.com/static/icons/comicine.png?v=5"' in home
    assert 'href="/static/icons/comicine-favicon.svg?v=3"' in gate
    assert 'src="https://images.comicine.com/static/icons/comicine.svg?v=5"' in gate
    assert 'src="https://images.comicine.com/static/icons/comicine-xtext.svg?v=2"' in gate


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


def test_require_locale_keys_fails_loudly_on_missing_key(monkeypatch):
    """W1-2: Missing redirect copy must raise RuntimeError instead of silently falling back to Chinese."""
    complete = build.load_translations()
    broken = {lang: dict(data) for lang, data in complete.items()}
    del broken["en-us"]["redirect_title"]
    monkeypatch.setattr(build, "load_translations", lambda: broken)

    try:
        build._require_locale_keys("en-us", build.REDIRECT_I18N_KEYS)
    except RuntimeError as exc:
        assert "redirect_title" in str(exc)
        assert "en-us.json" in str(exc)
    else:  # pragma: no cover - Reached only when the contract is invalid.
        raise AssertionError("missing redirect_title must raise RuntimeError")


def test_require_locale_keys_accepts_complete_locales():
    for lang in build.LANGS:
        redirect = build._require_locale_keys(lang, build.REDIRECT_I18N_KEYS)
        assert redirect["title"] and redirect["text"]
        assert redirect["footer_rights"] and redirect["footer_source"]
        assert redirect["footer_source_link"]
        gate = build._require_locale_keys(lang, build.GATE_I18N_KEYS)
        assert gate["title"] and gate["footer_rights"]


def test_write_runtime_functions_refuses_to_fall_back_to_chinese(tmp_path, monkeypatch):
    """W1-2: write_runtime_functions fails on a missing key instead of generating runtime.ts with a Chinese fallback."""
    complete = build.load_translations()
    broken = {lang: dict(data) for lang, data in complete.items()}
    del broken["ja-jp"]["footer_source_link"]
    monkeypatch.setattr(build, "load_translations", lambda: broken)
    monkeypatch.setattr(build, "FUNCTIONS_DIR", str(tmp_path))

    try:
        build.write_runtime_functions()
    except RuntimeError as exc:
        assert "footer_source_link" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("missing footer_source_link must raise RuntimeError")
    assert not (tmp_path / "_data" / "runtime.ts").exists()


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
        '<img src="https://comicine.com/static/icons/comicine.svg">'
        '<img src="https://images.comicine.com/static/icons/comicine.svg">'
        '<img src="https://image.comicine.com/portfolio/IMG_0115.webp">'
        '<a href="https://services.comicine.com/services">x</a>'
        '<a href="https://comicine.com/services">y</a>'
    )
    localized = patterns["asset"].sub(r'\1="../static/', sample)
    localized = build.rewrite_preview_srcsets(localized, patterns)
    assert 'src="../static/icons/comicine.svg"' in localized
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
