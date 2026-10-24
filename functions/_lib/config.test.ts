/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Shared configuration smoke test: contract constants are available on both sides. */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANG,
  GATE_COOKIE,
  LANG_COOKIE,
  PENDING_COOKIE,
  ROOT_DOMAIN,
  SESSION_COOKIE,
  SUPPORTED_LANGS,
} from "./config";

describe("shared config", () => {
  it("has the expected shared constants", () => {
    expect(ROOT_DOMAIN).toBe("limooo.cn");
    expect(DEFAULT_LANG).toBe("en-us");
    expect(SUPPORTED_LANGS).toContain("zh-cn");
    expect(GATE_COOKIE).toBe("__gate");
    expect(SESSION_COOKIE).toBe("limooo_session_v3");
    expect(PENDING_COOKIE).toBe("limooo_pending_v2");
    expect(LANG_COOKIE).toBe("user_lang_preference");
  });
});
