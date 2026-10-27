/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * docs.comicine.com — VitePress 站点配置
 *
 * 内容源：site/docs/docs/*.md（本目录，即 VitePress 根）
 *   index.md                     -> /docs-home/zh-cn
 *   video-platform.md            → /video-platform/zh-cn
 *   en-us/video-platform.md      → /video-platform/en-us
 *   README.md                    → /README/zh-cn（site/README.md 的四语副本）
 *   LICENSE.md                   → /LICENSE/zh-cn（site/LICENSE_zh_CN.md 的四语副本）
 *   en-us/index.md               → /en-us
 *
 * **内容页的 URL 一律带显式语言段，默认语言 zh-cn 也不例外**；不带语言段的
 * `/video-platform`、`/README`、`/LICENSE` 由 docs/public/_redirects 302 到
 * 对应的 `/.../zh-cn`（2026-10-08 定）。docs 主域根路径 `/` 由 public/_redirects
 * 302 到主站；the Chinese documentation home uses `/docs-home/zh-cn`, while
 * the other language homes remain `/en-us`、`/ja-jp`、`/ko-kr`。
 *
 * site/docs/ 是**按子域分目录**的容器：docs/ 归 docs.comicine.com（本目录），
 * services/ 归 services.comicine.com（价目表 CSV，由 src/services_pricing.py 读取）。
 *
 * 语言码放在**页面路径最后一段**（不是 VitePress 的 locales 前缀），所以不用
 * `locales`，改用 `additionalConfig`（按**源目录**分层）+ `rewrites`：
 * 每个页面拿到自己那份 lang / themeConfig（导航、侧栏、UI 文案都跟着语言走）。
 *
 * 主题：fork ComiCine/vitepress —— 页头/页脚在 fork 里改。
 */
import { readFileSync } from 'node:fs'

import { defineConfig } from 'vitepress'
import type { DefaultTheme } from 'vitepress'

import { THEME_BOOTSTRAP_SCRIPT } from './theme/comicine.ts'

const SITE_URL = 'https://docs.comicine.com'
const MAIN_SITE = 'https://comicine.com'
const SERVICES_SITE = 'https://services.comicine.com'
const CONTACT_SITE = 'https://contact.comicine.com'
const REPO = 'https://github.com/ComiCine/ComiCine-website'

interface LangDef {
  code: string
  label: string
  flag: string
  lang: string
  default?: boolean
}

const LANGS: LangDef[] = [
  { code: 'zh-cn', label: '简体中文', flag: '🇨🇳', lang: 'zh-CN', default: true },
  { code: 'en-us', label: 'English', flag: '🇺🇸', lang: 'en-US' },
  { code: 'ja-jp', label: '日本語', flag: '🇯🇵', lang: 'ja-JP' },
  { code: 'ko-kr', label: '한국어', flag: '🇰🇷', lang: 'ko-KR' }
]

const CODES = LANGS.map((l) => l.code)
const DEFAULT_LANG = LANGS.find((l) => l.default)?.code ?? CODES[0]

/** 语言码 -> BCP 47 标签（写进 <html lang> 与 head）。 */
function langTag(code: string): string {
  return (LANGS.find((l) => l.code === code) ?? LANGS[0]).lang
}

/** 页面路径 + 语言码 → 该语言的 URL 路径。 */
function routePath(basePath: string, code: string): string {
  const base = basePath === '/' ? '' : basePath
  if (code === DEFAULT_LANG) return base || '/'
  return `${base}/${code}`
}

/**
 * 内容页路径：语言码**一律显式带上**（默认语言 zh-cn 也是），
 * 无后缀的 `/README`、`/LICENSE`、`/video-platform` 由 _redirects 302 过来。
 * The Chinese documentation home uses `/docs-home/zh-cn` to avoid the root redirect.
 */
function contentPath(basePath: string, code: string): string {
  return `${basePath}/${code}`
}

/** 每个语言一份 UI 文案；VitePress 不会自动翻译默认主题。 */
interface Labels {
  title: string
  description: string
  navHome: string
  navServices: string
  navContact: string
  docsSection: string
  sidebarHome: string
  sidebarReadme: string
  sidebarVideo: string
  sidebarLicense: string
  sidebarMain: string
  outlineTitle: string
  sidebarMenuLabel: string
  darkModeSwitchLabel: string
  langMenuLabel: string
  navMenuLabel: string
  prev: string
  next: string
  footerRights: string
  footerSource: string
}

