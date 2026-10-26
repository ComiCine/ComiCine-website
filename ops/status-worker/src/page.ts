/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Status page presentation: header, footer, styles, scripts, and three page states (normal, 404, render failure).
 *
 * The header and footer "inherit base" by matching the `<nav>` in `site/src/templates/base.html`
 * and `_footer.html` item by item (same classes, SVGs, order, and `tokens.css` palette), but
 * **this file contains its own implementation** and does not load the main site's CSS:
 *   - status.limooo.cn is served by a separate Worker, while the main site's `/static/**` is
 *     cross-origin. `style-src 'self'` blocks it; loosening CSP would make this critical page
 *     depend on the main site and fail with it.
 *   - The main site uses precompiled Tailwind classes. Their equivalent CSS is written here
 *     (such as `.site-nav`, `.global-nav`, and `.nav-divider`), with matching class names for comparison.
 * The tradeoff is that header and footer changes on the main site must be copied here, as they
 * must also be copied to the docs.limooo.cn VitePress fork.
 */

import { type Lang, type UiKey, UI, LANG_LABELS, langFlag, probeDetail, t } from "./i18n";
import { BRAND_FONT_CSS } from "./brand-font";

/** Escape HTML; apply this to every interpolated value, including probe names and language codes from D1. */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Main-site asset host for the favicon and logo; matches `image_asset_host` in `config-contract.json`. */
const IMAGE_ASSET_BASE = "https://images.limooo.cn";
/** Repository linked by "Source" in the footer; matches `SOURCE_REPO_URL` in `src/config.py`. */
const SOURCE_REPO_URL = "https://github.com/Limooooo-Studio/Limooo-Website";
const GITHUB_URL = "https://github.com/Limooooo-Studio";
const BILIBILI_URL = "https://space.bilibili.com/1234163143";
const HOME_URL = "https://limooo.cn";
const SERVICES_URL = "https://services.limooo.cn";
const CONTACT_URL = "https://contact.limooo.cn";

// SVG paths and view boxes match base.html; the stylesheet supplies the shared dimensions.
const SVG_LANG =
  '<svg class="lang-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>';
const SVG_CHEVRON =
  '<svg class="lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SVG_SUN =
  '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const SVG_MOON =
  '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const SVG_MENU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
const SVG_EXTERNAL =
  '<svg class="nav-external" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5H9z"/></svg>';
const SVG_GITHUB =
  '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12c0 5.303 3.438 9.8 8.205 11.385c.6.113.82-.258.82-.577c0-.285-.01-1.04-.015-2.04c-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729c1.205.084 1.838 1.236 1.838 1.236c1.07 1.835 2.809 1.305 3.495.998c.108-.776.417-1.305.76-1.605c-2.665-.3-5.466-1.332-5.466-5.93c0-1.31.465-2.38 1.235-3.22c-.135-.303-.54-1.523.105-3.176c0 0 1.005-.322 3.3 1.23c.96-.267 1.98-.399 3-.405c1.02.006 2.04.138 3 .405c2.28-1.552 3.285-1.23 3.285-1.23c.645 1.653.24 2.873.12 3.176c.765.84 1.23 1.91 1.23 3.22c0 4.61-2.805 5.625-5.475 5.92c.42.36.81 1.096.81 2.22c0 1.606-.015 2.896-.015 3.286c0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';
const SVG_BILIBILI =
  '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.813 4.653h.854q2.266.08 3.773 1.574Q23.946 7.72 24 9.987v7.36q-.054 2.266-1.56 3.773c-1.506 1.507-2.262 1.524-3.773 1.56H5.333q-2.266-.054-3.773-1.56C.053 19.614.036 18.858 0 17.347v-7.36q.054-2.267 1.56-3.76t3.773-1.574h.774l-1.174-1.12a1.23 1.23 0 0 1-.373-.906q0-.534.373-.907l.027-.027q.4-.373.92-.373t.92.373L9.653 4.44q.107.106.187.213h4.267a.8.8 0 0 1 .16-.213l2.853-2.747q.4-.373.92-.373c.347 0 .662.151.929.4s.391.551.391.907q0 .532-.373.906zM5.333 7.24q-1.12.027-1.88.773q-.76.748-.786 1.894v7.52q.026 1.146.786 1.893t1.88.773h13.334q1.12-.026 1.88-.773t.786-1.893v-7.52q-.026-1.147-.786-1.894t-1.88-.773zM8 11.107q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q0-.56.386-.947q.387-.386.947-.386m8 0q.56 0 .933.373q.375.374.4.96v1.173q-.025.586-.4.96q-.373.375-.933.374c-.56-.001-.684-.125-.933-.374q-.375-.373-.4-.96V12.44q.025-.586.4-.96q.373-.373.933-.373"/></svg>';
