/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/** Gate page interactions. Fetch the sitekey and i18n from /gate/config at runtime. */

var turnstileWidget = null;
var CONFIG = null;
var GATE_I18N = {};
var TURNSTILE_SITEKEY = "";
/* build.py injects contract values into <body data-*> through _lang_attrs.html; this file only reads them. */
function gateBodyAttr(name, fallback) {
  var value = document.body && document.body.getAttribute(name);
  return value === null || value === undefined || value === '' ? (fallback || '') : value;
}
var DEFAULT_LANG = gateBodyAttr('data-default-lang', 'en-us');
var ROOT_DOMAIN = gateBodyAttr('data-root-domain', 'comicine.com');
var LANG_COOKIE = gateBodyAttr('data-lang-cookie', 'user_lang_preference');
var LANG_COOKIE_MAX_AGE = gateBodyAttr('data-lang-cookie-max-age', '31536000');
var THEME_COOKIE = gateBodyAttr('data-theme-cookie', 'comicine_theme');
var THEME_COOKIE_MAX_AGE = gateBodyAttr('data-theme-cookie-max-age', '31536000');
var CURRENT_LANG = gateBodyAttr('data-lang', DEFAULT_LANG);
var gateVerificationInFlight = false;
var gateLanguageChosen = false;
document.documentElement.lang = CURRENT_LANG;

/* Theme, translation, brand, and menu behaviour live in shared-ui.js, which auth.html loads first.
   Keep this guard visible: a missing shared file breaks every interaction on the gate. */
var UI = window.ComiCineUI;
if (!UI) console.error('[auth.js] shared-ui.js must load before auth.js');

/* Build time embeds gate copy for all four languages in the HTML; /gate/config supplies the
   runtime sitekey and the language the request was served with. Language switching and the
   initial copy therefore still work if the config endpoint is unavailable. */
(function () {
  var el = document.getElementById('gate-i18n');
  if (!el) return;
  try {
    GATE_I18N = JSON.parse(el.textContent || '{}');
  } catch (e) {
    console.warn('gate i18n parse failed', e);
  }
})();

function t(key) {
  var dict = GATE_I18N[CURRENT_LANG] || GATE_I18N[DEFAULT_LANG] || {};
  return dict[key] !== undefined ? dict[key] : key;
}

function turnstileLang(code) {
  return { 'zh-cn': 'zh-cn', 'en-us': 'en-us', 'ja-jp': 'ja', 'ko-kr': 'ko' }[code] || 'auto';
}

/* Theme reading and applying are shared with the main pages; only the cookie root differs. */
function getSystemTheme() { return UI.systemTheme(window); }
function effectiveTheme() { return UI.effectiveTheme(document, THEME_COOKIE); }
function storedTheme() { return UI.readStorageTheme(); }
function themeCookieValue() { return UI.cookieValue(document.cookie, THEME_COOKIE); }
function applyTheme(theme, animate) { UI.applyTheme(document, theme, animate); }
function saveTheme(theme) {
  /* /gate/config supplies the root domain at runtime; the injected attribute is the fallback. */
  UI.saveTheme(document, theme, {
    cookieName: THEME_COOKIE,
    maxAge: THEME_COOKIE_MAX_AGE,
    rootDomain: (CONFIG && CONFIG.root_domain) || ROOT_DOMAIN,
    hostname: location.hostname
  });
}

function loadTurnstileScript() {
  if (window.turnstile || TURNSTILE_SITEKEY === '') return;
  if (document.querySelector('script[data-turnstile]')) return;
  var s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback';
  s.async = true;
  s.defer = true;
  s.setAttribute('data-turnstile', '');
  document.head.appendChild(s);
}

