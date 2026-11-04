/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * VitePress configuration for docs.comicine.com.
 *
 * Source pages are grouped by language: site/docs/docs/<lang>/ for zh-cn,
 * en-us, ja-jp, and ko-kr, each holding the same relative file tree. Rewrites
 * place the language code at the end of every content URL. Every content page
 * has all four localized source files.
 *
 * Language-less content entries are resolved by Pages Functions using the main
 * site's preference order: cookie, Accept-Language, Cloudflare country
 * metadata, then the config-contract fallback (currently en-us). The docs root
 * /, /docs-home/, and the former localized home routes return 404. Private
 * articles live under /private/ and are protected by Cloudflare Access.
 *
 * VitePress locales only support language prefixes, so additionalConfig and
 * rewrites apply each page's lang and themeConfig based on its source directory.
 * Keep additionalConfig as pure data because it is serialized for the client.
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
const MAIN_SITE_CONTRACT = JSON.parse(
  readFileSync(new URL('../config-contract.json', import.meta.url), 'utf-8')
) as { default_lang: string }

interface LangDef {
  code: string
  label: string
  flag: string
  lang: string
  root?: boolean
}

const LANGS: LangDef[] = [
  { code: 'zh-cn', label: '简体中文', flag: '🇨🇳', lang: 'zh-CN', root: true },
  { code: 'en-us', label: 'English', flag: '🇺🇸', lang: 'en-US' },
  { code: 'ja-jp', label: '日本語', flag: '🇯🇵', lang: 'ja-JP' },
  { code: 'ko-kr', label: '한국어', flag: '🇰🇷', lang: 'ko-KR' }
]

const CODES = LANGS.map((l) => l.code)
const VITEPRESS_ROOT_LANG = LANGS.find((l) => l.root)?.code ?? CODES[0]
const SECURITY_X_DEFAULT_LANG = MAIN_SITE_CONTRACT.default_lang

/** Map a docs language code to its BCP 47 tag for HTML and metadata. */
function langTag(code: string): string {
  return (LANGS.find((l) => l.code === code) ?? LANGS[0]).lang
}

/**
 * Every content route has an explicit language suffix, including the VitePress
 * root language zh-cn. Pages Functions resolve language-less entries with the
 * main site's cookie and language fallback order.
 */
function contentPath(basePath: string, code: string): string {
  return `${basePath}/${code}`
}

