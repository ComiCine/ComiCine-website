#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Cross-host 404 contract smoke test for the live ComiCine sites.

Read-only: sends unauthenticated GET requests only, never follows a redirect,
never sends a Cookie header, and never forges the main site's __gate cookie.
Every request uses the crawler User-Agent allowlisted in docs/lists/robots.txt
(Googlebot), so the main site's Turnstile gate cannot turn a 404 into a 200 or
403 and hide the result.

One default run checks the unified 404 contract on four hosts:
  1. An unknown HTML page on comicine.com renders the localized 404 in place:
     status 404, no Refresh, no Location, Cache-Control with no-store, and a
     body that contains id="not-found-heading".
  2. The same path on docs.comicine.com, status.comicine.com, and
     image.comicine.com keeps status 404 and no Location, sets Cache-Control
     no-store, sets Refresh exactly to 0; url=https://comicine.com/404, and
     mentions that URL in the body.
  3. https://comicine.com/404 keeps status 404 with no Refresh, no Location,
     and the localized heading.
  4. An unknown /api/ path on comicine.com keeps its native 404 and adds no
     Refresh shell, because API errors must stay in their native format.
  5. A missing image asset on image.comicine.com keeps its native 404 and adds
     no Refresh shell, for the same reason.

A failed check prints one block with the host, path, request Accept, status,
the Location, Refresh, Cache-Control, and Content-Type headers, and the failed
assertions. A successful run prints exactly one line:
    404 smoke: ok (4 hosts)

Usage:
    python3 ops/smoke_404.py
    python3 ops/smoke_404.py --host comicine.com --docs-host docs.comicine.com
    python3 ops/smoke_404.py --help
