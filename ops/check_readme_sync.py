#!/usr/bin/env python3

# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Check that the four docs-site README copies still match the root README.

The root README is the single source document. The copies under
`docs/docs/{zh-cn,en-us,ja-jp,ko-kr}/README.md` are maintained by hand: each is the
root body behind a five-line YAML frontmatter block with the same AGPL HTML comment
header, and repository-internal links are rewritten to absolute GitHub URLs.
Translations diverge in prose by design, so zh-cn / ja-jp / ko-kr are compared by
heading structure only, while en-us must be identical to the root body after the
link protocol is normalized. `ops/readme_facts.py` validates facts but reads only
the root README, so copy drift was previously invisible to CI. This checker closes
that gap.

Usage:
    python3 ops/check_readme_sync.py                 # check the repository this script lives in
    python3 ops/check_readme_sync.py --root <dir>    # check another checkout (used by tests)
    python3 ops/check_readme_sync.py --json          # machine-readable result with English keys
    python3 ops/check_readme_sync.py --help

Exit codes: 0 = all copies match, 1 = drift detected, 2 = usage error.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The docs-site copy order is part of the output contract; keep it stable for CI logs and JSON.
LANGUAGES: tuple[str, ...] = ("zh-cn", "en-us", "ja-jp", "ko-kr")
CURRENT_LANGUAGE = "en-us"
ROOT_README = "README.md"

# Only the first 20 failures are printed; a badly outdated copy could otherwise flood CI logs.
MAX_FAILURES = 20
DETAIL_WIDTH = 120
FRONTMATTER_KEY = "aside: false"

HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*#*$")
FENCE_OPEN = re.compile(r"^(`{3,}|~{3,})")
REPO_LINK = re.compile(r"https?://github\.com/ComiCine/ComiCine-website/(?:blob|tree)/main/")
LINK_TARGET = re.compile(r"\]\(([^)\s]+)\)")

USAGE = """Check that the docs-site copies of README.md still match the root README.

The root README is the source document. Each copy is the root body behind five lines
of YAML frontmatter, with repository links rewritten to absolute GitHub URLs.
Translations differ in prose, so zh-cn / ja-jp / ko-kr are compared by heading
structure only; en-us must be identical to the root body once the link protocol is
normalized.

Usage:
  python3 ops/check_readme_sync.py                 check the repository this script lives in
  python3 ops/check_readme_sync.py --root <dir>    check another checkout
  python3 ops/check_readme_sync.py --json          print a machine-readable result
  python3 ops/check_readme_sync.py --help          print this help

Exit codes:
  0  all four copies are synchronized
  1  drift detected (missing file, missing frontmatter key, heading or body mismatch)
  2  usage error
"""


@dataclass(frozen=True)
class Heading:
    level: int
    text: str
    line: int


@dataclass(frozen=True)
class Failure:
    message: str
    details: tuple[str, ...] = ()


@dataclass(frozen=True)
class Document:
    frontmatter: list[str]
    headings: list[Heading]
    body: list[tuple[int, str]]


def read_lines(path: Path) -> list[str]:
    """Read UTF-8 and normalize CRLF / CR so line numbers agree across platforms."""
    text = path.read_text(encoding="utf-8")
    return text.replace("\r\n", "\n").replace("\r", "\n").split("\n")


def split_frontmatter(lines: list[str]) -> tuple[list[str], int]:
    """Return (frontmatter lines, first body index); an unclosed block is treated as body."""
    if not lines or lines[0] != "---":
        return [], 0
    for index in range(1, len(lines)):
        if lines[index] == "---":
            return lines[: index + 1], index + 1
    return [], 0


def comment_lines(lines: list[str]) -> set[int]:
    """Return 0-based indexes of lines that belong to an HTML comment.

    A line that opens a comment is excluded even when the comment closes on the same
    line, because comments are outside the body protocol. This also removes the AGPL
    header, whose wording differs between the root README and the docs copies.
    """
    marked: set[int] = set()
    in_comment = False
    for index, line in enumerate(lines):
        if in_comment:
            marked.add(index)
            if "-->" in line:
                in_comment = False
            continue
        opening = line.find("<!--")
        if opening == -1:
            continue
        marked.add(index)
        if "-->" not in line[opening + len("<!--") :]:
            in_comment = True
    return marked


