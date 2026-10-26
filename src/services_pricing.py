# ComiCine - shared configuration and utilities
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""CSV data source for the services.comicine.com price list.

The price list is no longer hard-coded in templates/services.html. Each build reads
``site/docs/services/*.csv``, so changing a price only requires editing the CSV and
deploying. Note that ``site/docs/`` contains subdomain-specific directories:
``docs/`` belongs to docs.comicine.com (VitePress content), while ``services/`` belongs
to services.comicine.com and contains the price list read by this module:

  convention.csv   shots,price[,bookable]       -> convention photography (01), priced by shot count
  outdoor.csv      type,people,price[,bookable] -> portrait photography (02), studio/outdoor x solo/duo

CSV columns and values are always English (studio/outdoor x solo/duo, yes/no) so
they can be read directly in a terminal or issue. Visitor-facing copy remains in
locales/*.json. Unit suffixes, tier labels, and notes also come from locales/*.json;
only numeric prices, tier combinations, and bookable values come from CSV. The build
fails if a CSV is missing, has an invalid header, contains an unknown or duplicate
tier, or has an invalid bookable value. A broken price list is worse than a failed build.

The price column has only two outcomes: a positive integer or ``None`` (rendered as
``-``). Any value that does not parse as a positive integer is treated as undisclosed:
blank, ``N/A``, ``TBD``, malformed numbers, ``0``, and negative numbers. The card keeps
the ``CNY`` prefix and unit suffix and replaces only the number (``CNY - / shot``),
preserving the layout of other tiers. ``-`` does not mean zero or free.

Usage:
    from services_pricing import load_pricing
    pricing = load_pricing()      # {"convention": [...], "outdoor": [...], "outdoor_note": {...}}
"""

from __future__ import annotations

import csv
import os

from config import BASE_DIR

SERVICES_DIR = os.path.join(BASE_DIR, "docs", "services")
# site/docs/ is now split into subdomain directories: docs/ belongs to
# docs.comicine.com (the VitePress content source, built by ops/docs_deploy.sh),
# while services/ belongs to services.comicine.com and contains the price lists
# read by this module.

CONVENTION_CSV = "convention.csv"
OUTDOOR_CSV = "outdoor.csv"

# Studio photography: map the CSV `shots` column to a unit-suffix key in the
# locale files. The CSV determines the number of tiers. Unlisted tiers (for
# example, a new four-shot tier) still render prices without a unit suffix.
# Add an entry here and matching copy to locales/*.json to provide one.
CONVENTION_UNIT_KEYS = {
    1: "unit_per_shot",
    3: "unit_per_3",
    6: "unit_per_6",
    9: "unit_per_9",
}

# Outdoor photography: map (type, people) to a tier-label key in the locale files.
OUTDOOR_PLAN_KEYS = {
    ("studio", "solo"): "plan_studio_solo",
    ("studio", "duo"): "plan_studio_duo",
    ("outdoor", "solo"): "plan_outdoor_solo",
    ("outdoor", "duo"): "plan_outdoor_duo",
}

# Render the four outdoor photography cards in this order so CSV row order
# cannot change the layout.
OUTDOOR_ORDER = (
    ("studio", "solo"),
    ("studio", "duo"),
    ("outdoor", "solo"),
    ("outdoor", "duo"),
)

# Optional `bookable` column: blank or `yes` means accepting bookings; otherwise
# the value must be `no`.
BOOKABLE_COLUMN = "bookable"
BOOKABLE_YES = {"", "y", "yes", "true", "1"}
BOOKABLE_NO = {"n", "no", "false", "0"}

# The `price` column has no placeholder allowlist: anything that does not parse
# as a positive integer is treated as undisclosed and rendered as `-`.
# Map each CSV `type` to the note heading and paused-copy keys used in the notes.
NOTE_ROW_KEYS = {
    "studio": ("extra_studio", "studio_paused"),
}


def _cell(value: object) -> str:
    """Return a trimmed CSV cell; treat a missing column (``None``) as an empty string."""
    if isinstance(value, list):
        return ",".join(str(item) for item in value).strip()
    if value is None:
        return ""
    return str(value).strip()


def _read_rows(filename: str, services_dir: str | None = None) -> list[dict[str, str]]:
    """Read one CSV and remove its header and blank rows.

    If ``services_dir`` is None, use the ``SERVICES_DIR`` module constant (tests may monkeypatch it).

    This function handles two malformed input cases:

    - **Duplicate headers** (``shots,price,price``): ``csv.DictReader`` silently keeps
      only the last duplicate column, which once rendered 999 without warning. Raise
      ``RuntimeError`` with the filename instead.
    - **More data fields than headers** (commonly a price written as ``1,000`` with an
      extra comma): ``csv.DictReader`` places overflow fields in ``row[None]`` as a
      list. Passing it to the template would raise ``AttributeError`` at ``v.strip()``.
      Join the overflow back into the final declared column, so ``price`` becomes
      ``"1,000"`` and :func:`_parse_price` returns ``None``; the template then renders
      ``-``. Never guess a price (both 1 and 1000 would be wrong), and do not raise.
    """
    directory = services_dir if services_dir is not None else SERVICES_DIR
    path = os.path.join(directory, filename)
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = [(name or "").strip() for name in (reader.fieldnames or [])]
            duplicates = sorted({name for name in fieldnames if fieldnames.count(name) > 1})
            if duplicates:
                raise RuntimeError(
                    f"{filename} has duplicate column(s): {', '.join(duplicates)}"
                )
            rows: list[dict[str, str]] = []
            for raw in reader:
                # Extra columns are stored as a list under the None key; remove
                # them before normalizing the remaining cells.
                overflow = _cell(raw.pop(None, None))
                row = {(key or "").strip(): _cell(value) for key, value in raw.items()}
                if overflow and fieldnames:
                    last = fieldnames[-1]
                    row[last] = f"{row.get(last, '')},{overflow}"
                if any(row.values()):
                    rows.append(row)
    except OSError as exc:
        raise RuntimeError(f"cannot read price list {path}: {exc}") from exc
    if not rows:
        raise RuntimeError(f"price list is empty: {path}")
    return rows


def _parse_price(raw: str) -> int | None:
    """Parse the price column as a positive integer, or return None.

    There is no placeholder allowlist. Blank values, ``N/A``, ``TBD``, malformed
    numbers, ``0``, and negative numbers all return None, which the template renders
    as ``-``. None does not mean zero or free.
    """
    text = raw.strip()
    try:
        price = int(text)
    except ValueError:
        return None
    return price if price > 0 else None


def _parse_bookable(filename: str, lineno: int, row: dict[str, str]) -> bool:
    """Read the optional `bookable` column; a missing or blank value means bookable."""
    raw = row.get(BOOKABLE_COLUMN, "").strip().lower()
    if raw in BOOKABLE_YES:
        return True
    if raw in BOOKABLE_NO:
        return False
    raise RuntimeError(
        f"{filename} line {lineno}: unrecognized {BOOKABLE_COLUMN} value {raw!r}"
        f' (expected "yes" or "no"; an empty cell means "yes")'
    )


def load_convention(services_dir: str | None = None) -> list[dict[str, object]]:
    """Return convention photography prices sorted by shot count.

    The return value is ``[{shots, price, unit_key, bookable}, ...]``. If
    ``services_dir`` is omitted, use the ``SERVICES_DIR`` module constant. An explicit
    path lets the build cache (``render_app._cached_pricing``) include the directory in
    its key, so tests using a temporary directory cannot read a previous CSV.
    """
    filename = CONVENTION_CSV
    rows = _read_rows(filename, services_dir)
    missing = {"shots", "price"} - set(rows[0])
    if missing:
        raise RuntimeError(f"{filename} is missing column(s): {', '.join(sorted(missing))}")

    # Accumulate (shot count, plan) pairs alongside plans. Shot counts remain
    # integers here, so sorting does not need to call int(...) on a value from
    # dict[str, object] (mypy rejects that overload for object). Return only the
    # plans to preserve the existing ascending-shot-count behavior.
    ranked: list[tuple[int, dict[str, object]]] = []
    seen: set[int] = set()
    for index, row in enumerate(rows, start=2):
        shots_raw = row["shots"]
        try:
            shots = int(shots_raw)
        except ValueError as exc:
            raise RuntimeError(
                f"{filename} line {index}: shots is not an integer: {shots_raw!r}"
            ) from exc
        if shots <= 0:
            raise RuntimeError(f"{filename} line {index}: shots must be positive: {shots_raw!r}")
        if shots in seen:
            raise RuntimeError(f"{filename} line {index}: duplicate shots: {shots}")
        seen.add(shots)
        bookable = _parse_bookable(filename, index, row)
        price = _parse_price(row["price"])
        ranked.append(
            (
                shots,
                {
                    "shots": shots,
                    "price": price,
                    # When there is no price, the template renders `-` while
                    # keeping the CNY prefix and unit suffix.
                    "no_price": price is None,
                    "unit_key": CONVENTION_UNIT_KEYS.get(shots),
                    "bookable": bookable,
                    "strikethrough": not bookable,
                },
            )
        )

    # The CSV fully determines the number of tiers, so adding one needs no code
    # change. Sort by shot count to keep the plan-grid order stable. ranked is
    # inserted in CSV order, and the sort is stable.
    ranked.sort(key=lambda entry: entry[0])
    return [plan for _shots, plan in ranked]


def load_outdoor(services_dir: str | None = None) -> dict[tuple[str, str], dict[str, object]]:
    """Return portrait photography prices keyed by (type, people); ``services_dir`` follows load_convention."""
    filename = OUTDOOR_CSV
    rows = _read_rows(filename, services_dir)
    missing = {"type", "people", "price"} - set(rows[0])
    if missing:
        raise RuntimeError(f"{filename} is missing column(s): {', '.join(sorted(missing))}")

    plans: dict[tuple[str, str], dict[str, object]] = {}
    for index, row in enumerate(rows, start=2):
        key = (row["type"], row["people"])
        if key not in OUTDOOR_PLAN_KEYS:
            raise RuntimeError(
                f"{filename} line {index}: unrecognized tier: {key[0]}/{key[1]}"
            )
        if key in plans:
            raise RuntimeError(f"{filename} line {index}: duplicate tier: {key[0]}/{key[1]}")
        price = _parse_price(row["price"])
        plans[key] = {
            "price": price,
            "no_price": price is None,
            "bookable": _parse_bookable(filename, index, row),
        }

    absent = [key for key in OUTDOOR_ORDER if key not in plans]
    if absent:
        listed = ", ".join(f"{a}/{b}" for a, b in absent)
        raise RuntimeError(f"{filename} is missing tier(s): {listed}")
    return plans


def outdoor_note_row(plans: dict[tuple[str, str], dict[str, object]]) -> dict[str, str]:
    """Return the studio summary row shown in the notes section.

    Show the paused message when every studio tier is not bookable; show the bookable
    message as soon as at least one tier is available. The note and card strikethroughs
    therefore always agree.
    """
    title_key, paused_key = NOTE_ROW_KEYS["studio"]
    bookable = any(plans[key]["bookable"] for key in OUTDOOR_ORDER if key[0] == "studio")
    return {
        "title_key": title_key,
        "value_key": "studio_bookable" if bookable else paused_key,
    }


def load_pricing(services_dir: str | None = None) -> dict[str, object]:
    """Read both CSV files and return the price-list structure required by services.html.

    If ``services_dir`` is omitted, use the ``SERVICES_DIR`` module constant. The
    build-time cache wrapper passes the actual directory (see
    ``render_app._cached_pricing``).
    """
    convention = load_convention(services_dir)
    outdoor_plans = load_outdoor(services_dir)
    outdoor = [
        {
            "plan_key": OUTDOOR_PLAN_KEYS[key],
            "price": outdoor_plans[key]["price"],
            "no_price": outdoor_plans[key]["no_price"],
            # Strike through tiers marked `no` in the CSV `bookable` column.
            "strikethrough": not outdoor_plans[key]["bookable"],
        }
        for key in OUTDOOR_ORDER
    ]
    return {
        "convention": convention,
        "outdoor": outdoor,
        "outdoor_note": outdoor_note_row(outdoor_plans),
    }
