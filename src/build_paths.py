# ComiCine - serverless personal website and admin system
#
# Copyright (C) 2026-Present ComiCine
# SPDX-License-Identifier: AGPL-3.0-or-later
# Section 7 additional terms apply when the work is used under GNU AGPL v3.
# See ADDITIONAL_TERMS.txt.

"""Derived build paths shared by the build modules.

Only paths needed by more than one build module live here: the Functions output
directory, the configuration contract, and the robots.txt source. Import them from
this module instead of importing build, so the modules stay acyclic.
"""

from __future__ import annotations

import os

from config import BASE_DIR

FUNCTIONS_DIR = os.path.join(BASE_DIR, "functions")

CONTRACT_PATH = os.path.join(BASE_DIR, "config-contract.json")

# Crawler and AI entry files (2026-10-12)
#
# The live /robots.txt is copied from this source file. The same file is the only
# source of gate allowlist entries: ops/check_gate_trust.py parses each explicit
# `User-agent:` entry except `*` and generates GATE_TRUST_CRAWLER_UAS.
# The builder appends the `Sitemap:` line with the contract root domain, so the
# domain is not maintained twice.
ROBOTS_SOURCE = os.path.join(BASE_DIR, "docs", "lists", "robots.txt")
