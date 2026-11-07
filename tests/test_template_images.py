# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Image markup rules: alt text, intrinsic size, decoding hints, and loading policy."""

import re
from pathlib import Path

import build
from render_app import RENDER_APP

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "src" / "templates"

IMG_TAG = re.compile(r"<img\b[^>]*>", re.IGNORECASE)
ATTRIBUTE = re.compile(r'([-\w:]+)\s*=\s*"([^"]*)"')

# The gate page wordmark is the only image inside the first screen (it sits above the
# Turnstile widget). It must stay eager: an absent loading attribute already means eager,
# so only no attribute or explicit eager passes. Keyed by the img class because the alt
# text and asset URL are localized/contract-driven.
FIRST_SCREEN_IMAGES = {("auth.html", "logo")}

# Template images are an audited inventory: one portfolio card, the gate wordmark, and the
# contact QR overlay. A new count means a new image must be audited first; update this
# constant afterwards.
TEMPLATE_IMAGE_COUNT = 3


def _attributes(tag: str) -> dict[str, str]:
    """Return the double-quoted attributes of a start tag, with lower-cased names."""
    return {name.lower(): value for name, value in ATTRIBUTE.findall(tag)}


def _is_svg(attributes: dict[str, str]) -> bool:
    """True for SVG sources; the portfolio and QR images use WebP/PNG data-src values."""
    source = attributes.get("src") or attributes.get("data-src") or ""
    return source.split("?", 1)[0].lower().endswith(".svg")


def _check(template: str, tag: str) -> None:
    attributes = _attributes(tag)
    label = f"{template} image {tag!r}"

    assert attributes.get("alt", "").strip(), f"{label}: missing alt text"
    assert attributes.get("width", "").strip(), f"{label}: missing width"
    assert attributes.get("height", "").strip(), f"{label}: missing height"
    assert attributes.get("src") != "", f"{label}: empty src attribute"

    loading = attributes.get("loading")
    assert loading in (None, "lazy", "eager"), f"{label}: loading={loading!r} is not lazy/eager"
    if (template, attributes.get("class")) in FIRST_SCREEN_IMAGES:
        assert loading in (None, "eager"), f"{label}: first-screen image must stay eager"

    if not _is_svg(attributes):
        assert attributes.get("decoding") == "async", f"{label}: raster image needs decoding=async"


def test_template_images_follow_the_rules():
    tags = []
    for path in sorted(TEMPLATES.glob("*.html")):
        for tag in IMG_TAG.findall(path.read_text(encoding="utf-8")):
            _check(path.name, tag)
            tags.append(tag)

    assert len(tags) == TEMPLATE_IMAGE_COUNT, (
        f"template image inventory changed ({len(tags)} img tags); "
        f"audit the new image and update TEMPLATE_IMAGE_COUNT ({TEMPLATE_IMAGE_COUNT})"
    )


def test_rendered_images_follow_the_rules():
    for lang in build.LANGS:
        for template, _filename, path, extra in build.PAGES:
            html = build.render_page(RENDER_APP, template, path, lang, extra)
            for tag in IMG_TAG.findall(html):
                _check(template, tag)
        for tag in IMG_TAG.findall(build.render_gate(RENDER_APP, lang)):
            _check("auth.html", tag)


def test_lazy_images_do_not_claim_high_priority():
    """Cards are below the fold; lazy already deprioritizes them, so high would fight the LCP wordmark."""
    for lang in build.LANGS:
        html = build.render_page(RENDER_APP, "index.html", "/", lang)
        for tag in IMG_TAG.findall(html):
            attributes = _attributes(tag)
            assert not (attributes.get("loading") == "lazy" and attributes.get("fetchpriority") == "high")
