/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Theme entry point for the ComiCine documentation site.
 *
 * Extend the fork's default theme; the header and footer are maintained in
 * ComiCine/vitepress. This file adds ComiCine brand styles and the main
 * site's cookie bridge.
 */
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'

import './styles.css'
import { installCookieBridge } from './comicine'

function normalizeEmptyUrlDelimiters(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const query = url.search.slice(1).replace(/^&+|&+$/g, '')
  const cleanPath = url.pathname + (query ? `?${query}` : '') + url.hash
  if (url.href !== url.origin + cleanPath) {
    window.history.replaceState(window.history.state, '', cleanPath)
  }
}

const theme = {
  extends: DefaultTheme,
  enhanceApp(ctx: Parameters<NonNullable<Theme['enhanceApp']>>[0]) {
    DefaultTheme.enhanceApp?.(ctx)
    normalizeEmptyUrlDelimiters()
    installCookieBridge(ctx.router)
  }
} satisfies Theme

export default theme