/** Header corresponding to `<nav>` in base.html: wordmark, three links, language overlay, theme toggle, mobile menu, and desktop socials. */
export function navHtml(lang: Lang): string {
  const links: Array<[string, string]> = [
    [HOME_URL, t(lang, "nav_home")],
    [SERVICES_URL, t(lang, "nav_services")],
    [CONTACT_URL, t(lang, "nav_contact")],
  ];
  const options = (Object.keys(LANG_LABELS) as Lang[])
    .map(
      (code) =>
        `<a class="theme-option${code === lang ? " selected" : ""}" data-lang="${esc(code)}" href="?lang=${esc(code)}">` +
        `<span class="lang-flag">${esc(langFlag(code))}</span><span>${esc(LANG_LABELS[code])}</span></a>`,
    )
    .join("");
  return (
    '<nav class="site-nav"><div class="nav-inner">' +
    `<a href="${HOME_URL}" class="nav-brand-link" id="nav-logo" aria-label="Limooo"><span class="nav-brand">Limooo</span></a>` +
    '<div class="nav-right"><div class="global-nav">' +
    links
      .map(([href, label]) => `<a class="nav-link" href="${href}"><span>${esc(label)}</span>${SVG_EXTERNAL}</a>`)
      .join("") +
    '</div><span class="nav-divider"></span>' +
    '<div class="lang-toggle lang-flyout">' +
    `<button class="lang-btn" id="lang-btn" type="button" aria-label="${esc(t(lang, "lang_aria"))}" aria-haspopup="true" aria-expanded="false">${SVG_LANG}${SVG_CHEVRON}</button>` +
    `<div id="langMenu" class="lang-menu">${options}</div>` +
    '</div><span class="nav-divider nav-divider-lang-theme"></span>' +
    `<button class="appearance-switch" id="theme-switch" type="button" role="switch" aria-checked="false" aria-label="${esc(t(lang, "theme_aria"))}">` +
    `<span class="appearance-check"><span class="appearance-icon">${SVG_SUN}${SVG_MOON}</span></span></button>` +
    '<span class="nav-divider"></span><span class="nav-divider nav-divider-mobile"></span>' +
    '<div class="nav-mobile-menu">' +
    `<button class="icon-btn nav-menu-button" id="nav-menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-label="${esc(t(lang, "nav_menu_aria"))}">${SVG_MENU}</button>` +
    '<div id="navLinksDropdown" class="nav-menu" role="menu">' +
    `<a class="nav-menu-item" role="menuitem" href="${HOME_URL}"><span>${esc(t(lang, "nav_home"))}</span>${SVG_EXTERNAL}</a>` +
    `<a class="nav-menu-item" role="menuitem" href="${SERVICES_URL}"><span>${esc(t(lang, "nav_services"))}</span>${SVG_EXTERNAL}</a>` +
    `<a class="nav-menu-item" role="menuitem" href="${CONTACT_URL}"><span>${esc(t(lang, "nav_contact"))}</span>${SVG_EXTERNAL}</a>` +
    '</div></div>' +
    `<a class="icon-btn nav-social-link" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub">${SVG_GITHUB}</a>` +
    `<a class="icon-btn nav-social-link" href="${BILIBILI_URL}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t(lang, "visit_bilibili"))}">${SVG_BILIBILI}</a>` +
    '</div></div></nav>'
  );
}

/** Footer corresponding to _footer.html: copyright, rights, license, and source links; fixed to the bottom. */
export function footerHtml(lang: Lang): string {
  const currentYear = new Date().getUTCFullYear();
  const copyrightYears = currentYear === 2026 ? "2026" : `2026-${currentYear}`;
  return (
    '<footer class="global-footer" id="global-footer"><div class="footer-link"><div class="footer-text">' +
    `<span class="footer-item footer-copyright">&copy; <span data-copyright-years data-copyright-start-year="2026">${copyrightYears}</span> <span class="footer-brand">Limooo</span> Studio</span>` +
    `<span class="footer-item">${esc(t(lang, "footer_rights"))}</span>` +
    `<span class="footer-item">${esc(t(lang, "footer_source"))}</span>` +
    `<span class="footer-item"><a class="footer-source-link" href="${SOURCE_REPO_URL}" target="_blank" rel="noopener noreferrer">${esc(t(lang, "footer_source_link"))}</a></span>` +
    "</div></div></footer>"
  );
}

