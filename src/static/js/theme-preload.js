/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/* Run this theme setup before the body renders to avoid a white flash in light mode.
   This external file replaces the inline template script, so CSP does not need unsafe-inline. */
(function () {
  var theme = localStorage.getItem("theme");
  if (!theme) {
    var script = document.currentScript;
    var cookieName = script && script.getAttribute("data-theme-cookie") || "limooo_theme";
    var escapedName = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var match = document.cookie.match(new RegExp("(?:^|;\\s*)" + escapedName + "=(light|dark)(?:;|$)"));
    theme = match ? match[1] : null;
  }
  if (
    theme === "light" ||
    (!theme && window.matchMedia("(prefers-color-scheme: light)").matches)
  ) {
    document.documentElement.classList.add("light-mode");
  }
})();
