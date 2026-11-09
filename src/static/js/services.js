/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/*
   Currency metadata lives in a separate classic script that only the currency picker needs.
   Keep window.ComiCineCurrencySearchData as the contract with that file, but load it on first
   use (opening a detail dialog) instead of making every visitor download it on first paint.
   */

var CURRENCY_DATA_URL = '/static/js/currency-data.js?v=2';
var currencyDataLoading = null;
var currencySearchDataAdopter = null;

function loadCurrencySearchData() {
    if (window.ComiCineCurrencySearchData) return Promise.resolve(window.ComiCineCurrencySearchData);
    if (currencyDataLoading) return currencyDataLoading;
    currencyDataLoading = new Promise(function(resolve) {
        var script = document.createElement('script');
        script.async = true;
        script.src = CURRENCY_DATA_URL;
        script.onload = function() {
            var data = window.ComiCineCurrencySearchData || null;
            if (data && currencySearchDataAdopter) currencySearchDataAdopter(data);
            resolve(data);
        };
        script.onerror = function() {
            if (script.parentNode) script.parentNode.removeChild(script);
            // Drop the memo so the next trigger retries instead of staying broken for the session.
            currencyDataLoading = null;
            resolve(null);
        };
        try {
            document.head.appendChild(script);
        } catch (_) {
            currencyDataLoading = null;
            resolve(null);
        }
    });
    return currencyDataLoading;
}

/*
   Service detail dialog: open and close.
   */

/* Only services.<root_domain> routes /convention and /outdoor; the main site serves the same
   markup at /services, where pushing those paths would 404 on reload. */
function isServicesHost() {
    var rootDomain = document.body.getAttribute('data-root-domain') || 'comicine.com';
    return location.hostname === 'services.' + rootDomain;
}

/* The card that owns a service id; also the focus/aria-expanded anchor for non-click opens. */
function serviceCard(id) {
    return document.querySelector('[data-action="openServiceDetail"][data-arg="' + id + '"]');
}

