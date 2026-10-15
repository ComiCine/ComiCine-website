/**
 * Limooo - serverless personal website and admin system
 *
 * Copyright (C) 2026 Limooo <https://limooo.cn/>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * 状态页的呈现层：页头 / 页脚 / 样式 / 脚本 / 三种页面（正常 / 404 / 渲染失败）。
 *
 * 页头页脚「继承 base」= 逐条对齐 site/src/templates/base.html 的 <nav> 与
 * _footer.html（同样的类名、同样的 SVG、同样的顺序、同样读 tokens.css 的色板），
 * 但**实现是本文件自带的一份**，不链主站的 CSS：
 *   - status.limooo.cn 是独立 Worker，主站 /static/** 属于另一个源，
 *     `style-src 'self'` 会直接拦掉，放开 CSP 又等于给这个最该稳的页面
 *     加一个「主站挂了它也塌」的依赖；
 *   - 主站用的是预编译 Tailwind 工具类，这里把用到的工具类手写成等价 CSS
 *     （.site-nav / .global-nav / .nav-divider …），类名保持一致便于对照。
 * 代价：主站改页头页脚时这里要同步（docs.limooo.cn 的 VitePress fork 同理）。
 */

import { type Lang, type UiKey, UI, LANG_LABELS, langFlag, probeDetail, t } from "./i18n";
import { BRAND_FONT_CSS } from "./brand-font";

/** HTML 转义：页面里每一处插值都必须过它（含 DB 里的探针名与语言码）。 */
export function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 主站资源主机（favicon/logo）：与 config-contract.json 的 image_asset_host 一致。 */
const IMAGE_ASSET_BASE = "https://images.limooo.cn";
/** 页脚「源码」指向的仓库：与 src/config.py 的 SOURCE_REPO_URL 一致。 */
const SOURCE_REPO_URL = "https://github.com/Limooooo-Studio/Limooo-Website";
const GITHUB_URL = "https://github.com/Limooooo-Studio";
const BILIBILI_URL = "https://space.bilibili.com/1234163143";
const HOME_URL = "https://limooo.cn";
const SERVICES_URL = "https://services.limooo.cn";
const CONTACT_URL = "https://contact.limooo.cn";

// ── SVG（逐字取自 base.html，只把 Tailwind 的 w-[18px] h-[18px] 换成 .icon-svg）──
const SVG_LANG =
  '<svg class="lang-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>';
const SVG_CHEVRON =
  '<svg class="lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SVG_SUN =
  '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const SVG_MOON =
  '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
const SVG_EXTERNAL =
  '<svg class="nav-external" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M0 0h24v24H0V0z" fill="none"/><path d="M9 5v2h6.59L4 18.59 5.41 20 17 8.41V15h2V5H9z"/></svg>';
const SVG_GITHUB =
  '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>';
const SVG_BILIBILI =
  '<svg class="icon-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/></svg>';

/** 页头：对应 base.html 的 <nav>（品牌字 → 三个导航链接 → 语言浮层 → 深浅胶囊 → 社交）。 */
export function navHtml(lang: Lang): string {
  const links: Array<[string, string]> = [
    [HOME_URL, t(lang, "nav_home")],
    [SERVICES_URL, t(lang, "nav_services")],
    [CONTACT_URL, t(lang, "nav_contact")],
  ];
  const options = (Object.keys(LANG_LABELS) as Lang[])
    .map(
      (code) =>
        `<div class="theme-option${code === lang ? " selected" : ""}" data-lang="${esc(code)}" role="menuitem">` +
        `<span class="lang-flag">${esc(langFlag(code))}</span><span>${esc(LANG_LABELS[code])}</span></div>`,
    )
    .join("");
  return (
    '<nav class="site-nav">' +
    `<a href="${HOME_URL}" class="nav-logo" id="nav-logo"><span class="nav-brand">Limooo</span></a>` +
    '<div class="nav-right">' +
    '<div class="global-nav">' +
    links
      .map(([href, label]) => `<a href="${href}"><span>${esc(label)}</span>${SVG_EXTERNAL}</a>`)
      .join("") +
    "</div>" +
    '<span class="nav-divider"></span>' +
    '<div class="theme-toggle lang-flyout">' +
    `<button class="lang-btn" id="lang-btn" type="button" aria-label="${esc(t(lang, "lang_aria"))}" aria-haspopup="true" aria-expanded="false">${SVG_LANG}${SVG_CHEVRON}</button>` +
    `<div id="langMenu" class="theme-menu" role="menu">${options}</div>` +
    "</div>" +
    '<span class="nav-divider"></span>' +
    `<button class="appearance-switch" id="theme-switch" type="button" role="switch" aria-checked="false" aria-label="${esc(t(lang, "theme_aria"))}">` +
    `<span class="appearance-check"><span class="appearance-icon">${SVG_SUN}${SVG_MOON}</span></span>` +
    "</button>" +
    '<span class="nav-divider"></span>' +
    `<a class="icon-btn" href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer" aria-label="GitHub" title="GitHub">${SVG_GITHUB}</a>` +
    `<a class="icon-btn" href="${BILIBILI_URL}" target="_blank" rel="noopener noreferrer" aria-label="${esc(t(lang, "visit_bilibili"))}" title="${esc(t(lang, "visit_bilibili"))}">${SVG_BILIBILI}</a>` +
    "</div></nav>"
  );
}