/** UI copy for each language; VitePress does not translate the default theme automatically. */
interface Labels {
  title: string
  description: string
  navHome: string
  navServices: string
  navContact: string
  docsSection: string
  sidebarReadme: string
  sidebarVideo: string
  sidebarLicense: string
  sidebarSecurity: string
  sidebarSecurityPolicy: string
  sidebarSecurityAcknowledgments: string
  sidebarArticles: string
  sidebarArticleAmc10FormulaGuide: string
  notFoundTitle: string
  notFoundQuote: string
  notFoundLinkLabel: string
  notFoundLinkText: string
  outlineTitle: string
  sidebarMenuLabel: string
  darkModeSwitchLabel: string
  langMenuLabel: string
  navMenuLabel: string
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
    sidebarReadme: '项目说明 README',
    sidebarVideo: '视频平台',
    sidebarLicense: '开源许可证',
    sidebarSecurity: '安全',
    sidebarSecurityPolicy: '安全漏洞披露政策',
    sidebarSecurityAcknowledgments: '安全致谢',
    sidebarArticles: '文章',
    sidebarArticleAmc10FormulaGuide: 'AMC 10 完整公式讲义',
    notFoundTitle: '页面未找到',
    notFoundQuote: '如果不改变方向并继续寻找，你最终可能会到达自己正前往的地方。',
    notFoundLinkLabel: '返回 ComiCine 主站',
    notFoundLinkText: '带我回首页',
    outlineTitle: '本页目录',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '外观',
    langMenuLabel: '切换语言',
    navMenuLabel: '菜单',
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
    sidebarReadme: 'Project README',
    sidebarVideo: 'Video platforms',
    sidebarLicense: 'License',
    sidebarSecurity: 'Security',
    sidebarSecurityPolicy: 'Security Vulnerability Disclosure Policy',
    sidebarSecurityAcknowledgments: 'Security Acknowledgments',
    sidebarArticles: 'Articles',
    sidebarArticleAmc10FormulaGuide: 'AMC 10 Complete Formula Guide',
    notFoundTitle: 'PAGE NOT FOUND',
    notFoundQuote: "But if you don't change your direction, and if you keep looking, you may end up where you are heading.",
    notFoundLinkLabel: 'Go to the ComiCine main site',
    notFoundLinkText: 'Take me home',
    outlineTitle: 'On this page',
    sidebarMenuLabel: 'Menu',
    darkModeSwitchLabel: 'Appearance',
    langMenuLabel: 'Change language',
    navMenuLabel: 'Menu',
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
    sidebarReadme: 'プロジェクト README',
    sidebarVideo: '動画プラットフォーム',
    sidebarLicense: 'ライセンス',
    sidebarSecurity: 'セキュリティ',
    sidebarSecurityPolicy: 'セキュリティ脆弱性の報告ポリシー',
    sidebarSecurityAcknowledgments: 'セキュリティ謝辞',
    sidebarArticles: '記事',
    sidebarArticleAmc10FormulaGuide: 'AMC 10 公式総合ガイド',
    notFoundTitle: 'ページが見つかりません',
    notFoundQuote: '進む方向を変えずに探し続けると、向かっている場所にたどり着くかもしれません。',
    notFoundLinkLabel: 'ComiCine メインサイトへ戻る',
    notFoundLinkText: 'ホームに戻る',
    outlineTitle: 'このページの目次',
    sidebarMenuLabel: 'メニュー',
    darkModeSwitchLabel: '外観',
    langMenuLabel: '言語を変更',
    navMenuLabel: 'メニュー',
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
    sidebarReadme: '프로젝트 README',
    sidebarVideo: '동영상 플랫폼',
    sidebarLicense: '라이선스',
    sidebarSecurity: '보안',
    sidebarSecurityPolicy: '보안 취약점 공개 정책',
    sidebarSecurityAcknowledgments: '보안 감사의 글',
    sidebarArticles: '아티클',
    sidebarArticleAmc10FormulaGuide: 'AMC 10 공식 총정리',
    notFoundTitle: '페이지를 찾을 수 없습니다',
    notFoundQuote: '방향을 바꾸지 않고 계속 찾아가면, 결국 자신이 향하던 곳에 도착할지도 모릅니다.',
    notFoundLinkLabel: 'ComiCine 메인 사이트로 이동',
    notFoundLinkText: '홈으로 돌아가기',
    outlineTitle: '이 페이지 목차',
    sidebarMenuLabel: '메뉴',
    darkModeSwitchLabel: '테마',
    langMenuLabel: '언어 변경',
    navMenuLabel: '메뉴',
    footerRights: '모든 권리 보유',
    footerSource: '소스'
  }
}

