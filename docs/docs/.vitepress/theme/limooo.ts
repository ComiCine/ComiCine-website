/**
 * Cookie bridge shared with the main site (docs.limooo.cn and limooo.cn).
 *
 * Main-site cookies (see site/src/static/js/base.js and functions/_lib/routing.ts):
 *   user_lang_preference = zh-cn | en-us | ja-jp | ko-kr   Domain=.limooo.cn
 *   limooo_theme         = light | dark                     Domain=.limooo.cn
 *
 * Language URL convention: the language code is the final path segment. Every
 * content page includes it explicitly, including the default zh-cn. Paths without
 * a language suffix are redirected by _redirects to /.../zh-cn:
 *   /video-platform/zh-cn      zh-cn (/video-platform redirects here)
 *   /video-platform/en-us      en-us
 *   /README/zh-cn              README page
 *   /en-us                     English home page (/ is the zh-cn home page)
 *
 * This bridge has three responsibilities:
 *   1. Read the main site's theme cookie and initialize VitePress appearance on first visit.
 *   2. Watch VitePress theme changes and write the selected theme to limooo_theme.
 *   3. Write the current language to user_lang_preference after route changes. On a page
 *      without a language suffix, redirect once per session when the cookie selects a
 *      different language and the target page exists.
 */

export const LANG_COOKIE = 'user_lang_preference'
export const THEME_COOKIE = 'limooo_theme'
export const APPEARANCE_KEY = 'vitepress-theme-appearance'

export const DEFAULT_LANG = 'zh-cn'
export const LANGS = ['zh-cn', 'en-us', 'ja-jp', 'ko-kr'] as const

const ROOT_DOMAIN = 'limooo.cn'
const COOKIE_MAX_AGE = 31536000
const REDIRECT_FLAG = 'limooo-docs-lang-redirect'

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

function pathSegments(path: string): string[] {
  return path.split('?')[0].split('/').filter(Boolean)
}

/** Derive the language from the URL path, using the final segment or the default. */
export function langFromPath(path: string): string {
  const segments = pathSegments(path)
  const last = segments[segments.length - 1]
  return last && (LANGS as readonly string[]).includes(last)
    ? last
    : DEFAULT_LANG
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
  // The home page is the only exception: / is zh-cn; content pages still use /zh-cn.
  if (base === '/') return lang === DEFAULT_LANG ? '/' : `/${lang}`
  return `${base}/${lang}`
}

export function isValidLang(value: string | null): value is string {
  return value !== null && (LANGS as readonly string[]).includes(value)
}

function syncLangCookie(path: string): void {
  const lang = langFromPath(path)
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
  go: (to: string) => unknown
}

/**
 * Redirect once only when the current page has no language suffix and the cookie
 * selects a non-default language. Send a HEAD request first to avoid redirecting
 * to a 404 when the translation does not exist. Return true while redirecting so
 * the current page does not overwrite the cookie before the target page loads.
 */
async function maybeRedirectToPreferred(
  router: RouterLike,
  preferred: string | null
): Promise<boolean> {
  if (hasLangSuffix(location.pathname)) return false
  if (!isValidLang(preferred) || preferred === DEFAULT_LANG) return false
  try {
    if (sessionStorage.getItem(REDIRECT_FLAG)) return false
    sessionStorage.setItem(REDIRECT_FLAG, '1')
  } catch {
    return false
  }
  const target = pathForLang(location.pathname, preferred)
  if (target === location.pathname) return false
  try {
    const response = await fetch(target, { method: 'HEAD' })
    if (response.ok) {
      void router.go(target)
      return true
    }
  } catch {
    /* Treat an unreachable target as a missing translation and keep the current page. */
  }
  return false
}

export function installCookieBridge(router: RouterLike): void {
  if (typeof document === 'undefined') return

  watchAppearance()

  // Read the preference before writing the current page language. Otherwise,
  // syncLangCookie overwrites it immediately and the redirect cannot happen.
  const preferred = readCookie(LANG_COOKIE)
  void maybeRedirectToPreferred(router, preferred).then((redirecting) => {
    if (!redirecting) syncLangCookie(location.pathname)
  })

  const previous = router.onAfterRouteChange
  router.onAfterRouteChange = async (to: string) => {
    await previous?.(to)
    syncLangCookie(to)
  }
}