/** 页脚：对应 _footer.html（版权 · 权利 · 许可证 · 源码链接，整条固定底部）。 */
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
 * 状态页样式。三块来源：
 *   1. 设计令牌 —— 与 site/src/static/css/tokens.css 同值（那份是全站单一事实源）；
 *   2. 页头页脚 —— 与 site/src/static/css/base.css 的对应规则同值，
 *      并把 base.html 用到的 Tailwind 工具类手写成等价 CSS；
 *   3. 状态卡片 —— 本页独有（含 --up/--down/--pending 三个状态色）。
 * 品牌字体内联见 brand-font.ts（子集 2.3 KB，主站那份是跨源且需要 CORS）。
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

/* ── 页头（base.html <nav> 的等价 CSS）── */
.site-nav{position:fixed;top:0;left:50%;transform:translateX(-50%);width:100%;max-width:80rem;z-index:100;display:flex;align-items:center;padding:0 1.25rem;height:70px;background:var(--bg)}
@media(min-width:768px){.site-nav{padding:0 2rem;height:100px}}
.nav-logo{display:flex;align-items:center;gap:.5rem;flex-shrink:0;text-decoration:none;color:var(--text)}
@media(min-width:768px){.nav-logo{gap:.625rem}}
.nav-brand{font-family:'Baloo 2',ui-rounded,system-ui,sans-serif;font-weight:700;line-height:1;font-size:1.125rem;letter-spacing:.05em}
@media(min-width:768px){.nav-brand{font-size:1.5rem}}
.nav-right{display:flex;align-items:center;margin-left:auto}
.global-nav{display:none;align-items:center}
@media(min-width:768px){.global-nav{display:flex}}
.global-nav a{display:inline-flex;align-items:center;padding:0 12px;font-size:14px;font-weight:500;text-decoration:none;color:var(--text);transition:color 200ms var(--ease-out);-webkit-font-smoothing:antialiased}
.global-nav a.active{color:var(--accent)}
@media(hover:hover) and (pointer:fine){.global-nav a:hover{color:var(--accent)}}
.nav-external{display:inline-block;margin-left:4px;width:11px;height:11px;flex-shrink:0;opacity:.45}
.nav-divider{display:none;width:1px;height:24px;background:var(--line);margin:0 12px;flex-shrink:0}
@media(min-width:768px){.nav-divider{display:block}}
.icon-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-md);border:none;background:none;cursor:pointer;color:var(--text);opacity:.75;transition:transform 200ms var(--ease-out),background 200ms var(--ease-out),opacity 200ms var(--ease-out)}
.icon-btn:active{transform:scale(.92)}
.icon-btn .icon-svg{width:18px;height:18px}
@media(hover:hover) and (pointer:fine){.icon-btn:hover{background:var(--highlight);opacity:1}}
.lang-btn{display:flex;align-items:center;padding:0 12px;height:36px;border:none;background:none;cursor:pointer;color:var(--text);transition:color 200ms var(--ease-out)}
@media(hover:hover) and (pointer:fine){.lang-btn:hover{color:var(--accent)}}
.lang-btn .lang-icon{width:16px;height:16px}
.lang-btn .lang-chevron{width:14px;height:14px;margin-left:4px;opacity:.6}
.appearance-switch{position:relative;border-radius:11px;display:block;width:40px;height:22px;flex-shrink:0;border:1px solid var(--line);background:var(--highlight);cursor:pointer;padding:0;transition:border-color 200ms var(--ease-out),background-color 200ms var(--ease-out)}
@media(hover:hover) and (pointer:fine){.appearance-switch:hover{border-color:var(--accent)}}
.appearance-check{position:absolute;top:1px;left:1px;width:18px;height:18px;border-radius:50%;background:var(--bg);box-shadow:var(--switch-shadow);transform:translateX(18px);transition:transform 250ms var(--ease-out)}
.appearance-icon{position:relative;display:block;width:18px;height:18px;border-radius:50%;overflow:hidden}
.appearance-icon svg{position:absolute;top:3px;left:3px;width:12px;height:12px;color:var(--switch-icon);transition:opacity 250ms var(--ease-out)}
.appearance-icon .sun{opacity:0}
.appearance-icon .moon{opacity:1}
.light-mode .appearance-icon .sun{opacity:1}
.light-mode .appearance-icon .moon{opacity:0}
.light-mode .appearance-check{transform:translateX(0)}
.theme-toggle{position:relative;display:flex;align-items:center}
.theme-menu{position:absolute;top:calc(100% + 8px);right:0;min-width:120px;background:var(--panel-bg);border:1px solid var(--line);border-radius:var(--radius-md);padding:4px;z-index:200;opacity:0;visibility:hidden;transform:translateY(-4px) scale(.92);transform-origin:top right;transition:opacity 150ms var(--ease-out),transform 150ms var(--ease-out),visibility 150ms;box-shadow:0 8px 28px var(--shadow-soft)}
.theme-menu.open{opacity:1;visibility:visible;transform:translateY(0) scale(1);transition:opacity 200ms var(--ease-out),transform 200ms var(--ease-out)}
.theme-option{padding:8px 14px;margin:2px 0;border-radius:var(--radius-sm);font-size:12px;font-weight:600;letter-spacing:calc(.05em*var(--ls-scale));cursor:pointer;white-space:nowrap;transition:background 150ms var(--ease-out);opacity:.5}
.lang-flag{margin-right:6px}
.theme-option.selected{opacity:1;background:var(--highlight)}
@media(hover:hover) and (pointer:fine){.theme-option:hover{opacity:1;background:var(--highlight)}}

