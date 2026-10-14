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
    var API_ROOT = 'https://api.frankfurter.dev/v2';
    var CACHE_KEY = 'limooo-services-fx-v1';
    var PREFERENCE_KEY = 'limooo-services-currency-v1';
    var FRESH_MS = 6 * 60 * 60 * 1000;
    var MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
    var PRIORITY = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'KRW', 'HKD', 'TWD', 'SGD', 'AUD', 'CAD', 'CHF', 'INR', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'NZD', 'ZAR', 'BRL', 'MXN', 'AED', 'SAR'];

    /* Flags and country aliases are explicit UI metadata; API currencies/rates validate every code. */
    var CURRENCY_META = {
        CNY: { flag: '🇨🇳', aliases: ['China', 'Mainland China', '中国', '中国大陆'] },
        USD: { flag: '🇺🇸', aliases: ['United States', 'United States of America', 'US', 'USA', 'America', '美国'] },
        EUR: { flag: '🇪🇺', aliases: [
            'Eurozone', 'Euro area', 'European Union', 'EU', 'Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Cyprus', 'Estonia',
            'Finland', 'France', 'Germany', 'Greece', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta',
            'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain', 'Andorra', 'Monaco', 'San Marino', 'Vatican City',
            'Holy See', 'Kosovo', 'Montenegro', '欧元区', '欧盟'
        ] },
        GBP: { flag: '🇬🇧', aliases: ['United Kingdom', 'UK', 'Britain', 'Great Britain', 'British', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Pound', 'Pounds', 'Pound Sterling', 'Sterling', '£', '英国', '英國'] },
        JPY: { flag: '🇯🇵', aliases: ['Japan', '日本', '日本国'] },
        KRW: { flag: '🇰🇷', aliases: ['South Korea', 'Republic of Korea', 'Korea', '대한민국', '한국'] },
        HKD: { flag: '🇭🇰', aliases: ['Hong Kong', 'Hong Kong SAR', '香港'] },
        TWD: { flag: '🇹🇼', aliases: ['Taiwan', 'Taiwan, China', '台湾', '臺灣'] },
        SGD: { flag: '🇸🇬', aliases: ['Singapore', '新加坡'] },
        AUD: { flag: '🇦🇺', aliases: ['Australia', '澳大利亚', '澳洲'] },
        CAD: { flag: '🇨🇦', aliases: ['Canada', '加拿大'] },
        CHF: { flag: '🇨🇭', aliases: ['Switzerland', 'Swiss', '瑞士'] },
        INR: { flag: '🇮🇳', aliases: ['India', '印度'] },
        THB: { flag: '🇹🇭', aliases: ['Thailand', '泰国', '泰國'] },
        MYR: { flag: '🇲🇾', aliases: ['Malaysia', '马来西亚', '馬來西亞'] },
        IDR: { flag: '🇮🇩', aliases: ['Indonesia', '印度尼西亚', '印尼'] },
        PHP: { flag: '🇵🇭', aliases: ['Philippines', '菲律宾', '菲律賓'] },
        VND: { flag: '🇻🇳', aliases: ['Vietnam', 'Viet Nam', '越南'] },
        NZD: { flag: '🇳🇿', aliases: ['New Zealand', '新西兰', '紐西蘭'] },
        ZAR: { flag: '🇿🇦', aliases: ['South Africa', '南非'] },
        BRL: { flag: '🇧🇷', aliases: ['Brazil', '巴西'] },
        MXN: { flag: '🇲🇽', aliases: ['Mexico', 'México', '墨西哥'] },
        AED: { flag: '🇦🇪', aliases: ['United Arab Emirates', 'UAE', 'Emirates', '阿联酋', '阿聯酋'] },
        SAR: { flag: '🇸🇦', aliases: ['Saudi Arabia', 'Kingdom of Saudi Arabia', '沙特阿拉伯'] }
    };

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
            if (!response.ok) throw new Error('Frankfurter HTTP ' + response.status);
            return response.json();
        });
    }

    function refreshData() {
        if (requestPromise) return requestPromise;
        var controller = new AbortController();
        var timeout = setTimeout(function() { controller.abort(); }, 8000);
        requestPromise = Promise.all([
            fetchJson(API_ROOT + '/currencies', controller.signal),
            fetchJson(API_ROOT + '/rates?base=CNY', controller.signal)
        ]).then(function(responses) {
            if (!Array.isArray(responses[0]) || !Array.isArray(responses[1]) || !responses[1].length) {
                throw new Error('Invalid Frankfurter response');
            }
            var currencies = Object.create(null);
            responses[0].forEach(function(item) {
                if (!item || typeof item.iso_code !== 'string' || !/^[A-Z]{3}$/.test(item.iso_code) || typeof item.name !== 'string') return;
                if (currencies[item.iso_code]) return;
                currencies[item.iso_code] = { name: item.name, symbol: typeof item.symbol === 'string' ? item.symbol : '' };
            });
            var rates = Object.create(null);
            var date = '';
            responses[1].forEach(function(item) {
                if (!item || item.base !== 'CNY' || typeof item.quote !== 'string' || !/^[A-Z]{3}$/.test(item.quote)) return;
                if (!Number.isFinite(item.rate) || item.rate <= 0 || !currencies[item.quote] || rates[item.quote]) return;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return;
                date = date || item.date;
                if (date !== item.date) return;
                rates[item.quote] = item.rate;
            });
            if (!date || !rates.USD) throw new Error('Frankfurter CNY rates missing or invalid');
            currencies.CNY = currencies.CNY || { name: 'Chinese Yuan Renminbi', symbol: '¥' };
            rates.CNY = 1;
            var data = { date: date, savedAt: Date.now(), rates: rates, currencies: currencies };
            currencyData = data;
            saveCache(data);
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
                renderOptions();
                applyReferences();
                updateStatus(data);
            }).catch(function() {});
            return Promise.resolve(currencyData);
        }
        return refreshData();
    }

    function cacheIsStale(data) {
        return !data || Math.max(0, Date.now() - data.savedAt) > FRESH_MS;
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

    function makeOption(code, metadata, data) {
        var info = CURRENCY_META[code] || {};
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
        name.textContent = metadata.name + (available ? '' : ' — ' + translate('currency_rate_unavailable'));
        row.setAttribute('aria-label', (info.flag ? info.flag + ' ' : '') + code + ', ' + metadata.name + (available ? '' : ', ' + translate('currency_rate_unavailable')));
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
        var codes = data ? Object.keys(data.currencies) : ['CNY'];
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
            var metadata = data && data.currencies[code] ? data.currencies[code] : { name: 'Chinese Yuan Renminbi', symbol: '¥' };
            var info = CURRENCY_META[code] || {};
            var haystack = normalize([code, metadata.name, metadata.symbol, (info.aliases || []).join(' '), code === 'CNY' ? '¥ 元' : ''].join(' '));
            var dollarSymbolMatch = query === '$' && (String(metadata.symbol || '').includes('$') || /\bdollars?\b/i.test(metadata.name));
            if (query && !haystack.includes(query) && !dollarSymbolMatch) return;
            rows.push(makeOption(code, metadata, data));
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
            reference.textContent = '≈ ' + formatted + ' ' + selected + ' · ' + currencyData.date;
            reference.setAttribute('aria-label', 'Approximately ' + formatted + ' ' + selected + ', reference rate date ' + currencyData.date);
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
        var trigger = event.target.closest && event.target.closest('.currency-trigger');
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
        if (!/^[A-Z]{3}$/.test(code || '') || !currencyData || !Number.isFinite(currencyData.rates[code])) return;
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

    if (selected !== 'CNY') {
        ensureData().then(function(data) {
            if (!data.currencies[selected] || !Number.isFinite(data.rates[selected])) {
                selected = 'CNY';
                try { localStorage.removeItem(PREFERENCE_KEY); } catch (_) { /* Ignore unavailable storage. */ }
                return;
            }
            applyReferences();
        }).catch(function() {
            if (currencyData && Number.isFinite(currencyData.rates[selected])) applyReferences();
        });
    }
})();
