/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/* build.py injects shared contract values into <body data-*> through _lang_attrs.html.
   The frontend only reads them: add a language or change cookie names/TTLs in config-contract.json. */
var BODY = document.body;
function bodyAttr(name, fallback) {
    var value = BODY && BODY.getAttribute(name);
    return value === null || value === undefined || value === '' ? (fallback || '') : value;
}
var DEFAULT_LANG = bodyAttr('data-default-lang', 'en-us');
var SUPPORTED_LANGS = bodyAttr('data-supported-langs').split(/\s+/).filter(function (code) { return code; });
var ROOT_DOMAIN = bodyAttr('data-root-domain', 'comicine.com');
var LANG_COOKIE = bodyAttr('data-lang-cookie', 'user_lang_preference');
var LANG_COOKIE_MAX_AGE = bodyAttr('data-lang-cookie-max-age', '31536000');
var THEME_COOKIE = bodyAttr('data-theme-cookie', 'comicine_theme');
var THEME_COOKIE_MAX_AGE = bodyAttr('data-theme-cookie-max-age', '31536000');

/* Theme, translation, brand, and menu behaviour live in shared-ui.js, which base.html loads first.
   Keep this guard visible: a missing shared file breaks every interaction on the page. */
var UI = window.ComiCineUI;
if (!UI) console.error('[base.js] shared-ui.js must load before base.js');

function rootDomainForHost(host) {
    host = String(host || '').toLowerCase();
    return host === ROOT_DOMAIN || host.endsWith('.' + ROOT_DOMAIN) ? ROOT_DOMAIN : null;
}
function isProductionDomain(host) {
    return rootDomainForHost(host) !== null;
}
document.documentElement.lang = bodyAttr('data-lang', DEFAULT_LANG);

/* Warm QR image URLs after the page load so they are ready when their controls open. */
function preloadPageImages() {
    var urls = new Set();
    document.querySelectorAll('[data-qr]').forEach(function(el) { urls.add(el.dataset.qr); });
    urls.forEach(function(url) {
        var img = new Image();
        img.referrerPolicy = 'origin';
        img.fetchPriority = 'low';
        img.onerror = function() {}; // Ignore 404s without logging a console error.
        img.src = url;
    });
}

/* Theme reading, applying, and persistence are shared with the gate page. Reduced motion is
   handled inside applyTheme: the system preference disables the transition, not the switch. */
function getSystemTheme() { return UI.systemTheme(window); }
function applyTheme(theme, animate) { UI.applyTheme(document, theme, animate); }
function themeCookieValue() { return UI.cookieValue(document.cookie, THEME_COOKIE); }
function storedTheme() { return UI.readStorageTheme(); }
function effectiveTheme() { return UI.effectiveTheme(document, THEME_COOKIE); }
function saveTheme(theme) {
    UI.saveTheme(document, theme, {
        cookieName: THEME_COOKIE,
        maxAge: THEME_COOKIE_MAX_AGE,
        rootDomain: ROOT_DOMAIN
    });
}

/* Detect rapid toggles: more than three in one second sends the user to the gate page.
   The gate page itself does not count toward this limit. */
var THEME_TOGGLE_WINDOW_MS = 1000;
var THEME_TOGGLE_MAX_COUNT = 3;
var themeToggleTimes = [];
var themeChallengeStarted = false;

function themeChallengeUrl() {
    /* Complete the challenge on the request's host instead of auth.<root_domain>. */
    var base = 'https://' + location.hostname + '/gate';
    var url = new URL(base, location.origin);
    url.searchParams.set('host', location.hostname);
    url.searchParams.set('next', location.pathname + location.search + location.hash);
    url.searchParams.set('challenge', '1');
    return url.toString();
}

function rememberThemeToggle(now) {
    var cutoff = now - THEME_TOGGLE_WINDOW_MS;
    themeToggleTimes.push(now);
    while (themeToggleTimes.length && themeToggleTimes[0] <= cutoff) {
        themeToggleTimes.shift();
    }
}

function triggerThemeChallenge() {
    var challengeUrl = themeChallengeUrl();
    if (location.hostname === new URL(challengeUrl, location.origin).hostname) return;
    if (themeChallengeStarted) return;
    themeChallengeStarted = true;
    location.replace(challengeUrl);
}

/* Toggle between light and dark, save the choice, and stop following the system preference. */
function toggleTheme() {
    var now = Date.now();
    var next = effectiveTheme() === 'light' ? 'dark' : 'light';
    saveTheme(next);
    applyTheme(next, true);
    rememberThemeToggle(now);
    if (themeToggleTimes.length > THEME_TOGGLE_MAX_COUNT) {
        triggerThemeChallenge();
    }
}

