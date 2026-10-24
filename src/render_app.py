# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Read-only Limooo rendering application used during builds.

Static page builds do not need to start the Flask business application, read production
secrets, create a SQLite database, or initialize routes. This module provides a minimal
Flask app with only the i18n context required by templates for prerendering in
``src/build.py``.
"""

from __future__ import annotations

import functools
from datetime import UTC, datetime

from flask import Flask, g

# Contract values follow the same rule: read the language list, cookie names
# and TTLs, and root domain from the config module **at call time**. Binding
# these at import time would make tests that monkeypatch config.SUPPORTED_LANGS
# receive a stale list. lru_cache would preserve the stale result, causing
# rendering tests to pass incorrectly and new languages not to take effect.
# W1-3's rule that adding a language only changes the contract depends on this.
import config

# Read SERVICES_DIR from the module **at call time** instead of binding it at
# import time. The build cache uses it as a key, and tests monkeypatch
# services_pricing.SERVICES_DIR to point to a temporary CSV directory. Binding
# it at import time would make the cache always use the repository's CSV and
# let tests pass incorrectly. Verified on 2026-10-11: rendering tests used real
# CSV prices during the full pytest run.
import services_pricing
from config import (
    DEFAULT_LANG,
    KEY_FALLBACK_LANG,
    STATIC_DIR,
    TEMPLATES_DIR,
    load_translations,
)
from portfolio import portfolio_items, portfolio_source_dir
from services_pricing import load_pricing


@functools.cache
def _cached_portfolio_items(source_dir: str) -> list[dict[str, object]]:
    """Return portfolio cards, scanning ``src/static/portfolio`` only once per build.

    ``portfolio_items()`` opens each source with ``PIL.Image.open`` to read its size,
    while the context processor runs once per page. Before caching, one build called
    it 33 times (four languages x eight pages plus the gate page). Build output must
    remain byte-for-byte reproducible, so this only memoizes the result and does not
    change ``portfolio.portfolio_items`` output.

    The source directory is an explicit argument, read by the caller with
    ``portfolio_source_dir()``, rather than a module constant captured in a closure.
    Tests that replace ``STATIC_DIR`` or ``SERVICES_DIR`` in one process must produce
    a cache miss automatically, or they could silently read a previous test's temp dir.
    """
    return portfolio_items(source_dir)


@functools.cache
def _cached_pricing(services_dir: str) -> dict[str, object]:
    """Load each ``docs/services/*.csv`` directory once instead of once per render.

    As above, ``services_dir`` is part of the cache key, so changing directories reloads the data.
    """
    return load_pricing(services_dir)


def _lang_flag(code: str) -> str:
    """Map a language region subtag to a flag emoji (zh-cn to 🇨🇳), or return an empty string if absent.

    Language codes come from the contract's supported_langs; none are hard-coded here.
    Adding a language only requires changing the contract, and the menu gains an item
    automatically. Its label key uses the primary language subtag, such as lang_<primary>.
    """
    parts = code.split("-")
    if len(parts) < 2 or len(parts[1]) != 2 or not parts[1].isalpha():
        return ""
    region = parts[1].upper()
    return "".join(chr(0x1F1E6 + ord(ch) - ord("A")) for ch in region)


@functools.cache
def _cached_lang_options(supported_langs: tuple[str, ...]) -> list[dict[str, str]]:
    """Return language-menu data from the contract's supported_langs; the template only renders it.

    ``supported_langs`` is an explicit argument, read by the caller from
    ``config.SUPPORTED_LANGS``. It is both the data source and cache key, so contract
    changes and test monkeypatches trigger recomputation automatically. This prevents
    stale cached language lists from hiding changes, following the same pattern as
    ``_cached_pricing(services_dir)`` and ``_cached_portfolio_items(source_dir)``.
    """
    return [
        {
            "code": code,
            "flag": _lang_flag(code),
            "label_key": f"lang_{code.split('-')[0]}",
        }
        for code in supported_langs
    ]


def create_render_app() -> Flask:
    """Create a Flask app containing only templates and the i18n context."""
    app = Flask(
        __name__,
        template_folder=str(TEMPLATES_DIR),
        static_folder=str(STATIC_DIR),
    )
    translations = load_translations()

    def translate(key: str, **kwargs: object) -> str:
        lang = getattr(g, "lang", DEFAULT_LANG)
        value = translations.get(lang, {}).get(
            key,
            translations.get(KEY_FALLBACK_LANG, {}).get(key, key),
        )
        if kwargs:
            try:
                return str(value).format(**kwargs)
            except (KeyError, IndexError, ValueError):
                return value
        return value

    @app.context_processor
    def inject_i18n() -> dict[str, object]:
        # Read the contract from config module attributes for each render instead
        # of using copies bound at import time. Test monkeypatches to config.*
        # must take effect immediately.
        contract_langs = tuple(config.SUPPORTED_LANGS)
        lang = getattr(g, "lang", config.DEFAULT_LANG)
        return {
            "_": translate,
            "translations": translations.get(lang, {}),
            "gate_url": f"https://{config.GATE_HOST}/__gate",
            "image_asset_base": config.IMAGE_ASSET_BASE_URL,
            "image_watermark_base": config.IMAGE_WATERMARK_BASE_URL,
            "services_host": config.SERVICES_HOST,
            "contact_host": config.CONTACT_HOST,
            "source_url": config.SOURCE_REPO_URL,
            "copyright_current_year": datetime.now(UTC).year,
            # Frontend read-only values (language list, cookie names and TTLs,
            # and root domain) all come from the contract. _lang_attrs.html
            # injects them into <body data-*> so JavaScript has no hardcoded
            # copies (W1-3).
            "root_domain": config.ROOT_DOMAIN,
            "default_lang": config.DEFAULT_LANG,
            "supported_langs": list(contract_langs),
            "lang_cookie": config.LANG_COOKIE,
            "lang_cookie_max_age": config.LANG_COOKIE_MAX_AGE,
            "theme_cookie": config.THEME_COOKIE,
            "theme_cookie_max_age": config.THEME_COOKIE_MAX_AGE,
            "lang_options": _cached_lang_options(contract_langs),
            # Portfolio card count is determined by images in
            # src/static/portfolio. portfolio_source_dir() reads
            # portfolio.STATIC_DIR at call time, so the cache key changes too.
            "portfolio_items": _cached_portfolio_items(portfolio_source_dir()),
            # Pricing comes from docs/services/*.csv; changing prices requires
            # no template edits.
            "pricing": _cached_pricing(services_pricing.SERVICES_DIR),
        }

    return app


RENDER_APP = create_render_app()