/**
 * Status page styles come from three sources:
 *   1. Design tokens matching `site/src/static/css/tokens.css`, the site-wide source of truth.
 *   2. Header and footer rules matching `site/src/static/css/base.css`, with equivalent CSS for
 *      the Tailwind classes used in base.html.
 *   3. Status cards unique to this page, including the `--up`, `--down`, and `--pending` colors.
 * The inlined brand font is in `brand-font.ts` (2.3 KB subset; the main site's copy is cross-origin and requires CORS).
 */
export const STATUS_CSS =
  BRAND_FONT_CSS +
  `
:root{
color-scheme:dark;--text-primary:#e2e2e3;--text-secondary:#b7b7bb;--text-muted:#a1a1aa;--text-subtle:#787880;--text-disabled:#65656b;--text-inverse:#fff;--text-rgb:226,226,227;--bg:#1b1b1f;--browser-theme-color:#1e1e1e;--text:var(--text-primary);--line:#2e2e32;--panel-bg:#202127;--highlight-surface:#2a2a2f;--highlight:var(--highlight-surface);--hover-highlight:#fff;--hover-highlight-soft:rgba(255,255,255,.12);--hover-highlight-border:rgba(255,255,255,.68);--hover-highlight-overlay:rgba(255,255,255,.14);--footer-border:var(--line);--accent:#05A5A6;--accent-soft:rgba(5,165,166,.12);--accent-glow:rgba(5,165,166,.2);--focus-ring:var(--accent);--danger:#f43f5e;--danger-strong:#ff4757;--danger-soft:rgba(255,71,87,.12);--success:#4ade80;--success-soft:rgba(34,197,94,.13);--info:#60a5fa;--info-soft:rgba(59,130,246,.13);--warning:#fbbf24;--warning-soft:rgba(245,158,11,.13);--purple:#c084fc;--purple-soft:rgba(168,85,247,.16);--status-down:#dc2626;--status-pending:#d97706;--shadow-soft:rgba(0,0,0,.15);--ease-out:cubic-bezier(.23,1,.32,1);--radius-sm:6px;--radius-md:10px;--radius-lg:16px;--radius-full:999px;--ls-scale:.65;--switch-icon:#dfdfd6;--switch-shadow:0 1px 3px var(--shadow-panel);--shadow-panel:rgba(0,0,0,.35);--muted:var(--text-muted);--up:var(--accent);--down:var(--status-down);--pending:var(--status-pending)
}
html[lang^="en"]{--ls-scale:.3}
.light-mode{color-scheme:light;--text-primary:#1f2328;--text-secondary:#45474c;--text-muted:#6b7280;--text-subtle:#858b94;--text-disabled:#9ca3af;--text-inverse:#fff;--text-rgb:31,35,40;--bg:#fff;--browser-theme-color:#fff;--text:var(--text-primary);--line:#e2e2e3;--panel-bg:#f6f6f7;--highlight-surface:#f2f2f3;--highlight:var(--highlight-surface);--footer-border:var(--line);--switch-icon:#67676c;--shadow-soft:rgba(0,0,0,.15);--switch-shadow:0 1px 2px var(--shadow-soft);--muted:var(--text-muted)}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;padding:0;width:100%}
body{background:var(--bg);color:var(--text);font:500 15px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}

/* Header rules equivalent to the main site navigation. */
.site-nav{position:fixed;top:0;left:0;width:100%;height:70px;z-index:100;background:var(--bg)}
@media(min-width:768px){.site-nav{height:100px}}
.nav-inner{display:flex;align-items:center;width:100%;max-width:80rem;height:100%;margin:0 auto;padding:0 20px}
@media(min-width:768px){.nav-inner{padding:0 2rem}}
.nav-brand-link{display:flex;align-items:center;flex-shrink:0;text-decoration:none}
.nav-brand{font-family:'Baloo 2',ui-rounded,system-ui,sans-serif;font-weight:700;line-height:1;font-size:1.125rem;letter-spacing:.05em;color:var(--text)}
@media(min-width:768px){.nav-brand{font-size:1.5rem}}
.nav-right{display:flex;align-items:center;margin-left:auto}
.global-nav{display:none;align-items:center}
@media(min-width:768px){.global-nav{display:flex}}
.global-nav a{display:inline-flex;align-items:center;padding:0 12px;font-size:14px;font-weight:500;text-decoration:none;color:var(--text);transition:color 200ms var(--ease-out);-webkit-font-smoothing:antialiased;white-space:nowrap}
.global-nav a.active,.global-nav a:hover{color:var(--accent)}
.nav-external{display:inline-block;margin-left:4px;width:11px;height:11px;flex-shrink:0;opacity:.45}
.nav-divider{display:none;width:1px;height:24px;background:var(--line);margin:0 12px;flex-shrink:0}
@media(min-width:768px){.nav-divider{display:block}}
.nav-divider-lang-theme{display:block}
.nav-divider-mobile{display:none}
@media(max-width:767px){.nav-divider-mobile{display:block}}
.icon-btn,.theme-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-md);border:none;background:none;cursor:pointer;color:var(--text);opacity:.75;text-decoration:none;transition:transform 200ms var(--ease-out),background 200ms var(--ease-out),opacity 200ms var(--ease-out)}
.icon-btn:active,.theme-btn:active{transform:scale(.92)}
.icon-btn .icon-svg,.theme-btn .icon-svg{width:18px;height:18px}
.nav-social-link svg,.nav-menu-button svg{width:18px;height:18px}
.nav-social-link svg{fill:currentColor}
@media(hover:hover) and (pointer:fine){.icon-btn:hover,.theme-btn:hover{background:var(--highlight);opacity:1}}
@media(max-width:767px){.nav-social-link{display:none}}
.nav-mobile-menu{position:relative;display:flex;align-items:center}
@media(min-width:768px){.nav-mobile-menu{display:none}}
.lang-toggle{position:relative;display:flex;align-items:center}
.lang-btn{display:flex;align-items:center;padding:0 12px;height:36px;border:none;background:none;cursor:pointer;color:var(--text);transition:color 200ms var(--ease-out)}
@media(hover:hover) and (pointer:fine){.lang-btn:hover{color:var(--accent)}}
.lang-icon{width:16px;height:16px}
.lang-chevron{width:14px;height:14px;margin-left:4px;opacity:.6}
.appearance-switch{position:relative;display:block;width:40px;height:22px;flex-shrink:0;padding:0;border:1px solid var(--line);border-radius:11px;background:var(--highlight);cursor:pointer;transition:border-color 200ms var(--ease-out),background-color 200ms var(--ease-out)}
@media(hover:hover) and (pointer:fine){.appearance-switch:hover{border-color:var(--accent)}}
.appearance-check{position:absolute;top:1px;left:1px;width:18px;height:18px;border-radius:50%;background:var(--bg);box-shadow:var(--switch-shadow);transform:translateX(18px);transition:transform 250ms var(--ease-out)}
.appearance-icon{position:relative;display:block;width:18px;height:18px;border-radius:50%;overflow:hidden}
.appearance-icon svg{position:absolute;top:3px;left:3px;width:12px;height:12px;color:var(--switch-icon);transition:opacity 250ms var(--ease-out)}
.appearance-icon .sun{opacity:0}
.appearance-icon .moon{opacity:1}
.light-mode .appearance-icon .sun{opacity:1}
.light-mode .appearance-icon .moon{opacity:0}
.light-mode .appearance-check{transform:translateX(0)}
.lang-menu,.nav-menu{position:absolute;right:0;padding:4px;z-index:200;background:var(--panel-bg);border:1px solid var(--line);border-radius:var(--radius-md);opacity:0;visibility:hidden;transform:translateY(-4px) scale(.92);transform-origin:top right;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 150ms;box-shadow:0 8px 28px var(--shadow-soft)}
.lang-menu{top:calc(100% + 4px);min-width:132px}
.lang-menu.open{opacity:1;visibility:visible;transform:translateY(0) scale(1)}
.nav-menu{top:calc(100% + 8px);min-width:120px}
.nav-menu.open{opacity:1;visibility:visible;transform:translateY(0) scale(1)}
.theme-option{display:block;padding:8px 14px;margin:2px 0;border-radius:var(--radius-sm);font-size:12px;font-weight:600;letter-spacing:calc(.05em*var(--ls-scale));cursor:pointer;white-space:nowrap;text-decoration:none;opacity:.5;color:var(--text);transition:background 150ms var(--ease-out)}
.theme-option.selected{opacity:1;background:var(--highlight)}
@media(hover:hover) and (pointer:fine){.theme-option:hover{opacity:1;background:var(--highlight)}}
.lang-flag{margin-right:6px}
.nav-menu-item{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;margin:2px 0;border-radius:var(--radius-sm);font-size:12px;font-weight:600;letter-spacing:calc(.05em*var(--ls-scale));white-space:nowrap;text-decoration:none;color:var(--text);opacity:.75;transition:background 150ms var(--ease-out)}
@media(hover:hover) and (pointer:fine){.nav-menu-item:hover{opacity:1;background:var(--highlight)}}

/* Footer (equivalent CSS for _footer.html) */
.global-footer{position:fixed;bottom:0;left:0;width:100%;z-index:90;border-top:1px solid var(--footer-border);background:var(--bg);display:flex;align-items:center;justify-content:center}
.footer-link{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:1.25rem 0;padding-bottom:calc(1.25rem + env(safe-area-inset-bottom));color:inherit;text-decoration:none}
.footer-text{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;row-gap:.45em;column-gap:0;padding-inline:1rem;font-size:10px;font-weight:600;letter-spacing:calc(.15em*var(--ls-scale));opacity:.5;text-align:center;line-height:1}
.footer-text>span,.footer-text>a{white-space:nowrap}
.footer-text>.footer-item{display:inline-block}
.footer-text>.footer-item:not(:first-child)::before{content:"\\00b7";margin:0 .55em;opacity:.7}
@media(max-width:559px){.footer-text>.footer-copyright{flex:0 0 100%;white-space:nowrap}.footer-text>.footer-copyright+.footer-item::before{content:none}}
.footer-brand{font-family:'Baloo 2',ui-rounded,system-ui,sans-serif;font-weight:700;letter-spacing:.02em;font-size:10px;font-size-adjust:.6552}
.footer-source-link{color:inherit;text-decoration:underline;white-space:nowrap}

/* Status content */
.status-main{max-width:880px;margin:0 auto;padding:96px 20px 110px}
@media(min-width:768px){.status-main{padding-top:132px}}
h1{font-size:28px;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 28px}
.overall{display:flex;align-items:center;gap:12px;padding:16px 18px;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel-bg)}
.overall.all{border-color:var(--up)}
.overall.partial{border-color:var(--pending)}
.overall.down{border-color:var(--down)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:0 0 auto}
/* The overview uses all/partial/down and cards use up/down/pending; both groups need colors:
   改版前卡片圆点只有 .dot 一条规则，故障卡的圆点是灰的（与状态文字不同色）。 */
.dot.all,.dot.up{background:var(--up)}
.dot.partial,.dot.pending{background:var(--pending)}
.dot.down{background:var(--down)}
.overall h2{font-size:17px;margin:0}
.count{color:var(--muted);font-size:14px}
section{margin-top:32px}
.sec-title{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card{border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel-bg);padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.card-top{display:flex;align-items:center;gap:8px}
.card h3{font-size:15px;font-weight:600;margin:0}
.card-bottom{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.state{font-size:13px}
.state.up{color:var(--up)}
.state.down{color:var(--down)}
.state.pending{color:var(--pending)}
.uptime{color:var(--muted);font-size:13px}
.status-footer{display:flex;justify-content:space-between;color:var(--muted);font-size:13px;margin-top:28px;border-top:1px solid var(--line);padding-top:14px}
.reason{color:var(--muted);font-size:12.5px;line-height:1.5;margin:0;overflow-wrap:anywhere}
.empty{color:var(--muted);font-size:14px;border:1px dashed var(--line);border-radius:var(--radius-lg);padding:16px 18px;margin:0}
.note{color:var(--muted);font-size:12px;margin-top:10px}

/* Error pages (404 or render failure) */
.err-box{border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel-bg);padding:20px}
.err-box p{margin:0;color:var(--muted)}
.err-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.btn{display:inline-flex;align-items:center;height:38px;padding:0 18px;border-radius:var(--radius-full);border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px;font-weight:600;transition:border-color 200ms var(--ease-out),color 200ms var(--ease-out)}
.btn.primary{border-color:var(--accent);color:var(--accent)}
@media(hover:hover) and (pointer:fine){.btn:hover{color:var(--hover-highlight);background:var(--hover-highlight-soft)}}`;