function themeFor(code: string): DefaultTheme.Config {
  const L = labels[code] ?? labels[VITEPRESS_ROOT_LANG]
  const readme = contentPath('/README', code)
  const video = contentPath('/video-platform', code)
  const license = contentPath('/LICENSE', code)
  const securityPolicy = contentPath('/security/policy', code)
  const securityAcknowledgments = contentPath('/security/acknowledgments', code)
  const articleAmc10FormulaGuide = contentPath('/articles/amc-10-formula-guide', code)
  return {
    // The VitePress fork's ComiCine components render the header and footer, matching the main site's base.html.
    // The header shows the same three main-site links; documentation navigation stays in the sidebar.
    nav: [
      { text: L.navHome, link: MAIN_SITE },
      { text: L.navServices, link: SERVICES_SITE },
      { text: L.navContact, link: CONTACT_SITE }
    ],
    sidebar: [
      {
        text: L.docsSection,
        items: [
          { text: L.sidebarReadme, link: readme },
          { text: L.sidebarVideo, link: video },
          { text: L.sidebarLicense, link: license }
        ]
      },
      {
        text: L.sidebarSecurity,
        items: [
          { text: L.sidebarSecurityPolicy, link: securityPolicy },
          { text: L.sidebarSecurityAcknowledgments, link: securityAcknowledgments }
        ]
      },
      {
        text: L.sidebarArticles,
        items: [
          { text: L.sidebarArticleAmc10FormulaGuide, link: articleAmc10FormulaGuide }
        ]
      }
    ],
    outline: { level: [2, 3], label: L.outlineTitle },
    sidebarMenuLabel: L.sidebarMenuLabel,
    darkModeSwitchLabel: L.darkModeSwitchLabel,
    langMenuLabel: L.langMenuLabel,
    navMenuLabel: L.navMenuLabel,
    docFooter: { prev: false, next: false },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ComiCine/ComiCine-website' },
      { icon: 'bilibili', link: 'https://space.bilibili.com/1234163143', ariaLabel: 'Bilibili' }
    ],
    footer: {
      copyright: '© 2026 <span class="brand-word">ComiCine</span>',
      items: [
        { text: L.footerRights },
        { text: 'AGPL-3.0' },
        { text: L.footerSource, link: REPO }
      ]
    },
    comicine: { languages: LANGS, langSegmentAlways: true },
    notFound: {
      title: L.notFoundTitle,
      quote: L.notFoundQuote,
      link: MAIN_SITE,
      linkLabel: L.notFoundLinkLabel,
      linkText: L.notFoundLinkText
    }
  } as DefaultTheme.Config
}

/** Per-language lang, title, and theme configuration as plain data that can be serialized for the client. */
function localeConfigFor(code: string) {
  const L = labels[code] ?? labels[VITEPRESS_ROOT_LANG]
  return {
    lang: langTag(code),
    title: L.title,
    description: L.description,
    themeConfig: themeFor(code)
  }
}

/**
 * Source files live in language directories; rewrites put the language code at the end
 * of each route (/video-platform/en-us).
 * Do not use a function for additionalConfig: it is serialized for the client and loses closures.
 * ops/docs_deploy.sh also reads this mapping to validate build output, keeping one source of truth.
 */
const REWRITES: Record<string, string> = JSON.parse(
  readFileSync(new URL('./rewrites.json', import.meta.url), 'utf-8')
)

const SOCIAL_IMAGE_SVG = 'https://images.comicine.com/static/icons/comicine-xtext.svg?v=4'
const SOCIAL_IMAGE_PNG = 'https://images.comicine.com/static/icons/comicine-xtext.png?v=5'

function canonicalUrlForPage(page: string): string | null {
  const sourcePage = page.startsWith('/') ? page.slice(1) : page
  if (sourcePage === '404.md') return null
  const outputPage = REWRITES[sourcePage] ?? sourcePage
  const route = outputPage.endsWith('/index.md')
    ? outputPage.slice(0, -'/index.md'.length)
    : outputPage.endsWith('.md')
      ? outputPage.slice(0, -'.md'.length)
      : outputPage
  return new URL(route ? '/' + route : '/', SITE_URL).toString()
}

function languageAlternatesForPage(page: string): [string, Record<string, string>][] {
  const sourcePage = page.startsWith('/') ? page.slice(1) : page
  const outputPage = REWRITES[sourcePage] ?? sourcePage
  const match = outputPage.match(/^security\/(policy|acknowledgments)\/(zh-cn|en-us|ja-jp|ko-kr)\.md$/)
  if (!match) return []

  const route = `/security/${match[1]}`
  const alternates = LANGS.map(({ code, lang }) => [
    'link',
    { rel: 'alternate', hreflang: lang, href: new URL(`${route}/${code}`, SITE_URL).toString() }
  ] as [string, Record<string, string>])
  alternates.push([
    'link',
    {
      rel: 'alternate',
      hreflang: 'x-default',
      href: new URL(`${route}/${SECURITY_X_DEFAULT_LANG}`, SITE_URL).toString()
    }
  ])
  return alternates
}

