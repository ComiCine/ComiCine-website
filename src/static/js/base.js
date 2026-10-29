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
function rootDomainForHost(host) {
    host = String(host || '').toLowerCase();
    return host === ROOT_DOMAIN || host.endsWith('.' + ROOT_DOMAIN) ? ROOT_DOMAIN : null;
}
function isProductionDomain(host) {
    return rootDomainForHost(host) !== null;
}
function sharedCookieDomain() {
    var root = rootDomainForHost(location.hostname);
    return root ? '; domain=.' + root : '';
}
document.documentElement.lang = bodyAttr('data-lang', DEFAULT_LANG);

/*
       Preload only small resources such as QR codes. Portfolio images with loading="lazy"
       are excluded so preloading does not bypass lazy loading.
       */
    function preloadPageImages() {
        if (!window.matchMedia('(hover: hover)').matches) return; // Do not preload QR codes on mobile.
        var urls = new Set();
        document.querySelectorAll('[data-qr]').forEach(function(el) { urls.add(el.dataset.qr); });
        urls.forEach(function(url) {
            var img = new Image();
            img.referrerPolicy = 'origin';
            img.onerror = function() {}; // Ignore 404s without logging a console error.
            img.src = url;
        });
    }

    /*
       Theme switching follows VitePress appearance behavior:
       - Follow the system on first visit; after a click, save the selected theme in localStorage.
       - Keep that selection until localStorage is cleared.
       */

    /* Read the operating system preference. */
    function getSystemTheme() {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    /* Apply the theme to the DOM: toggle light-mode, update meta tags, and sync aria-checked. */
    var themeTransitionTimer = null;

    function applyTheme(theme, animate) {
        var root = document.documentElement;
        if (themeTransitionTimer !== null) {
            window.clearTimeout(themeTransitionTimer);
            themeTransitionTimer = null;
        }
        if (animate) {
            root.classList.add('theme-transitioning');
            themeTransitionTimer = window.setTimeout(function() {
                root.classList.remove('theme-transitioning');
                themeTransitionTimer = null;
            }, 300);
        } else {
            root.classList.remove('theme-transitioning');
        }
        root.classList.toggle('light-mode', theme === 'light');
        var themeMeta = document.querySelector('meta[name="theme-color"]');
        if (themeMeta) themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue('--browser-theme-color').trim();
        document.querySelector('meta[name="color-scheme"]').content = theme;
        document.querySelectorAll('.appearance-switch').forEach(function(sw) {
            sw.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
        });
    }

    /* Use the localStorage theme when present; otherwise follow the system, as in VitePress. */
    function themeCookieValue() {
        var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + THEME_COOKIE + '=(light|dark)'));
        return match ? match[1] : null;
    }

    function effectiveTheme() {
        var saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') return saved;
        return themeCookieValue() || getSystemTheme();
    }

    /* Write a shared cross-subdomain cookie so the main, auth, and redirect pages use one theme. */
    function saveTheme(theme) {
        localStorage.setItem('theme', theme);
        var secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = THEME_COOKIE + '=' + theme + '; path=/; max-age=' + THEME_COOKIE_MAX_AGE
            + '; SameSite=Lax' + secure + sharedCookieDomain();
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
       - I18N_CACHE: dictionaries for every language; preload the others after page load.
       - t(): look up text by key and replace {param} placeholders.
       - applyLang(): switch language in the browser by updating data-i18n elements without reloading.
       */
    var I18N = JSON.parse(document.body.getAttribute('data-i18n-dict') || '{}');
    var CURRENT_LANG = bodyAttr('data-lang', DEFAULT_LANG);
    var I18N_CACHE = window.I18N_CACHE || {};
    I18N_CACHE[CURRENT_LANG] = I18N;

    function t(key, params) {
        var s = (I18N[key] !== undefined) ? I18N[key] : key;
        if (params) {
            Object.keys(params).forEach(function(k) {
                s = s.split('{' + k + '}').join(params[k]);
            });
        }
        return s;
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

    /* Parse data-i18n text syntax: "key" or "key;param=value". */
    function parseI18nText(spec) {
        var semi = spec.indexOf(';');
        var key = semi === -1 ? spec : spec.slice(0, semi);
        var params = {};
        if (semi !== -1) {
            spec.slice(semi + 1).split(';').forEach(function(p) {
                var eq = p.indexOf('=');
                if (eq !== -1) params[p.slice(0, eq)] = p.slice(eq + 1);
            });
        }
        return { key: key, params: params };
    }

    /* Parse data-i18n-attr syntax: "attr1,attr2:key;param=value|attr3:key2". */
    function parseI18nAttr(spec) {
        var out = [];
        String(spec).split('|').forEach(function(seg) {
            var colon = seg.indexOf(':');
            if (colon === -1) return;
            var attrs = seg.slice(0, colon).split(',');
            var rest = seg.slice(colon + 1);
            var semi = rest.indexOf(';');
            var key = semi === -1 ? rest : rest.slice(0, semi);
            var params = {};
            if (semi !== -1) {
                rest.slice(semi + 1).split(';').forEach(function(p) {
                    var eq = p.indexOf('=');
                    if (eq !== -1) params[p.slice(0, eq)] = p.slice(eq + 1);
                });
            }
            attrs.forEach(function(a) { out.push({ attr: a.trim(), key: key, params: params }); });
        });
        return out;
    }

    /* Update all marked elements using the current I18N dictionary. */
    function renderI18n() {
        document.querySelectorAll('[data-i18n]').forEach(function(el) {
            var spec = parseI18nText(el.getAttribute('data-i18n'));
            var text = t(spec.key, spec.params);
            var prefix = el.getAttribute('data-i18n-prefix');
            if (prefix != null) text = text ? prefix + text : '';
            el.textContent = text;
        });
        document.querySelectorAll('[data-i18n-attr]').forEach(function(el) {
            parseI18nAttr(el.getAttribute('data-i18n-attr')).forEach(function(x) {
                el.setAttribute(x.attr, t(x.key, x.params));
            });
        });
    }

    /* Write the language cookie using its name, TTL, and domain from injected data attributes. */
    function saveLangCookie(code) {
        var secure = location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = LANG_COOKIE + '=' + code + '; path=/; max-age=' + LANG_COOKIE_MAX_AGE
            + '; SameSite=Lax' + secure + sharedCookieDomain();
    }

    /* Apply a language in the browser: update the dictionary, document lang, marked text, and menu state. */
    function applyLang(lang) {
        if (I18N_CACHE[lang] == null) {  /* Fetch it first if it is missing or preload failed. */
            fetchI18n(lang, function(d) {
                if (d) { applyLang(lang); return; }
                /* If fetching the dictionary fails, save the cookie and reload for server rendering. */
                saveLangCookie(lang);
                location.reload();
            });
            return;
        }
        if (lang !== CURRENT_LANG) {
            CURRENT_LANG = lang;
            I18N = I18N_CACHE[lang];
            document.documentElement.lang = lang;
            renderI18n();
            document.querySelectorAll('#langMenu .theme-option').forEach(function(opt) {
                opt.classList.toggle('selected', opt.dataset.lang === lang);
            });
            document.dispatchEvent(new CustomEvent('languagechange'));
        }
        saveLangCookie(lang);
    }

    /* Preload the other language dictionaries at low priority after page load. */
    function prefetchI18n() {
        SUPPORTED_LANGS.forEach(function(lang) {
            if (lang === CURRENT_LANG || I18N_CACHE[lang] != null) return;
            fetchI18n(lang, function() {});
        });
    }

    /*
       After the current page loads, prefetch the other two home pages (HTML and images).
       - Use <link rel=prefetch> for HTML; its cache retains the language cookie and degrades gracefully.
       - Use new Image() to warm the HTTP cache. Home images use images.comicine.com's static edge cache;
         contact-page QR codes continue to use the image.comicine.com Worker.
       - Do not prefetch QR codes on mobile; the contact page only shows them on desktop hover.
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
        '/':        { host: 'comicine.com',          path: '/',        images: HOME_IMAGES, assetBase: true },
        '/services':{ host: 'services.comicine.com', path: '/services', images: [] },
        '/contact': { host: 'contact.comicine.com',  path: '/contact',  images: [
                        '/qr-codes/bilibili.png',
                        '/qr-codes/qq.png',
                        '/qr-codes/wechat.png' ], qr: true, assetBase: false }
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

    /* Home images load from images.comicine.com/static via the static edge cache.
       QR codes still use the image.comicine.com Worker, which selects a watermark by Referer. */
    function pageOrigin(key) {
        var manifest = PAGE_MANIFEST[key];
        var attr = manifest && manifest.assetBase
            ? 'data-image-asset-base'
            : 'data-image-watermark-base';
        var base = document.body && document.body.getAttribute(attr);
        return isProductionDomain(location.hostname)
            ? (base || (manifest && manifest.assetBase
                ? 'https://images.comicine.com'
                : 'https://image.comicine.com'))
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
        var desktop = window.matchMedia('(hover: hover)').matches;
        Object.keys(PAGE_MANIFEST).forEach(function(key) {
            var origin = pageOrigin(key);
            if (key === cur) {
                /* The current page is already open. Warm portfolio images at low priority while idle
                   so they are likely cached when the user scrolls to #portfolio. */
                if (desktop) {
                    PAGE_MANIFEST[key].images.forEach(function(rel) {
                        var img = new Image();
                        img.referrerPolicy = 'origin';
                        img.fetchPriority = 'low';
                        img.onerror = function() {};
                        img.src = rel.indexOf('http') === 0 ? rel : origin + rel;
                    });
                }
                return;
            }
            var l = document.createElement('link');
            l.rel = 'prefetch'; l.href = siblingHref(key);
            document.head.appendChild(l);
            PAGE_MANIFEST[key].images.forEach(function(rel) {
                if (PAGE_MANIFEST[key].qr && !desktop) return;   /* Skip QR codes on mobile. */
                var img = new Image();
                img.referrerPolicy = 'origin';
                img.fetchPriority = 'low';
                img.onerror = function() {};             /* Ignore 404s without logging a console error. */
                img.src = rel.indexOf('http') === 0 ? rel : origin + rel;
            });
        });
    }

    /* Toggle the language menu. */
    function toggleLangMenu(e) {
        if (e) e.stopPropagation();
        var m = document.getElementById('langMenu');
        if (m) {
            var open = !m.classList.contains('open');
            m.classList.toggle('open', open);
            var button = document.getElementById('lang-btn');
            if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        closeNavMenu();
    }

    function closeLangMenu() {
        var m = document.getElementById('langMenu');
        if (m) m.classList.remove('open');
        var button = document.getElementById('lang-btn');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function setLang(code) {
        closeLangMenu();
        closeNavLanguages();
        closeNavMenu();
        /* Normally switch without a reload: fetch the target dictionary and update data-i18n nodes.
           applyLang reloads only as a fallback when the dictionary endpoint fails. */
        if (code !== CURRENT_LANG) applyLang(code);
        else saveLangCookie(code);
    }

    /* On desktop, hover opens and closes the language menu like VitePress VPFlyout; touch uses clicks. */
    (function bindLangHover() {
        var fly = document.querySelector('.lang-flyout');
        if (!fly) return;
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            fly.addEventListener('mouseenter', function() {
                var m = document.getElementById('langMenu');
                if (m) m.classList.add('open');
                var button = document.getElementById('lang-btn');
                if (button) button.setAttribute('aria-expanded', 'true');
            });
            fly.addEventListener('mouseleave', closeLangMenu);
        }
    })();

    var navScreenBackground = [];

    function setNavScreenBackgroundInert(inert) {
        if (inert) {
            navScreenBackground = [];
            Array.prototype.forEach.call(document.body.children, function(child) {
                if (child.classList.contains('site-nav') || child.id === 'nav-screen' || child.inert) return;
                child.inert = true;
                navScreenBackground.push(child);
            });
            return;
        }
        navScreenBackground.forEach(function(child) { child.inert = false; });
        navScreenBackground = [];
    }

    function toggleNavLanguages(e) {
        if (e) e.stopPropagation();
        var list = document.getElementById('nav-screen-language-list');
        var toggle = document.getElementById('nav-screen-languages-toggle');
        var group = document.querySelector('.nav-screen-translations');
        if (!list || !toggle) return;
        var open = list.inert;
        list.classList.toggle('open', open);
        list.setAttribute('aria-hidden', open ? 'false' : 'true');
        list.inert = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (group) group.classList.toggle('open', open);
    }

    function closeNavLanguages() {
        var list = document.getElementById('nav-screen-language-list');
        var toggle = document.getElementById('nav-screen-languages-toggle');
        var group = document.querySelector('.nav-screen-translations');
        if (list) {
            list.classList.remove('open');
            list.setAttribute('aria-hidden', 'true');
            list.inert = true;
        }
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (group) group.classList.remove('open');
    }

    /* Toggle the VitePress-style full-screen navigation panel. */
    function toggleMobileMenu(e) {
        if (e) e.stopPropagation();
        var screen = document.getElementById('nav-screen');
        if (!screen) return;
        var open = !screen.classList.contains('open');
        screen.classList.toggle('open', open);
        screen.setAttribute('aria-hidden', open ? 'false' : 'true');
        screen.inert = !open;
        setNavScreenBackgroundInert(open);
        document.documentElement.classList.toggle('nav-screen-open', open);
        document.body.classList.toggle('nav-screen-open', open);
        var button = document.querySelector('.nav-menu-button');
        if (button) button.classList.toggle('active', open);
        if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
        closeLangMenu();
        closeNavLanguages();
    }

    /* Close the navigation panel and restore the page scroll state. */
    function closeNavMenu() {
        var screen = document.getElementById('nav-screen');
        if (screen) {
            screen.classList.remove('open');
            screen.setAttribute('aria-hidden', 'true');
            screen.inert = true;
        }
        setNavScreenBackgroundInert(false);
        document.documentElement.classList.remove('nav-screen-open');
        document.body.classList.remove('nav-screen-open');
        var button = document.querySelector('.nav-menu-button');
        if (button) button.classList.remove('active');
        if (button) button.setAttribute('aria-expanded', 'false');
        closeNavLanguages();
    }

    function openNewWindow(url) {
        window.open(url, "_blank", "noopener");
    }

    /* Initialize after the DOM has loaded. */
    window.addEventListener('load', function() {
        preloadPageImages();

        /* Restore the saved theme, or follow the system when there is no saved choice. */
        applyTheme(effectiveTheme());


        /* Follow system theme changes only when there is no saved choice. */
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
            if (!localStorage.getItem('theme')) applyTheme(getSystemTheme(), true);
        });

        /* Close the language flyout outside its control; the screen closes on its own backdrop or links. */
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.lang-toggle')) closeLangMenu();
            var screen = document.getElementById('nav-screen');
            if (screen && e.target === screen) closeNavMenu();
            if (e.target.closest('.nav-screen-link')) closeNavMenu();
        });

        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Escape') return;
            var screen = document.getElementById('nav-screen');
            if (screen && screen.classList.contains('open')) {
                closeNavMenu();
                var button = document.querySelector('.nav-menu-button');
                if (button) button.focus();
            } else {
                closeLangMenu();
            }
        });

        window.addEventListener('resize', function() {
            if (window.matchMedia('(min-width: 768px)').matches) closeNavMenu();
        });


        /* Prefetch all language dictionaries after load so switching languages does not wait on the network.
           Keep page prefetches at low priority so they do not compete for bandwidth after the initial view. */
        prefetchI18n();
        if ('requestIdleCallback' in window) {
            requestIdleCallback(prefetchPages, { timeout: 3000 });
        } else {
            setTimeout(prefetchPages, 1500);
        }
    });