function showError(key) {
  var el = document.getElementById('gate-error');
  var blockedDetail = document.getElementById('gate-blocked-detail');
  var locationLabel = document.getElementById('diag-location-label');
  var country = document.getElementById('diag-country');
  if (!el) return;
  if (!key) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('blocked');
    if (blockedDetail) blockedDetail.hidden = true;
    if (locationLabel) locationLabel.hidden = false;
    if (country) country.hidden = false;
    var retryBtn = document.getElementById('gate-retry');
    if (retryBtn) retryBtn.hidden = true;
    return;
  }
  el.hidden = false;
  el.textContent = t('error_' + key);
  var blocked = key === 'blocked';
  el.classList.toggle('blocked', blocked);
  if (blockedDetail) blockedDetail.hidden = !blocked;
  if (locationLabel) locationLabel.hidden = blocked;
  if (country) country.hidden = blocked;
}

/* Keep the public name for compatibility with the gate markup. */
function brandifyText(el) {
  UI.brandifyText(el);
}

/* The blocked page has no challenge to reset; resetting it would clear the only explanation
   the visitor gets, so theme and language changes leave that message in place. */
function gateBlocked() {
  return (document.body.getAttribute('data-gate-error') || '') === 'blocked';
}

function resetTurnstile() {
  var wrap = document.getElementById('turnstile-wrap');
  if (!wrap || gateBlocked()) return;
  if (!window.turnstile) {
    loadTurnstileScript();
    return;
  }
  showError('');
  if (turnstileWidget) {
    window.turnstile.remove(turnstileWidget);
    turnstileWidget = null;
  }
  /* Never reset automatically after failure. Resetting Turnstile immediately solves again and
     fires the callback, creating an unattended failure-reset-solve-failure loop that leaves the
     user stuck on verification. Solve again only after an explicit retry or a language/theme change. */
  turnstileWidget = window.turnstile.render(wrap, {
    sitekey: TURNSTILE_SITEKEY,
    /* Keep this value aligned with the siteverify checks in gate.ts. */
    action: 'gate',
    /* Stop hidden retry loops; a visible button lets the visitor retry after a network/config error. */
    retry: 'never',
    callback: submitGateVerification,
    'error-callback': function (errorCode) {
      if (typeof errorCode === 'number') console.error('Turnstile client error', errorCode);
      showError('failed');
      showRetry();
      return true; /* Mark the error handled; retryGateVerification owns the only retry path. */
    },
    'expired-callback': function () {
      showError('failed');
      showRetry();
    },
    theme: effectiveTheme() === 'light' ? 'light' : 'dark',
    language: turnstileLang(CURRENT_LANG)
  });
}

/* Explicit user retry: clear the previous error and solve again if needed. */
function retryGateVerification() {
  if (gateVerificationInFlight) return;
  showError('');
  if (window.turnstile && turnstileWidget) {
    window.turnstile.reset(turnstileWidget);
    return;
  }
  resetTurnstile();
}

/* Complete verification on this gate page. The endpoint only sets a cookie; it no longer redirects to a subdomain. */
function submitGateVerification(token) {
  var form = document.getElementById('gate');
  if (!form || gateVerificationInFlight) return;
  gateVerificationInFlight = true;
  var formData = new FormData(form);
  /* Submit the token from the success callback directly instead of relying on hidden-field update timing. */
  if (typeof token === 'string' && token) {
    formData.set('cf-turnstile-response', token);
  }

  fetch(form.action, {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' }
  })
    .then(function (response) {
      if (response.ok) {
        var next = form.querySelector('input[name="next"]');
        /* Navigate from this page directly to the original target, without the redirect subdomain. */
        location.replace(next && next.value ? next.value : '/');
        return null;
      }
      return response.json().catch(function () { return { error: 'failed' }; });
    })
    .then(function (result) {
      if (!result) return;
      showError(result.error || 'failed');
      showRetry();
      /* Do not call reset() here. Turnstile would immediately solve again and fire the callback,
         creating a silent failure-reset-solve-failure loop. */
    })
    .catch(function () {
      showError('unavailable');
      showRetry();
    })
    .then(function () { gateVerificationInFlight = false; });
}

