# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""tasks/22 W7-13: one owner for the shared mail framework and the alert copy.

`ops/email-templates/render.py` has no caller in production (the VPS Flask app is
gone) and the alert copy used to exist twice -- here and inline in the status
Worker -- where the two had already drifted. The decision recorded here is:

  * the framework stays (it is the only four-language HTML mail layout) and must
    keep rendering;
  * the status-worker `ALERT_I18N` is the single owner of the alert copy, and the
    Python `health-alert.i18n.json` must stay a tombstone so no second copy can
    grow back.

Everything runs offline: no mail is sent, no Cloudflare call is made.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EMAIL_DIR = ROOT / "ops" / "email-templates"
STATUS_WORKER = ROOT / "ops" / "status-worker" / "src" / "index.ts"
LANGS = ("zh-cn", "en-us", "ja-jp", "ko-kr")


def _render_module():
    spec = importlib.util.spec_from_file_location("comicine_email_render", EMAIL_DIR / "render.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_framework_still_renders_all_four_languages() -> None:
    render = _render_module()
    for lang in LANGS:
        html, plain = render.render_email(
            lang,
            title="Title",
            body="Body text",
            code="123456",
            cta_label="Open",
            cta_url="https://comicine.com/",
            hint="Hint",
        )
        assert "123456" in html and "123456" in plain, lang
        assert "__TITLE__" not in html and "__BODY__" not in html, lang
        assert "https://comicine.com/" in html, lang
        assert "comicine-favicon.png?v=11" in html, lang
        assert "comicine-xtext.png?v=4" in html, lang


def test_renderer_escapes_html() -> None:
    render = _render_module()
    html, _plain = render.render_email(
        "en-us", title="<script>alert(1)</script>", body="ok"
    )
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_alert_copy_owner_is_the_status_worker() -> None:
    """status-worker remains the sole owner of alert copy, and that copy is English only.

    On 2026-10-11, the user requested English-only alerts because both Feishu webhook
    and email recipients read English. The previous four-language expectation was
    replaced with exactly en-us; any extra locale now fails because it adds maintenance.
    """
    worker = STATUS_WORKER.read_text(encoding="utf-8")
    block = re.search(r"const ALERT_I18N[^=]*=\s*\{(.*?)\n\};", worker, re.S)
    assert block, "ALERT_I18N must stay in ops/status-worker/src/index.ts"

    present = re.findall(r'^\s*"([a-z]{2}-[a-z]{2})":\s*\{', block.group(1), re.M)
    assert present == ["en-us"], f"ALERT_I18N must be English only, found {present}"
    assert "en-us" in LANGS, "en-us must remain a supported language in the contract"


def test_python_alert_copy_is_only_a_tombstone() -> None:
    payload = json.loads((EMAIL_DIR / "health-alert.i18n.json").read_text(encoding="utf-8"))
    assert payload.get("_deprecated") is True
    assert "status-worker" in payload.get("_owner", "")
    # Do not add a second copy of this copy here; none of the old keys may return.
    leaked = [lang for lang in LANGS if lang in payload]
    assert not leaked, f"alert copy must live in the Worker only, found: {leaked}"
    for key in ("subject", "title", "intro", "hint"):
        assert key not in payload, f"alert copy key {key} came back to the Python side"


def test_deprecation_is_documented() -> None:
    readme = (EMAIL_DIR / "README.md").read_text(encoding="utf-8")
    assert "deprecated" in readme.lower()
    assert "ALERT_I18N" in readme
    module_doc = _render_module().__doc__ or ""
    assert "DEPRECATED" in module_doc