"""

from __future__ import annotations

import argparse
import http.client
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlsplit

DEFAULT_HOSTS = {
    "main": "comicine.com",
    "docs": "docs.comicine.com",
    "status": "status.comicine.com",
    "image": "image.comicine.com",
}
MAIN_404_URL = "https://comicine.com/404"
MISSING_PAGE_PATH = "/__codex_missing_page__"
MISSING_API_PATH = "/api/__missing__"
MISSING_IMAGE_PATH = "/qr-codes/__missing__.png"
CRAWLER_UA = "Googlebot/2.1 (+http://www.google.com/bot.html)"
TIMEOUT_S = 15
ATTEMPTS = 3
RETRY_DELAY_S = 0.5
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Return every 3xx response to the caller instead of following it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class KeepAliveHTTPSConnection(http.client.HTTPSConnection):
    """Send Connection: keep-alive, which urllib would otherwise force to close.

    The live 404 page is streamed with chunked transfer encoding. With urllib's
    default Connection: close the edge sometimes ends the stream early, so the
    body arrives truncated (http.client.IncompleteRead) even though the status
    and headers are correct. A persistent connection delivers the whole body;
    the server still closes it after the final chunk.
    """

    def request(self, method, url, body=None, headers=None, *, encode_chunked=False):
        merged = dict(headers or {})
        merged["Connection"] = "keep-alive"
        return super().request(method, url, body=body, headers=merged, encode_chunked=encode_chunked)


class KeepAliveHTTPSHandler(urllib.request.HTTPSHandler):
    """Use KeepAliveHTTPSConnection for https requests through the urllib opener."""

    def https_open(self, req):
        return self.do_open(KeepAliveHTTPSConnection, req, context=getattr(self, "_context", None))


OPENER = urllib.request.build_opener(NoRedirectHandler(), KeepAliveHTTPSHandler())


@dataclass
class Fetch:
    """One HTTP response (a 3xx arrives here as an HTTPError with the same data)."""

    status: int | None
    headers: list[tuple[str, str]]
    body: bytes
    error: str | None

    def header(self, name: str) -> str | None:
        wanted = name.lower()
        values = [value for key, value in self.headers if key.lower() == wanted]
        return ", ".join(values) if values else None

    def text(self) -> str:
        return self.body.decode("utf-8", errors="replace")


@dataclass
class Check:
    """One contract check and the reasons it failed; empty reasons means it passed."""

    label: str
    host: str
    path: str
    accept: str
    fetched: Fetch
    reasons: list[str] = field(default_factory=list)


def normalize_origin(value: str) -> tuple[str, str]:
    """Turn a host or origin into (origin, host) and reject a path or query."""
    raw = value.strip()
    if not raw:
        raise ValueError("expected a host or origin")
    if "://" not in raw:
        raw = f"https://{raw}"
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ValueError("expected an http(s) host or origin")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise ValueError("expected a host or origin without a path, query, or fragment")
    return f"{parts.scheme}://{parts.netloc}", parts.netloc


def fetch_once(url: str, accept: str) -> Fetch:
    """Send one GET request and return status, headers, and body; never follow a redirect."""
    request = urllib.request.Request(
        url,
        headers={"User-Agent": CRAWLER_UA, "Accept": accept},
        method="GET",
    )
    try:
        with OPENER.open(request, timeout=TIMEOUT_S) as response:
            return Fetch(response.status, list(response.headers.items()), response.read(), None)
    except urllib.error.HTTPError as exc:
        # A redirect handler that returns None leaves a 3xx here, with Location
        # still visible, instead of following it to another host.
        try:
            headers = list(exc.headers.items()) if exc.headers else []
            try:
                body = exc.read()
            except http.client.HTTPException as read_exc:
                # A truncated chunked body is a transport failure, not a body
                # assertion: keep the partial bytes only for debugging and let
                # the retry loop try again with a fresh connection.
                partial = getattr(read_exc, "partial", b"") or b""
                return Fetch(exc.code, headers, partial, f"{type(read_exc).__name__}: {read_exc}")
            return Fetch(exc.code, headers, body, None)
        finally:
            exc.close()
    except http.client.HTTPException as exc:
        return Fetch(None, [], b"", f"{type(exc).__name__}: {exc}")
    except (urllib.error.URLError, OSError) as exc:
        return Fetch(None, [], b"", f"{type(exc).__name__}: {exc}")


def fetch(url: str, accept: str) -> Fetch:
    """Retry transport errors and transient statuses; keep the final result deterministic."""
    result = fetch_once(url, accept)
    attempt = 1
    while attempt < ATTEMPTS and (result.error is not None or result.status in RETRY_STATUSES):
        time.sleep(RETRY_DELAY_S)
        result = fetch_once(url, accept)
        attempt += 1
    return result


def expect_status(check: Check, expected: int) -> None:
    if check.fetched.status != expected:
        check.reasons.append(f"status {check.fetched.status}, expected {expected}")


def expect_no_location(check: Check) -> None:
    value = check.fetched.header("Location")
    if value is not None:
        check.reasons.append(f"Location must be absent, got {value!r}")


def expect_no_refresh(check: Check) -> None:
    value = check.fetched.header("Refresh")
    if value is not None:
        check.reasons.append(f"Refresh must be absent, got {value!r}")


def expect_no_store(check: Check) -> None:
    value = check.fetched.header("Cache-Control")
    if value is None or "no-store" not in value.lower():
        shown = value if value is not None else "-"
        check.reasons.append(f"Cache-Control must contain no-store, got {shown!r}")


def expect_refresh_shell(check: Check) -> None:
    value = check.fetched.header("Refresh")
    expected = f"0; url={MAIN_404_URL}"
    actual = value.strip() if value is not None else None
    if actual != expected:
        check.reasons.append(f"Refresh must be {expected!r}, got {value!r}")


def expect_body_contains(check: Check, needle: str) -> None:
    if needle not in check.fetched.text():
        check.reasons.append(f"body must contain {needle!r}")


def run_check(
    label: str,
    host: str,
    origin: str,
    path: str,
    accept: str,
    assertions,
) -> Check:
    """Fetch one URL and run its assertions; a transport failure is the only reason reported."""
    fetched = fetch(f"{origin}{path}", accept)
    check = Check(label=label, host=host, path=path, accept=accept, fetched=fetched)
    if fetched.error is not None:
        check.reasons.append(f"request failed: {fetched.error}")
        return check
    assertions(check)
    return check


def collect_checks(origins: dict[str, str], hosts: dict[str, str]) -> list[Check]:
    """Build every default check, in a fixed order."""
    checks = [
        run_check(
            "unknown HTML page stays a subsite 404" if scope != "main" else "unknown HTML page renders the main-site 404",
            hosts[scope],
            origins[scope],
            MISSING_PAGE_PATH,
            "text/html",
            _subsite_assertions if scope != "main" else _main_page_assertions,
        )
        for scope in ("main", "docs", "status", "image")
    ]
    checks.append(
        run_check(
            "canonical main-site 404 keeps its status and heading",
            hosts["main"],
            origins["main"],
            "/404",
            "text/html",
            _main_404_assertions,
        )
    )
    checks.append(
        run_check(
            "main-site API 404 keeps its native format",
            hosts["main"],
            origins["main"],
            MISSING_API_PATH,
            "application/json",
            _api_assertions,
        )
    )
    checks.append(
        run_check(
            "image host asset 404 keeps its native format",
            hosts["image"],
            origins["image"],
            MISSING_IMAGE_PATH,
            "image/*",
            _asset_assertions,
        )
    )
    return checks


def _main_page_assertions(check: Check) -> None:
    expect_status(check, 404)
    expect_no_location(check)
    expect_no_store(check)
    expect_no_refresh(check)
    expect_body_contains(check, 'id="not-found-heading"')


def _subsite_assertions(check: Check) -> None:
    expect_status(check, 404)
    expect_no_location(check)
    expect_no_store(check)
    expect_refresh_shell(check)
    expect_body_contains(check, MAIN_404_URL)


def _main_404_assertions(check: Check) -> None:
    expect_status(check, 404)
    expect_no_refresh(check)
    expect_no_location(check)
    expect_no_store(check)
    expect_body_contains(check, 'id="not-found-heading"')


def _api_assertions(check: Check) -> None:
    expect_status(check, 404)
    expect_no_refresh(check)


def _asset_assertions(check: Check) -> None:
    expect_status(check, 404)
    expect_no_refresh(check)


def format_failure(check: Check) -> str:
    """Format one failing check as a deterministic block with aligned fields."""
    fetched = check.fetched
    lines = [f"FAIL: {check.label}"]
    lines.append(f"  {'host:':<15} {check.host}")
    lines.append(f"  {'path:':<15} {check.path}")
    lines.append(f"  {'accept:':<15} {check.accept}")
    lines.append(f"  {'status:':<15} {fetched.status if fetched.status is not None else '-'}")
    for name in ("Location", "Refresh", "Cache-Control", "Content-Type"):
        value = fetched.header(name)
        lines.append(f"  {name + ':':<15} {value if value is not None else '-'}")
    for reason in check.reasons:
        lines.append(f"  {'reason:':<15} {reason}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="smoke_404.py",
        description=(
            "Verify the cross-host 404 contract on the live ComiCine sites with read-only GET "
            "requests. Redirects are never followed and no cookies are sent."
        ),
        epilog=(
            "Exit codes: 0 when every check passes, 1 when any check fails, 2 on bad arguments.\n"
            "A successful default run prints exactly: 404 smoke: ok (4 hosts)"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--host",
        default=None,
        metavar="HOST",
        help=f"main site host or origin (default: {DEFAULT_HOSTS['main']})",
    )
    parser.add_argument(
        "--docs-host",
        default=None,
        metavar="HOST",
        help=f"docs site host or origin (default: {DEFAULT_HOSTS['docs']})",
    )
    parser.add_argument(
        "--status-host",
        default=None,
        metavar="HOST",
        help=f"status site host or origin (default: {DEFAULT_HOSTS['status']})",
    )
    parser.add_argument(
        "--image-host",
        default=None,
        metavar="HOST",
        help=f"image site host or origin (default: {DEFAULT_HOSTS['image']})",
    )
    return parser


def main(argv: list[str]) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    origins: dict[str, str] = {}
    hosts: dict[str, str] = {}
    for scope, option in (
        ("main", "host"),
        ("docs", "docs_host"),
        ("status", "status_host"),
        ("image", "image_host"),
    ):
        raw = getattr(args, option) or DEFAULT_HOSTS[scope]
        try:
            origin, host = normalize_origin(raw)
        except ValueError as exc:
            parser.error(f"--{option.replace('_', '-')}: {exc}")
        origins[scope] = origin
        hosts[scope] = host

    checks = collect_checks(origins, hosts)
    failures = [check for check in checks if check.reasons]
    if failures:
        print("\n\n".join(format_failure(check) for check in failures))
        return 1
    print("404 smoke: ok (4 hosts)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
