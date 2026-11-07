# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Dynamic portfolio layout: the number of cards follows the image count in src/static/portfolio."""

import re

import pytest
from PIL import features

import build
import config
import portfolio
import render_app
from render_app import RENDER_APP


def test_list_portfolio_images_sorted_and_filtered(tmp_path):
    (tmp_path / "IMG_0002.webp").write_bytes(b"")
    (tmp_path / "IMG_0001.JPG").write_bytes(b"")
    (tmp_path / "note.txt").write_text("x", encoding="utf-8")
    (tmp_path / ".DS_Store").write_bytes(b"")

    assert portfolio.list_portfolio_images(str(tmp_path)) == [
        "IMG_0001.JPG",
        "IMG_0002.webp",
    ]


def test_portfolio_items_numbering_and_stem(tmp_path):
    for name in ("a.webp", "b.png"):
        (tmp_path / name).write_bytes(b"")

    items = portfolio.portfolio_items(str(tmp_path))

    assert [i["stem"] for i in items] == ["a", "b"]
    assert [i["num"] for i in items] == ["01", "02"]
    assert [i["ext"] for i in items] == ["webp", "png"]


def test_portfolio_items_falls_back_when_source_missing(tmp_path):
    items = portfolio.portfolio_items(str(tmp_path / "missing"))

    assert [i["name"] for i in items] == list(portfolio.FALLBACK_PORTFOLIO_IMAGES)


def test_thumb_widths_follow_source_width():
    """Only the shared tiers a source can fill are published; narrower sources keep their own width."""
    # The tier list is the single source of width truth; it must stay non-empty and ascending.
    assert portfolio.PORTFOLIO_THUMB_WIDTHS
    assert list(portfolio.PORTFOLIO_THUMB_WIDTHS) == sorted(
        portfolio.PORTFOLIO_THUMB_WIDTHS
    )
    assert portfolio.thumb_widths_for(1080) == [480, 640, 800]
    assert portfolio.thumb_widths_for(800) == [480, 640, 800]
    assert portfolio.thumb_widths_for(700) == [480, 640]
    assert portfolio.thumb_widths_for(600) == [480]
    assert portfolio.thumb_widths_for(480) == [480]
    assert portfolio.thumb_widths_for(479) == [479]
    assert portfolio.thumb_widths_for(None) == [480, 640, 800]
    assert portfolio.thumb_widths_for(0) == [480, 640, 800]

    for source_width in (1080, 800, 700, 600, 480, 479, None, 0):
        widths = portfolio.thumb_widths_for(source_width)
        assert widths == sorted(widths), (
            f"widths for source width {source_width} are not ascending: {widths}"
        )


def test_default_thumb_width_keeps_640_when_available():
    assert portfolio.default_thumb_width([480, 640, 800]) == 640
    assert portfolio.default_thumb_width([480, 640]) == 640
    assert portfolio.default_thumb_width([480]) == 480
    assert portfolio.default_thumb_width([479]) == 479


def test_home_renders_one_card_per_portfolio_image():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    items = portfolio.portfolio_items()

    assert html.count('class="work-box"') == len(items)
    for item in items:
        # The largest published AVIF tier and the default WebP tier must both be rendered.
        largest = item["thumb_widths"][-1]
        assert f"/static/portfolio/thumbs/{item['stem']}-{largest}.avif" in html
        assert (
            f"/static/portfolio/thumbs/{item['stem']}-{item['default_thumb_width']}.webp"
            in html
        )


def test_body_exposes_portfolio_thumbs_for_prefetch():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    match = re.search(r'data-portfolio-thumbs="([^"]*)"', html)

    assert match is not None
    assert match.group(1).split() == [
        f"/static/portfolio/thumbs/{item['stem']}-{item['default_thumb_width']}.avif"
        for item in portfolio.portfolio_items()
    ]


def test_portfolio_items_expose_ratio_and_orientation(tmp_path):
    Image = pytest.importorskip("PIL.Image")

    for name, size in (
        ("portrait.webp", (1080, 1440)),
        ("landscape.webp", (1350, 900)),
        ("square.webp", (1000, 1000)),
    ):
        Image.new("RGB", size, "red").save(tmp_path / name, "WEBP")

    items = {i["stem"]: i for i in portfolio.portfolio_items(str(tmp_path))}

    # Ratios are reduced integer pairs (3:2 rather than an approximate 1.5).
    assert (items["portrait"]["width"], items["portrait"]["height"]) == (3, 4)
    assert (items["landscape"]["width"], items["landscape"]["height"]) == (3, 2)
    assert (items["square"]["width"], items["square"]["height"]) == (1, 1)
    assert items["portrait"]["orientation"] == "portrait"
    assert items["landscape"]["orientation"] == "landscape"
    assert items["square"]["orientation"] == "square"


