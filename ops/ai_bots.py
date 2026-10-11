#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026 Limooo <https://limooo.cn/>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

"""Zone AI-bot policy: read, snapshot and (optionally) set it to "do not block".

Why this exists (2026-10-12): limooo.cn is deliberately open to crawlers and AI
agents -- see docs/lists/crawlers.txt (the User-Agent allow-list that skips the
human-verification gate) and the generated /robots.txt. The edge, however, has
its own AI-bot blocking, and it wins **before** any Worker code runs: with the
default policy, requests from GPTBot / ClaudeBot / CCBot / Amazonbot /
Bytespider and friends are answered by the Cloudflare Managed Free Ruleset with
403 "Your request was blocked." (rule ref `block-ai-on-ads`), so nothing the
Pages Functions do can let them in. This script is the switch for that layer.

It talks to `GET/PATCH /zones/{zone_id}/bot_management`, which is a
**Bot Management** endpoint: the API token needs the "Bot Management: Edit"
permission (Read is enough for --show / --snapshot). Without it the API answers
403 Authentication error. That is an account-side change (token or Dashboard),
not something this script can grant itself; when the permission is missing the
script says so and exits non-zero instead of pretending the zone is fixed.

Modes:
  --show       live: print the AI-related keys, write nothing.
  --snapshot   live: refresh ops/ai-bots.snapshot.json.
  --apply      live: PATCH the managed keys to their allow-crawlers values.
  --dry-run    fully offline: read the committed snapshot and print the plan
               (default when no mode is given).

Managed keys (only those the zone actually reports are touched, so a plan that
does not expose a field is never sent it):
  ai_bots_protection    -> "disabled"   (legacy "Block AI bots" toggle; the value
                                         that produced `only_on_ad_pages` today)
  ai_search             -> "disabled"   (robots/policy for AI search crawlers)
  ai_user               -> "disabled"   (robots/policy for AI assistants/agents)
  ai_training           -> "disabled"   (robots/policy for AI training crawlers)
  crawler_protection    -> "disabled"   (AI Labyrinth: sends AI crawlers into a
                                         link maze -- that is not "access")
  is_robots_txt_managed -> false        (Cloudflare prepends a managed robots.txt
                                         derived from the three policies above;
                                         robots.txt is owned by src/build.py now)

Reported but never changed: fight_mode, content_bots_protection,
bot_preference_sync_enabled, stale_zone_configuration. Those decide whether other
automated traffic is challenged or blocked; flipping them is a product decision,
so the script only prints them (with a hint when they look like they are on).

Credentials: CLOUDFLARE_API_TOKEN (and optional CLOUDFLARE_ZONE_ID) from the
environment, else from the local secrets/webauthn.env. The token is never echoed
and never written to the snapshot.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SECRETS_FILE = Path(os.environ.get("AI_BOTS_ENV_FILE", ROOT / "secrets" / "webauthn.env"))
SNAPSHOT = Path(os.environ.get("AI_BOTS_SNAPSHOT", ROOT / "ops" / "ai-bots.snapshot.json"))
ZONE_NAME = os.environ.get("ZONE_NAME", "limooo.cn")
API_BASE = "https://api.cloudflare.com/client/v4"
ENDPOINT = "/zones/{zone_id}/bot_management"

# Value that means "do not block / do not add a policy" for every AI-bot key.
ALLOW = "disabled"

# key -> desired value. Order is the order they are printed in.
MANAGED: tuple[tuple[str, object], ...] = (
    ("ai_bots_protection", ALLOW),
    ("ai_search", ALLOW),
    ("ai_user", ALLOW),
    ("ai_training", ALLOW),
    ("crawler_protection", ALLOW),
    ("is_robots_txt_managed", False),
)

# Printed for context; never written by --apply.
REPORT_ONLY = (
    "fight_mode",
    "content_bots_protection",
    "bot_preference_sync_enabled",
    "stale_zone_configuration",
    "cf_robots_variant",
)

# REPORT_ONLY keys whose "on" value would block or challenge non-verified bots.
REPORT_BLOCKING = {
    "fight_mode": "true",
    "content_bots_protection": "block",
    "bot_preference_sync_enabled": "true",
}


def read_token() -> str:
    """Token from the environment, else from secrets/webauthn.env (never echoed)."""
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if token:
        return token
    if not SECRETS_FILE.is_file():
        return ""
    for line in SECRETS_FILE.read_text(encoding="utf-8").splitlines():
        if line.startswith("CLOUDFLARE_API_TOKEN="):
            return line.split("=", 1)[1].strip()
    return ""


def resolve_zone_id(token: str) -> str:
    zone_id = (os.environ.get("CLOUDFLARE_ZONE_ID") or "").strip()
    if zone_id:
        return zone_id
    payload = api(token, "GET", f"/zones?name={ZONE_NAME}")
    if not isinstance(payload, list) or not payload:
        raise RuntimeError(f"zone not found or not visible to this token: {ZONE_NAME}")
    return str(payload[0]["id"])


def api(token: str, method: str, path: str, body: dict | None = None) -> object:
    """Call the Cloudflare API; raise RuntimeError with the API's own message."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{API_BASE}{path}",
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 (fixed https host)
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:400]
        if error.code == 403:
            raise RuntimeError(
                "HTTP 403 from the Bot Management endpoint: the API token lacks the "
                '"Bot Management: Read/Edit" permission. Grant it (or change the policy '
                "in the Dashboard: Security > Settings > Configure AI bot policies) and retry. "
                f"API said: {detail}"
            ) from error
        raise RuntimeError(f"HTTP {error.code} from {path}: {detail}") from error
    if not isinstance(payload, dict) or not payload.get("success"):
        errors = payload.get("errors") if isinstance(payload, dict) else None
        raise RuntimeError(f"Cloudflare API error for {path}: {errors}")
    return payload.get("result")


