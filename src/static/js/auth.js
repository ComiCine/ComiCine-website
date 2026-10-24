/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
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
var ROOT_DOMAIN = gateBodyAttr('data-root-domain', 'limooo.cn');
var LANG_COOKIE = gateBodyAttr('data-lang-cookie', 'user_lang_preference');
var LANG_COOKIE_MAX_AGE = gateBodyAttr('data-lang-cookie-max-age', '31536000');
var THEME_COOKIE = gateBodyAttr('data-theme-cookie', 'limooo_theme');
var THEME_COOKIE_MAX_AGE = gateBodyAttr('data-theme-cookie-max-age', '31536000');
function sharedCookieDomain() {
  return location.hostname === ROOT_DOMAIN || location.hostname.endsWith('.' + ROOT_DOMAIN)
    ? '; domain=.' + ROOT_DOMAIN
    : '';
}
var CURRENT_LANG = gateBodyAttr('data-lang', DEFAULT_LANG);
var gateVerificationInFlight = false;
document.documentElement.lang = CURRENT_LANG;

/* Build time embeds gate copy for all four languages in the HTML; /gate/config only supplies the sitekey.
   Language switching and initial copy therefore still work if the runtime config endpoint is unavailable. */
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

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function effectiveTheme() {
  var saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved;
  var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + THEME_COOKIE + '=(light|dark)'));
  return match ? match[1] : getSystemTheme();
}

function saveTheme(theme) {
  localStorage.setItem('theme', theme);
  var secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = THEME_COOKIE + '=' + theme + '; path=/; max-age=' + THEME_COOKIE_MAX_AGE
    + '; SameSite=Lax' + secure + sharedCookieDomain();
}

function applyTheme(theme) {
  document.documentElement.classList.toggle('light-mode', theme === 'light');
  var schemeMeta = document.querySelector('meta[name="color-scheme"]');
  if (schemeMeta) schemeMeta.content = theme;
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.content = getComputedStyle(document.documentElement).getPropertyValue('--browser-theme-color').trim();
  var sw = document.querySelector('.appearance-switch');
  if (sw) sw.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
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

/* Wrap brand names such as "Limooo" in a Baloo 2 span for every language variant. */
function brandifyText(el) {
  var word = el.getAttribute('data-brandify');
  if (!word || !el.textContent || el.textContent.indexOf(word) === -1) return;
  if (el.querySelector('.brand-word')) return;
  el.innerHTML = el.textContent.split(word).join('<span class="brand-word">' + word + '</span>');
}

function resetTurnstile() {
  var wrap = document.getElementById('turnstile-wrap');
  if (!wrap) return;
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
    callback: submitGateVerification,
    'error-callback': function () {
      showError('failed');
      return true; /* Stop Turnstile from retrying automatically; let the user retry manually. */
    },
    'expired-callback': function () { showError('failed'); },
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
        /* Navigate from this page directly to the original target, without redirect.limooo.cn. */
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

function renderI18n() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    var text = t(el.getAttribute('data-i18n'));
    var key = el.getAttribute('data-i18n');
    if (text === key) return; /* Keep the server-rendered copy until the dictionary loads. */
    var prefix = el.getAttribute('data-i18n-prefix');
    if (prefix != null) text = text ? prefix + text : '';
    el.textContent = text;
    brandifyText(el);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
    var text = t(el.getAttribute('data-i18n-html'));
    if (text !== el.getAttribute('data-i18n-html')) el.innerHTML = text;
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
    el.getAttribute('data-i18n-attr').split('|').forEach(function (seg) {
      var colon = seg.indexOf(':');
      if (colon === -1) return;
      var key = seg.slice(colon + 1).split(';')[0];
      seg.slice(0, colon).split(',').forEach(function (attr) {
        var value = t(key);
        if (value !== key) el.setAttribute(attr.trim(), value);
      });
    });
  });
}

