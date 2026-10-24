# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Price list for services.limooo.cn; CSV is the single source of data and is read at build time."""

import re

import pytest

import build
from render_app import RENDER_APP
from services_pricing import (
    CONVENTION_CSV,
    OUTDOOR_CSV,
    load_pricing,
)


def _write(dir_path, name, text):
    path = dir_path / name
    path.write_text(text, encoding="utf-8")
    return path


# An autouse fixture used to call render_app._cached_pricing.cache_clear() before and after each case.
# At the time, the cache closed over SERVICES_DIR at import time, so changing directories did not invalidate it. render_app now
# **uses the directory as its key** (`_cached_pricing(services_dir)`; see the comment in render_app),
# so changing directories naturally misses the cache. The cache_clear workaround became dead code and was removed.
# Regression coverage: tests/test_build_w4.py::test_two_services_dirs_do_not_cross_pollute
# renders two temporary directories consecutively, **without** cache_clear, and asserts they do not cross-pollute.


@pytest.fixture
def services_dir(tmp_path, monkeypatch):
    """Point the price-list directory at a temporary directory so the test does not depend on repository CSV contents."""
    monkeypatch.setattr("services_pricing.SERVICES_DIR", str(tmp_path))
    return tmp_path


def test_load_pricing_reads_both_csv(services_dir):
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,20\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\nstudio,solo,100\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
    )

    pricing = load_pricing()

    assert [plan["price"] for plan in pricing["convention"]] == [20, 55, 100, 150]
    assert [plan["unit_key"] for plan in pricing["convention"]] == [
        "unit_per_shot",
        "unit_per_3",
        "unit_per_6",
        "unit_per_9",
    ]
    assert [plan["plan_key"] for plan in pricing["outdoor"]] == [
        "plan_studio_solo",
        "plan_studio_duo",
        "plan_outdoor_solo",
        "plan_outdoor_duo",
    ]
    assert [plan["price"] for plan in pricing["outdoor"]] == [100, 150, 120, 180]


def test_convention_rows_are_sorted_by_shot_count(services_dir):
    _write(services_dir, CONVENTION_CSV, "shots,price\n9,150\n1,20\n6,100\n3,55\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\nstudio,solo,100\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
    )

    pricing = load_pricing()

    assert [plan["shots"] for plan in pricing["convention"]] == [1, 3, 6, 9]


def test_outdoor_rows_are_rendered_in_fixed_order(services_dir):
    """Changing CSV row order must not change the layout of the four cards (studio first, then outdoor)."""
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,20\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\noutdoor,duo,180\nstudio,solo,100\noutdoor,solo,120\nstudio,duo,150\n",
    )

    pricing = load_pricing()

    assert [plan["price"] for plan in pricing["outdoor"]] == [100, 150, 120, 180]


@pytest.mark.parametrize(
    "bookable,expected",
    [
        ("yes", [False, False, False, False]),
        ("no", [True, True, True, True]),
        ("", [False, False, False, False]),
        (None, [False, False, False, False]),
    ],
)
def test_bookable_column_drives_the_strikethrough(services_dir, bookable, expected):
    """`bookable=no` adds a strikethrough; `yes`, blank, or a missing column does not."""
    column = "" if bookable is None else ",bookable"
    cells = [bookable] * 4 if bookable is not None else [None] * 4

    def row(kind, who, price, cell):
        base = f"{kind},{who},{price}"
        return base if cell is None else f"{base},{cell}"

    _write(
        services_dir,
        CONVENTION_CSV,
        "shots,price" + column + "\n"
        + "\n".join(
            f"{shots},{price}" + ("" if bookable is None else f",{bookable}")
            for shots, price in ((1, 20), (3, 55), (6, 100), (9, 150))
        )
        + "\n",
    )
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price" + column + "\n"
        + "\n".join(
            row(kind, who, price, cells[i])
            for i, (kind, who, price) in enumerate(
                (
                    ("studio", "solo", 100),
                    ("studio", "duo", 150),
                    ("outdoor", "solo", 120),
                    ("outdoor", "duo", 180),
                )
            )
        )
        + "\n",
    )

    pricing = load_pricing()

    assert [plan["strikethrough"] for plan in pricing["outdoor"]] == expected
    assert [plan["strikethrough"] for plan in pricing["convention"]] == expected


