# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.md.

"""Dynamic portfolio layout: the number of cards follows the image count in src/static/portfolio."""

import re

import pytest
from PIL import features

import build
import portfolio
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


def test_home_renders_one_card_per_portfolio_image():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    items = portfolio.portfolio_items()

    assert html.count('class="work-box"') == len(items)
    for item in items:
        # Each image must have three AVIF and WebP srcset sizes.
        assert f"/static/portfolio/thumbs/{item['stem']}-800.avif" in html
        assert f"/static/portfolio/thumbs/{item['stem']}-640.webp" in html


def test_body_exposes_portfolio_thumbs_for_prefetch():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")
    match = re.search(r'data-portfolio-thumbs="([^"]*)"', html)

    assert match is not None
    assert match.group(1).split() == [
        f"/static/portfolio/thumbs/{item['stem']}-640.avif"
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
    assert items["portrait"]["ratio"] == "3 / 4"
    assert items["landscape"]["ratio"] == "3 / 2"
    assert items["square"]["ratio"] == "1 / 1"
    assert items["portrait"]["orientation"] == "portrait"
    assert items["landscape"]["orientation"] == "landscape"
    assert items["square"]["orientation"] == "square"


def test_home_cards_carry_per_image_aspect_ratio():
    html = build.render_page(RENDER_APP, "index.html", "/", "zh-cn")

    # Each card declares its own aspect ratio and intrinsic dimensions to avoid cropping everything to 3:4 and to prevent CLS.
    for item in portfolio.portfolio_items():
        assert f'style="aspect-ratio: {item["ratio"]}"' in html
        assert f'width="{item["width"]}" height="{item["height"]}"' in html
        assert f'data-orientation="{item["orientation"]}"' in html


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
                        f"{stem}-{width}.{ext} 尺寸不符：{im.width}x{im.height}"
                    )


def test_avif_thumbs_are_decodable_and_not_webp(tmp_path):
    """The AVIF size must use a real AVIF container, not WebP or the source format."""
    Image = pytest.importorskip("PIL.Image")
    if not features.check("avif"):
        pytest.skip("当前 Pillow 没有 AVIF 编解码支持")

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
            for width in build.PORTFOLIO_THUMB_WIDTHS:
                assert f"/thumbs/{stem}-{width}.{fmt} {width}w" in html
        # Prefer AVIF with WebP as a fallback; the AVIF source must precede img in picture.
        assert html.index(f"{stem}-800.avif") < html.index(f"{stem}-800.webp")