/* Offer an explicit retry after failure; solve again only when the user clicks it. */
function showRetry() {
  var form = document.getElementById('gate');
  if (!form) return;
  var btn = document.getElementById('gate-retry');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'gate-retry';
    btn.type = 'button';
    btn.className = 'gate-retry';
    btn.setAttribute('data-action', 'retryGateVerification');
    form.appendChild(btn);
  }
  btn.textContent = t('retry');
  btn.hidden = false;
}

document.addEventListener('submit', function (event) {
  if (event.target && event.target.id === 'gate') {
    event.preventDefault();
    submitGateVerification();
  }
});

/* Dictionary lookup for the shared renderer: null means "missing", so the server copy stays. */
function gateTranslate(dict) {
  return function (key, params) {
    var value = dict ? dict[key] : undefined;
    if (value === undefined || value === null) {
      var fallback = GATE_I18N[DEFAULT_LANG] || {};
      value = fallback[key];
    }
    if (value === undefined || value === null) return null;
    return UI.formatText(value, params);
  };
}

function renderI18n() {
  UI.renderI18n(document, {
    translate: gateTranslate(GATE_I18N[CURRENT_LANG] || GATE_I18N[DEFAULT_LANG] || {}),
    missing: 'keep',
    html: true,
    brandify: true
  });
}

function saveLangCookie(code) {
  /* The root domain comes from /gate/config and <body data-root-domain>; prefer runtime config. */
  UI.writeCookie(document, LANG_COOKIE, code, {
    maxAge: LANG_COOKIE_MAX_AGE,
    rootDomain: (CONFIG && CONFIG.root_domain) || ROOT_DOMAIN,
    hostname: location.hostname
  });
}

function fetchI18n(lang, cb) {
  if (GATE_I18N[lang]) { cb(GATE_I18N[lang]); return; }
  fetch('/api/i18n/' + encodeURIComponent(lang), { headers: { 'Accept': 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d) {
        /* /api/i18n/<lang> returns the full locale dictionary with gate_-prefixed keys.
           Add only the keys needed by the gate page to avoid later renderI18n failures. */
        var map = {
          title: 'gate_title', heading: 'gate_heading', location: 'gate_location',
          ip: 'gate_ip', ray: 'gate_ray', foot: 'gate_foot',
          nav_home: 'nav_home', nav_services: 'nav_services', nav_contact: 'nav_contact',
          nav_menu_aria: 'nav_menu_aria', nav_appearance: 'nav_appearance', visit_bilibili: 'visit_bilibili',
          lang_zh: 'lang_zh', lang_en: 'lang_en', lang_ja: 'lang_ja', lang_ko: 'lang_ko',
          lang_aria: 'gate_lang_aria', theme_aria: 'gate_theme_aria',
          footer_rights: 'footer_rights', footer_source: 'footer_source', footer_source_link: 'footer_source_link',
          error_sitekey: 'gate_error_sitekey', error_invalid: 'gate_error_invalid',
          error_unavailable: 'gate_error_unavailable', error_failed: 'gate_error_failed',
          error_blocked: 'gate_error_blocked', error_blocked_detail: 'gate_error_blocked_detail',
          retry: 'gate_retry'
        };
        var normalized = {};
        Object.keys(map).forEach(function (outKey) {
          var srcKey = map[outKey];
          if (d[srcKey] !== undefined) normalized[outKey] = d[srcKey];
        });
        GATE_I18N[lang] = Object.keys(normalized).length ? normalized : GATE_I18N[lang];
      }
      cb(GATE_I18N[lang] || null);
    })
    .catch(function () { cb(null); });
}

/*
   Language switching: swap the gate dictionary, re-render the copy and the title, keep the
   scroll position, then reset Turnstile so the widget follows the new language and theme.
   The renderer only edits text and attributes, so the form, its values, and the panel state stay.
   */