def fence_run(stripped: str, char: str) -> int:
    """Return the length of the leading run of `char` in a stripped line."""
    length = 0
    while length < len(stripped) and stripped[length] == char:
        length += 1
    return length


def parse_headings(lines: list[str], comments: set[int]) -> list[Heading]:
    """Collect ATX headings while skipping comments and fenced code blocks.

    The fence length is tracked so a shorter run inside the block cannot close it.
    """
    headings: list[Heading] = []
    fence_char = ""
    fence_length = 0
    for index, line in enumerate(lines):
        if index in comments:
            continue
        stripped = line.strip()
        if fence_char:
            if fence_run(stripped, fence_char) >= fence_length:
                fence_char = ""
                fence_length = 0
            continue
        opener = FENCE_OPEN.match(stripped)
        if opener:
            fence_char = opener.group(1)[0]
            fence_length = len(opener.group(1))
            continue
        match = HEADING.match(line)
        if match:
            headings.append(Heading(level=len(match.group(1)), text=match.group(2), line=index + 1))
    return headings


def normalize_links(line: str) -> str:
    """Rewrite absolute repository links back to the relative form used by the root README."""
    line = REPO_LINK.sub("", line)

    def relative(match: re.Match[str]) -> str:
        target = match.group(1)
        if "://" in target or target.startswith(("#", "mailto:")):
            return match.group(0)
        # The protocol may carry a trailing slash where the relative form does not.
        if target != "/" and target.endswith("/"):
            target = target[:-1]
        return f"]({target})"

    return LINK_TARGET.sub(relative, line)


def parse_document(lines: list[str]) -> Document:
    """Parse one README into the frontmatter, structural headings, and comparison body."""
    frontmatter, body_start = split_frontmatter(lines)
    comments = comment_lines(lines)
    body = [
        (index + 1, line.rstrip())
        for index, line in enumerate(lines)
        if index >= body_start and index not in comments
    ]
    while body and not body[0][1]:
        body.pop(0)
    while body and not body[-1][1]:
        body.pop()
    return Document(
        frontmatter=frontmatter,
        headings=parse_headings(lines, comments),
        body=body,
    )


def shorten(text: str) -> str:
    """Keep failure details readable; an empty body line is shown explicitly."""
    if not text:
        return "<blank>"
    return text if len(text) <= DETAIL_WIDTH else text[: DETAIL_WIDTH - 3] + "..."


def compare_structure(
    relative: str, language: str, root: Document, copy: Document
) -> list[Failure]:
    """Compare heading levels, and heading text only for the English copy."""
    failures: list[Failure] = []
    expected = root.headings
    found = copy.headings
    if len(found) != len(expected):
        # An extra heading has a known line; a missing one has none, so point at the file start.
        line = found[len(expected)].line if len(found) > len(expected) else 1
        failures.append(
            Failure(
                f"FATAL: {relative}:{line}: expected {len(expected)} headings like README.md, "
                f"found {len(found)}"
            )
        )
        return failures

    for index, (copy_heading, root_heading) in enumerate(zip(found, expected, strict=True)):
        if copy_heading.level != root_heading.level:
            failures.append(
                Failure(
                    f"FATAL: {relative}:{copy_heading.line}: heading level {copy_heading.level} "
                    f"at this position, README.md has level {root_heading.level} "
                    f'("{copy_heading.text}"; README.md heading #{index + 1})'
                )
            )
            return failures

    if language != CURRENT_LANGUAGE:
        return failures
    for copy_heading, root_heading in zip(found, expected, strict=True):
        if copy_heading.text != root_heading.text:
            failures.append(
                Failure(
                    f"FATAL: {relative}:{copy_heading.line}: heading text differs from README.md "
                    f"(README.md:{root_heading.line})"
                )
            )
    return failures


def compare_body(relative: str, root: Document, copy: Document) -> list[Failure]:
    """Require the en-us body to equal the root body line by line after link normalization."""
    failures: list[Failure] = []
    expected = [(line, normalize_links(text)) for line, text in root.body]
    found = [(line, normalize_links(text)) for line, text in copy.body]
    common = min(len(expected), len(found))

    for index in range(common):
        if expected[index][1] == found[index][1]:
            continue
        failures.append(
            Failure(
                f"FATAL: {relative}:{found[index][0]}: body line differs from "
                f"README.md:{expected[index][0]}",
                (
                    f"  expected: {shorten(expected[index][1])}",
                    f"  found: {shorten(found[index][1])}",
                ),
            )
        )

    if len(found) > len(expected):
        failures.append(
            Failure(
                f"FATAL: {relative}:{found[common][0]}: body has "
                f"{len(found) - len(expected)} extra trailing lines not in README.md"
            )
        )
    elif len(expected) > len(found):
        # Content that was never written has no copy line; point just past the copy body.
        line = found[-1][0] + 1 if found else 1
        failures.append(
            Failure(
                f"FATAL: {relative}:{line}: body is missing {len(expected) - len(found)} trailing "
                f"lines that README.md has (README.md:{expected[common][0]})"
            )
        )
    return failures