/**
 * Theme preload script: **must run synchronously before the first render**, or light-theme users
 * will briefly see a dark background. It follows `site/src/static/js/theme-preload.js`:
 * localStorage > shared cookie > system preference. CSP disallows `unsafe-inline`, so this must
 * remain an external script.
 */
export const THEME_JS =
  "(function(){var t=null;try{t=localStorage.getItem('theme')}catch(e){}" +
  "if(t!=='light'&&t!=='dark'){var m=document.cookie.match(/(?:^|;\\s*)limooo_theme=(light|dark)/);t=m?m[1]:null}" +
  "if(t==='light'||(!t&&window.matchMedia('(prefers-color-scheme: light)').matches)){document.documentElement.classList.add('light-mode')}})();";

/** Automatic refresh interval in seconds; shared with the initial countdown to prevent mismatched hard-coded values. */
export const REFRESH_SECONDS = 300;

/**
 * Page script for the countdown, automatic refresh, language overlay, theme toggle, and bridge between the language cookie and initial page language.
 *
 * Unlike the main site's `base.js`, which swaps dictionaries without reloading, this script
 * reloads with `?lang=`. The status page is server-rendered and edge-cached, so putting the
 * language in the query string gives each language its own cache key without sending all four
 * dictionaries on every page load.
 * Language and theme cookies use `Domain=.limooo.cn`; changing either here also affects the
 * main site and docs.limooo.cn on the next visit, matching the docs bridge strategy.
 */
