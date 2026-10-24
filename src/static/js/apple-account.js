/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

let accounts = [];
let pwVisible = {};
let pwAutoHideTimer = null;
let currentRole = 'viewer'; // Admins can write; viewers are read-only.
let csrfToken = '';
const PW_VISIBLE_MS = 30000; // Keep plaintext passwords in memory for at most 30 seconds.

function clearAllPw() {
    if (Object.keys(pwVisible).length) { pwVisible = {}; renderList(); }
}

function schedulePwAutoHide() {
    if (pwAutoHideTimer) clearTimeout(pwAutoHideTimer);
    pwAutoHideTimer = setTimeout(clearAllPw, PW_VISIBLE_MS);
}

// Clear plaintext immediately when the page is backgrounded or the device is locked.
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        if (pwAutoHideTimer) { clearTimeout(pwAutoHideTimer); pwAutoHideTimer = null; }
        clearAllPw();
    }
});

window.addEventListener('pageshow', function(e) {
    if (e.persisted) initDashboard();
});

// Re-render dialog titles, descriptions, and the account list after a language change.
document.addEventListener('languagechange', function() {
    var modal = document.getElementById('modal');
    if (modal && !modal.classList.contains('hidden')) {
        document.getElementById('modal-title').textContent = editingId ? t('modal_edit_title') : t('modal_add_title');
        document.getElementById('modal-desc').textContent = editingId ? t('modal_edit_desc') : t('modal_add_desc');
    }
    var dmodal = document.getElementById('delete-modal');
    if (dmodal && !dmodal.classList.contains('hidden')) {
        var target = accounts.find(function(a) { return a.id === deleteTargetId; });
        if (target) document.getElementById('delete-desc').textContent = t('delete_confirm', { email: target.email });
    }
    renderList();
});

// If the page loads, the backend has allowed the signed-in user through; redirect to login only on API 401.
function initDashboard() {
    fetch('/api/auth/status').then(r => r.ok ? r.json() : Promise.reject(new Error('auth_status_failed'))).then(data => {
        csrfToken = data.csrf_token || '';
        currentRole = data.role || 'viewer';
        showDashboard();
    }).catch(() => showDashboard());
}

function csrfHeaders(extra) {
    var headers = extra || {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return headers;
}

function handleApiFailure(resp, fallback) {
    if (resp.status === 401) {
        window.location.href = '/login?next=' + encodeURIComponent(location.href);
        return true;
    }
    if (resp.status === 403) {
        toast(t('toast_no_permission'));
        return true;
    }
    if (fallback) toast(fallback);
    return true;
}

function showDashboard() {
    var dash = document.getElementById('dashboard');
    dash.classList.remove('hidden');
    if (currentRole !== 'admin') {
        // Hide add and other write-action buttons for read-only accounts without showing a notice.
        var addBtn = document.querySelector('.search-actions .btn-primary');
        if (addBtn) addBtn.hidden = true;
    }
    loadAccounts();
}

function handleLogout() {
    var next = encodeURIComponent(location.href);
    location.href = '/logout?next=' + next;
}

// Drag & Drop Sort

let dragSrcId = null;
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

function performDrop(targetId) {
    if (!dragSrcId || dragSrcId === targetId) return;
    const fromIdx = accounts.findIndex(a => a.id == dragSrcId);
    const toIdx = accounts.findIndex(a => a.id == targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = accounts.splice(fromIdx, 1);
    const newToIdx = accounts.findIndex(a => a.id == targetId);
    accounts.splice(newToIdx, 0, moved);
    renderList();
    saveOrder();
}

function clearDragState() {
    document.querySelectorAll('.account-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
    dragSrcId = null;
}

function hitCardAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.account-card') : null;
}

function initDrag() {
    document.querySelectorAll('.account-card').forEach(card => {
        if (isTouchDevice) {
            // Native HTML5 drag and drop is incomplete on mobile, so use touch events instead.
            const handle = card.querySelector('.drag-handle');
            if (!handle) return;
            handle.addEventListener('touchstart', function(e) {
                dragSrcId = card.dataset.id;
                card.classList.add('dragging');
            }, { passive: true });
            handle.addEventListener('touchmove', function(e) {
                e.preventDefault(); // Prevent page scrolling during the drag.
                const t = e.touches[0];
                const target = hitCardAt(t.clientX, t.clientY);
                document.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
                if (target && target !== card) target.classList.add('drag-over');
            }, { passive: false });
            handle.addEventListener('touchend', function(e) {
                const t = e.changedTouches[0];
                const target = hitCardAt(t.clientX, t.clientY);
                const targetId = target ? target.dataset.id : null;
                performDrop(targetId); // Run before clearDragState, while dragSrcId is still available.
                clearDragState();
            }, { passive: true });
            // Clear drag state if the system interrupts a drag, such as for a call or dialog.
            handle.addEventListener('touchcancel', clearDragState, { passive: true });
        } else {
            card.setAttribute('draggable', 'true');
            card.addEventListener('dragstart', function(e) {
                dragSrcId = this.dataset.id;
                this.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });
            card.addEventListener('dragend', clearDragState);
            card.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                document.querySelectorAll('.account-card').forEach(c => c.classList.remove('drag-over'));
                if (this.dataset.id !== dragSrcId) this.classList.add('drag-over');
            });
            card.addEventListener('dragleave', function() {
                this.classList.remove('drag-over');
            });
            card.addEventListener('drop', function(e) {
                e.preventDefault();
                performDrop(this.dataset.id);
            });
        }
    });
}

