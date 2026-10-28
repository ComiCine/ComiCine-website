/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

import { redirectLocalizedEntry } from "../_lib/security-language.js";

export function onRequest({ request }) {
  return redirectLocalizedEntry(request, "/security/acknowledgments");
}