def test_portfolio_items_expose_pixel_width_and_thumb_widths(tmp_path):
    Image = pytest.importorskip("PIL.Image")

    Image.new("RGB", (1080, 1440), "red").save(tmp_path / "wide.webp", "WEBP")
    Image.new("RGB", (600, 800), "red").save(tmp_path / "narrow.webp", "WEBP")

    items = {item["stem"]: item for item in portfolio.portfolio_items(str(tmp_path))}

    assert items["wide"]["source_width"] == 1080
    assert items["wide"]["thumb_widths"] == [480, 640, 800]
    assert items["wide"]["default_thumb_width"] == 640
    assert items["narrow"]["source_width"] == 600
    assert items["narrow"]["thumb_widths"] == [480]
    assert items["narrow"]["default_thumb_width"] == 480
    # The thumbnail tiers must not change the reduced ratio the template renders.
    for stem in ("wide", "narrow"):
        assert (items[stem]["width"], items[stem]["height"]) == (3, 4)


def test_home_cards_use_intrinsic_image_aspect_ratio():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")

    # Intrinsic dimensions preserve the image ratio and prevent CLS without inline CSS blocked by the site's CSP.
    for item in portfolio.portfolio_items():
        assert f'width="{item["width"]}" height="{item["height"]}"' in html
        assert f'data-orientation="{item["orientation"]}"' in html
    assert 'style="aspect-ratio:' not in html


def test_generate_portfolio_thumbs_writes_webp_and_avif(tmp_path):
    Image = pytest.importorskip("PIL.Image")

    source = tmp_path / "src"
    source.mkdir()
    Image.new("RGB", (1000, 1333), "red").save(source / "shot.webp", "WEBP")
    output = tmp_path / "out"

    count = build.generate_portfolio_thumbs(str(source), str(output))

    assert count == len(build.PORTFOLIO_THUMB_WIDTHS)
    for width in build.PORTFOLIO_THUMB_WIDTHS:
        assert (output / f"shot-{width}.webp").exists()
        assert (output / f"shot-{width}.avif").exists()


def test_thumbs_keep_source_aspect_ratio_in_both_formats(tmp_path):
    """For 3:2, 2:3, and 3:4 sources, WebP and AVIF preserve the ratio; width follows the size and height follows the ratio."""
    Image = pytest.importorskip("PIL.Image")

    source = tmp_path / "src"
    source.mkdir()
    cases = {"p34": (1080, 1440), "l32": (1350, 900), "p23": (900, 1350)}
    for stem, size in cases.items():
        Image.new("RGB", size, "red").save(source / f"{stem}.webp", "WEBP")

    output = tmp_path / "out"
    build.generate_portfolio_thumbs(str(source), str(output))

    for stem, (src_w, src_h) in cases.items():
        for width in build.PORTFOLIO_THUMB_WIDTHS:
            expect_h = round(src_h * width / src_w)
            for ext in ("webp", "avif"):
                with Image.open(output / f"{stem}-{width}.{ext}") as im:
                    assert (im.width, im.height) == (width, expect_h), (
                        f"{stem}-{width}.{ext} has unexpected dimensions: {im.width}x{im.height}"
                    )


def test_avif_thumbs_are_decodable_and_not_webp(tmp_path):
    """The AVIF size must use a real AVIF container, not WebP or the source format."""
    Image = pytest.importorskip("PIL.Image")
    if not features.check("avif"):
        pytest.skip("This Pillow build does not support AVIF decoding")

    source = tmp_path / "src"
    source.mkdir()
    Image.new("RGB", (1200, 800), "red").save(source / "wide.webp", "WEBP")
    output = tmp_path / "out"

    build.generate_portfolio_thumbs(str(source), str(output))

    for width in build.PORTFOLIO_THUMB_WIDTHS:
        path = output / f"wide-{width}.avif"
        assert path.read_bytes()[4:12] == b"ftypavif"
        with Image.open(path) as im:
            assert im.format == "AVIF"
            assert (im.width, im.height) == (width, round(800 * width / 1200))


def test_generate_portfolio_thumbs_skips_when_source_dir_missing(tmp_path):
    """A clean CI checkout has no source directory; skip without error or creating an empty directory."""
    output = tmp_path / "out"

    assert build.generate_portfolio_thumbs(str(tmp_path / "missing"), str(output)) == 0
    assert not output.exists()


