/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/* Run this theme setup before the body renders to avoid a white flash in light mode.
   This external file replaces the inline template script, so CSP does not need unsafe-inline. */
(function () {
  var theme = localStorage.getItem("theme");
  if (!theme) {
    var match = document.cookie.match(/(?:^|;\s*)limooo_theme=(light|dark)/);
    theme = match ? match[1] : null;
  }
  if (
    theme === "light" ||
    (!theme && window.matchMedia("(prefers-color-scheme: light)").matches)
  ) {
    document.documentElement.classList.add("light-mode");
  }
})();
