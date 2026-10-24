/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

(() => {
  const elements = document.querySelectorAll("[data-copyright-years]");
  if (!elements.length) return;

  const now = new Date();
  let currentYear = now.getUTCFullYear();
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) {
      const year = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          year: "numeric",
        }).format(now),
      );
      if (Number.isInteger(year)) currentYear = year;
    }
  } catch {}

  elements.forEach((element) => {
    const startYear = Number(element.getAttribute("data-copyright-start-year"));
    if (!Number.isInteger(startYear)) return;
    element.textContent =
      startYear === currentYear ? String(startYear) : `${startYear}-${currentYear}`;
  });
})();
