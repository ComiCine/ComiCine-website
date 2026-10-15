/* ═══════════════════════════════════════════════════════════════
   服务详情弹层：打开 / 关闭
   ═══════════════════════════════════════════════════════════════ */

var lastServiceTrigger = null;

function openServiceDetail(id) {
    var modal = document.getElementById('modal-' + id);
    if (!modal) return;
    if (this && this.nodeType === 1 && this.matches('[data-action="openServiceDetail"]')) {
        lastServiceTrigger = this;
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    var closeButton = modal.querySelector('.modal-close');
    if (closeButton) closeButton.focus();
    // 点击服务选项：让地址栏渲染出 /#convention 或 /#outdoor
    if (location.hash !== '#' + id) location.hash = id;
}

/* 去除地址栏的整个 hash（连 # 一起），回到干净 URL */
function clearHash() {
    if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
    }
}

function closeServiceDetail() {
    document.querySelectorAll('.service-modal.open').forEach(function(modal) {
        modal.classList.remove('open');
    });
    document.body.style.overflow = '';
    clearHash();
    if (lastServiceTrigger && document.contains(lastServiceTrigger)) {
        lastServiceTrigger.focus();
    }
    lastServiceTrigger = null;
}

function serviceModalFocusables(modal) {
    return Array.prototype.slice.call(modal.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function(el) { return !el.hidden && el.offsetParent !== null; });
}

/* 键盘操作：卡片支持 Enter/Space，弹层支持 Escape 与焦点循环。 */
document.addEventListener('keydown', function(e) {
    var trigger = e.target.closest && e.target.closest('[data-action="openServiceDetail"]');
    if (trigger && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openServiceDetail.call(trigger, trigger.getAttribute('data-arg'));
        return;
    }
    var currencyPicker = document.getElementById('currency-picker');
    if (currencyPicker && !currencyPicker.hidden) return;
    var modal = document.querySelector('.service-modal.open');
    if (!modal) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        closeServiceDetail();
        return;
    }
    if (e.key !== 'Tab') return;
    var focusables = serviceModalFocusables(modal);
    if (!focusables.length) {
        e.preventDefault();
        return;
    }
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
});

/* 浏览器前进 / 后退时，让弹层与地址栏 hash 保持同步 */
window.addEventListener('hashchange', function() {
    var hash = location.hash.replace('#', '');
    if (hash === 'convention' || hash === 'outdoor') {
        openServiceDetail(hash);
    } else {
        closeServiceDetail();
    }
});

/* 从主页作品框带 #convention / #outdoor 进入时，直达对应服务弹层 */
(function() {
    var hash = location.hash.replace('#', '');
    if (hash === 'convention' || hash === 'outdoor') {
        openServiceDetail(hash);
    }
})();


/* 服务卡片级联淡入 */
setTimeout(function() {
    document.querySelectorAll('.reveal-item').forEach(function(el, i) {
        setTimeout(function() { el.classList.add('show'); }, i * 60);
    });
}, 100);

