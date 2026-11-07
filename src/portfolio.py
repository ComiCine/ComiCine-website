# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Portfolio image manifest, discovered dynamically from ``src/static/portfolio``.

The home page portfolio section uses this manifest for its layout. Add or remove
images in ``src/static/portfolio`` and rebuild; the number and layout of cards
adjust automatically, with no filenames maintained in the template.

Each item in the template context (``portfolio_items``) contains:
    name                source filename, including its original jpg/png/webp extension
    stem                filename without extension; thumbnails use .webp/.avif and this stem
    ext                 lowercase extension
    num                 two-digit index (01, 02, ...) used in alt text
    width               reduced integer width preserving the image's intrinsic aspect ratio
    height              reduced integer height preserving the image's intrinsic aspect ratio
    orientation         "portrait", "landscape", or "square", used to select the card layout
    source_width        source pixel width, or None when the image cannot be read
    thumb_widths        thumbnail widths the build publishes for this image, ascending
    default_thumb_width width used by the plain src attribute and the prefetch list
"""

from __future__ import annotations

import os
import re
from math import gcd

from config import STATIC_DIR

#: Fallback portfolio entries used when private source images are absent. Their
#: public thumbnail variants are tracked under ``src/static/portfolio-thumbs/``.
#: Keep the list stable so clean CI builds render the same public portfolio.
FALLBACK_PORTFOLIO_IMAGES = (
    "IMG_0203.webp",
    "IMG_0146.webp",
    "IMG_0130.webp",
    "IMG_0244.webp",
    "IMG_0115.webp",
    "IMG_0179.webp",
)

#: Assumed aspect ratio when the original dimensions cannot be read. The
#: historical default renders all images in portrait 3:4.
DEFAULT_RATIO = (3, 4)

#: Thumbnail widths the build generates, ascending. Only the tiers a source image
#: can actually fill are published (see ``thumb_widths_for``), so the template can
#: reference exactly what exists and a narrow source never points at a 404.
#: These are tuned for typical 1080px-wide source images: keep only resolutions
#: large enough for the cards, so the first view does not download 1080x1440 originals.
PORTFOLIO_THUMB_WIDTHS = (480, 640, 800)

#: Width for the plain ``src`` attribute and the home-page prefetch list. The
#: browser picks from srcset in normal use, so this value only has to exist; it
#: stays at the historical 640px thumbnail whenever that tier is available.
PORTFOLIO_THUMB_DEFAULT_WIDTH = 640

_PORTFOLIO_EXTS = re.compile(r"\.(png|jpe?g|webp)$", re.I)


def portfolio_source_dir() -> str:
    """Return the private, untracked source image directory for the portfolio."""
    return os.path.join(STATIC_DIR, "portfolio")


def list_portfolio_images(source_dir: str | None = None) -> list[str]:
    """Return portfolio image filenames, sorted by name; return [] if the directory is missing or empty."""
    source_dir = source_dir or portfolio_source_dir()
    if not os.path.isdir(source_dir):
        return []
    return sorted(
        name
        for name in os.listdir(source_dir)
        if _PORTFOLIO_EXTS.search(name) and not name.startswith(".")
    )


def image_size(path: str) -> tuple[int, int] | None:
    """Read an image's pixel width and height, or return None if unavailable.

    One ``Image.open`` per image serves both the reduced ratio and the thumbnail
    tier decision, so the manifest never reopens a source just to read its size.
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as image:
            width, height = image.size
    except Exception:
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def _reduced_ratio(width: int, height: int) -> tuple[int, int]:
    """Reduce a pixel size to its smallest integer pair (1080x1440 becomes 3:4)."""
    divisor = gcd(width, height)
    return width // divisor, height // divisor


def image_ratio(path: str) -> tuple[int, int] | None:
    """Read an image's aspect ratio as a reduced integer pair, or return None if unavailable.

    Reduction keeps the ratio exact (1080x1440 becomes 3:4; 1350x900 becomes 3:2).
    The template uses the reduced pair as the image's intrinsic width and height,
    avoiding inline styles while preserving the exact ratio.
    """
    size = image_size(path)
    if size is None:
        return None
    return _reduced_ratio(*size)


def thumb_widths_for(source_width: int | None) -> list[int]:
    """Return the thumbnail widths to publish for one source image, in ascending order.

    Tiers wider than the source are skipped: upscaling would only blur the image
    and grow the file. An unknown width keeps every tier, because a clean checkout
    publishes all of them for the fallback list from ``src/static/portfolio-thumbs/``.
    A source narrower than the smallest tier is published once at its own width,
    so every card has a matching file and the build still never upscales.
    """
    if not source_width or source_width <= 0:
        return list(PORTFOLIO_THUMB_WIDTHS)
    widths = [width for width in PORTFOLIO_THUMB_WIDTHS if width <= source_width]
    return widths or [source_width]


def default_thumb_width(thumb_widths: list[int]) -> int:
    """Return the tier used by the plain ``src`` attribute and the home-page prefetch list.

    Prefer the historical 640px thumbnail, falling back to the widest published
    tier below it, or to the only tier when the source is narrower than every
    shared tier. Wide sources therefore render exactly as before, while narrow
    sources never name a thumbnail the build did not write.
    """
    if not thumb_widths:
        raise ValueError("thumb_widths must not be empty")
    at_most_default = [
        width for width in thumb_widths if width <= PORTFOLIO_THUMB_DEFAULT_WIDTH
    ]
    return at_most_default[-1] if at_most_default else thumb_widths[0]


def portfolio_items(source_dir: str | None = None) -> list[dict[str, object]]:
    """Return the portfolio card context, falling back to a default list when sources are missing."""
    source_dir = source_dir or portfolio_source_dir()
    names = list_portfolio_images(source_dir)
    if not names:
        names = list(FALLBACK_PORTFOLIO_IMAGES)

    items: list[dict[str, object]] = []
    for index, name in enumerate(names, start=1):
        stem, ext = os.path.splitext(name)
        # The fallback entries have no source files in a clean checkout, so use
        # the default 3:4 layout and keep every thumbnail tier when the dimensions
        # cannot be read.
        size = image_size(os.path.join(source_dir, name))
        width, height = _reduced_ratio(*size) if size else DEFAULT_RATIO
        source_width = size[0] if size else None
        thumb_widths = thumb_widths_for(source_width)
        if height > width:
            orientation = "portrait"
        elif width > height:
            orientation = "landscape"
        else:
            orientation = "square"
        items.append(
            {
                "name": name,
                "stem": stem,
                "ext": ext.lstrip(".").lower(),
                "num": f"{index:02d}",
                "width": width,
                "height": height,
                "orientation": orientation,
                "source_width": source_width,
                "thumb_widths": thumb_widths,
                "default_thumb_width": default_thumb_width(thumb_widths),
            }
        )
    return items