function saveLangCookie(code) {
  /* The root domain comes from /gate/config and <body data-root-domain>; prefer runtime config. */
  var rootDomain = (CONFIG && CONFIG.root_domain) || ROOT_DOMAIN;
  var domain = rootDomain && (location.hostname === rootDomain || location.hostname.endsWith('.' + rootDomain))
    ? '; domain=.' + rootDomain
    : '';
  var secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = LANG_COOKIE + '=' + code + '; path=/; max-age=' + LANG_COOKIE_MAX_AGE
    + '; SameSite=Lax' + secure + domain;
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
          lang_aria: 'gate_lang_aria', theme_aria: 'gate_theme_aria',
          footer_rights: 'footer_rights', footer_source: 'footer_source', footer_source_link: 'footer_source_link',
          error_sitekey: 'gate_error_sitekey', error_invalid: 'gate_error_invalid',
          error_unavailable: 'gate_error_unavailable', error_failed: 'gate_error_failed',
          error_blocked: 'gate_error_blocked', error_blocked_detail: 'gate_error_blocked_detail'
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

function applyLang(lang) {
  if (!GATE_I18N[lang]) {
    fetchI18n(lang, function (d) {
      if (!d) {
        saveLangCookie(lang);
        location.reload(); /* If the dictionary endpoint also fails, let the server render the selected language from the cookie. */
        return;
      }
      applyLang(lang);
    });
    return;
  }
  if (lang !== CURRENT_LANG) {
    CURRENT_LANG = lang;
    document.documentElement.lang = lang;
    renderI18n();
    document.querySelectorAll('#langMenu .theme-option').forEach(function (opt) {
      opt.classList.toggle('selected', opt.dataset.lang === lang);
    });
  }
  saveLangCookie(lang);
  resetTurnstile();
}

function toggleLangMenu(e) {
  if (e) e.stopPropagation();
  var m = document.getElementById('langMenu');
  if (m) m.classList.toggle('open');
}

function closeLangMenu() {
  var m = document.getElementById('langMenu');
  if (m) m.classList.remove('open');
}

function setLang(code) {
  closeLangMenu();
  applyLang(code);
}

function toggleTheme() {
  var next = effectiveTheme() === 'light' ? 'dark' : 'light';
  saveTheme(next);
  applyTheme(next);
  resetTurnstile();
}

function onloadTurnstileCallback() {
  resetTurnstile();
}

function initGateConfig(cfg) {
  CONFIG = cfg;
  GATE_I18N = cfg.i18n || GATE_I18N;
  TURNSTILE_SITEKEY = cfg.sitekey || '';
  CURRENT_LANG = cfg.lang || CURRENT_LANG;
  document.documentElement.lang = CURRENT_LANG;
  applyTheme(effectiveTheme());
  renderI18n();
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

(function bindLangHover() {
  var fly = document.querySelector('.lang-flyout');
  if (!fly) return;
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    fly.addEventListener('mouseenter', function () {
      var m = document.getElementById('langMenu');
      if (m) m.classList.add('open');
    });
    fly.addEventListener('mouseleave', closeLangMenu);
  }
})();

document.addEventListener('click', function (e) {
  if (!e.target.closest('.theme-toggle')) closeLangMenu();
});

/* Render static copy in the build language first; runtime config adds Turnstile and language switching. */
applyTheme(effectiveTheme());
renderI18n();
/* Keep the Baloo 2 brand rendering in the static fallback when i18n is unavailable. */
var staticBrandTarget = document.querySelector('[data-brandify]');
if (staticBrandTarget) brandifyText(staticBrandTarget);
showError(document.body.getAttribute('data-gate-error') || '');

fetch('/gate/config', { headers: { 'Accept': 'application/json' } })
  .then(function (r) { return r.ok ? r.json() : null; })
  .then(function (cfg) { if (cfg) initGateConfig(cfg); })
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
  if (!localStorage.getItem('theme')) applyTheme(getSystemTheme());
});