/* ── 页脚（_footer.html 的等价 CSS）── */
.global-footer{position:fixed;bottom:0;left:0;width:100%;z-index:90;border-top:1px solid var(--footer-border);background:var(--bg);display:flex;align-items:center;justify-content:center}
.footer-link{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:1.25rem 0;padding-bottom:calc(1.25rem + env(safe-area-inset-bottom));color:inherit;text-decoration:none}
.footer-text{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;row-gap:.45em;column-gap:0;padding-inline:1rem;font-size:10px;font-weight:600;letter-spacing:calc(.15em*var(--ls-scale));opacity:.5;text-align:center;line-height:1}
.footer-text>span,.footer-text>a{white-space:nowrap}
.footer-text>.footer-item{display:inline-block}
.footer-text>.footer-item:not(:first-child)::before{content:"\\00b7";margin:0 .55em;opacity:.7}
@media(max-width:559px){.footer-text>.footer-copyright{flex-basis:100%}.footer-text>.footer-copyright+.footer-item::before{content:none}}
.footer-brand{font-family:'Baloo 2',ui-rounded,system-ui,sans-serif;font-weight:700;letter-spacing:.02em;font-size:10px;font-size-adjust:.6552}
.footer-source-link{color:inherit;text-decoration:underline;white-space:nowrap}