def fetch_config(token: str, zone_id: str) -> dict:
    result = api(token, "GET", ENDPOINT.format(zone_id=zone_id))
    if not isinstance(result, dict):
        raise RuntimeError("unexpected bot_management response shape")
    return result


def plan(config: dict) -> dict:
    """Keys to write: managed, currently different, and actually reported by the zone."""
    changes: dict[str, object] = {}
    for key, desired in MANAGED:
        if key not in config:
            continue
        if config.get(key) != desired:
            changes[key] = desired
    return changes


def describe(config: dict) -> None:
    # 定宽对齐要同时覆盖两组的键名，否则 report-only 那几行会把列冲散。
    width = max(len(key) for key, _ in MANAGED + tuple((key, None) for key in REPORT_ONLY))
    print("ai bot policy")
    for key, desired in MANAGED:
        if key not in config:
            print(f"  {key:<{width}}  -  (not reported by this zone)")
            continue
        value = config.get(key)
        mark = "" if value == desired else f"  -> set to {json.dumps(desired)}"
        print(f"  {key:<{width}}  {json.dumps(value)}{mark}")
    print("reported, not managed")
    for key in REPORT_ONLY:
        if key not in config:
            continue
        value = config[key]
        hint = ""
        if REPORT_BLOCKING.get(key) == json.dumps(value):
            hint = "  <- blocks/challenges automated traffic; review by hand"
        print(f"  {key:<{width}}  {json.dumps(value)}{hint}")


def load_snapshot() -> dict:
    try:
        data = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    except OSError as error:
        raise RuntimeError(
            f"cannot read {SNAPSHOT} ({error.__class__.__name__}): no snapshot was ever "
            "captured, because reading the policy needs the Bot Management permission. "
            "Grant it to the API token and run --snapshot once (or use the Dashboard: "
            "Security > Settings > Configure AI bot policies)."
        ) from error
    config = data.get("config")
    if not isinstance(config, dict):
        raise RuntimeError(f"{SNAPSHOT} has no config section; re-run --snapshot")
    return data


def write_snapshot(zone_id: str, config: dict) -> None:
    payload = {
        "captured_at": datetime.now(UTC).isoformat(),
        "zone": ZONE_NAME,
        "zone_id": zone_id,
        # The whole response, not a hand-picked summary: fields move between plan
        # tiers, and a missing key is itself the fact worth recording.
        "config": config,
    }
    SNAPSHOT.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def report_plan(changes: dict) -> None:
    if not changes:
        print("plan: nothing to change")
        return
    print("plan: apply the following changes")
    width = max(len(key) for key in changes)
    for key in sorted(changes):
        print(f"  {key:<{width}}  -> {json.dumps(changes[key])}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Read, snapshot or relax the limooo.cn AI bot policy.",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--show", action="store_true", help="live: print the AI-related keys; write nothing")
    group.add_argument("--snapshot", action="store_true", help="live: refresh ops/ai-bots.snapshot.json")
    group.add_argument("--apply", action="store_true", help="live: allow AI crawlers on the whole zone")
    group.add_argument("--dry-run", action="store_true", help="offline: print the plan (default)")
    args = parser.parse_args()

    if not (args.show or args.snapshot or args.apply):
        args.dry_run = True

    try:
        return run(args)
    except RuntimeError as error:
        # 权限缺失、API 报错、快照读不到：一律只输出一行 FATAL，不吐 Python traceback ——
        # 这条脚本的读者往往是「手上只有一个受限 token 的人」。
        print(f"FATAL: {error}", file=sys.stderr)
        return 1


def run(args: argparse.Namespace) -> int:
    if args.dry_run:
        data = load_snapshot()
        print(f"ai bot policy snapshot  ({data.get('captured_at', '?')}, offline)")
        describe(data.get("config") or {})
        print()
        report_plan(plan(data.get("config") or {}))
        print("dry-run: no API call made")
        return 0

    token = read_token()
    if not token:
        print("FATAL: CLOUDFLARE_API_TOKEN not set and not found in secrets/webauthn.env", file=sys.stderr)
        return 1

    zone_id = resolve_zone_id(token)
    config = fetch_config(token, zone_id)
    print(f"ai bot policy (live, {ZONE_NAME})")
    describe(config)

    if args.snapshot:
        write_snapshot(zone_id, config)
        print(f"snapshot: wrote {SNAPSHOT}")
        return 0

    if args.show:
        return 0

    changes = plan(config)
    print()
    report_plan(changes)
    if not changes:
        return 0

    api(token, "PATCH", ENDPOINT.format(zone_id=zone_id), changes)
    after = fetch_config(token, zone_id)
    write_snapshot(zone_id, after)
    print("apply: done; verifying")
    describe(after)
    remaining = plan(after)
    if remaining:
        print(f"apply: WARNING - the zone still differs on {sorted(remaining)}")
        return 1
    print("apply: the zone now allows AI crawlers")
    return 0


if __name__ == "__main__":
    sys.exit(main())
