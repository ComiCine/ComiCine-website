# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Static asset mirroring and the portfolio image pipeline for the site build.

The helpers take their directories as arguments where the build facade needs to
control them; only the repository defaults come from config and portfolio.
"""

from __future__ import annotations

import os
import re
import shutil

# These are **optional dependencies**: use None when they are unavailable. Whether to fail is decided by
# check_image_prerequisites before public/ is modified; that function raises when needed.
# `x = None` conflicts with the Module type inferred from the import. This is the only place in the repository that needs an exception,
# limited to this assignment rather than a blanket ignore or a global check override.
try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore[assignment]

from config import PUBLIC_DIR, STATIC_DIR
from portfolio import (
    FALLBACK_PORTFOLIO_IMAGES,
    PORTFOLIO_THUMB_WIDTHS,
    thumb_widths_for,
)

# Portfolio card thumbnails: AVIF quality; the width tiers live in portfolio.py so the
# generator and the template share one source of truth.
PORTFOLIO_THUMB_AVIF_QUALITY = 55

# Parallel or backup processes may create copies with spaces, such as “visitor 2.js” or “visitors 3.ts”.
# These are not site assets; skip them during the build so they are not deployed to public/.
_PARALLEL_ARTIFACT_RE = re.compile(r"\s\d+\.(?:ts|js|py|sql|json|md|map)$")

# Source file used only as Tailwind CLI input; do not publish it with the site.
# The live /static/tailwind.input.css would contain only a 59-byte @tailwind directive,
# which is useless to visitors and exposes build details. The precompiled asset is tailwind.css.
_STATIC_EXCLUDE_NAMES = frozenset({"tailwind.input.css", "portfolio-thumbs"})


def _static_ignore(dirpath: str, names: list[str], static_dir: str) -> set[str]:
    ignored = {".DS_Store", "__pycache__"}
    ignored.update(_STATIC_EXCLUDE_NAMES.intersection(names))
    if os.path.normcase(os.path.abspath(dirpath)) == os.path.normcase(
        os.path.abspath(static_dir)
    ) and "portfolio" in names:
        ignored.add("portfolio")
    if os.path.normcase(os.path.abspath(dirpath)) == os.path.normcase(
        os.path.abspath(static_dir)
    ) and "files" in names:
        ignored.add("files")
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


PORTFOLIO_THUMB_QUALITY = 75


def generate_portfolio_thumbs(source_dir=None, output_dir=None) -> int:
    """Generate WebP and AVIF portfolio card thumbnails in the build output directory.

    Each source image gets exactly the tiers in ``portfolio.thumb_widths_for``: the
    shared widths that fit, or one tier at the source's own width when it is narrower
    than every shared width. Thumbnails are only for home-page card previews;
    full-size originals stay in the private local source directory.
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
        # Publish exactly the tiers the template references: the shared widths this
        # source can fill, or one tier at its own width when it is narrower than all of them.
        widths = thumb_widths_for(image.width)
        skipped = [width for width in PORTFOLIO_THUMB_WIDTHS if width > image.width]
        for width in widths:
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
                f"[build] thumbnail skip {name}: widths {skipped} exceed source width "
                f"{image.width}; wrote {widths}",
                flush=True,
            )

    print(f"[build] portfolio thumbnails: {count}", flush=True)
    return count


def copy_portfolio_thumb_fallbacks(seed_dir=None, output_dir=None) -> int:
    """Copy tracked public thumbnail variants for clean builds without private originals."""
    seed_dir = seed_dir or os.path.join(STATIC_DIR, "portfolio-thumbs")
    output_dir = output_dir or os.path.join(
        PUBLIC_DIR, "static", "portfolio", "thumbs"
    )
    expected = [
        f"{os.path.splitext(name)[0]}-{width}.{extension}"
        for name in FALLBACK_PORTFOLIO_IMAGES
        for width in PORTFOLIO_THUMB_WIDTHS
        for extension in ("webp", "avif")
    ]
    missing = [name for name in expected if not os.path.isfile(os.path.join(seed_dir, name))]
    if missing:
        raise FileNotFoundError(
            "missing tracked portfolio thumbnail variants: " + ", ".join(missing)
        )

    os.makedirs(output_dir, exist_ok=True)
    for name in expected:
        shutil.copy2(os.path.join(seed_dir, name), os.path.join(output_dir, name))
    print(f"[build] copied fallback portfolio thumbnails: {len(expected)} files", flush=True)
    return len(expected)


def check_image_prerequisites(
    source_root=None, wm_path: str | None = None, image: object = Image
) -> bool:
    """Validate image prerequisites before touching public/; return whether portfolio sources exist.

    These checks were previously spread through generate_watermarks. If Pillow was
    missing, the build failed after copytree had copied originals, leaving a public/
    directory with full portfolio images that could be deployed directly (W9-22).
    Run checks at the start of main() so a failure writes nothing.
    """
    source_root = source_root or STATIC_DIR
    wm_path = wm_path or os.path.join(STATIC_DIR, "icons", "comicine-watermark.png")
    portfolio_dir = os.path.join(source_root, "portfolio")
    has_portfolio = os.path.isdir(portfolio_dir) and any(
        name.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
        for name in os.listdir(portfolio_dir)
    )
    if not has_portfolio:
        return False

    if image is None:
        raise RuntimeError(
            "Pillow is not installed, cannot generate portfolio thumbnails or watermarks. "
            "Run `pip install -r ops/requirements.txt` before build.py."
        )
    if not os.path.exists(wm_path):
        raise FileNotFoundError(f"missing watermark asset: {wm_path}")
    return True


def generate_watermarks(source_root=None, out_root=None) -> int:
    """Generate watermarked variants from source originals in public/static/wm/.

    Rules, matching shouldWatermark in the Worker:
      - Process only top-level png, jpg, jpeg, and webp files under portfolio/.
      - Do not create watermarked variants for other paths such as icons/ or qr-codes/.
    Use comicine-watermark.png, preserve its transparency, and overlay it at the lower-left
    corner without a background. The watermark is 25% of the image's shorter side
    (minimum 96px), with a margin of 2% of that side (minimum 12px).
    """
    # Size parameters; comicine-watermark.png defines the logo color and opacity.
    WATERMARK_SCALE = 0.25       # Watermark width as a fraction of the image short edge
    WATERMARK_MIN_W = 96         # Minimum watermark width in pixels

    # A2: Generate watermarked variants from source originals in src/static/portfolio; the public bundle contains only
    # /static/wm/portfolio/*; originals are no longer public.
    source_root = source_root or STATIC_DIR
    out_root = out_root or os.path.join(PUBLIC_DIR, "static", "wm")

    # A clean CI checkout has no gitignored src/static/portfolio directory. Without source images, watermarking is unnecessary,
    # so skip it instead of failing. Fail only when watermarking is required but assets or dependencies are missing.
    wm_path = os.path.join(STATIC_DIR, "icons", "comicine-watermark.png")
    if not check_image_prerequisites(source_root, wm_path):
        print("[build] no portfolio files to watermark, skipping watermark generation", flush=True)
        return 0
    os.makedirs(out_root, exist_ok=True)

    wm = Image.open(wm_path).convert("RGBA")
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
    step that can fail. If Pillow or the watermark PNG is missing, or the build is
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

