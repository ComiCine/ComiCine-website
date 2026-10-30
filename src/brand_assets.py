#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Create published favicon copies with ten percent clear margins, preserving source artwork."""

from pathlib import Path

SOURCE_VIEWBOX = 'viewBox="0 0 1500 1500"'
PUBLISHED_VIEWBOX = 'viewBox="124.375 124.375 1251.25 1251.25"'


def crop_favicon_svg(svg: str) -> str:
    """Crop outer whitespace while leaving about ten percent clear space on every side."""
    if PUBLISHED_VIEWBOX in svg:
        return svg
    if svg.count(SOURCE_VIEWBOX) != 1:
        raise ValueError("Expected the original ComiCine favicon viewBox exactly once")
    return svg.replace(SOURCE_VIEWBOX, PUBLISHED_VIEWBOX, 1)


def write_cropped_favicon(source_path: str | Path, output_path: str | Path) -> None:
    """Write a cropped-viewBox copy; the source SVG remains unchanged."""
    source = Path(source_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        crop_favicon_svg(source.read_text(encoding="utf-8")),
        encoding="utf-8",
    )
