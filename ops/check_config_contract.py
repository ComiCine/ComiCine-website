#!/usr/bin/env python3

# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Validate config-contract.json, src/config.py, and generated functions/_lib/config.ts before deploy.

This uses only the standard library. Exit nonzero if any representation differs from the contract,
preventing configuration drift such as the edge recognizing a new domain while the application does not.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "config-contract.json"
CONFIG_TS_PATH = ROOT / "functions" / "_lib" / "config.ts"
PYTHON_CONFIG_PATH = ROOT / "src" / "config.py"


PYTHON_FIELD_MAP = {
    "root_domain": "ROOT_DOMAIN",
    "supported_langs": "SUPPORTED_LANGS",
    "default_lang": "DEFAULT_LANG",
    "key_fallback_lang": "KEY_FALLBACK_LANG",
    "lang_cookie": "LANG_COOKIE",
    "lang_cookie_max_age": "LANG_COOKIE_MAX_AGE",
    "theme_cookie": "THEME_COOKIE",
    "theme_cookie_max_age": "THEME_COOKIE_MAX_AGE",
    "gate_cookie": "GATE_COOKIE",
    "session_cookie": "SESSION_COOKIE",
    "pending_cookie": "PENDING_COOKIE",
    "csrf_cookie": "CSRF_COOKIE",
    "gate_ttl_seconds": "GATE_COOKIE_TTL",
    "session_ttl_seconds": "SESSION_TTL",
    "pending_ttl_seconds": "PENDING_TTL",
    "reveal_max_auth_age_seconds": "REVEAL_MAX_AUTH_AGE",
    "public_hosts": "PUBLIC_HOSTS",
    "managed_hosts": "MANAGED_HOSTS",
    "shared_lang_hosts": "SHARED_LANG_HOSTS",
    "page_routes": "PAGE_ROUTES",
    "identity_host": "IDENTITY_HOST",
    "apple_account_email_domain": "APPLE_ACCOUNT_EMAIL_DOMAIN",
    "identity_sites": "IDENTITY_SITE_ROLES",
    "image_asset_host": "IMAGE_ASSET_HOST",
    "image_watermark_host": "IMAGE_WATERMARK_HOST",
    "gate_trust": "GATE_TRUST",
    "observability_hmac_env": "OBSERVABILITY_HMAC_ENV",
    "whitelist_file": "WHITELIST_FILE",
}


def fail(message: str) -> None:
    print(f"[config-contract] FAIL: {message}", file=sys.stderr)