var language = UI.createLanguage({
  doc: document,
  lang: CURRENT_LANG,
  render: { missing: 'keep', html: true, brandify: true },
  meta: null,
  dispatch: false,
  getDict: function (code) { return GATE_I18N[code] || null; },
  fetchDict: fetchI18n,
  useDict: function (code) { CURRENT_LANG = code; },
  translate: gateTranslate,
  saveCookie: saveLangCookie,
  reload: function () { location.reload(); },
  onApplied: function () {
    /* Keep the blocked explanation visible, and re-render it in the language just chosen. */
    if (gateBlocked()) {
      showError('blocked');
      return;
    }
    resetTurnstile();
  }
});

/* Keep the public name: the data-action layer calls window.applyLang and window.setLang. */
function applyLang(lang) {
  language.apply(lang);
}

/* Menus: the desktop language flyout plus the mobile panel shared with the main pages. */
var navMenus = UI.createNavigation({ doc: document });

function toggleLangMenu(e) { navMenus.toggleLangMenu(e); }
function closeLangMenu() { navMenus.closeLangMenu(); }
function toggleNavLanguages(e) { navMenus.toggleNavLanguages(e); }
function closeNavLanguages() { navMenus.closeNavLanguages(); }
function toggleMobileMenu(e) { navMenus.toggleMobileMenu(e); }
function closeNavMenu() { navMenus.closeNavMenu(); }

function setLang(code) {
  gateLanguageChosen = true;
  closeLangMenu();
  closeNavMenu();
  applyLang(code);
}

function toggleTheme() {
  var next = effectiveTheme() === 'light' ? 'dark' : 'light';
  saveTheme(next);
  applyTheme(next, true);
  resetTurnstile();
}

function onloadTurnstileCallback() {
  resetTurnstile();
}

function initGateConfig(cfg) {
  CONFIG = cfg;
  GATE_I18N = cfg.i18n || GATE_I18N;
  TURNSTILE_SITEKEY = cfg.sitekey || '';
  /* The reply carries the language the request was served with; a visitor who already picked
     another one keeps it, otherwise the UI and the language cookie would disagree. */
  if (!gateLanguageChosen) {
    CURRENT_LANG = cfg.lang || CURRENT_LANG;
    language.setCurrent(CURRENT_LANG);
    document.documentElement.lang = CURRENT_LANG;
  }
  applyTheme(effectiveTheme());
  renderI18n();
  UI.syncLanguageState(document, CURRENT_LANG);
  var errorKey = document.body.getAttribute('data-gate-error') || '';
  if (errorKey) showError(errorKey);
  if (errorKey === 'blocked') {
    var form = document.getElementById('gate');
    if (form) form.hidden = true;
    return;
  }
  if (TURNSTILE_SITEKEY === '') {
    showError('sitekey');
    return;
  }
  resetTurnstile();
}

/* Render static copy in the build language first; runtime config adds Turnstile and language switching. */
navMenus.bind();
applyTheme(effectiveTheme());
renderI18n();
/* Keep the ComiCine brand rendering in the static fallback when i18n is unavailable. */
var staticBrandTarget = document.querySelector('[data-brandify]');
if (staticBrandTarget) brandifyText(staticBrandTarget);
showError(document.body.getAttribute('data-gate-error') || '');

fetch('/gate/config', { headers: { 'Accept': 'application/json' } })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (cfg) {
    // Without the sitekey the widget cannot render; fail visibly instead of leaving a blank gate.
    if (cfg) initGateConfig(cfg);
    else showError('unavailable');
  })
  .catch(function () { showError('unavailable'); });

fetch('/gate/diag', { headers: { 'Accept': 'application/json' } })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (d) {
    if (!d) return;
    var map = { 'diag-country': d.country, 'diag-ip': d.ip, 'diag-ray': d.ray };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id]) el.textContent = map[id];
    });
  })
  .catch(function () {});

window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
  if (!storedTheme() && !themeCookieValue()) applyTheme(getSystemTheme(), true);
});
