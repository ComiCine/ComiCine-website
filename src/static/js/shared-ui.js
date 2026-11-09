/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/**
 * Shared browser UI for the main site (base.js) and the verification gate (auth.js).
 *
 * Why this file exists: both page scripts carried their own copy of the theme switch, the i18n
 * renderer, the brand wrapper, and the navigation menus (about 200 duplicated lines), and the
 * copies had already drifted: base.js dispatched `languagechange` and auth.js did not, the gate
 * renderer also handled `data-i18n-html` and the brand word, and neither script exposed the
 * language choice or menu state to assistive technology. This file is the single implementation;
 * the page scripts keep only their page-specific behaviour (prefetch, hero, Turnstile, sessions).
 *
 * Loading contract: classic script, loaded with `defer` before base.js or auth.js. It only defines
 * `window.ComiCineUI`; it reads no DOM and installs no listeners until the page calls `bind()` or
 * one of the methods. That also lets the vitest suite import this same source in Node and test the
 * pure helpers (i18n parsing, cookie parsing, page meta keys) without a browser.
 */
(function (root) {
    'use strict';

    var REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
    var warnedKeys = {};

    /* Report a missing dictionary key once, then stay quiet: language switches can repeat. */
    function warnOnce(scope, key) {
        var id = scope + ':' + key;
        if (warnedKeys[id]) return;
        warnedKeys[id] = true;
        if (typeof console !== 'undefined' && console.warn) {
            console.warn('[ComiCineUI] missing dictionary key ' + key + ' (' + scope + ')');
        }
    }

    function each(list, fn) {
        Array.prototype.forEach.call(list || [], fn);
    }

    function motionQuery(view) {
        if (!view || typeof view.matchMedia !== 'function') return null;
        try { return view.matchMedia(REDUCED_MOTION_QUERY); } catch (_) { return null; }
    }

    /* Whether the operating system asks for reduced motion; false when the API is unavailable. */
    function prefersReducedMotion(view) {
        var query = motionQuery(view || (typeof window !== 'undefined' ? window : null));
        return !!(query && query.matches);
    }

    /* Run a DOM update without losing the scroll position the visitor had before the switch. */
    function preserveScroll(doc, fn) {
        var view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
        var docEl = doc.documentElement || {};
        var y = view && typeof view.scrollY === 'number' ? view.scrollY : (docEl.scrollTop || 0);
        fn();
        var restore = function () {
            if (!view) return;
            if (typeof view.scrollTo === 'function') view.scrollTo(0, y);
            else if (docEl) docEl.scrollTop = y;
        };
        if (view && typeof view.requestAnimationFrame === 'function') {
            view.requestAnimationFrame(restore);
        } else {
            setTimeout(restore, 0);
        }
    }

    function cookieValue(cookieString, name) {
        var parts = String(cookieString || '').split(';');
        for (var i = 0; i < parts.length; i++) {
            var separator = parts[i].indexOf('=');
            if (separator < 0) continue;
            if (parts[i].slice(0, separator).trim() !== name) continue;
            var value = parts[i].slice(separator + 1).trim();
            return value === '' ? null : value;
        }
        return null;
    }

    /* Shared cookies use the root domain, and only on hosts below it. */
    function cookieDomainFor(host, rootDomain) {
        host = String(host || '').toLowerCase();
        rootDomain = String(rootDomain || '').toLowerCase();
        if (!rootDomain) return '';
        var suffix = '.' + rootDomain;
        var matches = host === rootDomain || host.slice(-suffix.length) === suffix;
        return matches ? '; domain=.' + rootDomain : '';
    }

    function writeCookie(doc, name, value, options) {
        var opts = options || {};
        var view = doc.defaultView;
        var host = opts.hostname || (view && view.location ? view.location.hostname : '');
        var secure = view && view.location && view.location.protocol === 'https:' ? '; Secure' : '';
        doc.cookie = name + '=' + value + '; path=/; max-age=' + opts.maxAge
            + '; SameSite=Lax' + secure + cookieDomainFor(host, opts.rootDomain);
    }

    function normalizeTheme(value) {
        return value === 'light' || value === 'dark' ? value : null;
    }

    function systemTheme(view) {
        if (!view || typeof view.matchMedia !== 'function') return 'dark';
        try {
            return view.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
        } catch (_) {
            return 'dark';
        }
    }

    function storageOf(view) {
        try { return view && view.localStorage ? view.localStorage : null; } catch (_) { return null; }
    }

    function readStorageTheme(store) {
        try {
            var storage = store && store.getItem
                ? store
                : (typeof localStorage !== 'undefined' ? localStorage : null);
            if (!storage || !storage.getItem) return null;
            return normalizeTheme(storage.getItem('theme'));
        } catch (_) {
            return null;
        }
    }

    /* Prefer the shared theme cookie, then this origin's stored choice, then the system. */
    function effectiveTheme(doc, cookieName) {
        var view = doc.defaultView;
        return normalizeTheme(cookieValue(doc.cookie, cookieName))
            || readStorageTheme(storageOf(view))
            || systemTheme(view);
    }

    /*
       Theme switching follows VitePress appearance behavior:
       - Follow the system on first visit; after a click, save the selected theme in localStorage.
       - Keep that selection until localStorage is cleared.
       The transition is skipped when the operating system asks for reduced motion.
       */
    var themeTransitionTimer = null;

    function applyTheme(doc, theme, animate, options) {
        var opts = options || {};
        var rootEl = doc.documentElement;
        var view = doc.defaultView;
        var reduced = opts.reducedMotion === undefined ? prefersReducedMotion(view) : !!opts.reducedMotion;
        if (themeTransitionTimer !== null) {
            clearTimeout(themeTransitionTimer);
            themeTransitionTimer = null;
        }
        if (animate && !reduced) {
            rootEl.classList.add('theme-transitioning');
            themeTransitionTimer = setTimeout(function () {
                rootEl.classList.remove('theme-transitioning');
                themeTransitionTimer = null;
            }, 300);
        } else {
            rootEl.classList.remove('theme-transitioning');
        }
        rootEl.classList.toggle('light-mode', theme === 'light');
        var schemeMeta = doc.querySelector('meta[name="color-scheme"]');
        if (schemeMeta) schemeMeta.content = theme;
        var themeMeta = doc.querySelector('meta[name="theme-color"]');
        if (themeMeta && view && typeof view.getComputedStyle === 'function') {
            themeMeta.content = view.getComputedStyle(rootEl).getPropertyValue('--browser-theme-color').trim();
        }
        each(doc.querySelectorAll('.appearance-switch'), function (sw) {
            sw.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
        });
    }

    /* Write the shared cross-subdomain cookie so every subdomain uses one theme. */
    function saveTheme(doc, theme, options) {
        var opts = options || {};
        try {
            var storage = storageOf(doc.defaultView);
            if (storage) storage.setItem('theme', theme);
        } catch (_) {
            /* Private browsing: the cookie below still carries the choice. */
        }
        writeCookie(doc, opts.cookieName, theme, {
            maxAge: opts.maxAge,
            rootDomain: opts.rootDomain,
            hostname: opts.hostname
        });
    }

    /* Parse data-i18n text syntax: "key" or "key;param=value". */
    function parseI18nText(spec) {
        var raw = String(spec == null ? '' : spec);
        var semi = raw.indexOf(';');
        var key = semi === -1 ? raw : raw.slice(0, semi);
        var params = {};
        if (semi !== -1) {
            raw.slice(semi + 1).split(';').forEach(function (entry) {
                var eq = entry.indexOf('=');
                if (eq !== -1) params[entry.slice(0, eq)] = entry.slice(eq + 1);
            });
        }
        return { key: key, params: params };
    }

    /* Parse data-i18n-attr syntax: "attr1,attr2:key;param=value|attr3:key2". */
    function parseI18nAttr(spec) {
        var out = [];
        String(spec == null ? '' : spec).split('|').forEach(function (segment) {
            var colon = segment.indexOf(':');
            if (colon === -1) return;
            var attrs = segment.slice(0, colon).split(',');
            var rest = segment.slice(colon + 1);
            var semi = rest.indexOf(';');
            var key = semi === -1 ? rest : rest.slice(0, semi);
            var params = {};
            if (semi !== -1) {
                rest.slice(semi + 1).split(';').forEach(function (entry) {
                    var eq = entry.indexOf('=');
                    if (eq !== -1) params[entry.slice(0, eq)] = entry.slice(eq + 1);
                });
            }
            attrs.forEach(function (attr) {
                var name = attr.trim();
                if (name) out.push({ attr: name, key: key, params: params });
            });
        });
        return out;
    }

    function formatText(template, params) {
        var text = String(template);
        if (!params) return text;
        Object.keys(params).forEach(function (key) {
            text = text.split('{' + key + '}').join(params[key]);
        });
        return text;
    }

    /* Turn a dictionary into a lookup that returns null for a missing key instead of the key text. */
    function translator(dict) {
        return function (key, params) {
            var value = dict ? dict[key] : undefined;
            if (value === undefined || value === null) return null;
            return formatText(value, params);
        };
    }

    /*
       Update all marked elements using the given translator.
       - missing: 'keep' leaves the server-rendered copy in place, 'raw' writes the key (main site).
       - html: also handle [data-i18n-html] (gate page only).
       - brandify: wrap the exact brand word after each text update (gate page only).
       */
    function renderI18n(doc, options) {
        var opts = options || {};
        var translate = opts.translate || function (key) { return key; };
        var missing = opts.missing === 'raw' ? 'raw' : 'keep';
        var brandify = opts.brandify ? brandifyText : null;

        each(doc.querySelectorAll('[data-i18n]'), function (el) {
            var spec = parseI18nText(el.getAttribute('data-i18n'));
            var text = translate(spec.key, spec.params);
            if (text === null) {
                if (missing !== 'raw') return;
                text = spec.key;
            }
            var prefix = el.getAttribute('data-i18n-prefix');
            if (prefix !== null && prefix !== undefined) text = text ? prefix + text : '';
            el.textContent = text;
            if (brandify) brandify(el);
        });

        if (opts.html) {
            each(doc.querySelectorAll('[data-i18n-html]'), function (el) {
                var html = translate(el.getAttribute('data-i18n-html'));
                if (html !== null) el.innerHTML = html;
            });
        }

        each(doc.querySelectorAll('[data-i18n-attr]'), function (el) {
            parseI18nAttr(el.getAttribute('data-i18n-attr')).forEach(function (entry) {
                var value = translate(entry.key, entry.params);
                if (value === null) {
                    if (missing !== 'raw') return;
                    value = entry.key;
                }
                el.setAttribute(entry.attr, value);
            });
        });
    }

    /*
       Wrap exact ComiCine brand names so the brand font never affects surrounding text.
       Kept as the single brand implementation for both page scripts.
       */
    function brandifyText(el) {
        var word = el.getAttribute('data-brandify');
        if (!word || !el.textContent || el.textContent.indexOf(word) === -1) return;
        if (el.querySelector('.brand-word')) return;
        el.innerHTML = el.textContent.split(word).join('<span class="brand-word">' + word + '</span>');
    }

    /* Mark the selected language in both menus and expose it to assistive technology. */
    function syncLanguageState(doc, lang, selector) {
        each(doc.querySelectorAll(selector || '#langMenu .theme-option, .nav-screen-language-option'), function (option) {
            var selected = option.getAttribute('data-lang') === lang;
            option.classList.toggle('selected', selected);
            if (selected) option.setAttribute('aria-current', 'page');
            else option.removeAttribute('aria-current');
        });
    }

    function themeKeys(prefix) {
        return {
            titleKey: 'page_title_' + prefix,
            descriptionKey: 'meta_description_' + prefix
        };
    }

    /*
       Title and description dictionary keys for the page at hostname/pathname.
       Template markup owns the initial title; the client only needs to know which keys to swap on
       a language change. Pages without a translated description return null for that half, and
       unknown pages return null so the existing title is left untouched.
       */
    function pageMetaFor(hostname, pathname, rootDomain) {
        var host = String(hostname || '').toLowerCase();
        var root = String(rootDomain || '').toLowerCase();
        var path = String(pathname || '/');
        path = ('/' + path.replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
        path = path.replace(/\.html$/, '').replace(/\/index$/, '') || '/';

        function sub(prefix) {
            return !!root && (host === prefix + '.' + root);
        }

        if (sub('services')) return themeKeys('services');
        if (sub('contact')) return themeKeys('contact');
        if (sub('visitor')) return { titleKey: 'page_title_visitor', descriptionKey: null };
        if (sub('account')) return { titleKey: 'page_title_apple_account', descriptionKey: null };
        if (sub('images') || sub('image')) {
            return { titleKey: 'meta_title_images', descriptionKey: 'meta_description_images' };
        }
        /* Leave the gate, the 404 page, and unknown hosts alone. */
        if (path === '/gate' || path === '/404' || path === '/not-found') return null;
        if (path === '/services' || path === '/convention' || path === '/outdoor') return themeKeys('services');
        if (path === '/contact') return themeKeys('contact');
        if (path === '/visitor') return { titleKey: 'page_title_visitor', descriptionKey: null };
        if (path === '/apple-account' || path === '/apple') {
            return { titleKey: 'page_title_apple_account', descriptionKey: null };
        }
        if (path === '/' || path === '/portfolio') return themeKeys('home');
        /* Unknown paths are not this page's business: a 404 near-miss such as /foo must not
           borrow the home title. The page script overrides this for the not-found page. */
        return null;
    }

    /* Swap document.title and the description meta; a missing key keeps the server copy. */
    function applyPageMeta(doc, translate, meta) {
        if (!meta) return;
        if (meta.titleKey) {
            var title = translate(meta.titleKey);
            if (title === null || title === '') warnOnce('title', meta.titleKey);
            else doc.title = title;
        }
        if (!meta.descriptionKey) return;
        var tag = doc.querySelector('meta[name="description"]');
        if (!tag) return;
        var description = translate(meta.descriptionKey);
        if (description === null || description === '') {
            warnOnce('description', meta.descriptionKey);
            return;
        }
        tag.setAttribute('content', description);
    }

    /*
       Language switching shared by both pages.

       The page owns dictionary storage (a flat cache on the main site, one nested gate dictionary
       on the verification page); this controller owns the order of operations: fetch when needed,
       swap the dictionary, re-render marked text, update menu state and page meta, restore the
       scroll position, persist the cookie, then run the page hook (the gate resets Turnstile there).
       */
    function createLanguage(options) {
        var opts = options || {};
        var doc = opts.doc;
        var lang = opts.lang || '';
        var renderOptions = opts.render || {};
        var meta = opts.meta || null;
        var stateSelector = opts.stateSelector || '#langMenu .theme-option, .nav-screen-language-option';
        /* Every apply bumps this, so a slow dictionary response for an older choice cannot
           overwrite a newer one the visitor already picked. */
        var requestId = 0;

        function current() {
            return lang;
        }

        function setCurrent(next) {
            lang = next;
        }

        function apply(nextLang) {
            var id = ++requestId;
            if (nextLang === lang) {
                if (opts.saveCookie) opts.saveCookie(nextLang);
                if (opts.onApplied) opts.onApplied(lang, opts.getDict(lang));
                return;
            }
            var dict = opts.getDict(nextLang);
            if (dict === null || dict === undefined) {
                opts.fetchDict(nextLang, function (loaded) {
                    if (id !== requestId) return;
                    if (loaded) {
                        apply(nextLang);
                        return;
                    }
                    if (opts.saveCookie) opts.saveCookie(nextLang);
                    if (opts.reload) opts.reload();
                });
                return;
            }
            var previous = lang;
            lang = nextLang;
            if (opts.useDict) opts.useDict(nextLang, dict);
            var translate = opts.translate(dict);
            preserveScroll(doc, function () {
                doc.documentElement.lang = nextLang;
                renderI18n(doc, {
                    translate: translate,
                    missing: renderOptions.missing,
                    html: renderOptions.html,
                    brandify: renderOptions.brandify
                });
                syncLanguageState(doc, nextLang, stateSelector);
                applyPageMeta(doc, translate, meta);
            });
            if (opts.saveCookie) opts.saveCookie(nextLang);
            if (opts.dispatch) {
                var view = doc.defaultView;
                var CustomEventCtor = (view && view.CustomEvent) || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
                if (typeof CustomEventCtor === 'function') doc.dispatchEvent(new CustomEventCtor('languagechange'));
            }
            if (opts.onApplied) opts.onApplied(previous, dict);
        }

        return { current: current, setCurrent: setCurrent, apply: apply };
    }

    function focusElement(el) {
        if (!el || typeof el.focus !== 'function') return;
        try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); }
    }

    function firstFocusable(container) {
        if (!container || typeof container.querySelector !== 'function') return null;
        return container.querySelector(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
    }

    /* Keyboard-initiated clicks have detail 0; opening those menus also moves focus into them. */
    function keyboardActivation(event) {
        return !!event && event.detail === 0;
    }

    /*
       Menus shared by both pages: the desktop language flyout, the full-screen mobile navigation
       panel, and the language list inside it.

       Accessibility contract: every trigger keeps aria-expanded in step with its container,
       containers carry aria-hidden plus inert while closed, Escape closes the innermost open menu
       and returns focus to its trigger, and the selected language carries aria-current. The
       reduced-motion preference is handled by the CSS media query, so a state change here is
       instant either way.
       */
    function createNavigation(options) {
        var opts = options || {};
        var doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        var win = doc ? doc.defaultView : null;
        var background = [];

        function byId(id) {
            return doc ? doc.getElementById(id) : null;
        }

        function langButton() { return byId('lang-btn'); }
        function langMenu() { return byId('langMenu'); }
        function navScreen() { return byId('nav-screen'); }
        function navMenuButton() { return doc.querySelector('.nav-menu-button'); }
        function navLanguageToggle() { return byId('nav-screen-languages-toggle'); }
        function navLanguageList() { return byId('nav-screen-language-list'); }
        function navLanguageGroup() { return doc.querySelector('.nav-screen-translations'); }

        function setBackgroundInert(inert) {
            if (!doc || !doc.body) return;
            if (inert) {
                background = [];
                each(doc.body.children, function (child) {
                    if (child.classList.contains('site-nav') || child.id === 'nav-screen' || child.inert) return;
                    child.inert = true;
                    background.push(child);
                });
                return;
            }
            background.forEach(function (child) { child.inert = false; });
            background = [];
        }

        function setLangMenuOpen(open, behavior) {
            var menu = langMenu();
            if (!menu) return;
            var button = langButton();
            var focusFirst = !!(behavior && behavior.focusFirst);
            var returnFocus = !!(behavior && behavior.returnFocus);
            if (open) {
                menu.classList.add('open');
                menu.setAttribute('aria-hidden', 'false');
                menu.inert = false;
                if (button) button.setAttribute('aria-expanded', 'true');
                if (focusFirst) focusElement(firstFocusable(menu));
                return;
            }
            /* Move focus out before hiding: aria-hidden with a focused descendant is invalid. */
            var active = doc.activeElement;
            var inside = !!(menu.contains && active && menu.contains(active));
            if (returnFocus || (inside && behavior && behavior.returnFocus !== false)) {
                focusElement(button);
            }
            menu.classList.remove('open');
            menu.setAttribute('aria-hidden', 'true');
            menu.inert = true;
            if (button) button.setAttribute('aria-expanded', 'false');
        }

        function closeLangMenu(behavior) {
            setLangMenuOpen(false, behavior || {});
        }

        function toggleLangMenu(event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            var menu = langMenu();
            if (!menu) return;
            var open = !menu.classList.contains('open');
            setNavScreenOpen(false, { returnFocus: false });
            setLangMenuOpen(open, { focusFirst: open && keyboardActivation(event), returnFocus: false });
        }

        function setNavLanguagesOpen(open, behavior) {
            var list = navLanguageList();
            var toggle = navLanguageToggle();
            var group = navLanguageGroup();
            if (!list || !toggle) return;
            if (open) {
                list.classList.add('open');
                list.setAttribute('aria-hidden', 'false');
                list.inert = false;
                toggle.setAttribute('aria-expanded', 'true');
                if (group) group.classList.add('open');
                if (behavior && behavior.focusFirst) focusElement(firstFocusable(list));
                return;
            }
            var active = doc.activeElement;
            var inside = !!(list.contains && active && list.contains(active));
            /* Move focus to the trigger before hiding the list: a focused node inside an
               aria-hidden/inert container is an invalid state. */
            if ((behavior && behavior.returnFocus) || inside) focusElement(toggle);
            list.classList.remove('open');
            list.setAttribute('aria-hidden', 'true');
            list.inert = true;
            toggle.setAttribute('aria-expanded', 'false');
            if (group) group.classList.remove('open');
        }

        function closeNavLanguages(behavior) {
            setNavLanguagesOpen(false, behavior || {});
        }

        function toggleNavLanguages(event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            var list = navLanguageList();
            if (!list) return;
            var open = !list.classList.contains('open');
            setNavLanguagesOpen(open, { focusFirst: open && keyboardActivation(event), returnFocus: false });
        }

        /* Toggle the VitePress-style full-screen navigation panel. */
        function setNavScreenOpen(open, behavior) {
            var screen = navScreen();
            if (!screen) return;
            var button = navMenuButton();
            if (open) {
                closeLangMenu({ returnFocus: false });
                closeNavLanguages({ returnFocus: false });
                screen.classList.add('open');
                screen.setAttribute('aria-hidden', 'false');
                screen.inert = false;
                setBackgroundInert(true);
                doc.documentElement.classList.add('nav-screen-open');
                if (doc.body) doc.body.classList.add('nav-screen-open');
                if (button) {
                    button.classList.add('active');
                    button.setAttribute('aria-expanded', 'true');
                }
                focusElement(firstFocusable(screen));
                return;
            }
            var active = doc.activeElement;
            var inside = !!(screen.contains && active && screen.contains(active));
            /* Focus the trigger before the panel becomes inert, so focus never lands on the
               hidden surface and assistive technology sees a consistent tree. */
            if ((behavior && behavior.returnFocus) || inside) focusElement(button);
            screen.classList.remove('open');
            screen.setAttribute('aria-hidden', 'true');
            screen.inert = true;
            setBackgroundInert(false);
            doc.documentElement.classList.remove('nav-screen-open');
            if (doc.body) doc.body.classList.remove('nav-screen-open');
            if (button) {
                button.classList.remove('active');
                button.setAttribute('aria-expanded', 'false');
            }
            closeNavLanguages({ returnFocus: false });
        }

        function closeNavMenu(behavior) {
            setNavScreenOpen(false, behavior || {});
        }

        function toggleMobileMenu(event) {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
            var screen = navScreen();
            if (!screen) return;
            setNavScreenOpen(!screen.classList.contains('open'), { returnFocus: false });
        }

        /* Escape closes the innermost open menu and returns focus to its trigger. */
        function handleKeydown(event) {
            if (!event || event.key !== 'Escape') return;
            var list = navLanguageList();
            if (list && list.classList.contains('open')) {
                closeNavLanguages({ returnFocus: true });
                return;
            }
            var screen = navScreen();
            if (screen && screen.classList.contains('open')) {
                closeNavMenu({ returnFocus: true });
                return;
            }
            var menu = langMenu();
            if (menu && menu.classList.contains('open')) closeLangMenu({ returnFocus: true });
        }

        function handleClick(event) {
            var target = event && event.target;
            if (!target || typeof target.closest !== 'function') return;
            if (!target.closest('.lang-flyout')) closeLangMenu({ returnFocus: false });
            var screen = navScreen();
            if (screen && target === screen) closeNavMenu({});
            if (target.closest('.nav-screen-link')) closeNavMenu({});
        }

        var HOVER_CLOSE_DELAY_MS = 220;
        var hoverCloseTimer = 0;

        function cancelHoverClose() {
            if (!hoverCloseTimer) return;
            win.clearTimeout(hoverCloseTimer);
            hoverCloseTimer = 0;
        }

        /* On desktop, hover opens and closes the language flyout; touch uses clicks. */
        function bindHover() {
            var fly = doc.querySelector('.lang-flyout');
            if (!fly || !win || typeof win.matchMedia !== 'function') return;
            var hoverable = false;
            try { hoverable = win.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (_) {}
            if (!hoverable) return;
            fly.addEventListener('mouseenter', function () {
                cancelHoverClose();
                setLangMenuOpen(true, {});
            });
            fly.addEventListener('mouseleave', function () {
                cancelHoverClose();
                /* A 1px overshoot at the menu edge must not close it: wait long enough for the
                   pointer to come back, and cancel the close as soon as it re-enters. */
                hoverCloseTimer = win.setTimeout(function () {
                    hoverCloseTimer = 0;
                    setLangMenuOpen(false, {});
                }, HOVER_CLOSE_DELAY_MS);
            });
        }

        function bind() {
            if (!doc) return;
            doc.addEventListener('click', handleClick);
            doc.addEventListener('keydown', handleKeydown);
            if (win) {
                win.addEventListener('resize', function () {
                    var isDesktop = win.innerWidth >= 768;
                    if (typeof win.matchMedia === 'function') {
                        try { isDesktop = win.matchMedia('(min-width: 768px)').matches; } catch (_) {}
                    }
                    if (isDesktop) setNavScreenOpen(false, { returnFocus: false });
                });
            }
            bindHover();
            /* The gate navigation predates aria-controls; add it at runtime instead of trading
               on markup the main site keeps in its template. */
            var button = langButton();
            if (button && !button.hasAttribute('aria-controls')) button.setAttribute('aria-controls', 'langMenu');
            var menu = langMenu();
            if (menu && !menu.classList.contains('open')) {
                menu.setAttribute('aria-hidden', 'true');
                menu.inert = true;
                if (button) button.setAttribute('aria-expanded', 'false');
            }
            var screen = navScreen();
            if (screen && !screen.classList.contains('open')) {
                screen.setAttribute('aria-hidden', 'true');
                screen.inert = true;
            }
            var list = navLanguageList();
            if (list && !list.classList.contains('open')) {
                list.setAttribute('aria-hidden', 'true');
                list.inert = true;
            }
            /* An empty lang attribute would otherwise clear the selected option on every load. */
            var lang = doc.documentElement.lang;
            if (lang) syncLanguageState(doc, lang);
            /* Pages with their own navigation block mark the current item with .active only;
               expose it to assistive technology without editing each page template. */
            each(doc.querySelectorAll('.nav-link.active, .nav-screen-link.active'), function (link) {
                if (!link.hasAttribute('aria-current')) link.setAttribute('aria-current', 'page');
            });
        }

        return {
            bind: bind,
            toggleLangMenu: toggleLangMenu,
            closeLangMenu: closeLangMenu,
            toggleMobileMenu: toggleMobileMenu,
            closeNavMenu: closeNavMenu,
            toggleNavLanguages: toggleNavLanguages,
            closeNavLanguages: closeNavLanguages
        };
    }

    root.ComiCineUI = {
        prefersReducedMotion: prefersReducedMotion,
        preserveScroll: preserveScroll,
        cookieValue: cookieValue,
        cookieDomainFor: cookieDomainFor,
        writeCookie: writeCookie,
        normalizeTheme: normalizeTheme,
        systemTheme: systemTheme,
        readStorageTheme: readStorageTheme,
        effectiveTheme: effectiveTheme,
        applyTheme: applyTheme,
        saveTheme: saveTheme,
        parseI18nText: parseI18nText,
        parseI18nAttr: parseI18nAttr,
        formatText: formatText,
        translator: translator,
        renderI18n: renderI18n,
        brandifyText: brandifyText,
        syncLanguageState: syncLanguageState,
        pageMetaFor: pageMetaFor,
        applyPageMeta: applyPageMeta,
        createLanguage: createLanguage,
        createNavigation: createNavigation
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
