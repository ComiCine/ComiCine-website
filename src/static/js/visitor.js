/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
 */

/**
 * Visitor dashboard.
 *
 * Status filtering is entirely local: the first load makes one request to /api/visitors.
 * Clicking a status chip updates the DOM without requesting /api/visitors?status=....
 * Auto-refresh, language changes, and page visibility changes also use the endpoint without a status parameter.
 *
 * Clicking a row requests /api/visitors/<hash>/ip to decrypt its full IP; the list endpoint only returns hashes.
 * On success, open https://ipinfo.io/<ip> in a new tab.
 */

import { filterMarkers } from './visitor-filter.js';

// Data and request state.
let allMarkers = [];
let statusCounts = {};
let currentStatus = 'all';
let inFlight = false;
let dataLoaded = false;
let lastLoadedAt = 0;

// base.js exposes the translator through a classic script, whose execution order relative to modules can vary by browser.
// This adapter falls back to the key until the translator is ready, without causing a ReferenceError.
function t(key, params) {
  const translator = typeof window !== 'undefined' ? window.limoooTranslate : undefined;
  return typeof translator === 'function' ? translator(key, params) : key;
}

// Dashboard.
function showDashboard() {
  const dash = document.getElementById('dashboard');
  dash.classList.remove('hidden');
  requestAnimationFrame(() => {
    dash.classList.add('visible');
  });
  refresh();
}

function handleLogout() {
  const next = encodeURIComponent(location.href);
  location.href = '/logout?next=' + next;
}

// Data.
function showLoading() {
  const container = document.getElementById('visitor-list');
  if (container) {
    container.innerHTML = '<div class="loading-indicator">' +
      '<div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div>' +
      '</div>';
  }
}

function showError() {
  const container = document.getElementById('visitor-list');
  if (container) {
    container.innerHTML = '<div class="loading-indicator dim">' + esc(t('load_failed')) + '</div>';
  }
}

function updateStats(stats) {
  const safe = stats || {};
  document.getElementById('stat-ips').textContent = Number(safe.total_ips || 0).toLocaleString();
  document.getElementById('stat-requests').textContent = Number(safe.total_requests || 0).toLocaleString();
  document.getElementById('stat-countries').textContent = Number(safe.countries || 0).toLocaleString();
  document.getElementById('stat-statuses').textContent = Object.keys(statusCounts).length.toLocaleString();
}