export const STATUS_JS =
  "(function(){var REFRESH=" +
  REFRESH_SECONDS +
  ",ROOT='limooo.cn',LANG_COOKIE='user_lang_preference',THEME_COOKIE='limooo_theme',MAX_AGE=31536000," +
  "LANGS=['zh-cn','en-us','ja-jp','ko-kr'],doc=document,html=doc.documentElement;" +
  "var copyrightYears=doc.querySelectorAll('[data-copyright-years]'),now=new Date(),copyrightYear=now.getUTCFullYear();" +
  "try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;if(tz){var y=Number(new Intl.DateTimeFormat('en-US',{timeZone:tz,year:'numeric'}).format(now));if(Number.isInteger(y))copyrightYear=y}}catch(e){}" +
  "copyrightYears.forEach(function(el){var start=Number(el.getAttribute('data-copyright-start-year'));if(Number.isInteger(start))el.textContent=start===copyrightYear?String(start):String(start)+'-'+copyrightYear});" +
  "function cookie(n){var m=doc.cookie.match(new RegExp('(?:^|;\\\\s*)'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):''}" +
  "function save(n,v){var h=location.hostname,d=(h===ROOT||h.slice(-(ROOT.length+1))==='.'+ROOT)?'; domain=.'+ROOT:'',s=location.protocol==='https:'?'; Secure':'';" +
  "doc.cookie=n+'='+encodeURIComponent(v)+'; path=/; max-age='+MAX_AGE+'; SameSite=Lax'+s+d}" +
  "var up=doc.getElementById('updated-at');if(up){var ep=Number(up.getAttribute('data-epoch'));" +
  "if(ep){try{up.textContent=new Date(ep*1000).toLocaleString(html.lang||undefined)}catch(e){up.textContent=new Date(ep*1000).toISOString()}}}" +
  "var left=REFRESH,cnt=doc.getElementById('refresh-count');" +
  "setInterval(function(){left-=1;if(cnt){cnt.textContent=String(left>0?left:0)}if(left<=0){location.reload()}},1000);" +
  "var sw=doc.getElementById('theme-switch');" +
  "function theme(){var s=null;try{s=localStorage.getItem('theme')}catch(e){}if(s==='light'||s==='dark')return s;" +
  "var c=cookie(THEME_COOKIE);if(c==='light'||c==='dark')return c;" +
  "return window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}" +
  "function paint(t){html.classList.toggle('light-mode',t==='light');if(sw)sw.setAttribute('aria-checked',t==='dark'?'true':'false')}" +
  "if(sw){paint(theme());sw.addEventListener('click',function(){var n=theme()==='light'?'dark':'light';" +
  "try{localStorage.setItem('theme',n)}catch(e){}save(THEME_COOKIE,n);paint(n)})}" +
  "var menu=doc.getElementById('langMenu'),btn=doc.getElementById('lang-btn'),fly=doc.querySelector('.lang-flyout'),navMenu=doc.getElementById('navLinksDropdown'),navBtn=doc.getElementById('nav-menu-btn');" +
  "function open(o){if(!menu)return;menu.classList.toggle('open',o);if(btn)btn.setAttribute('aria-expanded',o?'true':'false')}" +
  "function openNav(o){if(!navMenu)return;navMenu.classList.toggle('open',o);if(navBtn)navBtn.setAttribute('aria-expanded',o?'true':'false')}" +
  "if(btn)btn.addEventListener('click',function(e){e.stopPropagation();open(!menu.classList.contains('open'));openNav(false)});" +
  "if(navBtn)navBtn.addEventListener('click',function(e){e.stopPropagation();openNav(!navMenu.classList.contains('open'));open(false)});" +
  "if(fly&&window.matchMedia('(hover: hover) and (pointer: fine)').matches){" +
  "fly.addEventListener('mouseenter',function(){open(true)});fly.addEventListener('mouseleave',function(){open(false)})}" +
  "doc.addEventListener('click',function(){open(false);openNav(false)});" +
  "if(menu)menu.addEventListener('click',function(e){e.stopPropagation();var el=e.target.closest('[data-lang]');if(!el)return;e.preventDefault();" +
  "var c=el.getAttribute('data-lang');if(LANGS.indexOf(c)<0)return;save(LANG_COOKIE,c);" +
  "var u=new URL(location.href);u.searchParams.set('lang',c);location.href=u.toString()});" +
  "var pref=cookie(LANG_COOKIE),explicit=new URL(location.href).searchParams.get('lang'),guard='limooo_status_lang_synced';" +
  "if(pref&&LANGS.indexOf(pref)>=0&&pref!==html.lang&&!explicit){var done=false;" +
  "try{done=sessionStorage.getItem(guard)==='1'}catch(e){}if(!done){try{sessionStorage.setItem(guard,'1')}catch(e){}" +
  "var v=new URL(location.href);v.searchParams.set('lang',pref);location.replace(v.toString())}}})();";

