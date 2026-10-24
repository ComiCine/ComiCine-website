# Limooo - shared configuration and utilities
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Project-wide configuration and shared utilities.

Centralize paths, languages, domains, database connections, and other constants shared
by the Flask backend and Pages build scripts. The Pages-side counterpart is
``functions/_lib/config.ts``.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import sqlite3

# Path constants
# Repository root (this file is in src/, one level below the root)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
SOURCE_DIR = os.path.join(BASE_DIR, "src")
STATIC_DIR = os.path.join(SOURCE_DIR, "static")
TEMPLATES_DIR = os.path.join(SOURCE_DIR, "templates")
LOCALES_DIR = os.path.join(BASE_DIR, "locales")
PUBLIC_DIR = os.environ.get("LIMOOO_PUBLIC_DIR") or os.path.join(BASE_DIR, "public")
PREVIEW_DIR = os.environ.get("LIMOOO_PREVIEW_DIR") or os.path.join(BASE_DIR, "preview")

# Single source of truth for shared configuration: config.py and the generated
# functions/_lib/config.ts both read from here. Change domains, languages,
# cookies, TTLs, and public hosts in this file only.
CONTRACT_PATH = os.path.join(BASE_DIR, "config-contract.json")


def _load_contract() -> dict:
    """Read and return the cross-platform contract, raising on parse errors to prevent stale constants."""
    try:
        with open(CONTRACT_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"无法读取配置契约 {CONTRACT_PATH}: {exc}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"配置契约格式错误（应为 JSON 对象）: {CONTRACT_PATH}")
    return data


CONTRACT = _load_contract()


def _contract_str(key: str) -> str:
    value = CONTRACT.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"配置契约缺少字符串字段: {key}")
    return value


def _contract_int(key: str) -> int:
    value = CONTRACT.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise RuntimeError(f"配置契约字段必须为正整数: {key}")
    return value


def _contract_str_list(key: str) -> list[str]:
    value = CONTRACT.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) and item for item in value):
        raise RuntimeError(f"配置契约字段必须为非空字符串列表: {key}")
    return value


def _contract_page_routes() -> dict[str, dict[str, str]]:
    """Read and validate the host-to-path-to-prerendered-page route mapping."""
    value = CONTRACT.get("page_routes")
    if not isinstance(value, dict):
        raise RuntimeError("配置契约缺少 page_routes 字段（应为 JSON 对象）")
    routes: dict[str, dict[str, str]] = {}
    for host, paths in value.items():
        if not isinstance(host, str) or not host or not isinstance(paths, dict):
            raise RuntimeError(f"配置契约 page_routes 条目格式错误: {host!r}")
        normalized: dict[str, str] = {}
        for path, filename in paths.items():
            if (
                not isinstance(path, str)
                or not path.startswith("/")
                or not isinstance(filename, str)
                or not filename.endswith(".html")
            ):
                raise RuntimeError(f"配置契约 page_routes 路由格式错误: {host!r} {path!r}")
            normalized[path.rstrip("/") or "/"] = filename
        routes[host] = normalized
    return routes


def _contract_identity_site_roles() -> dict[str, str]:
    """Read and validate the exact source hosts allowed to use the identity broker."""
    value = CONTRACT.get("identity_sites")
    if not isinstance(value, dict) or not value:
        raise RuntimeError("配置契约缺少 identity_sites 字段（应为来源主机到本地角色的 JSON 对象）")
    identity_host = CONTRACT.get("identity_host")
    managed_hosts = CONTRACT.get("managed_hosts")
    root_domain = CONTRACT.get("root_domain")
    hostname_pattern = re.compile(
        r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
        r"(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$"
    )
    roles: dict[str, str] = {}
    for host, role in value.items():
        if (
            not isinstance(host, str)
            or not hostname_pattern.fullmatch(host)
            or host == identity_host
            or not isinstance(managed_hosts, list)
            or host not in managed_hosts
            or not isinstance(root_domain, str)
            or not host.endswith(f".{root_domain}")
            or not isinstance(role, str)
            or role not in {"admin", "viewer"}
        ):
            raise RuntimeError(f"配置契约 identity_sites 条目格式错误: {host!r}")
        roles[host] = role
    return roles


# On a fresh deployment, data/ may not exist yet; importing this module ensures
# the directory is ready. Build mode (LIMOOO_BUILD=1) only renders output and
# does not create the runtime database directory. The Python service creates it
# at startup, so build.py has no data/ side effects on a clean machine.
BUILD_MODE = os.environ.get("LIMOOO_BUILD") == "1"
if not BUILD_MODE:
    os.makedirs(DATA_DIR, exist_ok=True)