def check_copy(relative: str, language: str, root: Document, copy: Document) -> list[Failure]:
    """Apply the documentation protocol to one copy and return its failures."""
    failures: list[Failure] = []
    if not any(line.strip() == FRONTMATTER_KEY for line in copy.frontmatter):
        failures.append(Failure(f"FATAL: {relative}: frontmatter missing '{FRONTMATTER_KEY}'"))
    failures.extend(compare_structure(relative, language, root, copy))
    if language == CURRENT_LANGUAGE:
        failures.extend(compare_body(relative, root, copy))
    return failures


def relative_name(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def collect_failures(root: str | Path = ROOT) -> list[Failure]:
    """Return every drift failure for `root`; an empty list means the copies are synchronized."""
    root_path = Path(root)
    root_readme = root_path / ROOT_README
    if not root_readme.is_file():
        return [Failure(f"FATAL: {ROOT_README}: missing file")]
    try:
        root_document = parse_document(read_lines(root_readme))
    except (OSError, UnicodeDecodeError) as exc:
        return [Failure(f"FATAL: {ROOT_README}: cannot read file ({exc})")]

    failures: list[Failure] = []
    for language in LANGUAGES:
        copy_path = root_path / "docs" / "docs" / language / "README.md"
        relative = relative_name(root_path, copy_path)
        if not copy_path.is_file():
            failures.append(Failure(f"FATAL: {relative}: missing file"))
            continue
        try:
            copy_document = parse_document(read_lines(copy_path))
        except (OSError, UnicodeDecodeError) as exc:
            failures.append(Failure(f"FATAL: {relative}: cannot read file ({exc})"))
            continue
        failures.extend(check_copy(relative, language, root_document, copy_document))
    return failures


def check(root: str | Path = ROOT) -> list[str]:
    """Return the printable drift lines for `root`; an empty list means synchronized."""
    lines: list[str] = []
    for failure in collect_failures(root):
        lines.append(failure.message)
        lines.extend(failure.details)
    return lines


def success_line() -> str:
    return f"readme sync: OK ({len(LANGUAGES)} copies match README.md)"


def json_result(root: Path, failures: list[Failure]) -> dict:
    return {
        "ok": not failures,
        "root": str(root),
        "root_readme": ROOT_README,
        "languages": list(LANGUAGES),
        "failure_count": len(failures),
        "failures": [
            {"message": failure.message, "details": list(failure.details)}
            for failure in failures[:MAX_FAILURES]
        ],
        "truncated": len(failures) > MAX_FAILURES,
        "summary": success_line()
        if not failures
        else f"readme sync: FAILED ({len(failures)} problems)",
        "exit_code": 0 if not failures else 1,
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    root = ROOT
    as_json = False
    index = 0
    while index < len(args):
        argument = args[index]
        if argument in ("--help", "-h"):
            print(USAGE)
            return 0
        if argument == "--json":
            as_json = True
            index += 1
            continue
        if argument == "--root":
            if index + 1 >= len(args):
                print("FATAL: --root requires a directory", file=sys.stderr)
                return 2
            root = Path(args[index + 1])
            index += 2
            continue
        print(f"FATAL: unknown argument {argument}", file=sys.stderr)
        return 2

    failures = collect_failures(root)
    if as_json:
        print(json.dumps(json_result(root, failures), ensure_ascii=False, indent=2))
        return 0 if not failures else 1
    if not failures:
        print(success_line())
        return 0
    for failure in failures[:MAX_FAILURES]:
        print(failure.message)
        for detail in failure.details:
            print(detail)
    if len(failures) > MAX_FAILURES:
        print(f"... {len(failures) - MAX_FAILURES} more")
    return 1


if __name__ == "__main__":
    sys.exit(main())