/** Probe record for rendering. `detail` is a normalized error code, not raw exception text. */
export interface PageProbe {
  name: string;
  group: string;
  label_key: string | null;
  status: number | null;
  uptime: number | null;
  detail: string;
}

export interface PagePayload {
  updated_at: number;
  total: number;
  down: number;
  probes: PageProbe[];
}

/** Map probe status to one of the display states: 1 up, 0 down, otherwise pending. */
export function statusKey(status: number | null): "up" | "down" | "pending" {
  return status === 1 ? "up" : status === 0 ? "down" : "pending";
}

/** Page shell; `<head>` contains only two same-origin assets (stylesheet and theme preload script), with no inline script or styles. */
function shell(lang: Lang, title: string, body: string): string {
  return (
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark light">' +
    `<title>${esc(title)}</title><meta name="robots" content="noindex">` +
    `<link rel="icon" href="${IMAGE_ASSET_BASE}/static/icons/Limooo.svg?v=2" type="image/svg+xml">` +
    '<script src="/status-theme.js"></script>' +
    '<link rel="stylesheet" href="/status.css">' +
    `</head><body data-lang="${esc(lang)}">` +
    navHtml(lang) +
    body +
    footerHtml(lang) +
    '<script src="/status.js" defer></script></body></html>'
  );
}