/*
   Frontend translation utilities:
   - I18N: full dictionary for the current language, injected by the backend for the initial render.
   - I18N_CACHE: dictionaries for the current language and any languages fetched after menu intent.
   - t(): look up text by key and replace {param} placeholders.
   - applyLang(): switch language in the browser by updating data-i18n elements without reloading.
   */
var I18N = JSON.parse(document.body.getAttribute('data-i18n-dict') || '{}');
var CURRENT_LANG = bodyAttr('data-lang', DEFAULT_LANG);
var I18N_CACHE = window.I18N_CACHE || {};
var I18N_PREFETCH_STARTED = false;
I18N_CACHE[CURRENT_LANG] = I18N;

function t(key, params) {
    var s = (I18N[key] !== undefined) ? I18N[key] : key;
    return UI.formatText(s, params);
}
window.comicineTranslate = t;

/* Fetch a language dictionary, or call back immediately if it is cached. */
function fetchI18n(lang, cb) {
    if (I18N_CACHE[lang] !== undefined) { cb(I18N_CACHE[lang]); return; }
    if (window.__PREVIEW_I18N__) {
        I18N_CACHE[lang] = window.__PREVIEW_I18N__[lang] || null;
        cb(I18N_CACHE[lang]);
        return;
    }
    fetch('/api/i18n/' + encodeURIComponent(lang), { headers: { 'Accept': 'application/json' } })
        .then(function(r) { if (!r.ok) throw new Error('i18n ' + lang); return r.json(); })
        .then(function(d) { I18N_CACHE[lang] = d; cb(d); })
        .catch(function() { I18N_CACHE[lang] = null; cb(null); });
}

/* Write the language cookie using its name, TTL, and domain from injected data attributes. */
function saveLangCookie(code) {
    UI.writeCookie(document, LANG_COOKIE, code, {
        maxAge: LANG_COOKIE_MAX_AGE,
        rootDomain: ROOT_DOMAIN,
        hostname: location.hostname
    });
}

/*
   Language switching: swap the dictionary, re-render marked text, update the title/description
   and the selected language, keep the scroll position and form state, then save the cookie.
   The renderer only edits text and attributes, so inputs, focus, and open panels survive.
   */
var PAGE_META = UI.pageMetaFor(location.hostname, location.pathname, ROOT_DOMAIN);
/* The not-found page answers on the requested URL, so its path says nothing; use the markup.
   Without this, switching language on a 404 would retitle the tab as the nearest known page. */
if (document.querySelector('.not-found-main')) {
    PAGE_META = { titleKey: 'not_found_title', descriptionKey: null };
}
var language = UI.createLanguage({
    doc: document,
    lang: CURRENT_LANG,
    render: { missing: 'raw', brandify: false },
    meta: PAGE_META,
    dispatch: true,
    getDict: function (code) {
        return I18N_CACHE[code] === null || I18N_CACHE[code] === undefined ? null : I18N_CACHE[code];
    },
    fetchDict: fetchI18n,
    useDict: function (code, dict) {
        CURRENT_LANG = code;
        I18N = dict;
    },
    translate: UI.translator,
    saveCookie: saveLangCookie,
    reload: function () { location.reload(); }
});

/* Public compatibility alias: the templates' data-action calls setLang, which applies the language. */
function applyLang(langCode) {
    language.apply(langCode);
}

/* Preload the other language dictionaries after the page load. */
function prefetchI18n() {
    if (I18N_PREFETCH_STARTED) return;
    I18N_PREFETCH_STARTED = true;
    SUPPORTED_LANGS.forEach(function (code) {
        if (code === language.current() || I18N_CACHE[code] != null) return;
        fetchI18n(code, function () {});
    });
}

/*
   After the current page loads, prefetch the other two home pages (HTML and images).
   - Use <link rel=prefetch> for HTML; its cache retains the language cookie and degrades gracefully.
   - Use low-priority Image requests to warm the HTTP cache on all devices.
     Home images and contact-page QR codes use images.comicine.com's static edge cache.
   - Keep this image list aligned with the src values in index.html and contact.html.
   */
/* The template builds the home portfolio image list from src/static/portfolio and writes it to
   body[data-portfolio-thumbs]. Use the fallback list if that attribute is missing. */
var HOME_IMAGES = (document.body && document.body.getAttribute('data-portfolio-thumbs') || '')
    .split(/\s+/).filter(function (rel) { return rel; });