# Runtime database, kept separate from the disposable geo_cache.db (IP cache)
# so deployment cleanup cannot remove application data.
DATABASE = os.path.join(DATA_DIR, "geo_cache.db")
APPLE_ACCOUNT_DB = os.path.join(DATA_DIR, "apple_account.db")
AUTH_DB = os.path.join(DATA_DIR, "auth.db")
# Import seed for the blocklist (D1 blocked_ips is authoritative; see
# docs/lists/README.md). Moved from data/ to docs/lists/ on 2026-10-11 so it is
# easier to maintain alongside the allowlist.
LISTS_DIR = os.path.join(BASE_DIR, "docs", "lists")
BLOCKLIST_FILE = os.path.join(LISTS_DIR, "blocklist.txt")

SECRET_DIR = os.path.join(BASE_DIR, "secrets")
ENV_FILE = os.path.join(SECRET_DIR, "webauthn.env")

# Cloudflare blocklist synchronization (shared by auto_block.py and sync-worker)
CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4"
CF_LIST_NAME = "limooo_blocklist"
CF_BATCH_SIZE = 200
D1_DATABASE_ID = os.environ.get(
    "D1_DATABASE_ID", "e2f29d54-29c0-46af-938d-e13995a11d7f"
)

# Domains and subdomains
ROOT_DOMAIN = _contract_str("root_domain")
BASE_URL = f"https://{ROOT_DOMAIN}"
WWW_HOST = f"www.{ROOT_DOMAIN}"
SERVICES_HOST = f"services.{ROOT_DOMAIN}"
CONTACT_HOST = f"contact.{ROOT_DOMAIN}"
VISITOR_HOST = f"visitor.{ROOT_DOMAIN}"
APPLE_ACCOUNT_HOST = f"account.{ROOT_DOMAIN}"
IDENTITY_HOST = _contract_str("identity_host")
REDIRECT_HOST = f"redirect.{ROOT_DOMAIN}"
REDIRECT_URL = f"https://{REDIRECT_HOST}/"
GATE_HOST = f"auth.{ROOT_DOMAIN}"
IMAGES_HOST = f"images.{ROOT_DOMAIN}"
IMAGE_BASE_URL = f"https://{IMAGES_HOST}"
IMAGE_ASSET_HOST = _contract_str("image_asset_host")
IMAGE_WATERMARK_HOST = _contract_str("image_watermark_host")
IMAGE_WATERMARK_BASE_URL = f"https://{IMAGE_WATERMARK_HOST}"
IMAGE_ASSET_BASE_URL = f"https://{IMAGE_ASSET_HOST}"
REDIRECT_BASE_URL = REDIRECT_URL
PUBLIC_HOSTS = tuple(_contract_str_list("public_hosts"))
MANAGED_HOSTS = tuple(_contract_str_list("managed_hosts"))
SHARED_LANG_HOSTS = tuple(_contract_str_list("shared_lang_hosts"))
PAGE_ROUTES = _contract_page_routes()
IDENTITY_SITE_ROLES = _contract_identity_site_roles()
IMAGE_ASSET_HOSTNAME = IMAGE_ASSET_HOST
IMAGE_WATERMARK_HOSTNAME = IMAGE_WATERMARK_HOST
GATE_TRUST = CONTRACT.get("gate_trust", {})
OBSERVABILITY_HMAC_ENV = _contract_str("observability_hmac_env")

# Open-source repository
# Repository linked by the AGPL-3.0 "Source code" links in the header and footer.
SOURCE_REPO_URL = "https://github.com/Limooooo-Studio/Limooo-Website"

# Languages
# Language codes are lowercase to match Cloudflare Turnstile's language parameter.
SUPPORTED_LANGS = tuple(_contract_str_list("supported_langs"))
DEFAULT_LANG = _contract_str("default_lang")  # Used when the language cannot be determined
KEY_FALLBACK_LANG = _contract_str("key_fallback_lang")  # Used when a translation key is missing
if DEFAULT_LANG not in SUPPORTED_LANGS or KEY_FALLBACK_LANG not in SUPPORTED_LANGS:
    raise RuntimeError("配置契约中的 default_lang / key_fallback_lang 必须属于 supported_langs")
LANG_COOKIE = _contract_str("lang_cookie")
LANG_COOKIE_MAX_AGE = _contract_int("lang_cookie_max_age")
THEME_COOKIE = _contract_str("theme_cookie")
THEME_COOKIE_MAX_AGE = _contract_int("theme_cookie_max_age")

