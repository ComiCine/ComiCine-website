/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Theme entry point for docs.limooo.cn.
 *
 * Extend the fork's default theme; the header and footer are maintained in
 * Limooooo-Studio/vitepress. This file adds Limooo brand styles and the main
 * site's cookie bridge.
 */
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'

import './styles.css'
import { installCookieBridge } from './limooo'

const theme = {
  extends: DefaultTheme,
  enhanceApp(ctx: Parameters<NonNullable<Theme['enhanceApp']>>[0]) {
    DefaultTheme.enhanceApp?.(ctx)
    installCookieBridge(ctx.router)
  }
} satisfies Theme

export default theme