/** Server-render the status page from data already fetched by the caller; this pure function is easy to test. */
export function statusPageHtml(payload: PagePayload, lang: Lang): string {
  const groups: Array<{ key: string; label: string; probes: PageProbe[] }> = [
    { key: "public", label: t(lang, "group_public"), probes: [] },
    { key: "internal", label: t(lang, "group_internal"), probes: [] },
  ];
  for (const p of payload.probes) {
    const bucket = groups.find((g) => g.key === p.group) ?? groups[1];
    bucket.probes.push(p);
  }

  const card = (p: PageProbe) => {
    const sk = statusKey(p.status);
    // `label_key` from D1 (`probes.label_key`) can be any string; translate known keys, otherwise use the probe name.
    const label = (p.label_key && UI[lang][p.label_key as UiKey]) || p.name;
    const uptime = p.uptime === null ? "—" : `${p.uptime.toFixed(2)}%`;
    // Show a reason only for non-healthy states; otherwise the line is noise, and an up code
    // (`http_200` or `ok`) gives visitors no useful information.
    const reason =
      sk === "up"
        ? ""
        : `<p class="reason">${esc(t(lang, "reason_line", { detail: probeDetailSafe(p.detail, lang) }))}</p>`;
    return (
      `<div class="card"><div class="card-top"><span class="dot ${sk}"></span><h3>${esc(label)}</h3></div>` +
      `<div class="card-bottom"><span class="state ${sk}">${esc(t(lang, sk))}</span>` +
      `<span class="uptime">${esc(uptime)} <span>${esc(t(lang, "uptime"))}</span></span></div>` +
      reason +
      "</div>"
    );
  };

  const sections = groups
    .filter((g) => g.probes.length > 0)
    .map(
      (g) =>
        `<section><h2 class="sec-title">${esc(g.label)}</h2><div class="grid">` +
        g.probes.map(card).join("") +
        "</div></section>",
    )
    .join("");

  const overallKey = payload.down === 0 ? "all" : payload.down < payload.total ? "partial" : "down";
  const body =
    '<main class="status-main">' +
    `<h1>${esc(t(lang, "title"))}</h1><p class="sub">${esc(t(lang, "sub"))}</p>` +
    `<div class="overall ${overallKey}"><div class="dot ${overallKey}"></div>` +
    `<div><h2>${esc(t(lang, `overall_${overallKey}`))}</h2>` +
    `<span class="count">(${payload.down}/${payload.total})</span></div></div>` +
    (payload.total === 0 ? `<p class="empty">${esc(t(lang, "no_probes"))}</p>` : sections) +
    `<footer class="status-footer"><span>${esc(t(lang, "updated"))} ` +
    `<time id="updated-at" data-epoch="${payload.updated_at}">—</time></span>` +
    `<span>${esc(t(lang, "refresh"))} <span id="refresh-count">${REFRESH_SECONDS}</span>s</span></footer>` +
    `<p class="note">${esc(t(lang, "note"))}</p>` +
    "</main>";
  return shell(lang, t(lang, "title"), body);
}