# Human-verification gate and login (aligned with Pages functions/_lib/config.ts)
GATE_COOKIE = _contract_str("gate_cookie")
SESSION_COOKIE = _contract_str("session_cookie")
PENDING_COOKIE = _contract_str("pending_cookie")
CSRF_COOKIE = _contract_str("csrf_cookie")
GATE_COOKIE_TTL = _contract_int("gate_ttl_seconds")
SESSION_TTL = _contract_int("session_ttl_seconds")
PENDING_TTL = _contract_int("pending_ttl_seconds")
# Maximum age in seconds for recent authentication required to reveal a plaintext
# password; users must log in again after this interval.
REVEAL_MAX_AUTH_AGE = _contract_int("reveal_max_auth_age_seconds")
WHITELIST_FILE = _contract_str("whitelist_file")

# Apple Account
APPLE_ACCOUNT_EMAIL_DOMAIN = _contract_str("apple_account_email_domain")
APPLE_ACCOUNT_DOMAIN = f"@{APPLE_ACCOUNT_EMAIL_DOMAIN}"
APPLE_ACCOUNT_KEY_ETC = "/etc/limooo/apple_account_encryption.key"
APPLE_ACCOUNT_KEY_FILE = os.path.join(SECRET_DIR, "apple_account_encryption.key")

# Redirect-page preload images (aligned with the Pages manifest and middleware)
REDIRECT_PRELOAD_IMAGES = [
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0203-800.webp",
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0146-800.webp",
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0130-800.webp",
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0244-800.webp",
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0115-800.webp",
    f"{IMAGE_ASSET_BASE_URL}/static/portfolio/thumbs/IMG_0179-800.webp",
]

# Database connection factory
def get_geo_db() -> sqlite3.Connection:
    """Create a SQLite connection with WAL mode and a timeout for concurrent access."""
    conn = sqlite3.connect(DATABASE, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def get_apple_account_db() -> sqlite3.Connection:
    """Create the Apple Account database connection, separate from geo_cache.db."""
    conn = sqlite3.connect(APPLE_ACCOUNT_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.row_factory = sqlite3.Row
    return conn


# IP utilities
def is_private_ip(ip: str) -> bool:
    """Check whether an IP is private or loopback; these addresses need no GeoIP lookup."""
    if ip in ("127.0.0.1", "localhost", "::1", "-"):
        return True
    try:
        address = ipaddress.ip_address(ip)
        return address.is_private or address.is_loopback
    except ValueError:
        return False


# Geolocation cache database operations
def ensure_geo_cache(conn: sqlite3.Connection) -> None:
    """Create the geo_cache table if needed and apply required schema migrations."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS geo_cache (
            ip         TEXT PRIMARY KEY,
            country    TEXT,
            city       TEXT,
            latitude   REAL,
            longitude  REAL,
            isp        TEXT,
            asn        TEXT,
            cached_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Backward compatibility: add the asn column if it is missing.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(geo_cache)").fetchall()}
    if "asn" not in cols:
        conn.execute("ALTER TABLE geo_cache ADD COLUMN asn TEXT")
    conn.commit()


def get_cached_geo(conn: sqlite3.Connection, ip: str) -> dict | None:
    """Read the cached geolocation for an IP address."""
    row = conn.execute(
        "SELECT country, city, latitude, longitude, isp, asn FROM geo_cache WHERE ip = ?",
        (ip,),
    ).fetchone()
    if not row:
        return None
    # Use index access because callers may not set row_factory=Row
    # (sqlite3.Row supports indexing as well).
    return {
        "country": row[0],
        "city": row[1],
        "latitude": row[2],
        "longitude": row[3],
        "isp": row[4],
        "asn": row[5],
    }


def load_translations() -> dict[str, dict[str, str]]:
    """Read every locale JSON file and validate it as a string-to-string mapping.

    This is the only locale-loading entry point. A missing translation file during
    the build must fail instead of silently falling back to an empty mapping, which
    would remove page copy. Previously, build.py had four separate loops and
    render_app.py had another; two build.py paths did not validate value types.
    """
    translations: dict[str, dict[str, str]] = {}
    for lang in SUPPORTED_LANGS:
        path = os.path.join(LOCALES_DIR, f"{lang}.json")
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"无法读取翻译文件 {path}: {exc}") from exc
        if not isinstance(data, dict) or not all(isinstance(v, str) for v in data.values()):
            raise RuntimeError(f"翻译文件格式错误（应为字符串字典）: {path}")
        translations[lang] = data
    return translations
