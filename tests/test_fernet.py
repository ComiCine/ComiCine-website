# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Fernet encryption and decryption tests for Apple Account passwords (test-only key)."""

from pathlib import Path

import pytest
from cryptography.fernet import Fernet

TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
TOKEN_FIXTURE = Path(__file__).parent / "fixtures" / "fernet_token.txt"
# W5-3: Generated with the same key by `fernetEncrypt` in `functions/_lib/fernet.ts`
# (plaintext `8.8.8.8`; see the tasks/22 execution notes for the command). Production depends on this direction:
# TypeScript encrypts (`tracking.ts` writes `ip_enc`) and Python decrypts (`ops/check_ip_rays.py`).
TS_TOKEN_FIXTURE = Path(__file__).parent / "fixtures" / "fernet_token_ts.txt"


def test_fixed_ticket_round_trip():
    key = TEST_KEY
    fernet = Fernet(key.encode())
    token = fernet.encrypt(b"hello-comicine").decode()
    assert fernet.decrypt(token.encode()) == b"hello-comicine"


def test_wrong_key_rejected():
    token = Fernet(TEST_KEY.encode()).encrypt(b"secret").decode()
    # This key decodes to 33 bytes, which Fernet rejects during construction. Match the actual exception type
    # instead of catching Exception and allowing any error to pass.
    with pytest.raises(ValueError, match="32 url-safe base64-encoded bytes"):
        Fernet(b"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWZ9").decrypt(token.encode())


def test_fixture_is_python_decryptable():
    token = TOKEN_FIXTURE.read_text(encoding="utf-8").strip()
    assert Fernet(TEST_KEY.encode()).decrypt(token.encode()) == b"hello-comicine"


def test_ts_generated_fixture_is_python_decryptable():
    """W5-3: Python `Fernet` must be able to decrypt output from the TypeScript `fernetEncrypt`.

    This protects the cross-language boundary, not `cryptography` itself:
    `functions/_lib/tracking.ts` encrypts visitor IPs into `visitor_rollups.ip_enc`,
    and `ops/check_ip_rays.py` decrypts them with Python. The TypeScript side must
    preserve base64 `=` padding because `Fernet.decrypt()` uses
    `base64.urlsafe_b64decode`; missing padding raises `InvalidToken` and appears as
    missing records for every IP. The Vitest test in `functions/_lib/fernet.test.ts`
    asserts that the implementation keeps padding. Together, the two tests verify
    that Python can decrypt a real padded token from TypeScript.
    """
    token = TS_TOKEN_FIXTURE.read_text(encoding="utf-8").strip()
    assert len(token) % 4 == 0
    assert Fernet(TEST_KEY.encode()).decrypt(token.encode()) == b"8.8.8.8"

