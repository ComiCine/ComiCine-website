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
    name        source filename, including its original jpg/png/webp extension
    stem        filename without extension; thumbnails use .webp/.avif and this stem
    ext         lowercase extension
    num         two-digit index (01, 02, ...) used in alt text
    width       source image width in pixels, or None if Pillow or the source is missing
    height      source image height in pixels, or None if Pillow or the source is missing
    ratio       CSS aspect-ratio value (such as "3 / 4"), defaulting to 3 / 4 if unknown
    orientation "portrait", "landscape", or "square", used to select the card layout
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


def image_ratio(path: str) -> tuple[int, int] | None:
    """Read an image's aspect ratio as a reduced integer pair, or return None if unavailable.

    Reduction keeps the ratio exact (1080x1440 becomes 3:4; 1350x900 becomes 3:2).
    The template emits an integer ``aspect-ratio`` so each card matches the image's
    actual dimensions without decimal rounding.
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
    divisor = gcd(width, height)
    return width // divisor, height // divisor


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
        # the default 3:4 layout when dimensions cannot be read.
        ratio = image_ratio(os.path.join(source_dir, name)) or DEFAULT_RATIO
        width, height = ratio
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
                "ratio": f"{width} / {height}",
                "orientation": orientation,
            }
        )
    return items