if (!HOME_IMAGES.length) {
    HOME_IMAGES = [
        '/static/portfolio/thumbs/IMG_0203-640.avif',
        '/static/portfolio/thumbs/IMG_0146-640.avif',
        '/static/portfolio/thumbs/IMG_0130-640.avif',
        '/static/portfolio/thumbs/IMG_0244-640.avif',
        '/static/portfolio/thumbs/IMG_0115-640.avif',
        '/static/portfolio/thumbs/IMG_0179-640.avif' ];
}
var PAGE_MANIFEST = {
    '/':        { host: 'comicine.com',          path: '/',        images: HOME_IMAGES },
    '/services':{ host: 'services.comicine.com', path: '/services', images: [] },
    '/contact': { host: 'contact.comicine.com',  path: '/contact',  images: [
                    '/static/qr-codes/bilibili.png',
                    '/static/qr-codes/qq.png',
                    '/static/qr-codes/wechat.png' ] }
};

/* Identify the current home page by subdomain in production and by path in local development. */
function currentPageKey() {
    var h = location.hostname;
    if (h === ROOT_DOMAIN || h === 'www.' + ROOT_DOMAIN) return '/';
    if (h === 'services.' + ROOT_DOMAIN) return '/services';
    if (h === 'contact.' + ROOT_DOMAIN) return '/contact';
    if (rootDomainForHost(h)) return null;   /* Do not prefetch admin or Apple Account pages. */
    return location.pathname;                    /* Local paths: '/', '/services', or '/contact'. */
}

/* Page images load from images.comicine.com/static via the static edge cache. */
function pageOrigin() {
    var base = document.body && document.body.getAttribute('data-image-asset-base');
    return isProductionDomain(location.hostname)
        ? (base || 'https://images.comicine.com')
        : location.origin;
}

/* Sibling page URLs use a subdomain root in production and same-origin paths locally. */
function siblingHref(key) {
    var p = PAGE_MANIFEST[key];
    return isProductionDomain(location.hostname) ? 'https://' + p.host : location.origin + p.path;
}

function prefetchPages() {
    var cur = currentPageKey();
    if (!PAGE_MANIFEST[cur]) return;
    Object.keys(PAGE_MANIFEST).forEach(function(key) {
        var origin = pageOrigin();
        if (key === cur) {
            /* Warm current-page images while idle so they are ready when needed. */
            PAGE_MANIFEST[key].images.forEach(function(rel) {
                var img = new Image();
                img.referrerPolicy = 'origin';
                img.fetchPriority = 'low';
                img.onerror = function() {};
                img.src = rel.indexOf('http') === 0 ? rel : origin + rel;
            });
            return;
        }
        var l = document.createElement('link');
        l.rel = 'prefetch'; l.href = siblingHref(key);
        document.head.appendChild(l);
        PAGE_MANIFEST[key].images.forEach(function(rel) {
            var img = new Image();
            img.referrerPolicy = 'origin';
            img.fetchPriority = 'low';
            img.onerror = function() {};             /* Ignore 404s without logging a console error. */
            img.src = rel.indexOf('http') === 0 ? rel : origin + rel;
        });
    });
}

/* Menus: the desktop language flyout, the mobile navigation panel, and its language list.
   Shared with the gate page; focus handling and ARIA state stay in one place. */
var navMenus = UI.createNavigation({ doc: document });

function toggleLangMenu(e) { navMenus.toggleLangMenu(e); }
function closeLangMenu() { navMenus.closeLangMenu(); }
function toggleNavLanguages(e) { navMenus.toggleNavLanguages(e); }
function closeNavLanguages() { navMenus.closeNavLanguages(); }
function toggleMobileMenu(e) { navMenus.toggleMobileMenu(e); }
function closeNavMenu() { navMenus.closeNavMenu(); }

/* Deferred scripts run after parsing, so the navigation nodes exist: bind before the load event.
   Waiting for load delayed hover, Escape, and the initial ARIA state until every image finished. */
navMenus.bind();

function setLang(code) {
    closeLangMenu();
    closeNavLanguages();
    closeNavMenu();
    /* Normally switch without a reload: fetch the target dictionary and update data-i18n nodes.
       applyLang reloads only as a fallback when the dictionary endpoint fails. */
    language.apply(code);
}

function openNewWindow(url) {
    window.open(url, "_blank", "noopener");
}

/* Initialize after the DOM has loaded. */
window.addEventListener('load', function() {
    /* Restore the saved theme, or follow the system when there is no saved choice. */
    applyTheme(effectiveTheme());

    /* Follow system theme changes only when there is no saved choice. */
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
        if (!storedTheme() && !themeCookieValue()) applyTheme(getSystemTheme(), true);
    });

    /* Start speculative downloads after load, when the browser has idle time. */
    var prefetchAfterLoad = function() {
        preloadPageImages();
        prefetchI18n();
        prefetchPages();
    };
    if ('requestIdleCallback' in window) {
        requestIdleCallback(prefetchAfterLoad, { timeout: 3000 });
    } else {
        setTimeout(prefetchAfterLoad, 1500);
    }
});