/* Currency display is informational only; CSV prices remain the CNY source of truth. */
(function() {
    var API_PATH = '/api/currency-rates';
    var CACHE_KEY = 'limooo-services-fx-v2';
    var PREFERENCE_KEY = 'limooo-services-currency-v1';
    var FRESH_MS = 6 * 60 * 60 * 1000;
    var MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
    var PRIORITY = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'HKD', 'TWD', 'SGD', 'AUD', 'CAD', 'CHF', 'INR', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'NZD', 'ZAR', 'BRL', 'MXN', 'AED', 'SAR'];

    var CURRENCY_SEARCH_DATA = window.LimoooCurrencySearchData || {};
    var CURRENCY_META = CURRENCY_SEARCH_DATA.currencies || {};
    var TERRITORY_CURRENCIES = CURRENCY_SEARCH_DATA.territories || {};
    var TERRITORY_ALIASES = CURRENCY_SEARCH_DATA.territoryAliases || {};
    var COUNTRY_ALIASES_BY_CURRENCY = Object.create(null);
    var REGIONS_BY_CURRENCY = Object.create(null);
    var regionNames = null;
    var currencyNames = null;
    if (typeof Intl.DisplayNames === 'function') {
        try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (_) {}
        try { currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' }); } catch (_) {}
    }

    var picker = document.getElementById('currency-picker');
    if (!picker) return;
    var search = document.getElementById('currency-search');
    var options = document.getElementById('currency-options');
    var status = document.getElementById('currency-picker-status');
    var selected = readPreference();
    var activeTrigger = null;
    var currencyData = readCache();
    var requestPromise = null;

    function translate(key, params) {
        return typeof window.limoooTranslate === 'function' ? window.limoooTranslate(key, params) : key;
    }

    function readPreference() {
        try {
            var value = localStorage.getItem(PREFERENCE_KEY);
            return /^[A-Z]{3}$/.test(value || '') ? value : 'CNY';
        } catch (_) { return 'CNY'; }
    }

    function savePreference(code) {
        selected = code;
        try { localStorage.setItem(PREFERENCE_KEY, code); } catch (_) { /* Private browsing may disable storage. */ }
    }

    function validCache(data) {
        if (!data || typeof data !== 'object' || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) return false;
        if (!Number.isFinite(data.savedAt) || !data.rates || !data.currencies) return false;
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
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) { /* Rates still work in memory. */ }
    }

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

    function localCurrencyMetadata(code) {
        var name = '';
        if (currencyNames) {
            try { name = currencyNames.of(code); } catch (_) {}
        }
        if (!name || name === code) name = code;
        return { name: name, symbol: currencySymbol(code) };
    }

    function reconcileSelection(data) {
        if (selected === 'CNY' || (data && Number.isFinite(data.rates[selected]) && data.rates[selected] > 0)) return;
        selected = 'CNY';
        try { localStorage.removeItem(PREFERENCE_KEY); } catch (_) { /* Ignore unavailable storage. */ }
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
                if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return;
                if (!date || item.date > date) date = item.date;
                rates[item.quote] = item.rate;
                rateDates[item.quote] = item.date;
                currencies[item.quote] = localCurrencyMetadata(item.quote);
            });
            if (!date || !Object.keys(rates).length) throw new Error('Currency rates missing or invalid');
            currencies.CNY = localCurrencyMetadata('CNY');
            rates.CNY = 1;
            var data = { date: date, savedAt: Date.now(), rates: rates, rateDates: rateDates, currencies: currencies };
            currencyData = data;
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
                renderOptions();
                applyReferences();
                updateStatus(data);
            }).catch(function() {});
            return Promise.resolve(currencyData);
        }
        return refreshData();
    }

    function updateStatus(data, failed) {
        if (failed) {
            status.textContent = translate('currency_api_unavailable');
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

    function buildCountrySearchIndex() {
        Object.keys(TERRITORY_CURRENCIES).forEach(function(region) {
            var name = '';
            try { name = regionNames ? regionNames.of(region) : ''; } catch (_) {}
            var aliases = [region, name].concat(TERRITORY_ALIASES[region] || []);
            TERRITORY_CURRENCIES[region].forEach(function(code) {
                if (!/^[A-Z]{3}$/.test(code)) return;
                if (!REGIONS_BY_CURRENCY[code]) REGIONS_BY_CURRENCY[code] = [];
                if (REGIONS_BY_CURRENCY[code].indexOf(region) === -1) REGIONS_BY_CURRENCY[code].push(region);
                aliases.forEach(function(alias) { addUnique(COUNTRY_ALIASES_BY_CURRENCY, code, alias); });
            });
        });
    }

    buildCountrySearchIndex();

    function currencyMetadata(code, data) {
        var apiMetadata = data && data.currencies[code];
        var fallback = localCurrencyMetadata(code);
        var name = apiMetadata && apiMetadata.name || fallback.name;
        var info = CURRENCY_META[code] || {};
        var regions = REGIONS_BY_CURRENCY[code] || [];
        var flag = info.flag || '';
        if (!flag && regions.length === 1 && /^[A-Z]{2}$/.test(regions[0])) {
            flag = String.fromCodePoint.apply(null, regions[0].split('').map(function(letter) {
                return 0x1F1E6 + letter.charCodeAt(0) - 65;
            }));
        }
        return { name: name, symbol: apiMetadata && apiMetadata.symbol || fallback.symbol, flag: flag };
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
        var rows = [];
        var codes = data ? Object.keys(data.rates) : [];
        if (codes.indexOf('CNY') === -1) codes.push('CNY');
        codes.sort(function(a, b) {
            var ai = PRIORITY.indexOf(a); var bi = PRIORITY.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
        });
        codes.forEach(function(code) {
            if (!/^[A-Z]{3}$/.test(code)) return;
            var metadata = currencyMetadata(code, data);
            var info = CURRENCY_META[code] || {};
            var countryAliases = COUNTRY_ALIASES_BY_CURRENCY[code] || [];
            var haystack = normalize([code, metadata.name, metadata.symbol, (info.aliases || []).join(' '), countryAliases.join(' '), code === 'CNY' ? '¥ 元' : ''].join(' '));
            var dollarSymbolMatch = query === '$' && (String(metadata.symbol || '').includes('$') || /\bdollars?\b/i.test(metadata.name));
            if (query && !matchesSearch(haystack, query) && !dollarSymbolMatch) return;
            rows.push(makeOption(code, data));
        });
        options.replaceChildren.apply(options, rows);
        if (!rows.length) {
            var empty = document.createElement('p');
            empty.className = 'currency-option-empty';
            empty.textContent = translate('currency_no_results');
            options.appendChild(empty);
        }
    }

    function applyReferences() {
        document.querySelectorAll('[data-price-box]').forEach(function(box) {
            var reference = box.nextElementSibling;
            if (!reference || !reference.matches('[data-currency-reference]')) return;
            reference.textContent = '';
            if (selected === 'CNY' || box.dataset.cnyPrice === undefined || !currencyData) return;
            var cny = Number(box.dataset.cnyPrice);
            var rate = currencyData.rates[selected];
            if (!Number.isFinite(cny) || cny < 0 || !Number.isFinite(rate) || rate <= 0) return;
            var amount = cny * rate;
            if (!Number.isFinite(amount)) return;
            var fractionDigits = 2;
            try {
                fractionDigits = new Intl.NumberFormat(document.documentElement.lang || 'en', { style: 'currency', currency: selected }).resolvedOptions().maximumFractionDigits;
            } catch (_) { return; }
            var formatted = new Intl.NumberFormat(document.documentElement.lang || 'en', {
                useGrouping: true,
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits
            }).format(amount);
            var rateDate = currencyData.rateDates && currencyData.rateDates[selected] || currencyData.date;
            reference.textContent = '≈ ' + formatted + ' ' + selected;
            reference.setAttribute('aria-label', 'Approximately ' + formatted + ' ' + selected + ', reference rate date ' + rateDate);
        });
    }

    function closePicker() {
        if (picker.hidden) return;
        picker.hidden = true;
        document.body.style.overflow = document.querySelector('.service-modal.open') ? 'hidden' : '';
        if (activeTrigger && document.contains(activeTrigger)) activeTrigger.focus();
        activeTrigger = null;
    }

    function openPicker(trigger) {
        activeTrigger = trigger;
        picker.hidden = false;
        document.body.style.overflow = 'hidden';
        search.value = '';
        renderOptions();
        updateStatus(currencyData);
        requestAnimationFrame(function() { search.focus(); });
        ensureData().then(function(data) {
            if (picker.hidden) return;
            currencyData = data;
            reconcileSelection(data);
            renderOptions();
            updateStatus(data);
            applyReferences();
        }).catch(function() {
            if (picker.hidden) return;
            renderOptions();
            updateStatus(currencyData, true);
        });
    }

    document.addEventListener('click', function(event) {
        var trigger = event.target.closest && event.target.closest('[data-currency-open]');
        if (trigger) {
            event.preventDefault();
            openPicker(trigger);
            return;
        }
        if (event.target.closest && event.target.closest('[data-currency-close]')) {
            closePicker();
            return;
        }
        var option = event.target.closest && event.target.closest('.currency-option');
        if (!option || option.disabled) {
            if (option && option.disabled) status.textContent = translate('currency_rate_unavailable');
            return;
        }
        var code = option.dataset.currencyCode;
        if (!/^[A-Z]{3}$/.test(code || '') || (code !== 'CNY' && (!currencyData || !Number.isFinite(currencyData.rates[code])))) return;
        savePreference(code);
        applyReferences();
        renderOptions();
        closePicker();
    });

    search.addEventListener('input', renderOptions);
    picker.querySelector('.currency-picker-panel').addEventListener('click', function(event) { event.stopPropagation(); });
    document.addEventListener('keydown', function(event) {
        if (picker.hidden) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closePicker();
            return;
        }
        if (event.key !== 'Tab') return;
        var focusable = Array.prototype.slice.call(picker.querySelectorAll('input:not([disabled]), button:not([disabled])'));
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
        }
    });

    ensureData().then(function(data) {
        currencyData = data;
        reconcileSelection(data);
        renderOptions();
        updateStatus(data);
        applyReferences();
    }).catch(function() {
        renderOptions();
        updateStatus(currencyData, true);
    });
})();