const labels: Record<string, Labels> = {
  'zh-cn': {
    title: '文档',
    description: 'ComiCine 的公开文档：平台清单、隐私与合规参考。',
    navHome: '主页',
    navServices: '服务',
    navContact: '联系方式',
    docsSection: '文档',
    sidebarHome: '文档首页',
    sidebarReadme: '项目说明 README',
    sidebarVideo: '视频平台',
    sidebarLicense: '开源许可证',
    sidebarMain: '返回主站',
    outlineTitle: '本页目录',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    langMenuLabel: '切换语言',
    navMenuLabel: '菜单',
    prev: '上一页',
    next: '下一页',
    footerRights: '保留所有权利',
    footerSource: '源码'
  },
  'en-us': {
    title: 'Docs',
    description: 'Public ComiCine documentation: platform inventories, privacy and compliance references.',
    navHome: 'Home',
    navServices: 'Services',
    navContact: 'Contact',
    docsSection: 'Documentation',
    sidebarHome: 'Docs home',
    sidebarReadme: 'Project README',
    sidebarVideo: 'Video platforms',
    sidebarLicense: 'License',
    sidebarMain: 'Main site',
    outlineTitle: 'On this page',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Appearance',
    langMenuLabel: 'Change language',
    navMenuLabel: 'Menu',
    prev: 'Previous page',
    next: 'Next page',
    footerRights: 'All rights reserved',
    footerSource: 'Source'
  },
  'ja-jp': {
    title: 'ドキュメント',
    description: 'ComiCine の公開ドキュメント：プラットフォーム一覧、プライバシーとコンプライアンスの参考資料。',
    navHome: 'ホーム',
    navServices: 'サービス',
    navContact: 'お問い合わせ',
    docsSection: 'ドキュメント',
    sidebarHome: 'ドキュメント ホーム',
    sidebarReadme: 'プロジェクト README',
    sidebarVideo: '動画プラットフォーム',
    sidebarLicense: 'ライセンス',
    sidebarMain: 'メインサイト',
    outlineTitle: 'このページの目次',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: '外観',
    langMenuLabel: '言語を変更',
    navMenuLabel: 'メニュー',
    prev: '前のページ',
    next: '次のページ',
    footerRights: 'All rights reserved',
    footerSource: 'ソース'
  },
  'ko-kr': {
    title: '문서',
    description: 'ComiCine 공개 문서: 플랫폼 목록, 개인정보 및 컴플라이언스 참고 자료.',
    navHome: '홈',
    navServices: '서비스',
    navContact: '문의',
    docsSection: '문서',
    sidebarHome: '문서 홈',
    sidebarReadme: '프로젝트 README',
    sidebarVideo: '동영상 플랫폼',
    sidebarLicense: '라이선스',
    sidebarMain: '메인 사이트',
    outlineTitle: '이 페이지 목차',
    sidebarMenuLabel: '메뉴',
    darkModeSwitchLabel: '테마',
    langMenuLabel: '언어 변경',
    navMenuLabel: '메뉴',
    prev: '이전 페이지',
    next: '다음 페이지',
    footerRights: '모든 권리 보유',
    footerSource: '소스'
  }
}

function themeFor(code: string): DefaultTheme.Config {
  const L = labels[code] ?? labels[DEFAULT_LANG]
  const home = code === DEFAULT_LANG
    ? contentPath('/docs-home', code)
    : routePath('/', code)
  const readme = contentPath('/README', code)
  const video = contentPath('/video-platform', code)
  const license = contentPath('/LICENSE', code)
  return {
    // 页头/页脚由 fork 的 ComiCine 组件渲染（与主站 base.html 一致）
    // 页头展示主站的三个相同入口，文档自己的导航在侧栏
    nav: [
      { text: L.navHome, link: MAIN_SITE },
      { text: L.navServices, link: SERVICES_SITE },
      { text: L.navContact, link: CONTACT_SITE }
    ],
    sidebar: [
      {
        text: L.docsSection,
        items: [
          { text: L.sidebarHome, link: home },
          { text: L.sidebarReadme, link: readme },
          { text: L.sidebarVideo, link: video },
          { text: L.sidebarLicense, link: license },
          { text: L.sidebarMain, link: MAIN_SITE }
        ]
      }
    ],
    outline: { level: [2, 3], label: L.outlineTitle },
    sidebarMenuLabel: L.sidebarMenuLabel,
    darkModeSwitchLabel: L.darkModeSwitchLabel,
    langMenuLabel: L.langMenuLabel,
    navMenuLabel: L.navMenuLabel,
    docFooter: { prev: L.prev, next: L.next },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ComiCine/ComiCine-website' },
      { icon: 'bilibili', link: 'https://space.bilibili.com/1234163143', ariaLabel: 'Bilibili' }
    ],
    footer: {
      copyright: '© 2026 <img class="footer-brand-logo" src="https://images.comicine.com/static/icons/comicine-xtext.svg?v=2" alt="ComiCine" width="48" height="12">',
      items: [
        { text: L.footerRights },
        { text: 'AGPL-3.0' },
        { text: L.footerSource, link: REPO }
      ]
    },
    // langSegmentAlways：内容页路径总是带语言段（含 zh-cn），
    // fork 的语言浮层据此把「中文」指向 /README/zh-cn 而不是 /README（后者会 404）
    comicine: { languages: LANGS, langSegmentAlways: true }
  } as DefaultTheme.Config
}