/**
 * The pricing CSV now lives in site/docs/services/, alongside the VitePress root (site/docs/docs/),
 * so it is already outside the build workspace and services/ needs no special exclusion.
 * Keep a CSV fallback in case a data file is later added to the content root; do not publish it as-is.
 */
const SRC_EXCLUDE = ['**/*.csv']

export default defineConfig({
  lang: langTag(VITEPRESS_ROOT_LANG),
  title: labels[VITEPRESS_ROOT_LANG].title,
  description: labels[VITEPRESS_ROOT_LANG].description,
  cleanUrls: true,
  metaChunk: true,
  srcExclude: SRC_EXCLUDE,
  markdown: { math: true },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/comicine-favicon.svg?v=13' }],
    ['link', { rel: 'apple-touch-icon', href: '/comicine-favicon.png?v=13' }],
    ['meta', { name: 'theme-color', content: '#05A5A6' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
    ['meta', { property: 'og:site_name', content: 'ComiCine Docs' }],
    [
      'link',
      {
        rel: 'preload',
        href: '/fonts/delius-swash-caps/delius-swash-caps-copyright.woff2?v=1',
        as: 'font',
        type: 'font/woff2',
        crossorigin: ''
      }
    ],
    ['link', { rel: 'stylesheet', href: '/fonts.css' }],
    // Run before VitePress check-dark-mode: copy the main site's comicine_theme cookie into
    // localStorage to prevent a first-paint flash when the themes differ.
    ['script', { id: 'comicine-theme-bridge' }, THEME_BOOTSTRAP_SCRIPT]
  ],
  sitemap: {
    hostname: SITE_URL,
    transformItems: (items) =>
      items.filter((item) => !new URL(item.url, SITE_URL).pathname.startsWith('/private/'))
  },
  transformHead({ page, title, description }) {
    const canonicalUrl = canonicalUrlForPage(page)
    if (!canonicalUrl) return []
    const pathname = new URL(canonicalUrl).pathname
    const pageType = 'article'
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ...(pathname.startsWith('/private/')
        ? [['meta', { name: 'robots', content: 'noindex, nofollow' }] as [string, Record<string, string>]]
        : []),
      ...languageAlternatesForPage(page),
      ['meta', { property: 'og:type', content: pageType }],
      ['meta', { property: 'og:title', itemprop: 'name', content: title }],
      ['meta', { property: 'og:description', itemprop: 'description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', itemprop: 'image', content: SOCIAL_IMAGE_SVG }],
      ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
      ['meta', { property: 'og:image:width', content: '5250' }],
      ['meta', { property: 'og:image:height', content: '1500' }],
      ['meta', { property: 'og:image:alt', content: 'ComiCine logo' }],
      ['meta', { property: 'og:image', content: SOCIAL_IMAGE_PNG }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '5250' }],
      ['meta', { property: 'og:image:height', content: '1500' }],
      ['meta', { property: 'og:image:alt', content: 'ComiCine logo' }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: SOCIAL_IMAGE_PNG }]
    ]
  },
  rewrites: REWRITES,
  themeConfig: themeFor(VITEPRESS_ROOT_LANG),
  // Apply the matching lang and themeConfig by source directory using serializable plain data.
  additionalConfig: {
    '/zh-cn/': localeConfigFor('zh-cn'),
    '/en-us/': localeConfigFor('en-us'),
    '/ja-jp/': localeConfigFor('ja-jp'),
    '/ko-kr/': localeConfigFor('ko-kr')
  }
})