def load_contract() -> dict:
    try:
        with CONTRACT_PATH.open(encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read or parse {CONTRACT_PATH}: {exc}")
        raise SystemExit(1) from exc
    if not isinstance(data, dict):
        fail(f"{CONTRACT_PATH} must be a JSON object")
        raise SystemExit(1)
    return data


def load_python_config() -> dict:
    spec = importlib.util.spec_from_file_location("limooo_config_check", PYTHON_CONFIG_PATH)
    if spec is None or spec.loader is None:
        fail(f"cannot load {PYTHON_CONFIG_PATH}")
        raise SystemExit(1)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_ts_contract() -> dict | None:
    if not CONFIG_TS_PATH.exists():
        # Generated files are not committed: validate the Python side before build.py,
        # then pages_deploy.sh validates the TypeScript side after the build.
        print(f"[config-contract] WARNING: {CONFIG_TS_PATH} not generated yet; skipping TS-side check")
        return None
    try:
        text = CONFIG_TS_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        fail(f"cannot read {CONFIG_TS_PATH}: {exc}")
        raise SystemExit(1) from exc
    marker = "export const CONTRACT = {"
    start = text.find(marker)
    outer_start = text.find("{", start + len("export const CONTRACT = ") if start >= 0 else 0)
    if start < 0 or outer_start < 0:
        fail(f"{CONFIG_TS_PATH} is missing the generated CONTRACT constant (looks hand-edited)")
        raise SystemExit(1)
    try:
        decoder = json.JSONDecoder()
        object_data, _ = decoder.raw_decode(text[outer_start:])
        return object_data
    except json.JSONDecodeError as exc:
        fail(f"CONTRACT in {CONFIG_TS_PATH} is not valid JSON: {exc}")
        raise SystemExit(1) from exc


def compare(side: str, contract: dict, actual: dict) -> bool:
    ok = True
    for key, expected in contract.items():
        if key == "schema_version":
            continue
        got = actual.get(key, "<missing>")
        if got != expected:
            fail(f"{side}.{key}: expect {expected!r}, got {got!r}")
            ok = False
    return ok


def python_values(module) -> dict:
    result = {}
    for contract_key, python_name in PYTHON_FIELD_MAP.items():
        value = getattr(module, python_name, "<missing>")
        if isinstance(value, tuple):
            value = list(value)
        result[contract_key] = value
    return result


def check_constants_consumed() -> None:
    """Require contract TTLs to be consumed instead of hard-coding values such as 3600 or 7*86400."""
    required = {
        "GATE_TTL_SECONDS": "gate.ts",
        "SESSION_TTL_SECONDS": "session.ts",
    }
    source_text = {
        path.name: path.read_text(encoding="utf-8")
        for path in (ROOT / "functions").rglob("*.ts")
        if path.name != "config.ts" and not path.name.endswith(".test.ts")
    }
    for constant, expected_file in required.items():
        if not any(constant in text for text in source_text.values()):
            fail(f"config constant {constant} is not consumed by functions/ sources (expected in {expected_file})")
            raise SystemExit(1)


def check_managed_hosts(contract: dict) -> None:
    """Require managed_hosts to include hosted subdomains such as auth, redirect, images, and image."""
    root = contract.get("root_domain", "")
    expected = [
        f"auth.{root}",
        f"identity.{root}",
        f"redirect.{root}",
        f"images.{root}",
        f"image.{root}",
    ]
    managed = set(contract.get("managed_hosts", []))
    missing = [host for host in expected if host not in managed]
    if missing:
        fail(f"managed_hosts is missing managed subdomains: {', '.join(missing)}")
        raise SystemExit(1)
    identity_host = contract.get("identity_host")
    identity_sites = contract.get("identity_sites")
    if identity_host not in managed:
        fail("managed_hosts must include identity_host")
        raise SystemExit(1)
    if not isinstance(identity_sites, dict) or not identity_sites:
        fail("identity_sites must map source hosts to local admin or viewer roles")
        raise SystemExit(1)
    hostname_pattern = re.compile(
        r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
        r"(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$"
    )
    invalid_sites = [
        host for host, role in identity_sites.items()
        if (
            not isinstance(host, str)
            or not hostname_pattern.fullmatch(host)
            or host not in managed
            or not host.endswith(f".{root}")
            or not isinstance(role, str)
            or role not in ("admin", "viewer")
            or host == identity_host
        )
    ]
    if invalid_sites:
        fail(f"identity_sites contains invalid hosts or roles: {', '.join(map(str, invalid_sites))}")
        raise SystemExit(1)


def main() -> int:
    skip_ts = "--skip-ts" in sys.argv[1:]
    contract = load_contract()
    if contract.get("schema_version") != 1:
        fail("only schema_version = 1 is supported")
        return 1

    module = load_python_config()
    py_ok = compare("src/config.py", contract, python_values(module))
    check_managed_hosts(contract)
    check_constants_consumed()

    ts_contract = None if skip_ts else load_ts_contract()
    ts_ok = True
    if ts_contract is not None:
        # The generated CONTRACT includes schema_version, so skip it during comparison.
        actual_ts = {key: value for key, value in ts_contract.items() if key != "schema_version"}
        expect_ts = {key: value for key, value in contract.items() if key != "schema_version"}
        ts_ok = compare("functions/_lib/config.ts", expect_ts, actual_ts)

    if not (py_ok and ts_ok):
        return 1
    if ts_contract is None and not skip_ts:
        print("[config-contract] OK: contract / Python consistent (TS not generated yet, skipped)")
    elif ts_contract is not None:
        print("[config-contract] OK: contract / Python / TypeScript consistent")
    else:
        print("[config-contract] OK: contract / Python consistent (--skip-ts, pre-build check)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