def test_home_avif_and_webp_srcsets_cover_every_image():
    """Every home-page image must have matching AVIF and WebP srcsets with the same size options."""
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")

    for item in portfolio.portfolio_items():
        stem = item["stem"]
        for fmt in ("avif", "webp"):
            for width in item["thumb_widths"]:
                assert f"/thumbs/{stem}-{width}.{fmt} {width}w" in html
        # Prefer AVIF with WebP as a fallback; the AVIF source must precede img in picture.
        largest = item["thumb_widths"][-1]
        assert html.index(f"{stem}-{largest}.avif") < html.index(f"{stem}-{largest}.webp")


def _render_home_with_portfolio(tmp_path, monkeypatch, images):
    """Publish ``images`` into a temporary static root and render the home page from it.

    Returns the rendered HTML and the temporary portfolio source directory, so one
    fixture can drive both the page assertions and thumbnail generation.
    """
    Image = pytest.importorskip("PIL.Image")

    static_dir = tmp_path / "static"
    portfolio_dir = static_dir / "portfolio"
    portfolio_dir.mkdir(parents=True)
    for name, size in images.items():
        Image.new("RGB", size, "red").save(portfolio_dir / name, "WEBP")

    monkeypatch.setattr(portfolio, "STATIC_DIR", str(static_dir))
    render_app._cached_portfolio_items.cache_clear()
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    return html, portfolio_dir


def test_home_narrow_source_emits_only_supported_tier(tmp_path, monkeypatch):
    """A 600px source publishes only the 480px tier, so the page never points at a missing file."""
    html, portfolio_dir = _render_home_with_portfolio(
        tmp_path, monkeypatch, {"narrow.webp": (600, 800)}
    )

    assert "/thumbs/narrow-480.avif 480w" in html
    assert "/thumbs/narrow-480.webp 480w" in html
    data_src = re.search(r'data-src="([^"]*/thumbs/narrow-480\.webp)"', html)
    assert data_src is not None, "the img must fall back to the published 480px tier"
    prefetch = re.search(r'data-portfolio-thumbs="([^"]*)"', html)
    assert prefetch is not None
    assert prefetch.group(1).split() == ["/static/portfolio/thumbs/narrow-480.avif"]
    assert "narrow-640" not in html
    assert "narrow-800" not in html

    output = tmp_path / "out"
    assert build.generate_portfolio_thumbs(str(portfolio_dir), str(output)) == 1
    assert sorted(path.name for path in output.iterdir()) == [
        "narrow-480.avif",
        "narrow-480.webp",
    ]


def test_home_source_narrower_than_smallest_tier_publishes_its_own_width(tmp_path, monkeypatch):
    """A 400px source publishes one 400px tier instead of upscaling to the shared widths."""
    html, portfolio_dir = _render_home_with_portfolio(
        tmp_path, monkeypatch, {"tiny.webp": (400, 500)}
    )

    assert "tiny-400.avif 400w" in html
    assert "tiny-400.webp 400w" in html
    data_src = re.search(r'data-src="([^"]*/thumbs/tiny-400\.webp)"', html)
    assert data_src is not None, "the img must fall back to the only published tier"
    prefetch = re.search(r'data-portfolio-thumbs="([^"]*)"', html)
    assert prefetch is not None
    assert prefetch.group(1).split() == ["/static/portfolio/thumbs/tiny-400.avif"]
    for width in (480, 640, 800):
        assert f"tiny-{width}" not in html

    output = tmp_path / "out"
    assert build.generate_portfolio_thumbs(str(portfolio_dir), str(output)) == 1
    assert sorted(path.name for path in output.iterdir()) == [
        "tiny-400.avif",
        "tiny-400.webp",
    ]


def test_home_wide_source_keeps_three_tiers_and_640_default(tmp_path, monkeypatch):
    """A 1080px source keeps the historical 480/640/800 srcsets and the 640px default."""
    html, _ = _render_home_with_portfolio(
        tmp_path, monkeypatch, {"wide.webp": (1080, 1440)}
    )

    base = config.IMAGE_ASSET_BASE_URL
    for extension in ("avif", "webp"):
        expected_srcset = ", ".join(
            f"{base}/static/portfolio/thumbs/wide-{width}.{extension} {width}w"
            for width in (480, 640, 800)
        )
        assert f'data-srcset="{expected_srcset}"' in html
    data_src = re.search(r'data-src="([^"]*/thumbs/wide-640\.webp)"', html)
    assert data_src is not None, "the img must default to the 640px tier"
    prefetch = re.search(r'data-portfolio-thumbs="([^"]*)"', html)
    assert prefetch is not None
    assert prefetch.group(1).split() == ["/static/portfolio/thumbs/wide-640.avif"]

