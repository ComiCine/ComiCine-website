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

const theme = {
  extends: DefaultTheme,
  enhanceApp(ctx: Parameters<NonNullable<Theme['enhanceApp']>>[0]) {
    DefaultTheme.enhanceApp?.(ctx)
    installCookieBridge(ctx.router)
  }
} satisfies Theme

export default theme