async function saveOrder() {
    var order = accounts.map(function(a) { return a.id; });
    try {
        const resp = await fetch('/api/apple-account/reorder', {
            method: 'PUT',
            headers: csrfHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ order: order })
        });
        if (!resp.ok) handleApiFailure(resp, t('toast_op_failed'));
    } catch(e) {}
}

// CRUD

async function loadAccounts() {
    const container = document.getElementById('account-list');
    container.innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
    try {
        const resp = await fetch('/api/apple-account/accounts');
        if (resp.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(location.href); return; }
        accounts = await resp.json();
        pwVisible = {};
        renderList();
    } catch(e) { container.innerHTML = '<div class="empty-state">' + esc(t('load_failed')) + '</div>'; }
}

function renderList() {
    const container = document.getElementById('account-list');
    const search = document.getElementById('search').value.toLowerCase().trim();
    let filtered = search ? accounts.filter(a => a.email.toLowerCase().includes(search) || a.notes.toLowerCase().includes(search)) : accounts;

    document.getElementById('count-badge').textContent = t('apple_account_count', { count: filtered.length });
    if (!filtered.length) { container.innerHTML = '<div class="empty-state"><div class="big-icon">🔑</div>' + esc(t('apple_account_empty')) + '</div>'; return; }
    container.innerHTML = filtered.map(a => {
        const pwShown = (pwVisible[a.id] !== undefined);
        const isAdmin = currentRole === 'admin';
        return `
        <div class="account-card" data-id="${a.id}">
            ${isAdmin ? `<div class="drag-handle">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="9" x2="18" y2="9"/><line x1="6" y1="15" x2="18" y2="15"/></svg>
            </div>` : ''}
            <div class="account-body">
                <div class="account-row">
                    <span class="account-email">${esc(a.email)}</span>
                    <button class="row-btn" data-action="copyEmail" data-arg="${a.id}" data-arg-type="number" title="${t('copy_email')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    </button>
                </div>
                <div class="account-row">
                    <span class="account-pw">${pwShown ? esc(pwVisible[a.id]) : esc(a.password)}</span>
                    <button class="row-btn ${pwShown ? 'active' : ''}" data-action="togglePw" data-arg="${a.id}" data-arg-type="number" title="${pwShown ? t('hide_password') : t('show_password')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${pwShown
                            ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
                            : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'}
                        </svg>
                    </button>
                    <button class="row-btn" data-action="copyPw" data-arg="${a.id}" data-arg-type="number" title="${t('copy_pw')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                    </button>
                </div>
                ${a.notes ? '<div class="account-notes">' + esc(a.notes) + '</div>' : ''}
            </div>
            ${isAdmin ? `<div class="account-actions">
                <button class="row-btn" data-action="openEditModal" data-arg="${a.id}" data-arg-type="number" title="${t('edit')}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="row-btn danger" data-action="deleteAccount" data-arg="${a.id}" data-arg-type="number" title="${t('delete')}">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </div>` : ''}
        </div>`;
    }).join('');
    if (currentRole === 'admin') setTimeout(initDrag, 0);
}

async function revealPw(id) {
    if (pwVisible[id] !== undefined) return pwVisible[id];
    try {
        const resp = await fetch('/api/apple-account/accounts/' + id + '/reveal', { method: 'POST', headers: csrfHeaders() });
        if (resp.status === 403) { toast(t('toast_no_permission')); return null; }
        if (resp.status === 401) {
            // Recent authentication expired, but the session is still valid; authAt is simply too old.
            // Go through Access again via /login. The user must retry reveal after returning; do not replay it automatically.
            var body = {};
            try { body = await resp.json(); } catch(e) { body = {}; }
            if (body && body.reauth) toast(t('toast_reauth_required'));
            // Let the notice render for one frame before redirecting.
            setTimeout(function() {
                window.location.href = '/login?next=' + encodeURIComponent(location.href);
            }, body && body.reauth ? 800 : 0);
            return null;
        }
        if (!resp.ok) { toast(t('toast_pw_fetch_failed')); return null; }
        const data = await resp.json();
        return data.password;
    } catch(e) { toast(t('toast_pw_fetch_failed')); return null; }
}

/* Password field in the dialog with an eye toggle for plain and masked states.
   Keep type="text" instead of using browser password rendering, which varies by browser.
   The masked state shows dots matching the password length; the actual value is stored in data-real. */
let fieldPwHidden = true;

function renderFieldPw() {
    var input = document.getElementById('field-password');
    var real = input.dataset.real || '';
    if (fieldPwHidden) {
        input.value = real ? '·'.repeat(real.length) : '';
    } else {
        input.value = real;
    }
    document.getElementById('field-password-eye-open').hidden = fieldPwHidden;
    document.getElementById('field-password-eye-closed').hidden = !fieldPwHidden;
}

function toggleFieldPw() {
    fieldPwHidden = !fieldPwHidden;
    renderFieldPw();
}

/* Update the real value and redraw the dots as the user types. */
document.getElementById('field-password').addEventListener('input', function() {
    this.dataset.real = this.value;
    if (fieldPwHidden) renderFieldPw();
});

async function togglePw(id) {
    if (pwVisible[id] !== undefined) {
        delete pwVisible[id];
        renderList();
        return;
    }
    const pw = await revealPw(id);
    if (pw === null) return;
    pwVisible[id] = pw;
    renderList();
    schedulePwAutoHide();
}

async function copyPw(id) {
    const pw = await revealPw(id);
    if (!pw) return;
    try { await navigator.clipboard.writeText(pw); toast(t('toast_copy_pw')); }
    catch(e) { toast(t('toast_copy_failed')); }
    if (pwVisible[id] !== undefined) {
        delete pwVisible[id];
        renderList();
    }
}

async function copyEmail(id) {
    const a = accounts.find(x => x.id === id);
    if (!a) return;
    try { await navigator.clipboard.writeText(a.email); toast(t('toast_copy_email')); }
    catch(e) { toast(t('toast_copy_failed')); }
}

let deleteTargetId = null;

function deleteAccount(id) {
    const a = accounts.find(x => x.id === id);
    if (a) document.getElementById('delete-desc').textContent = t('delete_confirm', { email: a.email });
    deleteTargetId = id;
    document.getElementById('delete-modal').classList.remove('hidden');
}

function closeDeleteModal() {
    var modal = document.getElementById('delete-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    deleteTargetId = null;
}

async function confirmDelete() {
    if (deleteTargetId === null) return;
    const id = deleteTargetId;
    const resp = await fetch('/api/apple-account/accounts/' + id, { method: 'DELETE', headers: csrfHeaders() });
    closeDeleteModal();
    if (!resp.ok) { handleApiFailure(resp, t('toast_delete_failed')); return; }
    accounts = accounts.filter(a => a.id !== id);
    delete pwVisible[id];
    renderList();
    toast(t('toast_deleted'));
}

// Modal

let editingId = null;

function openAddModal() {
    editingId = null;
    document.getElementById('modal-title').textContent = t('modal_add_title');
    document.getElementById('field-email').value = '';
    document.getElementById('field-notes').value = '';
    // Clear the real password and restore the masked state.
    var pwInput = document.getElementById('field-password');
    pwInput.dataset.real = '';
    fieldPwHidden = true;
    renderFieldPw();
    document.getElementById('modal').classList.remove('hidden');
}

function openEditModal(id) {
    const a = accounts.find(x => x.id === id);
    if (!a) return;
    editingId = id;
    document.getElementById('modal-title').textContent = t('modal_edit_title');
    document.getElementById('modal-desc').textContent = t('modal_edit_desc');
    document.getElementById('field-email').value = a.email.split('@')[0];
    document.getElementById('field-notes').value = a.notes || '';
    // The list API returns a masked password, so fetch the real value through the reveal endpoint.
    // Prefill with dots and store the original value in dataset.original to detect changes.
    var pwInput = document.getElementById('field-password');
    pwInput.dataset.real = '';
    pwInput.dataset.original = '';
    fieldPwHidden = true;
    renderFieldPw();
    document.getElementById('modal').classList.remove('hidden');
    revealPw(id).then(function(realPw) {
        if (realPw) {
            pwInput.dataset.real = realPw;
            pwInput.dataset.original = realPw;
            renderFieldPw();
        }
    });
}

function closeModal() {
    var modal = document.getElementById('modal');
    if (!modal) return;
    modal.classList.add('hidden');
    // Reset the password field so a later dialog does not retain plaintext or dots.
    fieldPwHidden = true;
    document.getElementById('field-password').dataset.real = '';
    document.getElementById('field-password').dataset.original = '';
    renderFieldPw();
}

async function saveAccount() {
    const emailDomain = document.querySelector('.email-domain').textContent.trim();
    const email = document.getElementById('field-email').value.trim().split('@')[0] + emailDomain;
    const password = (document.getElementById('field-password').dataset.real || '').trim();
    const notes = document.getElementById('field-notes').value.trim();
    if (!password) { toast(t('toast_enter_pw')); return; }
    const btn = document.getElementById('modal-save-btn');
    btn.disabled = true;
    try {
        if (editingId) {
            const origPw = document.getElementById('field-password').dataset.original || '';
            const pwChanged = password !== origPw;
            const resp = await fetch('/api/apple-account/accounts/' + editingId, {
                method:'PUT',
                headers: csrfHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({email, password, notes, password_changed: pwChanged})
            });
            if (!resp.ok) { handleApiFailure(resp, t('toast_update_failed')); btn.disabled = false; return; }
        } else {
            if (!email) { toast(t('toast_enter_email')); btn.disabled = false; return; }
            const resp = await fetch('/api/apple-account/accounts', {
                method:'POST',
                headers: csrfHeaders({'Content-Type':'application/json'}),
                body: JSON.stringify({email, password, notes})
            });
            if (!resp.ok) { handleApiFailure(resp, t('toast_add_failed')); btn.disabled = false; return; }
        }
        closeModal();
        await loadAccounts();
        toast(editingId ? t('toast_updated') : t('toast_added'));
    } catch(e) { toast(t('toast_op_failed')); }
    btn.disabled = false;
}

var accountModal = document.getElementById('modal');
var deleteModal = document.getElementById('delete-modal');
if (accountModal) accountModal.addEventListener('click', function(e) { if (e.target === this) closeModal(); });
if (deleteModal) deleteModal.addEventListener('click', function(e) { if (e.target === this) closeDeleteModal(); });
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeModal(); closeDeleteModal(); }
    if (e.key === 'Enter' && accountModal && !accountModal.classList.contains('hidden') && document.activeElement.tagName !== 'TEXTAREA') saveAccount();
});

function toast(msg) { var el = document.getElementById('toast'); el.textContent = msg; el.classList.add('show'); setTimeout(function(){ el.classList.remove('show'); }, 2000); }
function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

initDashboard();