async function refresh() {
  if (inFlight) return;
  inFlight = true;
  let refreshed = false;
  try {
    if (!dataLoaded) showLoading();

    const resp = await fetch('/api/visitors');
    if (resp.status === 401) {
      window.location.href = '/login?next=' + encodeURIComponent(location.href);
      return;
    }
    if (resp.status === 403) {
      document.getElementById('visitor-list').innerHTML =
        '<div class="loading-indicator dim">' + esc(t('no_permission')) + '</div>';
      return;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    const data = await resp.json();
    allMarkers = Array.isArray(data.markers) ? data.markers : [];
    statusCounts = data.status_counts || {};
    dataLoaded = true;
    lastLoadedAt = Date.now();
    updateStats(data.stats);
    refreshed = true;
  } catch (error) {
    console.error('Failed to load:', error);
    showError();
  } finally {
    inFlight = false;
    if (refreshed) applyFilter();
  }
}

// The API returns UTC timestamps (`2026-01-02T00:00:00Z` or Unix seconds); historical values may be bare UTC strings.
// Parse them as Date values and format with local-time getters so each admin sees their own wall-clock time.
// Treat values without a timezone (`YYYY-MM-DD HH:MM:SS`) as UTC because that is their source timezone.
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    const fromNumber = new Date(value * 1000);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  const str = String(value).trim();
  if (/^\d+$/.test(str)) {
    const fromEpoch = new Date(Number(str) * 1000);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  const legacy = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  const date = legacy
    ? new Date(Date.UTC(
      Number(legacy[1]), Number(legacy[2]) - 1, Number(legacy[3]),
      Number(legacy[4]), Number(legacy[5]), Number(legacy[6] || 0),
    ))
    : new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(value) {
  const date = toDate(value);
  if (!date) return value ? String(value) : '';
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

// Hover shows the full timestamp with its timezone offset and relative age instead of an unexplained number.
function timeTitle(value) {
  const date = toDate(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offset = 'UTC' + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const absSec = Math.abs(diffSec);
  let relative;
  if (absSec < 60) relative = t('time_just_now');
  else if (absSec < 3600) relative = t('time_minutes_ago', { n: Math.round(absSec / 60) });
  else if (absSec < 86400) relative = t('time_hours_ago', { n: Math.round(absSec / 3600) });
  else relative = t('time_days_ago', { n: Math.round(absSec / 86400) });
  return formatTime(value) + ' ' + offset + ' · ' + relative;
}

function statusClass(code) {
  if (code === '444') return 's444';
  if (code.charAt(0) === '5') return 's5';
  if (code.charAt(0) === '4') return 's4';
  if (code.charAt(0) === '3') return 's3';
  return 's2';
}

function renderList(markers) {
  const container = document.getElementById('visitor-list');
  if (!markers.length) {
    container.innerHTML = '<div class="loading-indicator dim">' + esc(t('no_records')) + '</div>';
    return;
  }

  container.innerHTML = markers.map((m) => {
    const markerId = m.ip_hash || '';
    const hasGeo = !!(m.country || m.city);
    let locHtml;
    if (hasGeo) {
      const sameLoc = m.country && m.city &&
        m.country.trim().toLowerCase() === m.city.trim().toLowerCase();
      if (sameLoc) {
        locHtml = '<div class="loc">' + esc(m.country) + '</div>';
      } else {
        locHtml = (m.country ? '<div class="loc">' + esc(m.country) + '</div>' : '') +
                  (m.city ? '<div class="loc-city">' + esc(m.city) + '</div>' : '');
      }
    } else {
      locHtml = '<div class="loc">' + esc(markerId || t('unknown')) + '</div>';
    }

    const lines = [];
    if (markerId) lines.push('ID: ' + esc(markerId));
    if (m.isp) lines.push('ISP: ' + esc(m.isp));
    if (m.asn) lines.push('AS: ' + esc(m.asn));
    const badges = Object.keys(m.statuses || {})
      .sort((a, b) => Number(a) - Number(b))
      .map((c) => '<span class="badge ' + statusClass(c) + '">' + esc(c) + '×' +
        Number(m.statuses[c]) + '</span>')
      .join('');

    return '<div class="visitor-row" data-hash="' + esc(markerId) + '" title="' +
      esc(t('ip_view_hint')) + '">' +
      '<div class="dot ' + (hasGeo ? 'geo' : 'nogeo') + '"></div>' +
      '<div class="info">' + locHtml +
      '<div class="detail">' + lines.join(' · ') + '</div>' +
      (badges ? '<div class="badges">' + badges + '</div>' : '') +
      '</div><div class="time-col">' +
      '<div class="time-text" title="' + esc(timeTitle(m.last_time)) + '">' +
      esc(formatTime(m.last_time)) + '</div>' +
      '<div class="count-text">' + t('times', { count: m.count }) + '</div>' +
      '</div></div>';
  }).join('');
}

function renderChips(counts) {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  const codes = Object.keys(counts || {}).sort((a, b) => Number(a) - Number(b));
  let html = chipHtml('all', t('filter_all'), null);
  codes.forEach((c) => {
    html += chipHtml(c, c, counts[c]);
  });
  bar.innerHTML = html;
}

function chipHtml(status, label, count) {
  const active = currentStatus === status ? ' active' : '';
  const countHtml = count != null ? '<span class="cnt">' + count + '</span>' : '';
  return '<button class="chip' + active + '" data-status="' + esc(status) + '">' +
    esc(label) + countHtml + '</button>';
}

function applyFilter() {
  if (!dataLoaded || inFlight) return;
  renderChips(statusCounts);

  const filtered = filterMarkers(allMarkers, currentStatus);
  renderList(filtered);
}

document.getElementById('filter-bar').addEventListener('click', (event) => {
  const btn = event.target.closest('.chip');
  if (!btn) return;
  currentStatus = btn.dataset.status;
  applyFilter();
});

// Clicking a visitor row decrypts that IP and opens ipinfo.io.
// The list endpoint returns only ip_hash; decrypt one IP on demand through
// functions/api/visitors/[hash]/ip.ts instead of decrypting 500 rows on every poll.
const IP_LITERAL_RE = /^[0-9a-fA-F:.]{3,45}$/;

let toastTimer = null;
function toast(message) {
  if (!message) return;
  let el = document.getElementById('visitor-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'visitor-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  void el.offsetWidth; // Restart the transition so repeated clicks still provide feedback.
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3000);
}

async function openIpInfo(hash) {
  if (!hash) {
    toast(t('ip_unavailable'));
    return;
  }

  // Reserve the new tab synchronously during the click. Calling window.open after await is
  // treated by Safari/Chrome as a popup without a user gesture and is blocked.
  // noopener must be set afterward because it prevents access to the window needed to change its URL.
  // Open about:blank first, then clear opener to prevent reverse tabnabbing.
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  const fail = () => {
    if (tab) tab.close();
    toast(t('ip_unavailable'));
  };

  let resp;
  try {
    resp = await fetch('/api/visitors/' + encodeURIComponent(hash) + '/ip', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    fail();
    return;
  }
  if (!resp.ok) {
    // Map missing historical ciphertext (404), missing keys (503), and other failures to one notice without exposing details.
    fail();
    return;
  }
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    fail();
    return;
  }
  const ip = typeof data.ip === 'string' ? data.ip.trim() : '';
  if (!IP_LITERAL_RE.test(ip)) {
    fail();
    return;
  }

  const url = 'https://ipinfo.io/' + ip;
  if (tab) {
    tab.location.replace(url);
  } else {
    // If the placeholder is blocked, such as when popups are disabled, fall back to the current tab.
    location.href = url;
  }
}

document.getElementById('visitor-list').addEventListener('click', (event) => {
  const row = event.target.closest('.visitor-row');
  if (!row) return;
  openIpInfo(row.dataset.hash);
});

function esc(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

// Pause auto-refresh while the page is hidden to avoid background requests; refresh once when it becomes
// visible again if the data is stale. Refreshing never changes currentStatus or sends a status parameter.
//
// The 10-minute interval limits the cost of /api/visitors, the site's heaviest D1 query over a 30-day window.
// Polling every 60 seconds can read millions of rows per day; on 2026-09-17 it hit the free-plan 5M daily
// limit and disabled all D1 endpoints for a day. A 5-minute interval allows 288 requests/day; 10 minutes
// halves that to 144. Visitor statistics are operational data viewed by day, so this delay is acceptable.
// Use the page's refresh button when the newest data is needed immediately.
const REFRESH_INTERVAL_MS = 600000;
let refreshTimer = null;
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refresh(); }, REFRESH_INTERVAL_MS);
}
function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    startAutoRefresh();
    if (dataLoaded && Date.now() - lastLoadedAt > REFRESH_INTERVAL_MS) refresh();
  }
});

// Preserve the current filter after a language change and reload data without a status parameter.
document.addEventListener('languagechange', () => { refresh(); });

// Template onclick handlers still call refresh() and handleLogout(). Expose these module-scoped functions
// on window to preserve the behavior of the previous classic script.
window.refresh = refresh;
window.handleLogout = handleLogout;

function start() {
  if (!document.hidden) startAutoRefresh();
  showDashboard();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
