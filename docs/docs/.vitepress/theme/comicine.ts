/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Cookie bridge shared with the main site and documentation site.
 *
 * Main-site cookies (see site/src/static/js/base.js and functions/_lib/routing.ts):
 *   user_lang_preference = zh-cn | en-us | ja-jp | ko-kr   Domain=.comicine.com
 *   comicine_theme       = light | dark                     Domain=.comicine.com
 *
 * Language URL convention: the language code is the final path segment. Every
 * content page includes it explicitly, including the VitePress root language zh-cn.
 * Pages Functions resolve language-less entry URLs with the main site's
 * cookie > Accept-Language > Cloudflare country > config fallback order:
 *   /video-platform/zh-cn      zh-cn (/video-platform redirects here)
 *   /video-platform/en-us      en-us
 *   /README/zh-cn              README page
 *   /en-us                     English home page (/ is the zh-cn home page)
 *
 * This bridge has three responsibilities:
 *   1. Read the main site's theme cookie and initialize VitePress appearance on first visit.
 *   2. Watch VitePress theme changes and write the selected theme to comicine_theme.
 *   3. Write the current language to user_lang_preference after route changes.
 *      The server resolves language-less content entry URLs before VitePress loads.
 */

export const LANG_COOKIE = 'user_lang_preference'
export const THEME_COOKIE = 'comicine_theme'
export const APPEARANCE_KEY = 'vitepress-theme-appearance'

export const VITEPRESS_ROOT_LANG = 'zh-cn'
export const LANGS = ['zh-cn', 'en-us', 'ja-jp', 'ko-kr'] as const

const ROOT_DOMAIN = 'comicine.com'
const COOKIE_MAX_AGE = 31536000
/** Synchronous script run in <head> before VitePress's own check-dark-mode script. */
export const THEME_BOOTSTRAP_SCRIPT = `;(() => {
  try {
    if (localStorage.getItem('${APPEARANCE_KEY}')) return
    var m = document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)/)
    if (m) localStorage.setItem('${APPEARANCE_KEY}', m[1])
  } catch (e) {}
})()`

function cookieAttributes(): string {
  const host = location.hostname
  const domain =
    host === ROOT_DOMAIN || host.endsWith('.' + ROOT_DOMAIN)
      ? '; domain=.' + ROOT_DOMAIN
      : ''
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  return `; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}${domain}`
}

export function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')
  )
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}${cookieAttributes()}`
}

export function readThemeCookie(): string | null {
  return readCookie(THEME_COOKIE)
}

function pathSegments(path: string): string[] {
  return path.split('?')[0].split('/').filter(Boolean)
}

/** Derive the language from the final URL segment when the route is localized. */
export function langFromPath(path: string): string | null {
  const segments = pathSegments(path)
  const last = segments[segments.length - 1]
  return last && (LANGS as readonly string[]).includes(last)
    ? last
    : null
}

/** Check whether the path has an explicit language suffix. */
export function hasLangSuffix(path: string): boolean {
  const segments = pathSegments(path)
  const last = segments[segments.length - 1]
  return !!last && (LANGS as readonly string[]).includes(last)
}

/** Return the path for the same page in another language. */
export function pathForLang(path: string, lang: string): string {
  const segments = pathSegments(path)
  if (hasLangSuffix(path)) segments.pop()
  const base = segments.length ? '/' + segments.join('/') : '/'
  // The Chinese home page uses an explicit route because / redirects to the main site.
  if (base === '/' || base === '/docs-home') {
    return lang === VITEPRESS_ROOT_LANG ? '/docs-home/zh-cn' : `/${lang}`
  }
  return `${base}/${lang}`
}

export function isValidLang(value: string | null): value is string {
  return value !== null && (LANGS as readonly string[]).includes(value)
}

function syncLangCookie(path: string): void {
  const lang = langFromPath(path)
  if (!lang) return
  if (readCookie(LANG_COOKIE) !== lang) writeCookie(LANG_COOKIE, lang)
}

function syncThemeCookie(): void {
  const value = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light'
  if (readCookie(THEME_COOKIE) !== value) writeCookie(THEME_COOKIE, value)
}

function watchAppearance(): void {
  syncThemeCookie()
  new MutationObserver(syncThemeCookie).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
  })
}

interface RouterLike {
  onAfterRouteChange?: (to: string) => unknown
}

export function installCookieBridge(router: RouterLike): void {
  if (typeof document === 'undefined') return

  watchAppearance()
  syncLangCookie(location.pathname)

  const previous = router.onAfterRouteChange
  router.onAfterRouteChange = async (to: string) => {
    await previous?.(to)
    syncLangCookie(to)
  }
}
