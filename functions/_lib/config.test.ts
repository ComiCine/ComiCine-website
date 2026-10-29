/**
 * ComiCine - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present ComiCine
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
  LEGACY_ROOT_DOMAINS,
  PENDING_COOKIE,
  ROOT_DOMAIN,
  ROOT_DOMAINS,
  SESSION_COOKIE,
  SUPPORTED_LANGS,
} from "./config";

describe("shared config", () => {
  it("has the expected shared constants", () => {
    expect(ROOT_DOMAIN).toBe("comicine.com");
    expect(LEGACY_ROOT_DOMAINS).toEqual([]);
    expect(ROOT_DOMAINS).toEqual(["comicine.com"]);
    expect(DEFAULT_LANG).toBe("en-us");
    expect(SUPPORTED_LANGS).toContain("zh-cn");
    expect(GATE_COOKIE).toBe("__gate");
    expect(SESSION_COOKIE).toBe("comicine_session");
    expect(PENDING_COOKIE).toBe("comicine_pending");
    expect(LANG_COOKIE).toBe("user_lang_preference");
  });
});
