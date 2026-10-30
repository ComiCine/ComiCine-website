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
 * Language-less entry URLs are resolved by Pages Functions using the main
 * site's preference order: cookie, Accept-Language, Cloudflare country
 * metadata, then the config-contract fallback (currently en-us). The docs root
 * redirects to the main site; localized home pages use /docs-home/zh-cn,
 * /en-us, /ja-jp, and /ko-kr.
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

/** Return the language route for a localized page. */
function routePath(basePath: string, code: string): string {
  const base = basePath === '/' ? '' : basePath
  if (code === VITEPRESS_ROOT_LANG) return base || '/'
  return `${base}/${code}`
}

/**
 * Every content route has an explicit language suffix, including the VitePress
 * root language zh-cn. Pages Functions resolve language-less entries with the
 * main site's cookie and language fallback order. The Chinese home uses
 * `/docs-home/zh-cn` to avoid the root redirect.
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
  sidebarSecurity: string
  sidebarSecurityPolicy: string
  sidebarSecurityAcknowledgments: string
  sidebarArticles: string
  sidebarArticleUkMajors: string
  notFoundTitle: string
  notFoundQuote: string
  notFoundLinkLabel: string
  notFoundLinkText: string
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
    sidebarSecurity: '安全',
    sidebarSecurityPolicy: '安全漏洞披露政策',
    sidebarSecurityAcknowledgments: '安全致谢',
    sidebarArticles: '文章',
    sidebarArticleUkMajors: '英国本科五个申请专业深度解析',
    notFoundTitle: '页面未找到',
    notFoundQuote: '如果不改变方向并继续寻找，你最终可能会到达自己正前往的地方。',
    notFoundLinkLabel: '返回 ComiCine 主站',
    notFoundLinkText: '带我回首页',
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
    sidebarSecurity: 'Security',
    sidebarSecurityPolicy: 'Security Vulnerability Disclosure Policy',
    sidebarSecurityAcknowledgments: 'Security Acknowledgments',
    sidebarArticles: 'Articles',
    sidebarArticleUkMajors: 'An In-Depth Look at Five UK Undergraduate Programmes',
    notFoundTitle: 'PAGE NOT FOUND',
    notFoundQuote: "But if you don't change your direction, and if you keep looking, you may end up where you are heading.",
    notFoundLinkLabel: 'Go to the ComiCine main site',
    notFoundLinkText: 'Take me home',
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
    sidebarSecurity: 'セキュリティ',
    sidebarSecurityPolicy: 'セキュリティ脆弱性の報告ポリシー',
    sidebarSecurityAcknowledgments: 'セキュリティ謝辞',
    sidebarArticles: '記事',
    sidebarArticleUkMajors: '英国学部課程・5つの出願専攻の徹底解説',
    notFoundTitle: 'ページが見つかりません',
    notFoundQuote: '進む方向を変えずに探し続けると、向かっている場所にたどり着くかもしれません。',
    notFoundLinkLabel: 'ComiCine メインサイトへ戻る',
    notFoundLinkText: 'ホームに戻る',
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
    sidebarSecurity: '보안',
    sidebarSecurityPolicy: '보안 취약점 공개 정책',
    sidebarSecurityAcknowledgments: '보안 감사의 글',
    sidebarArticles: '아티클',
    sidebarArticleUkMajors: '영국 학부 지원 전공 5개 심층 분석',
    notFoundTitle: '페이지를 찾을 수 없습니다',
    notFoundQuote: '방향을 바꾸지 않고 계속 찾아가면, 결국 자신이 향하던 곳에 도착할지도 모릅니다.',
    notFoundLinkLabel: 'ComiCine 메인 사이트로 이동',
    notFoundLinkText: '홈으로 돌아가기',
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
  const L = labels[code] ?? labels[VITEPRESS_ROOT_LANG]
  const home = code === VITEPRESS_ROOT_LANG
    ? contentPath('/docs-home', code)
    : routePath('/', code)
  const readme = contentPath('/README', code)
  const video = contentPath('/video-platform', code)
  const license = contentPath('/LICENSE', code)
  const securityPolicy = contentPath('/security/policy', code)
  const securityAcknowledgments = contentPath('/security/acknowledgments', code)
  const articleUkMajors = contentPath('/articles/uk-undergraduate-majors', code)
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
          { text: L.sidebarArticleUkMajors, link: articleUkMajors }
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

/** 每个语言的 lang / 标题 / 主题配置（纯数据，能安全序列化进客户端）。 */
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
 * 源文件放各自的语言目录（zh-cn/index.md、en-us/index.md），用 rewrites 把路由改成
 * 「语言码在最后一段」（/en-us、/video-platform/en-us）。
 * 不用 additionalConfig 的函数形式：函数会被序列化进客户端而丢掉闭包。
 * 映射表同时被 ops/docs_deploy.sh 的产物校验读取，保持单一事实源。
 */
const REWRITES: Record<string, string> = JSON.parse(
  readFileSync(new URL('./rewrites.json', import.meta.url), 'utf-8')
)

const SOCIAL_IMAGE_SVG = 'https://images.comicine.com/static/icons/comicine-xtext.svg?v=3'
const SOCIAL_IMAGE_PNG = 'https://images.comicine.com/static/icons/comicine-xtext.png?v=4'

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
 * 价目表 CSV 现在在 site/docs/services/，与 VitePress 根（site/docs/docs/）
 * **同级**，本来就不会进入构建工作区，所以不再需要专门排除 services/。
 * 留一条 csv 兜底：万一以后有人往内容根里塞数据文件，也不会被原样发布出去。
 */
const SRC_EXCLUDE = ['**/*.csv']

export default defineConfig({
  lang: langTag(VITEPRESS_ROOT_LANG),
  title: labels[VITEPRESS_ROOT_LANG].title,
  description: labels[VITEPRESS_ROOT_LANG].description,
  cleanUrls: true,
  metaChunk: true,
  srcExclude: SRC_EXCLUDE,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/comicine-favicon.svg?v=10' }],
    ['link', { rel: 'apple-touch-icon', href: '/comicine-favicon.png?v=10' }],
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
    // 必须在 VitePress 的 check-dark-mode 之前执行：把主站 comicine_theme cookie
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
      ...languageAlternatesForPage(page),
      ['meta', { property: 'og:type', content: pageType }],
      ['meta', { property: 'og:title', itemprop: 'name', content: title }],
      ['meta', { property: 'og:description', itemprop: 'description', content: description }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
      ['meta', { property: 'og:image', itemprop: 'image', content: SOCIAL_IMAGE_SVG }],
      ['meta', { property: 'og:image:type', content: 'image/svg+xml' }],
      ['meta', { property: 'og:image:width', content: '4500' }],
      ['meta', { property: 'og:image:height', content: '1500' }],
      ['meta', { property: 'og:image:alt', content: 'ComiCine logo' }],
      ['meta', { property: 'og:image', content: SOCIAL_IMAGE_PNG }],
      ['meta', { property: 'og:image:type', content: 'image/png' }],
      ['meta', { property: 'og:image:width', content: '4500' }],
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
  // 按**源目录**给页面套上对应语言的 lang + themeConfig（纯数据，可序列化）
  additionalConfig: {
    '/zh-cn/': localeConfigFor('zh-cn'),
    '/en-us/': localeConfigFor('en-us'),
    '/ja-jp/': localeConfigFor('ja-jp'),
    '/ko-kr/': localeConfigFor('ko-kr')
  }
})