@pytest.mark.parametrize(
    "studio,expected",
    [
        # When neither studio tier is bookable, show the paused note.
        (("no", "no"), "studio_paused"),
        # If either tier is bookable, show the available note so it does not contradict card strikethroughs.
        (("yes", "yes"), "studio_bookable"),
        (("yes", "no"), "studio_bookable"),
        # A blank value also means bookable.
        (("", ""), "studio_bookable"),
    ],
)
def test_studio_note_row_follows_the_bookable_column(services_dir, studio, expected):
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,20\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price,bookable\n"
        f"studio,solo,100,{studio[0]}\nstudio,duo,150,{studio[1]}\n"
        "outdoor,solo,120,yes\noutdoor,duo,180,yes\n",
    )

    pricing = load_pricing()

    assert pricing["outdoor_note"] == {
        "title_key": "extra_studio",
        "value_key": expected,
    }


def test_studio_note_row_is_rendered(services_dir):
    """The note row must be rendered by the template; show the paused message when no studio tier is bookable."""
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,20\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price,bookable\n"
        "studio,solo,100,no\nstudio,duo,150,no\noutdoor,solo,120,yes\noutdoor,duo,180,yes\n",
    )

    html = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")

    assert 'data-i18n="extra_studio"' in html
    assert 'data-i18n="studio_paused"' in html
    assert 'data-i18n="studio_bookable"' not in html


def test_invalid_bookable_value_fails_the_build(services_dir):
    _write(services_dir, CONVENTION_CSV, "shots,price,bookable\n1,20,maybe\n3,55,yes\n6,100,yes\n9,150,yes\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price,bookable\nstudio,solo,100,yes\nstudio,duo,150,yes\noutdoor,solo,120,yes\noutdoor,duo,180,yes\n",
    )

    with pytest.raises(RuntimeError) as excinfo:
        load_pricing()

    assert "bookable" in str(excinfo.value) and "unrecognized" in str(excinfo.value)


@pytest.mark.parametrize(
    "convention,outdoor,message",
    [
        ("shots,price\n1,20\n3,55\n6,100\n9,150\n", "type,people,price\nstudio,solo,100\n", "missing tier"),
        ("shots\n1\n3\n6\n9\n", None, "missing column"),
    ],
)
def test_invalid_csv_fails_the_build(services_dir, convention, outdoor, message):
    _write(services_dir, CONVENTION_CSV, convention)
    if outdoor is not None:
        _write(services_dir, OUTDOOR_CSV, outdoor)

    with pytest.raises(RuntimeError) as excinfo:
        load_pricing()

    assert message in str(excinfo.value)


def test_missing_csv_fails_the_build(services_dir):
    with pytest.raises(RuntimeError) as excinfo:
        load_pricing()

    assert "cannot read price list" in str(excinfo.value)


def test_services_page_renders_csv_prices(services_dir):
    """Prices in the template must come from the CSV rather than hard-coded constants."""
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,30\n3,60\n6,110\n9,160\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price,bookable\n"
        "studio,solo,110,no\nstudio,duo,160,no\noutdoor,solo,130,yes\noutdoor,duo,190,\n",
    )
    html = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")

    assert re.findall(r'<span class="price-num">CNY (\d+)', html) == [
        "30",
        "60",
        "110",
        "160",
        "110",
        "160",
        "130",
        "190",
    ]
    # Tier labels and unit suffixes still use i18n.
    assert 'data-i18n="plan_studio_solo"' in html
    assert 'data-i18n="unit_per_9"' in html
    # Mark both studio tiers as unavailable with strikethrough; do not mark either outdoor tier.
    assert html.count('class="plan-price strikethrough"') == 2


@pytest.mark.parametrize(
    "literal",
    ["N/A", "n/a", "NA", " N/A ", "TBD", "", "1OO", "0", "-5", "12.5"],
)
def test_non_positive_integer_price_renders_dash(services_dir, literal):
    """There is no price placeholder allowlist: values that do not parse as positive integers (`N/A`, blank, invalid text, `0`, or a negative number) map to `no_price`, and the build still succeeds."""
    _write(
        services_dir,
        CONVENTION_CSV,
        f"shots,price\n1,{literal}\n3,55\n6,100\n9,150\n",
    )
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\n"
        f"studio,solo,{literal}\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
    )

    pricing = load_pricing()

    assert pricing["convention"][0]["price"] is None
    assert pricing["convention"][0]["no_price"] is True
    assert pricing["convention"][1]["no_price"] is False
    assert pricing["outdoor"][0]["price"] is None
    assert pricing["outdoor"][0]["no_price"] is True
    assert [plan["no_price"] for plan in pricing["outdoor"]] == [
        True,
        False,
        False,
        False,
    ]


