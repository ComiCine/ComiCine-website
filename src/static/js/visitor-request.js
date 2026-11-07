/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Pure request-outcome helpers for the visitor dashboard (browser ESM).
 *
 * This module does not access the DOM or make network requests, so Vitest can test it directly.
 *
 * The caller tracks its own timeout flag instead of relying on AbortSignal.timeout(): browsers
 * disagree on the exception name produced by an aborted request (AbortError, TimeoutError, or a
 * platform-specific variant), and the abort reason object is not portable either. A local flag set
 * by the same timer that calls AbortController.abort() stays accurate everywhere, and it keeps an
 * abort without that flag from being misreported as a network failure.
 */

export const REQUEST_TIMEOUT_MS = 15000;

/**
 * Classify one failed /api/visitors request into a single stable reason.
 *
 * Precedence follows the information the dashboard actually has:
 * 1. An explicit timeout flag wins, because browsers name abort exceptions differently.
 * 2. The HTTP status, when a response exists (auth, forbidden, server).
 * 3. A non-abort thrown error, which means the request never reached the server.
 * 4. Anything else is unknown.
 *
 * Accepts a missing, null, or non-object argument so a caller cannot fail while reporting a failure.
 *
 * @param {{ status?: number, error?: unknown, timedOut?: boolean }} [failure]
 * @returns {'timeout' | 'auth' | 'forbidden' | 'server' | 'network' | 'unknown'}
 */
export function classifyFailure(failure = {}) {
  // Narrow before destructuring: a destructured parameter would throw on an explicit null,
  // and reporting a failure must not raise a second failure.
  const input = failure && typeof failure === 'object' ? failure : {};
  const { status, error, timedOut } = input;

  if (timedOut) return 'timeout';

  if (Number.isInteger(status) && status > 0) {
    if (status === 401) return 'auth';
    if (status === 403) return 'forbidden';
    if (status >= 500 && status <= 599) return 'server';
    return 'unknown';
  }

  if (error && !isAbortError(error)) return 'network';

  return 'unknown';
}

// An aborted request is not a network failure; the caller's timedOut flag decides what it means.
// code 20 is the legacy DOMException.ABORT_ERR value, still seen through wrapped fetch errors.
function isAbortError(error) {
  if (!error || typeof error !== 'object') return false;
  return error.name === 'AbortError' || error.code === 20;
}
