#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Create tightly framed published favicon copies without changing the source artwork."""

from pathlib import Path

SOURCE_VIEWBOX = 'viewBox="0 0 1500 1500"'
CROPPED_VIEWBOX = 'viewBox="250 249.75 1000.1 1000.1"'


def crop_favicon_svg(svg: str) -> str:
    """Crop only the outer viewBox whitespace from the known ComiCine favicon SVG."""
    if CROPPED_VIEWBOX in svg:
        return svg
    if svg.count(SOURCE_VIEWBOX) != 1:
        raise ValueError("Expected the original ComiCine favicon viewBox exactly once")
    return svg.replace(SOURCE_VIEWBOX, CROPPED_VIEWBOX, 1)


def write_cropped_favicon(source_path: str | Path, output_path: str | Path) -> None:
    """Write a cropped-viewBox copy; the source SVG remains unchanged."""
    source = Path(source_path)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        crop_favicon_svg(source.read_text(encoding="utf-8")),
        encoding="utf-8",
    )