/** 每个语言的 lang / 标题 / 主题配置（纯数据，能安全序列化进客户端）。 */
function localeConfigFor(code: string) {
  const L = labels[code] ?? labels[DEFAULT_LANG]
  return {
    lang: langTag(code),
    title: L.title,
    description: L.description,
    themeConfig: themeFor(code)
  }
}

/**
 * 源文件放各自的语言目录（en-us/index.md），用 rewrites 把路由改成
 * 「语言码在最后一段」（/en-us、/video-platform/en-us）。
 * 不用 additionalConfig 的函数形式：函数会被序列化进客户端而丢掉闭包。
 * 映射表同时被 ops/docs_deploy.sh 的产物校验读取，保持单一事实源。
 */
const REWRITES: Record<string, string> = JSON.parse(
  readFileSync(new URL('./rewrites.json', import.meta.url), 'utf-8')
)

const SOCIAL_IMAGE_SVG = 'https://images.comicine.com/static/icons/comicine.svg?v=4'
const SOCIAL_IMAGE_PNG = 'https://images.comicine.com/static/icons/comicine.png?v=4'

function canonicalUrlForPage(page: string): string | null {
  const sourcePage = page.startsWith('/') ? page.slice(1) : page
  if (sourcePage === '404.md') return null
  const outputPage = REWRITES[sourcePage] ?? (sourcePage === 'index.md' ? '' : sourcePage)
  const route = outputPage.endsWith('/index.md')
    ? outputPage.slice(0, -'/index.md'.length)
    : outputPage.endsWith('.md')
      ? outputPage.slice(0, -'.md'.length)
      : outputPage
  return new URL(route ? '/' + route : '/', SITE_URL).toString()
}

/**
 * 价目表 CSV 现在在 site/docs/services/，与 VitePress 根（site/docs/docs/）
 * **同级**，本来就不会进入构建工作区，所以不再需要专门排除 services/。
 * 留一条 csv 兜底：万一以后有人往内容根里塞数据文件，也不会被原样发布出去。
 */
const SRC_EXCLUDE = ['**/*.csv']

export default defineConfig({
  lang: langTag(DEFAULT_LANG),
  title: labels[DEFAULT_LANG].title,
  description: labels[DEFAULT_LANG].description,
  cleanUrls: true,
  metaChunk: true,
  srcExclude: SRC_EXCLUDE,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/comicine-favicon.svg?v=2' }],
    ['link', { rel: 'apple-touch-icon', href: '/comicine-favicon.png?v=2' }],
    ['meta', { name: 'theme-color', content: '#05A5A6' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { property: 'og:site_name', content: 'ComiCine Docs' }],
    [
      'link',
      {
        rel: 'preload',
        href: '/fonts/baloo2-latin-wght-normal.woff2',
        as: 'font',
        type: 'font/woff2',
        crossorigin: ''
      }
    ],
    ['link', { rel: 'stylesheet', href: '/fonts.css' }],
    // 必须在 VitePress 的 check-dark-mode 之前执行：把主站 limooo_theme cookie
    // 灌进 localStorage，避免与主站深浅模式不一致造成的首屏闪烁。
    ['script', { id: 'comicine-theme-bridge' }, THEME_BOOTSTRAP_SCRIPT]
  ],
  sitemap: {
    hostname: SITE_URL,
    transformItems: (items) => items.filter((item) => new URL(item.url, SITE_URL).pathname !== '/')
  },
  transformHead({ page, title, description }) {
    const canonicalUrl = canonicalUrlForPage(page)
    if (!canonicalUrl) return []
    const pathname = new URL(canonicalUrl).pathname
    const isHome = pathname === '/' || pathname === '/docs-home/zh-cn' || pathname === '/en-us'
      || pathname === '/ja-jp' || pathname === '/ko-kr'
    const pageType = isHome ? 'website' : 'article'
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:type', content: pageType }],
      ['meta', { property: 'og:title', itemprop: 'name', content: title }],
      ['meta', { property: 'og:description', itemprop: 'description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', itemprop: 'image', content: SOCIAL_IMAGE_SVG }],
      ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
      ['meta', { property: 'og:image:width', content: '4000' }],
      ['meta', { property: 'og:image:height', content: '4000' }],
      ['meta', { property: 'og:image:alt', content: 'ComiCine logo' }],
      ['meta', { property: 'og:image', content: SOCIAL_IMAGE_PNG }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '4000' }],
      ['meta', { property: 'og:image:height', content: '4000' }],
      ['meta', { property: 'og:image:alt', content: 'ComiCine logo' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: SOCIAL_IMAGE_PNG }]
    ]
  },
  rewrites: REWRITES,
  themeConfig: themeFor(DEFAULT_LANG),
  // 按**源目录**给页面套上对应语言的 lang + themeConfig（纯数据，可序列化）
  additionalConfig: {
    '/': localeConfigFor('zh-cn'),
    '/en-us/': localeConfigFor('en-us'),
    '/ja-jp/': localeConfigFor('ja-jp'),
    '/ko-kr/': localeConfigFor('ko-kr')
  }
})