/* ── 状态内容 ── */
.status-main{max-width:880px;margin:0 auto;padding:96px 20px 110px}
@media(min-width:768px){.status-main{padding-top:132px}}
h1{font-size:28px;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 28px}
.overall{display:flex;align-items:center;gap:12px;padding:16px 18px;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel-bg)}
.overall.all{border-color:var(--up)}
.overall.partial{border-color:var(--pending)}
.overall.down{border-color:var(--down)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:0 0 auto}
/* 总览用 all/partial/down，卡片用 up/down/pending —— 两组都要给颜色：
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

/* ── 故障页（404 / 渲染失败）── */
.err-box{border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--panel-bg);padding:20px}
.err-box p{margin:0;color:var(--muted)}
.err-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.btn{display:inline-flex;align-items:center;height:38px;padding:0 18px;border-radius:var(--radius-full);border:1px solid var(--line);color:var(--text);text-decoration:none;font-size:14px;font-weight:600;transition:border-color 200ms var(--ease-out),color 200ms var(--ease-out)}
.btn.primary{border-color:var(--accent);color:var(--accent)}
@media(hover:hover) and (pointer:fine){.btn:hover{border-color:var(--hover-highlight);color:var(--hover-highlight);background:var(--hover-highlight-soft)}}`;

/**
 * 主题预置脚本：**必须在首屏渲染前同步执行**，否则浅色用户会看到一帧深色底
 * （与主站 site/src/static/js/theme-preload.js 同逻辑：localStorage > 共享 cookie >
 * 系统偏好）。CSP 里没有 unsafe-inline，所以它只能是一个外链脚本。
 */
export const THEME_JS =
  "(function(){var t=null;try{t=localStorage.getItem('theme')}catch(e){}" +
  "if(t!=='light'&&t!=='dark'){var m=document.cookie.match(/(?:^|;\\s*)limooo_theme=(light|dark)/);t=m?m[1]:null}" +
  "if(t==='light'||(!t&&window.matchMedia('(prefers-color-scheme: light)').matches)){document.documentElement.classList.add('light-mode')}})();";

/** 自动重载节奏（秒）：与渲染出的首屏倒计时共用同一个常量（曾经两边写死不同值）。 */
export const REFRESH_SECONDS = 300;

/**
 * 页面脚本：倒计时/自动刷新 + 语言浮层 + 深浅胶囊 + 语言 cookie 与首屏语言的桥接。
 *
 * 与主站 base.js 的差别：主站是「纯前端换字典、不刷新」，这里直接带着
 * `?lang=` 重新请求一次——状态页是服务端渲染 + 边缘缓存，语言进查询串
 * 才有独立缓存键，换字典反而要多下发四份文案。
 * 语言/主题 cookie 都写 `Domain=.limooo.cn`，所以在这里切一次，
 * 主站和 docs.limooo.cn 下次访问也跟着变（与 docs 的桥接策略一致）。
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
  "var menu=doc.getElementById('langMenu'),btn=doc.getElementById('lang-btn'),fly=doc.querySelector('.lang-flyout');" +
  "function open(o){if(!menu)return;menu.classList.toggle('open',o);if(btn)btn.setAttribute('aria-expanded',o?'true':'false')}" +
  "if(btn)btn.addEventListener('click',function(e){e.stopPropagation();open(!menu.classList.contains('open'))});" +
  "if(fly&&window.matchMedia('(hover: hover) and (pointer: fine)').matches){" +
  "fly.addEventListener('mouseenter',function(){open(true)});fly.addEventListener('mouseleave',function(){open(false)})}" +
  "doc.addEventListener('click',function(){open(false)});" +
  "if(menu)menu.addEventListener('click',function(e){e.stopPropagation();var el=e.target.closest('[data-lang]');if(!el)return;" +
  "var c=el.getAttribute('data-lang');if(LANGS.indexOf(c)<0)return;save(LANG_COOKIE,c);" +
  "var u=new URL(location.href);u.searchParams.set('lang',c);location.href=u.toString()});" +
  "var pref=cookie(LANG_COOKIE),explicit=new URL(location.href).searchParams.get('lang'),guard='limooo_status_lang_synced';" +
  "if(pref&&LANGS.indexOf(pref)>=0&&pref!==html.lang&&!explicit){var done=false;" +
  "try{done=sessionStorage.getItem(guard)==='1'}catch(e){}if(!done){try{sessionStorage.setItem(guard,'1')}catch(e){}" +
  "var v=new URL(location.href);v.searchParams.set('lang',pref);location.replace(v.toString())}}})();";

/** 探针（渲染用）。`detail` 是归一化错误码，不是原始异常文本。 */
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

/** 探针状态 → 展示用的三态键（1 up / 0 down / 其他 pending）。 */
export function statusKey(status: number | null): "up" | "down" | "pending" {
  return status === 1 ? "up" : status === 0 ? "down" : "pending";
}

/** 整页骨架：<head> 里只有两个自源资源（样式 + 主题预置脚本），无内联脚本/样式。 */
function shell(lang: Lang, title: string, body: string): string {
  return (
    `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="dark light">' +
    `<title>${esc(title)} · limooo.cn</title><meta name="robots" content="noindex">` +
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

/** 服务端渲染状态页（数据由调用方查好，本函数是纯函数，便于测试）。 */
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
    // label_key 来自 D1（probes.label_key）——任意字符串，命中表就翻译，否则用探针名。
    const label = (p.label_key && UI[lang][p.label_key as UiKey]) || p.name;
    const uptime = p.uptime === null ? "—" : `${p.uptime.toFixed(2)}%`;
    // 只有非「正常」状态才解释原因：正常时那行是噪音，而且 up 的码（http_200/ok）
    // 对访客没有信息量。
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

/** 归一化错误码 → 文案；这里再兜一层，任何异常都不该让整页渲染失败。 */
function probeDetailSafe(code: string, lang: Lang): string {
  try {
    return probeDetail(code, lang);
  } catch {
    return t(lang, "err_unknown_code", { code: code || "unknown" });
  }
}

/** 404：地址写错/扫站/旧链接。品牌页头页脚照旧，只是中间换成说明与出口。 */
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
 * 渲染失败（D1 读不出来 / 未预期异常）：503 + no-store。
 *
 * 这是**状态页自己**的错误页：读不到库时不能返回 Cloudflare 的 1101 通用错误页，
 * 那既没有品牌也没有出口，访客只会以为整个站都挂了。文案走同一张表，四语齐全。
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