/** Map a normalized error code to copy; this fallback prevents any exception from breaking the whole page render. */
function probeDetailSafe(code: string, lang: Lang): string {
  try {
    return probeDetail(code, lang);
  } catch {
    return t(lang, "err_unknown_code", { code: code || "unknown" });
  }
}

/** 404 for mistyped, scanned, or outdated URLs. Keep the branded header and footer, replacing only the content with an explanation and exit link. */
export function notFoundHtml(lang: Lang): string {
  const body =
    '<main class="status-main">' +
    `<h1>${esc(t(lang, "notfound_title"))}</h1>` +
    `<div class="err-box"><p>${esc(t(lang, "notfound_text"))}</p>` +
    '<div class="err-actions">' +
    `<a class="btn primary" href="/">${esc(t(lang, "back_status"))}</a>` +
    `<a class="btn" href="${HOME_URL}">${esc(t(lang, "back_home"))}</a>` +
    "</div></div></main>";
  return shell(lang, t(lang, "notfound_title"), body);
}

/**
 * Render failure (D1 read failure or unexpected exception): 503 + no-store.
 *
 * This is the **status page's own** error page. If D1 is unavailable, do not return Cloudflare's
 * generic 1101 page, which has no branding or exit link and makes visitors think the whole site
 * is down. Copy comes from the same table and is available in all four languages.
 */
export function renderErrorHtml(lang: Lang): string {
  const body =
    '<main class="status-main">' +
    `<h1>${esc(t(lang, "err_title"))}</h1>` +
    `<div class="err-box"><p>${esc(t(lang, "err_text"))}</p>` +
    '<div class="err-actions">' +
    `<a class="btn primary" href="/">${esc(t(lang, "err_retry"))}</a>` +
    `<a class="btn" href="${HOME_URL}">${esc(t(lang, "back_home"))}</a>` +
    "</div></div>" +
    `<p class="note">${esc(t(lang, "note"))}</p></main>`;
  return shell(lang, t(lang, "err_title"), body);
}
