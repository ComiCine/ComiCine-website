# Limooo - serverless personal website and admin system
#
# Copyright (C) 2026-Present Limooo Studio
# SPDX-License-Identifier: AGPL-3.0-or-later
# Additional terms under Section 7 apply.
# See ADDITIONAL_TERMS.md.

"""Shared test configuration that adds src/ to the module search path."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

sys.path.insert(0, str(SRC))
sys.path.insert(0, str(ROOT))
