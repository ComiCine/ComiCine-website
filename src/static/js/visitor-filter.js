/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Pure status filter for the visitor list (browser ESM).
 *
 * This module does not access the DOM or make network requests, so Vitest can test it directly.
 *
 * Rules:
 * - Return a copy of the original array when status is 'all'.
 * - statuses uses string keys (for example, { "200": 3 }); convert the caller's status to a string before comparing.
 * - Do not modify the input array or change its order.
 */

export function filterMarkers(markers, status) {
  if (!Array.isArray(markers)) return [];

  const key = status == null || status === '' ? 'all' : String(status);
  if (key === 'all') return markers.slice();

  const numericKey = Number.isFinite(Number(key)) ? String(Number(key)) : null;
  return markers.filter((marker) => {
    const statuses = marker && marker.statuses ? marker.statuses : {};
    const value = statuses[key] || (numericKey ? statuses[numericKey] : undefined) || 0;
    return Number(value) > 0;
  });
}