def test_no_price_renders_as_dash(services_dir):
    """When a price is missing, replace only the number with `-`; keep the `CNY` prefix and unit suffix in place, and leave other tiers unchanged."""
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,N/A\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\nstudio,solo,TBD\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,0\n",
    )

    html = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")

    # Studio photography uses a per-shot suffix; outdoor photography uses a per-hour suffix. Keep both prefixes.
    assert '<span class="price-num">CNY -<span class="plan-unit" data-i18n="unit_per_shot">' in html
    assert (
        html.count(
            '<span class="price-num">CNY -<span class="plan-unit" data-i18n="unit_per_hour">'
        )
        == 2
    )
    assert "N/A" not in html
    assert "TBD" not in html
    assert "CNY None" not in html
    assert re.findall(r'<span class="price-num">CNY (\d+)', html) == [
        "55",
        "100",
        "150",
        "150",
        "120",
    ]


def test_services_page_matches_committed_csv():
    """The repository's actual CSV files must render, so malformed formatting cannot be committed or deployed unnoticed."""
    pricing = load_pricing()

    assert pricing["convention"], "convention.csv must have at least one tier"
    assert len(pricing["outdoor"]) == 4
    # Shot counts are ascending and unique.
    shots = [plan["shots"] for plan in pricing["convention"]]
    assert shots == sorted(shots) and len(set(shots)) == len(shots)

    html = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")
    # Render one price cell per tier (a number or `-`), matching the CSV row count.
    assert html.count('<span class="price-num">') == len(pricing["convention"]) + 4
    assert "None" not in html


def test_overflow_price_column_renders_dash(services_dir):
    """An extra comma in a price such as `1,000` must not make the build raise `AttributeError`.

    When a data row has more fields than the header, `csv.DictReader` stores the overflow fields in `row[None]` as a list. The rule is that values that do not parse as positive integers render as `-` and never fail the build, so the overflow fields must be normalized to a string (`"1,000"`) and passed to `_parse_price`, which returns `None`.
    """
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,1,000\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\nstudio,solo,1,000\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
    )

    pricing = load_pricing()

    assert pricing["convention"][0]["price"] is None
    assert pricing["convention"][0]["no_price"] is True
    assert [plan["price"] for plan in pricing["convention"]] == [None, 55, 100, 150]
    assert pricing["outdoor"][0]["price"] is None
    assert pricing["outdoor"][0]["no_price"] is True

    html = build.render_page(RENDER_APP, "services.html", "/services", "zh-cn")

    # For an overflow tier, replace only the number with `-`; keep the CNY prefix and unit suffix, and leave other tiers unchanged.
    assert '<span class="price-num">CNY -<span class="plan-unit" data-i18n="unit_per_shot">' in html
    assert re.findall(r'<span class="price-num">CNY (\d+)', html) == [
        "55",
        "100",
        "150",
        "150",
        "120",
        "180",
    ]
    assert "1,000" not in html
    assert "CNY None" not in html


@pytest.mark.parametrize(
    "filename,text",
    [
        (CONVENTION_CSV, "shots,price,price\n1,20\n3,55\n6,100\n9,150\n"),
        (
            OUTDOOR_CSV,
            "type,people,price,price\n"
            "studio,solo,100\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
        ),
    ],
)
def test_duplicate_header_fails_the_build(services_dir, filename, text):
    """Duplicate headers (`shots,price,price`) would silently select the last column; the build must fail and include the filename in the error."""
    _write(services_dir, CONVENTION_CSV, "shots,price\n1,20\n3,55\n6,100\n9,150\n")
    _write(
        services_dir,
        OUTDOOR_CSV,
        "type,people,price\nstudio,solo,100\nstudio,duo,150\noutdoor,solo,120\noutdoor,duo,180\n",
    )
    _write(services_dir, filename, text)

    with pytest.raises(RuntimeError) as excinfo:
        load_pricing()

    assert filename in str(excinfo.value)
    assert "duplicate" in str(excinfo.value)