function openServiceModal(modal, trigger) {
    if (!modal) return;
    ComiCineDialog.open({
        root: modal,
        mode: 'class-open',
        trigger: trigger || undefined,
        onClose: function() {
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
    });
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    loadCurrencySearchData();
}

function openServiceDetail(id) {
    var modal = document.getElementById('modal-' + id);
    if (!modal) return;
    var trigger = this && this.nodeType === 1 && this.matches('[data-action="openServiceDetail"]') ? this : null;
    openServiceModal(modal, trigger);
    if (isServicesHost()) {
        var target = '/' + id;
        if (location.pathname !== target || location.hash) history.pushState(null, '', target);
    }
}

/* Close the dialog URL: /convention and /outdoor exist only on the services host. The main site
   keeps its /services path and only drops the hash, so a reload cannot land on a 404. */
function clearHash() {
    if (isServicesHost()) {
        if (location.pathname === '/convention' || location.pathname === '/outdoor') {
            history.replaceState(null, '', '/' + location.search);
        }
        return;
    }
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function closeServiceDetail() {
    document.querySelectorAll('.service-modal.open').forEach(function(modal) {
        ComiCineDialog.close(modal);
    });
    clearHash();
}

/* Keyboard support: Enter/Space opens a card. Escape and Tab trapping live in dialog.js. */
document.addEventListener('keydown', function(e) {
    var trigger = e.target.closest && e.target.closest('[data-action="openServiceDetail"]');
    if (trigger && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openServiceDetail.call(trigger, trigger.getAttribute('data-arg'));
    }
});

/* A nested layer (the currency picker) must close before the dialog it sits on. */
var closeNestedLayer = null;

/* Keep the dialog in sync with the URL when navigating backward or forward. */
window.addEventListener('popstate', function() {
    if (closeNestedLayer) closeNestedLayer();
    var route = location.pathname.replace(/^\/+|\/+$/g, '');
    var target = route === 'convention' || route === 'outdoor' ? route : '';
    if (!target && location.hash) target = location.hash.slice(1);
    var wanted = target === 'convention' || target === 'outdoor' ? document.getElementById('modal-' + target) : null;
    document.querySelectorAll('.service-modal.open').forEach(function(modal) {
        if (modal !== wanted) ComiCineDialog.close(modal);
    });
    if (wanted && !ComiCineDialog.isOpen(wanted)) {
        openServiceModal(wanted, serviceCard(target));
    }
});

/* Open the matching service dialog when arriving from a home card or a legacy hash link. */
(function() {
    var route = location.pathname.replace(/^\/+|\/+$/g, '');
    var id = route === 'convention' || route === 'outdoor' ? route : location.hash.slice(1);
    if (id !== 'convention' && id !== 'outdoor') return;
    var modal = document.getElementById('modal-' + id);
    if (!modal) return;
    if (isServicesHost() && location.hash) history.replaceState(null, '', '/' + id + location.search);
    openServiceModal(modal, serviceCard(id));
})();


/* Fade in service cards in sequence. */
setTimeout(function() {
    document.querySelectorAll('.reveal-item').forEach(function(el, i) {
        setTimeout(function() { el.classList.add('show'); }, i * 60);
    });
}, 100);

/* Currency display is informational only; CSV prices remain the CNY source of truth. */
(function() {
    var API_PATH = '/api/currency-rates';
    var CACHE_KEY = 'comicine-services-fx-v2';
    // The chosen currency is stored on its own so clearing the rate cache keeps the selection.
    var SELECTION_KEY = 'comicine-services-currency';
    var FRESH_MS = 6 * 60 * 60 * 1000;
    var MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
    var PRIORITY = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'HKD', 'TWD', 'SGD', 'AUD', 'CAD', 'CHF', 'INR', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'NZD', 'ZAR', 'BRL', 'MXN', 'AED', 'SAR'];

    // Filled by adoptCurrencySearchData() when the deferred metadata script arrives. Until then the
    // picker still works from the rates payload and Intl.DisplayNames, just without flags and aliases.
    var CURRENCY_META = Object.create(null);
    var TERRITORY_CURRENCIES = Object.create(null);
    var TERRITORY_ALIASES = Object.create(null);
    var COUNTRY_ALIASES_BY_CURRENCY = Object.create(null);
    var REGIONS_BY_CURRENCY = Object.create(null);
    var regionNames = null;
    var currencyNames = null;
    var englishCurrencyNames = null;
    if (typeof Intl.DisplayNames === 'function') {
        try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}
        try { currencyNames = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'currency' }); } catch (_) {}
        try { englishCurrencyNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (_) {}
    }

    var picker = document.getElementById('currency-picker');
    if (!picker) return;
    var search = document.getElementById('currency-search');
    var options = document.getElementById('currency-options');
    var status = document.getElementById('currency-picker-status');
    var selected = readStoredCurrency();
    var optionsRenderScheduled = false;
    var currencyData = readCache();
    var requestPromise = null;
    var ratesFailed = false;
    var savedSelectionUnavailable = false;
    var currencyMetadataCache = Object.create(null);
    var cachedFormatterCode = '';
    var cachedFormatterLocale = '';
    var cachedAmountFormatter = null;
    var renderedData = null;
    var renderedQuery = null;
    var renderedSelection = null;
    var renderedCountryIndexReady = false;
    var countrySearchIndexReady = false;
    var countrySearchIndexScheduled = false;
    var renderGeneration = 0;

    function translate(key, params) {
        var translate = window.comicineTranslate;
        return typeof translate === 'function' ? translate(key, params) : key;
    }

    function readStoredCurrency() {
        try {
            var raw = localStorage.getItem(SELECTION_KEY);
            var code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
            return /^[A-Z]{3}$/.test(code) ? code : null;
        } catch (_) {
            // Safari private mode can throw on access; an unreadable store is the same as "no choice".
            return null;
        }
    }

    function writeStoredCurrency(code) {
        try {
            if (/^[A-Z]{3}$/.test(code || '')) localStorage.setItem(SELECTION_KEY, code);
            else localStorage.removeItem(SELECTION_KEY);
        } catch (_) {
            // A full quota or private mode must not break the current session's selection.
        }
    }

    function setSelectedCurrency(code) {
        selected = code;
        writeStoredCurrency(code);
    }

    function validRateDate(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        var date = new Date(value + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }

    function validCache(data) {
        if (!data || typeof data !== 'object' || !validRateDate(data.date)) return false;
        if (!Number.isFinite(data.savedAt)) return false;
        if (!data.rates || typeof data.rates !== 'object' || Array.isArray(data.rates)) return false;
        if (!data.currencies || typeof data.currencies !== 'object' || Array.isArray(data.currencies)) return false;
        var codes = Object.keys(data.rates);
        if (data.rates.CNY !== 1 || !codes.some(function(code) { return code !== 'CNY'; })) return false;
        if (codes.some(function(code) {
            return !/^[A-Z]{3}$/.test(code) || !Number.isFinite(data.rates[code]) || data.rates[code] <= 0;
        })) return false;
        var age = Math.max(0, Date.now() - data.savedAt);
        if (age > MAX_STALE_MS || data.savedAt - Date.now() > FRESH_MS) return false;
        return true;
    }

    function readCache() {
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return validCache(parsed) ? parsed : null;
        } catch (_) { return null; }
    }

    function saveCache(data) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (_) { /* Rates still work in memory. */ }
    }

    /*
       Take over the deferred currency metadata: replace the empty tables, rebuild the country search
       index from scratch, and re-render the options with flags and aliases.
       */
    function adoptCurrencySearchData(data) {
        if (!data || typeof data !== 'object') return;
        CURRENCY_META = data.currencies || Object.create(null);
        TERRITORY_CURRENCIES = data.territories || Object.create(null);
        TERRITORY_ALIASES = data.territoryAliases || Object.create(null);
        REGIONS_BY_CURRENCY = Object.create(null);
        COUNTRY_ALIASES_BY_CURRENCY = Object.create(null);
        territoryCodes = Object.keys(TERRITORY_CURRENCIES);
        territoryIndexCursor = 0;
        countrySearchIndexReady = false;
        countrySearchIndexScheduled = false;
        currencyMetadataCache = Object.create(null);
        renderedData = null;
        scheduleCountrySearchIndex();
        scheduleRenderOptions(true);
    }

    currencySearchDataAdopter = adoptCurrencySearchData;
    if (window.ComiCineCurrencySearchData) adoptCurrencySearchData(window.ComiCineCurrencySearchData);

    function fetchJson(url, signal) {
        return fetch(url, { headers: { Accept: 'application/json' }, signal: signal }).then(function(response) {
            if (!response.ok) throw new Error('Rates HTTP ' + response.status);
            return response.json();
        });
    }

    var SYMBOLS_BY_CURRENCY = Object.create(null);

    function currencySymbol(code) {
        if (Object.prototype.hasOwnProperty.call(SYMBOLS_BY_CURRENCY, code)) return SYMBOLS_BY_CURRENCY[code];
        var symbol = '';
        try {
            var part = new Intl.NumberFormat('en', { style: 'currency', currency: code })
                .formatToParts(1)
                .filter(function(item) { return item.type === 'currency'; })[0];
            if (part && part.value !== code) symbol = part.value;
        } catch (_) {}
        SYMBOLS_BY_CURRENCY[code] = symbol;
        return symbol;
    }

    function localCurrencyMetadata(code, includeSymbol) {
        var metadata = currencyMetadataCache[code];
        if (!metadata) {
            var name = '';
            var englishName = '';
            if (currencyNames) {
                try { name = currencyNames.of(code); } catch (_) {}
            }
            if (englishCurrencyNames) {
                try { englishName = englishCurrencyNames.of(code); } catch (_) {}
            }
            if (!englishName || englishName === code) englishName = code;
            if (!name || name === code) name = englishName;
            metadata = { name: name, englishName: englishName };
            currencyMetadataCache[code] = metadata;
        }
        if (includeSymbol && !Object.prototype.hasOwnProperty.call(metadata, 'symbol')) {
            metadata.symbol = currencySymbol(code);
        }
        return metadata;
    }

    /*
       Drop a stored currency only once rates prove it has no valid rate. Without rates (offline,
       API failure) keep the stored choice, so a transient failure does not silently reset it.
       */
    function reconcileSelection(data, persist) {
        if (!selected || selected === 'CNY' || !data || !data.rates) return;
        if (Number.isFinite(data.rates[selected]) && data.rates[selected] > 0) return;
        selected = null;
        // A cross-tab sync already saw the other tab's value; writing back would echo it around.
        if (persist !== false) writeStoredCurrency('CNY');
        savedSelectionUnavailable = true;
    }

    function refreshData() {
        if (requestPromise) return requestPromise;
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 12000);
        requestPromise = fetchJson(API_PATH, controller.signal).then(function(response) {
            if (!Array.isArray(response) || !response.length) throw new Error('Invalid currency rates response');
            var currencies = Object.create(null);
            var rates = Object.create(null);
            var rateDates = Object.create(null);
            var date = '';
            response.forEach(function(item) {
                if (!item || item.base !== 'CNY' || typeof item.quote !== 'string' || !/^[A-Z]{3}$/.test(item.quote)) return;
                if (item.quote === 'CNY' || !Number.isFinite(item.rate) || item.rate <= 0 || rates[item.quote]) return;
                if (!validRateDate(item.date)) return;
                if (!date || item.date > date) date = item.date;
                rates[item.quote] = item.rate;
                rateDates[item.quote] = item.date;
            });
            if (!date || !Object.keys(rates).length) throw new Error('Currency rates missing or invalid');
            currencies.CNY = localCurrencyMetadata('CNY');
            rates.CNY = 1;
            var data = { date: date, savedAt: Date.now(), rates: rates, rateDates: rateDates, currencies: currencies };
            currencyData = data;
            ratesFailed = false;
            saveCache(data);
            reconcileSelection(data);
            return data;
        }).finally(function() {
            clearTimeout(timeout);
            requestPromise = null;
        });
        return requestPromise;
    }

    function ensureData() {
        if (currencyData && Date.now() - currencyData.savedAt <= FRESH_MS) return Promise.resolve(currencyData);
        if (currencyData) {
            refreshData().then(function(data) {
                reconcileSelection(data);
                scheduleRenderOptions(true);
                applyReferences();
                if (!picker.hidden) updateStatus(data);
            }).catch(function() {
                // A stale cache still renders reference prices; say so instead of silently pretending
                // the rates are current. Only the copy changes, the cached amounts stay usable.
                ratesFailed = true;
                reconcileSelection(currencyData);
                scheduleRenderOptions(true);
                if (!picker.hidden) updateStatus(currencyData, true);
            });
            return Promise.resolve(currencyData);
        }
        return refreshData();
    }

    var lastStatus = { data: null, failed: false };

    function updateStatus(data, failed) {
        lastStatus = { data: data || null, failed: failed === true };
        // The rate date is data, not a static dictionary entry; drop the key so base.js
        // does not reset it to "Loading..." on the next language change.
        status.removeAttribute('data-i18n');
        if (savedSelectionUnavailable && !picker.hidden) {
            // One-time notice: the currency saved last visit has no rate any more. It wins over the
            // rate status because the user needs to know why their choice changed.
            savedSelectionUnavailable = false;
            status.textContent = translate('currency_saved_unavailable');
            return;
        }
        if (failed) {
            // Distinguish "stale but usable cached rates" from "no rates at all".
            status.textContent = data
                ? translate('currency_cached_rates', { date: data.date })
                : translate('currency_api_unavailable');
            return;
        }
        if (data) status.textContent = translate('currency_rate_date', { date: data.date });
        else status.textContent = translate('currency_loading');
    }

    function normalize(value) {
        return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
    }

    function addUnique(map, key, value) {
        if (!value) return;
        if (!map[key]) map[key] = [];
        var normalized = normalize(value);
        if (!normalized || map[key].some(function(item) { return normalize(item) === normalized; })) return;
        map[key].push(value);
    }

    var territoryCodes = [];
    var territoryIndexCursor = 0;

    function indexTerritory(region) {
            var name = '';
            try { name = regionNames ? regionNames.of(region) : ''; } catch (_) {}
            var aliases = [region, name].concat(TERRITORY_ALIASES[region] || []);
            TERRITORY_CURRENCIES[region].forEach(function(code) {
                if (!/^[A-Z]{3}$/.test(code)) return;
                if (!REGIONS_BY_CURRENCY[code]) REGIONS_BY_CURRENCY[code] = [];
                if (REGIONS_BY_CURRENCY[code].indexOf(region) === -1) REGIONS_BY_CURRENCY[code].push(region);
                aliases.forEach(function(alias) { addUnique(COUNTRY_ALIASES_BY_CURRENCY, code, alias); });
            });
    }

    function scheduleCountrySearchIndex() {
        if (countrySearchIndexReady || countrySearchIndexScheduled) return;
        countrySearchIndexScheduled = true;
        function processChunk() {
            var end = Math.min(territoryIndexCursor + 24, territoryCodes.length);
            while (territoryIndexCursor < end) {
                indexTerritory(territoryCodes[territoryIndexCursor]);
                territoryIndexCursor += 1;
            }
            if (territoryIndexCursor < territoryCodes.length) {
                if (typeof window.requestIdleCallback === 'function') {
                    window.requestIdleCallback(processChunk, { timeout: 500 });
                } else {
                    window.setTimeout(processChunk, 0);
                }
                return;
            }
            countrySearchIndexReady = true;
            countrySearchIndexScheduled = false;
            scheduleRenderOptions(true);
        }
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(processChunk, { timeout: 500 });
        } else {
            window.setTimeout(processChunk, 0);
        }
    }

    function currencyMetadata(code, data, includeSymbol) {
        var apiMetadata = data && data.currencies[code];
        var fallback = localCurrencyMetadata(code, includeSymbol);
        var name = fallback.name !== code ? fallback.name : apiMetadata && apiMetadata.name || fallback.name;
        var info = CURRENCY_META[code] || {};
        var regions = REGIONS_BY_CURRENCY[code] || [];
        var flag = info.flag || '';
        if (!flag && regions.length === 1 && /^[A-Z]{2}$/.test(regions[0])) {
            flag = String.fromCodePoint.apply(null, regions[0].split('').map(function(letter) {
                return 0x1F1E6 + letter.charCodeAt(0) - 65;
            }));
        }
        return {
            name: name,
            englishName: fallback.englishName && fallback.englishName !== code ? fallback.englishName : apiMetadata && apiMetadata.name || name,
            symbol: apiMetadata && apiMetadata.symbol || fallback.symbol || '',
            flag: flag
        };
    }

    function matchesSearch(haystack, query) {
        if (haystack.includes(query)) return true;
        var words = query.split(/\s+/).filter(Boolean);
        return words.length > 1 && words.every(function(word) { return haystack.includes(word); });
    }

    function makeOption(code, data) {
        var info = currencyMetadata(code, data);
        var row = document.createElement('button');
        var available = code === 'CNY' || !!(data && Number.isFinite(data.rates[code]) && data.rates[code] > 0);
        row.type = 'button';
        row.className = 'currency-option';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', selected === code ? 'true' : 'false');
        row.dataset.currencyCode = code;
        row.disabled = !available;
        var flag = document.createElement('span');
        flag.className = 'currency-option-flag';
        flag.setAttribute('aria-hidden', 'true');
        flag.textContent = info.flag || '';
        var codeLabel = document.createElement('span');
        codeLabel.className = 'currency-option-code';
        codeLabel.textContent = code;
        var name = document.createElement('span');
        name.className = 'currency-option-name';
        name.textContent = info.name;
        row.setAttribute('aria-label', (info.flag ? info.flag + ' ' : '') + code + ', ' + info.name);
        row.appendChild(flag);
        row.appendChild(codeLabel);
        row.appendChild(name);
        if (selected === code) {
            var check = document.createElement('span');
            check.className = 'currency-option-selected';
            check.setAttribute('aria-hidden', 'true');
            check.textContent = '✓';
            row.appendChild(check);
        }
        return row;
    }

    function renderOptions() {
        var data = currencyData;
        var query = normalize(search.value);
        if (data === renderedData && query === renderedQuery && selected === renderedSelection && countrySearchIndexReady === renderedCountryIndexReady) return;
        var codes = data ? Object.keys(data.rates) : Object.keys(CURRENCY_META);
        if (!data) {
            Object.keys(TERRITORY_CURRENCIES).forEach(function(region) {
                TERRITORY_CURRENCIES[region].forEach(function(code) {
                    if (codes.indexOf(code) === -1) codes.push(code);
                });
            });
        }
        if (codes.indexOf('CNY') === -1) codes.push('CNY');
        codes.sort(function(a, b) {
            var ai = PRIORITY.indexOf(a); var bi = PRIORITY.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
        var includeSymbols = /[$£€¥￥₩₹฿₫₱₪₦₵₡₲₴₭₮₺₸₽₨₼₾¢₿]/.test(query);
        var generation = ++renderGeneration;
        var cursor = 0;
        var matchCount = 0;
        options.replaceChildren();
        renderedData = data;
        renderedQuery = query;
        renderedSelection = selected;
        renderedCountryIndexReady = countrySearchIndexReady;

        function renderBatch() {
            if (generation !== renderGeneration) return;
            var fragment = document.createDocumentFragment();
            var end = Math.min(cursor + 24, codes.length);
            while (cursor < end) {
                var code = codes[cursor++];
                if (!/^[A-Z]{3}$/.test(code)) continue;
                var metadata = currencyMetadata(code, data, includeSymbols);
                var info = CURRENCY_META[code] || {};
                var countryAliases = COUNTRY_ALIASES_BY_CURRENCY[code] || [];
                var haystack = normalize([code, metadata.name, metadata.englishName, metadata.symbol, (info.aliases || []).join(' '), countryAliases.join(' '), code === 'CNY' ? '¥ 元' : ''].join(' '));
                var dollarSymbolMatch = query === '$' && (String(metadata.symbol || '').includes('$') || /\bdollars?\b/i.test(metadata.englishName));
                if (query && !matchesSearch(haystack, query) && !dollarSymbolMatch) continue;
                fragment.appendChild(makeOption(code, data));
                matchCount += 1;
            }
            if (fragment.childNodes.length) options.appendChild(fragment);
            if (cursor < codes.length) {
                window.setTimeout(renderBatch, 0);
                return;
            }
            if (!matchCount && generation === renderGeneration) {
                var empty = document.createElement('p');
                empty.className = 'currency-option-empty';
                empty.textContent = translate('currency_no_results');
                options.appendChild(empty);
            }
        }

        renderBatch();
    }

    function scheduleRenderOptions(preload) {
        if (optionsRenderScheduled || (picker.hidden && !preload)) return;
        optionsRenderScheduled = true;
        window.requestAnimationFrame(function() {
            window.setTimeout(function() {
                optionsRenderScheduled = false;
                if (picker.hidden && !preload) return;
                renderOptions();
            }, 0);
        });
    }

    function amountFormatter(code) {
        var locale = document.documentElement.lang || 'en';
        if (code !== cachedFormatterCode || locale !== cachedFormatterLocale) {
            var currencyFormatter = new Intl.NumberFormat(locale, { style: 'currency', currency: code });
            var fractionDigits = currencyFormatter.resolvedOptions().maximumFractionDigits;
            cachedAmountFormatter = new Intl.NumberFormat(locale, {
                useGrouping: true,
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits
            });
            cachedFormatterCode = code;
            cachedFormatterLocale = locale;
        }
        return cachedAmountFormatter;
    }

    function applyReferences() {
        var updates = [];
        document.querySelectorAll('[data-price-box]').forEach(function(box) {
            var reference = box.nextElementSibling;
            if (!reference || !reference.matches('[data-currency-reference]')) return;
            var text = '';
            var label = '';
            if (selected && selected !== 'CNY' && box.dataset.cnyPrice !== undefined && currencyData) {
                var cny = Number(box.dataset.cnyPrice);
                var rate = currencyData.rates[selected];
                if (Number.isFinite(cny) && cny >= 0 && Number.isFinite(rate) && rate > 0) {
                    var amount = cny * rate;
                    if (Number.isFinite(amount)) {
                        try {
                            var formatted = amountFormatter(selected).format(amount);
                            var rateDate = currencyData.rateDates && currencyData.rateDates[selected] || currencyData.date;
                            text = '≈ ' + selected + ' ' + formatted;
                            label = translate('currency_reference_label', { code: selected, amount: formatted, date: rateDate });
                        } catch (_) {}
                    }
                }
            }
            updates.push({ reference: reference, text: text, label: label });
        });
        updates.forEach(function(update) {
            var reference = update.reference;
            if (reference.textContent !== update.text) reference.textContent = update.text;
            if (update.label) {
                if (reference.getAttribute('aria-label') !== update.label) reference.setAttribute('aria-label', update.label);
            } else if (reference.hasAttribute('aria-label')) {
                reference.removeAttribute('aria-label');
            }
        });
    }

    function closePicker() {
        if (picker.hidden) return;
        // dialog.js owns visibility, the scroll lock, focus restore and the nested-layer stack.
        ComiCineDialog.close(picker);
    }

    function syncRenderedSelection() {
        var previous = options.querySelector('.currency-option[aria-selected="true"]');
        if (previous && previous.dataset.currencyCode === selected) {
            renderedSelection = selected;
            return;
        }
        if (previous) {
            previous.setAttribute('aria-selected', 'false');
            var previousMark = previous.querySelector('.currency-option-selected');
            if (previousMark) previousMark.remove();
        }
        var current = options.querySelector('[data-currency-code="' + selected + '"]');
        if (current) {
            current.setAttribute('aria-selected', 'true');
            var mark = document.createElement('span');
            mark.className = 'currency-option-selected';
            mark.setAttribute('aria-hidden', 'true');
            mark.textContent = '✓';
            current.appendChild(mark);
        }
        renderedSelection = selected;
    }

    function openPicker(trigger) {
        search.value = '';
        ComiCineDialog.open({
            root: picker,
            dialog: picker.querySelector('.currency-picker-panel'),
            mode: 'attr-hidden',
            trigger: trigger,
            initialFocus: search
        });
        updateStatus(currencyData, ratesFailed);
        scheduleRenderOptions();
    }

    document.addEventListener('click', function(event) {
        var trigger = event.target.closest && event.target.closest('[data-currency-open]');
        if (trigger) {
            event.preventDefault();
            openPicker(trigger);
            loadCurrencySearchData();
            return;
        }
    });

    picker.addEventListener('click', function(event) {
        var closeTrigger = event.target.closest && event.target.closest('[data-currency-close]');
        if (closeTrigger) {
            closePicker();
            return;
        }
        var option = event.target.closest && event.target.closest('.currency-option');
        if (!option || option.disabled) {
            if (option && option.disabled) ComiCineDialog.announce(picker, translate('currency_rate_unavailable'));
            return;
        }
        var code = option.dataset.currencyCode;
        if (!/^[A-Z]{3}$/.test(code || '') || (code !== 'CNY' && ratesFailed && (!currencyData || !Number.isFinite(currencyData.rates[code])))) return;
        setSelectedCurrency(code);
        syncRenderedSelection();
        applyReferences();
        closePicker();
    });

    search.addEventListener('input', function() { scheduleRenderOptions(); });

    // Registered on the top-level popstate handler so the picker closes before the dialog under it.
    closeNestedLayer = function() {
        if (!picker.hidden) closePicker();
    };

    // Another tab changed the currency: mirror it without requesting rates or writing back.
    window.addEventListener('storage', function(event) {
        if (event.key !== null && event.key !== SELECTION_KEY) return;
        var code = readStoredCurrency();
        if (code === selected) return;
        selected = code;
        reconcileSelection(currencyData, false);
        renderedData = null;
        scheduleRenderOptions(true);
        applyReferences();
        if (!picker.hidden) syncRenderedSelection();
    });

    // Re-render labels when the page language changes: names come from Intl.DisplayNames and
    // the status line carries the rate date, so both must be rebuilt rather than reloaded.
    document.addEventListener('languagechange', function() {
        try {
            currencyNames = typeof Intl.DisplayNames === 'function'
                ? new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'currency' })
                : null;
        } catch (_) { currencyNames = null; }
        currencyMetadataCache = Object.create(null);
        renderedData = null;
        updateStatus(lastStatus.data, lastStatus.failed);
        scheduleRenderOptions(true);
        applyReferences();
    });

    scheduleCountrySearchIndex();
    scheduleRenderOptions(true);
    ensureData().then(function(data) {
        currencyData = data;
        reconcileSelection(data);
        scheduleRenderOptions(true);
        updateStatus(data);
        applyReferences();
    }).catch(function() {
        ratesFailed = true;
        reconcileSelection(currencyData);
        scheduleRenderOptions(true);
        updateStatus(currencyData, true);
    });
})();
