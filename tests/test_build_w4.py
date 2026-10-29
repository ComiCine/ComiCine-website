# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Regression tests for tasks/22 W4: build efficiency, smaller artifacts, and A2 (portfolio originals are private).

Coverage:
  W4-1 Context processor invariants are calculated once (load_pricing / portfolio_items)
  W4-2 tailwind.input.css is excluded from deployment
  W4-5 Manifest contents match build output byte-for-byte
  W4-6 Thumbnails never upscale narrow images
  W9-22 Validate image prerequisites before modifying public/ and remove originals after copytree
"""

from __future__ import annotations

import json
import re

import pytest

import build
import portfolio
import render_app
import services_pricing

# W4-1: Compute build invariants only once.


def test_context_processor_computes_invariants_once(tmp_path, monkeypatch):
    """The context processor reads invariants on every render, but should compute each input only once.

    Previously, portfolio_items() and load_pricing() were called inside the context
    processor 33 times per build (four languages x eight pages plus the gate page).
    portfolio_items also opened every source image on each page render. Both helpers
    are now wrapped in lru_cache, with source directories included in the cache key.
    """
    Image = pytest.importorskip("PIL.Image")

    static_dir = tmp_path / "static"
    services_dir = tmp_path / "services"
    (static_dir / "portfolio").mkdir(parents=True)
    services_dir.mkdir()
    Image.new("RGB", (1080, 1440), "red").save(static_dir / "portfolio" / "shot.webp", "WEBP")
    _seed_services(services_dir, 20)
    monkeypatch.setattr("portfolio.STATIC_DIR", str(static_dir))
    monkeypatch.setattr("services_pricing.SERVICES_DIR", str(services_dir))

    expected_items = portfolio.portfolio_items(str(static_dir / "portfolio"))
    expected_pricing = services_pricing.load_pricing(str(services_dir))

    for helper, arg, expected in (
        (render_app._cached_portfolio_items, str(static_dir / "portfolio"), expected_items),
        (render_app._cached_pricing, str(services_dir), expected_pricing),
    ):
        helper.cache_clear()
        assert helper.cache_info().misses == 0

        first = helper(arg)
        assert first == expected
        for _ in range(32):  # Read it 32 more times to simulate the remaining 32 pages.
            assert helper(arg) == first

        info = helper.cache_info()
        assert info.misses == 1, f"{helper.__name__} 被真算了 {info.misses} 次"
        assert info.hits == 32
        helper.cache_clear()


def test_cached_helpers_match_the_originals():
    """Caching is only memoization; results must match the original uncached functions exactly."""
    render_app._cached_portfolio_items.cache_clear()
    render_app._cached_pricing.cache_clear()

    source = portfolio.portfolio_source_dir()
    assert render_app._cached_portfolio_items(source) == portfolio.portfolio_items(source)
    assert render_app._cached_pricing(services_pricing.SERVICES_DIR) == services_pricing.load_pricing()


def test_rendering_pages_does_not_grow_cache_misses():
    """After rendering a batch of pages, each underlying function has still run only once."""
    render_app._cached_portfolio_items.cache_clear()
    render_app._cached_pricing.cache_clear()

    for lang in ("zh-cn", "en-us", "ja-jp", "ko-kr"):
        build.render_page(render_app.RENDER_APP, "index.html", "/", lang)
        build.render_page(render_app.RENDER_APP, "services.html", "/services", lang)

    assert render_app._cached_portfolio_items.cache_info().misses == 1
    assert render_app._cached_pricing.cache_info().misses == 1


def _seed_services(dir_path, solo_price):
    (dir_path / services_pricing.CONVENTION_CSV).write_text(
        f"shots,price\n1,{solo_price}\n3,55\n6,100\n9,150\n", encoding="utf-8"
    )
    (dir_path / services_pricing.OUTDOOR_CSV).write_text(
        "type,people,price\n"
        "studio,solo,100\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
        encoding="utf-8",
    )


def test_two_services_dirs_do_not_cross_pollute(tmp_path, monkeypatch):
    """Changing directories must invalidate the cache without requiring cache_clear() (W4-1 regression).

    The previous implementation used an argument-free lru_cache(maxsize=1), so a
    second temporary SERVICES_DIR in the same pytest process returned the first
    directory's prices, creating a silent false pass.
    """
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    _seed_services(first, 111)
    _seed_services(second, 222)

    monkeypatch.setattr("services_pricing.SERVICES_DIR", str(first))
    html_first = build.render_page(render_app.RENDER_APP, "services.html", "/services", "zh-cn")

    monkeypatch.setattr("services_pricing.SERVICES_DIR", str(second))
    html_second = build.render_page(render_app.RENDER_APP, "services.html", "/services", "zh-cn")

    prices_first = re.findall(r'<span class="price-amount">CNY (\d+)', html_first)
    prices_second = re.findall(r'<span class="price-amount">CNY (\d+)', html_second)
    assert prices_first[0] == "111", prices_first
    assert prices_second[0] == "222", prices_second


def test_two_portfolio_dirs_do_not_cross_pollute(tmp_path, monkeypatch):
    """The portfolio cache must rescan after STATIC_DIR changes instead of reusing the previous manifest."""
    Image = pytest.importorskip("PIL.Image")

    first = tmp_path / "first"
    second = tmp_path / "second"
    (first / "portfolio").mkdir(parents=True)
    (second / "portfolio").mkdir(parents=True)
    Image.new("RGB", (1080, 1440), "red").save(first / "portfolio" / "alpha.webp", "WEBP")
    Image.new("RGB", (1080, 1440), "red").save(second / "portfolio" / "beta.webp", "WEBP")

    monkeypatch.setattr("portfolio.STATIC_DIR", str(first))
    html_first = build.render_page(render_app.RENDER_APP, "index.html", "/", "zh-cn")
    assert "alpha-640.webp" in html_first
    assert "beta-640.webp" not in html_first

    monkeypatch.setattr("portfolio.STATIC_DIR", str(second))
    html_second = build.render_page(render_app.RENDER_APP, "index.html", "/", "zh-cn")
    assert "beta-640.webp" in html_second
    assert "alpha-640.webp" not in html_second


# W4-2: Build inputs must not be included in the deployment bundle.


def test_static_ignore_excludes_tailwind_input():
    """tailwind.input.css is an input to the Tailwind CLI and must not be copied into deployment output."""
    ignored = build._static_ignore("/tmp/static", ["tailwind.input.css", "tailwind.css"])

    assert "tailwind.input.css" in ignored
    assert "tailwind.css" not in ignored


def test_static_ignore_excludes_private_portfolio_source(tmp_path, monkeypatch):
    static = tmp_path / "static"
    static.mkdir()
    monkeypatch.setattr(build, "STATIC_DIR", str(static))

    root_ignored = build._static_ignore(str(static), ["portfolio", "icons"])
    nested_ignored = build._static_ignore(
        str(static / "portfolio"), ["original.webp"]
    )

    assert "portfolio" in root_ignored
    assert "original.webp" not in nested_ignored
    assert "portfolio-thumbs" in build._static_ignore(
        str(static), ["portfolio-thumbs"]
    )


# W4-6: Thumbnails may be downscaled but never enlarged.


def _write_image(path, size):
    Image = pytest.importorskip("PIL.Image")
    Image.new("RGB", size, "red").save(path, "WEBP")


def test_thumbnails_skip_widths_wider_than_source(tmp_path):
    """For a 600px source, keep the 480px thumbnail and skip the 640px and 800px sizes; never upscale."""
    source = tmp_path / "src"
    source.mkdir()
    _write_image(source / "mid.webp", (600, 900))
    output = tmp_path / "out"

    count = build.generate_portfolio_thumbs(str(source), str(output))

    assert count == 1
    assert (output / "mid-480.webp").exists()
    assert not (output / "mid-640.webp").exists()
    assert not (output / "mid-800.avif").exists()


def test_thumbnails_skip_everything_when_source_is_narrow(tmp_path):
    source = tmp_path / "src"
    source.mkdir()
    _write_image(source / "narrow.webp", (320, 480))
    output = tmp_path / "out"

    assert build.generate_portfolio_thumbs(str(source), str(output)) == 0
    assert list(output.glob("*")) == []


def test_thumbnails_still_generate_all_widths_for_normal_source(tmp_path):
    """Regression: a normal 1080px source still produces all three sizes."""
    source = tmp_path / "src"
    source.mkdir()
    _write_image(source / "shot.webp", (1080, 1440))
    output = tmp_path / "out"

    assert build.generate_portfolio_thumbs(str(source), str(output)) == 3
    for width in build.PORTFOLIO_THUMB_WIDTHS:
        assert (output / f"shot-{width}.webp").exists()
        assert (output / f"shot-{width}.avif").exists()


def test_fallback_portfolio_thumbnails_are_copied_for_clean_builds(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()
    output = tmp_path / "out"
    expected = [
        f"{name.rsplit('.', 1)[0]}-{width}.{extension}"
        for name in build.FALLBACK_PORTFOLIO_IMAGES
        for width in build.PORTFOLIO_THUMB_WIDTHS
        for extension in ("webp", "avif")
    ]
    for name in expected:
        (seed / name).write_bytes(name.encode("ascii"))

    assert build.copy_portfolio_thumb_fallbacks(str(seed), str(output)) == len(
        expected
    )
    assert sorted(path.name for path in output.iterdir()) == sorted(expected)
    assert all(
        (output / name).read_bytes() == name.encode("ascii") for name in expected
    )


def test_fallback_portfolio_thumbnails_fail_when_a_variant_is_missing(tmp_path):
    seed = tmp_path / "seed"
    seed.mkdir()

    with pytest.raises(
        FileNotFoundError, match="missing tracked portfolio thumbnail variants"
    ):
        build.copy_portfolio_thumb_fallbacks(str(seed), str(tmp_path / "out"))


# W4-5: The manifest must match the build artifacts.


def _fake_artifact(root, name="index.html", body="hello"):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")
    return path


def test_verify_manifest_accepts_matching_tree(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(build, "PUBLIC_DIR", str(tmp_path))
    _fake_artifact(tmp_path)
    build.write_manifest()

    assert build.verify_manifest(str(tmp_path)) == 0
    assert "manifest verified" in capsys.readouterr().out


def test_verify_manifest_rejects_changed_file(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "PUBLIC_DIR", str(tmp_path))
    path = _fake_artifact(tmp_path)
    build.write_manifest()

    path.write_text("tampered", encoding="utf-8")

    assert build.verify_manifest(str(tmp_path)) == 1


def test_verify_manifest_rejects_extra_and_missing_files(tmp_path, monkeypatch):
    monkeypatch.setattr(build, "PUBLIC_DIR", str(tmp_path))
    _fake_artifact(tmp_path, "a.html")
    _fake_artifact(tmp_path, "b.html")
    build.write_manifest()

    _fake_artifact(tmp_path, "sneaked-in.txt")
    (tmp_path / "b.html").unlink()

    assert build.verify_manifest(str(tmp_path)) == 2


def test_verify_manifest_rejects_missing_or_broken_manifest(tmp_path):
    # No manifest.json.
    assert build.verify_manifest(str(tmp_path)) == 1
    # manifest.json contains invalid JSON.
    (tmp_path / "manifest.json").write_text("{not json", encoding="utf-8")
    assert build.verify_manifest(str(tmp_path)) == 1
    # manifest.json has no files mapping.
    (tmp_path / "manifest.json").write_text(json.dumps({"count": 3}), encoding="utf-8")
    assert build.verify_manifest(str(tmp_path)) == 1


# W9-22: Validate prerequisites before modifying public/.


def test_check_image_prerequisites_returns_false_without_sources(tmp_path):
    assert build.check_image_prerequisites(str(tmp_path)) is False


def test_check_image_prerequisites_requires_pillow_and_watermark_png(tmp_path, monkeypatch):
    """Require Pillow and the provided transparent ComiCine watermark before writing output."""
    source = tmp_path / "src"
    (source / "portfolio").mkdir(parents=True)
    _write_image(source / "portfolio" / "shot.webp", (1080, 1440))
    watermark = source / "icons" / "comicine-watermark.png"
    watermark.parent.mkdir(parents=True)
    _write_image(watermark, (150, 150))

    # All prerequisites are available: pass.
    monkeypatch.setattr(build, "Image", object())
    assert build.check_image_prerequisites(str(source), str(watermark)) is True

    # Pillow is missing.
    monkeypatch.setattr(build, "Image", None)
    with pytest.raises(RuntimeError, match="Pillow"):
        build.check_image_prerequisites(str(source), str(watermark))

    # The watermark PNG is missing.
    monkeypatch.setattr(build, "Image", object())
    with pytest.raises(FileNotFoundError):
        build.check_image_prerequisites(str(source), str(tmp_path / "missing.png"))


def test_generate_watermarks_skips_without_sources(tmp_path):
    """A clean CI checkout has no source images, so skip watermark generation instead of failing."""
    assert build.generate_watermarks(str(tmp_path), str(tmp_path / "out")) == 0


def test_remove_public_portfolio_originals_keeps_thumbs(tmp_path):
    """Keep only thumbs/ and recursively remove top-level and nested files and directories."""
    portfolio_dir = tmp_path / "portfolio"
    thumbs = portfolio_dir / "thumbs"
    thumbs.mkdir(parents=True)
    nested = portfolio_dir / "album"
    nested.mkdir()
    (portfolio_dir / "IMG_0001.webp").write_bytes(b"original")
    (portfolio_dir / "IMG_0002.webp").write_bytes(b"original")
    (thumbs / "IMG_0001-640.webp").write_bytes(b"thumb")
    (portfolio_dir / "notes.txt").write_text("remove me", encoding="utf-8")
    (nested / "original.svg").write_text("<svg/>", encoding="utf-8")

    assert build.remove_public_portfolio_originals(str(portfolio_dir)) == 4
    assert sorted(p.name for p in portfolio_dir.iterdir()) == ["thumbs"]
    assert (thumbs / "IMG_0001-640.webp").exists()


def test_remove_public_portfolio_originals_can_clear_stale_thumbs(tmp_path):
    portfolio_dir = tmp_path / "portfolio"
    stale_thumbs = portfolio_dir / "thumbs"
    stale_thumbs.mkdir(parents=True)
    (stale_thumbs / "removed-source-640.webp").write_bytes(b"stale")

    assert build.remove_public_portfolio_originals(
        str(portfolio_dir), keep_thumbs=False
    ) == 1
    assert list(portfolio_dir.iterdir()) == []


def test_main_removes_originals_right_after_copytree(monkeypatch, tmp_path):
    """Regression on operation order: delete originals immediately after copytree, before any step that can fail.

    Validate prerequisites (Pillow and watermark PNG) before writing public/.
    Replace expensive work with recording stubs and observe only call order.
    """
    order: list[str] = []
    static_dir = tmp_path / "static"
    (static_dir / "portfolio").mkdir(parents=True)
    (static_dir / "icons").mkdir(parents=True)
    (static_dir / "portfolio" / "source.webp").write_bytes(b"test source")
    # main() publishes the canonical root brand assets, so the stub build needs their source files.
    for icon_name in ("comicine-xtext.svg", "comicine-favicon.svg"):
        (static_dir / "icons" / icon_name).write_text("<svg/>", encoding="utf-8")
    output_dir = tmp_path / "out"

    monkeypatch.setattr(build, "STATIC_DIR", str(static_dir))
    monkeypatch.setattr(build, "PUBLIC_DIR", str(output_dir))
    monkeypatch.setattr(build, "PREVIEW_DIR", str(tmp_path / "preview"))
    monkeypatch.setattr(build, "FUNCTIONS_DIR", str(tmp_path / "functions"))
    monkeypatch.setattr(build, "check_image_prerequisites", lambda *a, **k: order.append("prereq"))
    monkeypatch.setattr(build, "write_pages_edge_config", lambda *a: None)
    monkeypatch.setattr(build, "render_page", lambda *a, **k: "<html></html>")
    monkeypatch.setattr(build, "render_gate", lambda *a, **k: "<html></html>")
    monkeypatch.setattr(build, "generate_portfolio_thumbs", lambda *a, **k: order.append("thumbs") or 0)
    monkeypatch.setattr(
        build,
        "copy_portfolio_thumb_fallbacks",
        lambda *a, **k: order.append("fallback-thumbs") or 36,
    )
    monkeypatch.setattr(build, "generate_watermarks", lambda *a, **k: order.append("watermarks") or 0)
    monkeypatch.setattr(
        build,
        "remove_public_portfolio_originals",
        lambda *a, **k: order.append("remove-originals") or 0,
    )
    monkeypatch.setattr(build, "write_config_functions", lambda: None)
    monkeypatch.setattr(build, "write_i18n_functions", lambda: None)
    monkeypatch.setattr(build, "write_runtime_functions", lambda: None)
    monkeypatch.setattr(build, "write_manifest", lambda: {})

    assert build.main() == 0

    assert order[0] == "prereq", f"前置条件必须先于任何写入：{order}"
    first_remove = order.index("remove-originals")
    assert first_remove < order.index("thumbs"), f"删原图必须早于缩略图：{order}"
    assert first_remove < order.index("watermarks"), f"删原图必须早于水印：{order}"
