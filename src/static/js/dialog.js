/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/*
 * Shared modal dialog helper for classic (non-module) page scripts.
 *
 * window.ComiCineDialog.open({ root, dialog, mode, trigger, initialFocus, lockScroll, onClose })
 *   Shows root and returns the stack entry { root, dialog, mode, trigger, lockScroll, onClose },
 *   or null when root is missing. dialog defaults to root and is used for focus trapping and for
 *   resolving a selector initialFocus. trigger defaults to document.activeElement. Opening an
 *   already open root returns the existing entry without pushing a duplicate layer.
 * window.ComiCineDialog.close(root)
 *   Hides and removes one layer, releases its scroll lock, recomputes background inert state,
 *   restores focus to the remembered trigger, and calls onClose. Returns true when it closed.
 * window.ComiCineDialog.closeAll()
 *   Closes every open layer from top to bottom and restores all page state.
 * window.ComiCineDialog.isOpen(root) / window.ComiCineDialog.top()
 *   Query the open stack; top() returns the top entry object, or null when the stack is empty.
 * window.ComiCineDialog.announce(root, message)
 *   Writes message into an existing status region inside root, or into the document level
 *   [role="status"] region when root holds none. Returns true when it wrote text, false when
 *   there is no message or no region. It never creates a node and never adds a second region.
 *
 * mode switches only the visibility state; CSS owns the actual visuals:
 *   'class-open' (default) adds and removes the "open" class on root.
 *   'class-hidden' removes the "hidden" class on open and adds it back on close.
 *   'attr-hidden' clears the hidden property on open and sets it on close.
 *
 * The stack is global and LIFO. Only the top layer handles Escape and Tab, the body scroll lock
 * is reference counted so nested dialogs cannot unlock the page early, and every open or close
 * recomputes which body children are inert.
 */
(function() {
    'use strict';

    var MODE_CLASS_OPEN = 'class-open';
    var MODE_CLASS_HIDDEN = 'class-hidden';
    var MODE_ATTR_HIDDEN = 'attr-hidden';
    var FOCUSABLE_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]';
    var STATUS_REGION_SELECTOR = '[role="status"], [aria-live]';
    var DOCUMENT_STATUS_SELECTOR = '[role="status"]';

    var stack = [];
    var scrollLockCount = 0;
    var savedBodyOverflow = '';
    var backgroundState = [];

    function matchesSelector(el, selector) {
        var match = el.matches || el.webkitMatchesSelector || el.msMatchesSelector;
        if (!match) return false;
        try {
            return match.call(el, selector);
        } catch (err) {
            return false;
        }
    }

    function focusElement(el) {
        if (!el || typeof el.focus !== 'function') return false;
        try {
            el.focus({ preventScroll: true });
        } catch (err) {
            try {
                el.focus();
            } catch (err2) {
                return false;
            }
        }
        return true;
    }

    /* Recompute on every Tab press: dialog contents can be rendered after the dialog opens. */
    function getFocusable(dialog) {
        if (!dialog || typeof dialog.querySelectorAll !== 'function') return [];
        var nodes = dialog.querySelectorAll(FOCUSABLE_SELECTOR);
        var focusable = [];
        var i;
        for (i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            if (el.disabled) continue;
            if (el.tabIndex < 0) continue;
            if (el.hidden) continue;
            if (el.getAttribute('aria-hidden') === 'true') continue;
            if (!el.getClientRects().length) continue;
            focusable.push(el);
        }
        return focusable;
    }

    function resolveInitialFocus(dialog, initialFocus) {
        if (!initialFocus) return null;
        if (typeof initialFocus === 'string') {
            if (!dialog || typeof dialog.querySelector !== 'function') return null;
            try {
                return dialog.querySelector(initialFocus);
            } catch (err) {
                return null;
            }
        }
        if (initialFocus.nodeType === 1) return initialFocus;
        return null;
    }

    function setVisibility(root, mode, visible) {
        if (mode === MODE_CLASS_HIDDEN) {
            if (visible) root.classList.remove('hidden');
            else root.classList.add('hidden');
            return;
        }
        if (mode === MODE_ATTR_HIDDEN) {
            root.hidden = !visible;
            return;
        }
        if (visible) root.classList.add('open');
        else root.classList.remove('open');
    }

    function findEntry(root) {
        var i;
        for (i = stack.length - 1; i >= 0; i--) {
            if (stack[i].root === root) return stack[i];
        }
        return null;
    }

    function lockPageScroll() {
        if (scrollLockCount === 0) {
            savedBodyOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }
        scrollLockCount++;
    }

    function unlockPageScroll() {
        if (scrollLockCount <= 0) return;
        scrollLockCount--;
        if (scrollLockCount === 0) document.body.style.overflow = savedBodyOverflow;
    }

    function releaseBackgroundInert() {
        var i;
        for (i = 0; i < backgroundState.length; i++) {
            var record = backgroundState[i];
            record.el.inert = false;
            if (record.ariaHidden === null) record.el.removeAttribute('aria-hidden');
            else record.el.setAttribute('aria-hidden', record.ariaHidden);
        }
        backgroundState = [];
    }

    function containsOpenRoot(child) {
        var i;
        for (i = 0; i < stack.length; i++) {
            if (child === stack[i].root || child.contains(stack[i].root)) return true;
        }
        return false;
    }

    function syncBackgroundInert() {
        releaseBackgroundInert();
        if (!stack.length) return;
        var children = document.body.children;
        var i;
        for (i = 0; i < children.length; i++) {
            var child = children[i];
            if (!child || child.nodeType !== 1) continue;
            if (child.classList && child.classList.contains('site-nav')) continue;
            if (child.inert) continue; /* Another owner, such as the closed mobile nav screen, controls it. */
            if (containsOpenRoot(child)) continue;
            /* Inerting the page's live announcement area would silence it, so it stays outside the trap. */
            if (matchesSelector(child, STATUS_REGION_SELECTOR) || child.querySelector(STATUS_REGION_SELECTOR)) continue;
            backgroundState.push({ el: child, ariaHidden: child.getAttribute('aria-hidden') });
            child.inert = true;
            child.setAttribute('aria-hidden', 'true');
        }
    }

    function restoreFocus(trigger) {
        if (!trigger || trigger === document.body) return;
        if (!document.contains(trigger)) return;
        focusElement(trigger);
    }

    function notifyClose(entry) {
        if (typeof entry.onClose !== 'function') return;
        try {
            entry.onClose();
        } catch (err) {}
    }

    function open(options) {
        options = options || {};
        var root = options.root;
        if (!root) return null;
        var existing = findEntry(root);
        if (existing) return existing;
        var entry = {
            root: root,
            dialog: options.dialog || root,
            mode: options.mode || MODE_CLASS_OPEN,
            trigger: options.trigger !== undefined ? options.trigger : document.activeElement,
            lockScroll: options.lockScroll !== false,
            onClose: typeof options.onClose === 'function' ? options.onClose : null
        };
        setVisibility(root, entry.mode, true);
        stack.push(entry);
        if (entry.lockScroll) lockPageScroll();
        var focusTarget = resolveInitialFocus(entry.dialog, options.initialFocus);
        if (!focusTarget) {
            var focusable = getFocusable(entry.dialog);
            focusTarget = focusable.length ? focusable[0] : entry.dialog;
        }
        focusElement(focusTarget);
        syncBackgroundInert();
        return entry;
    }

    function close(root) {
        var entry = findEntry(root);
        if (!entry) return false;
        stack.splice(stack.indexOf(entry), 1);
        setVisibility(entry.root, entry.mode, false);
        if (entry.lockScroll) unlockPageScroll();
        syncBackgroundInert();
        restoreFocus(entry.trigger);
        notifyClose(entry);
        return true;
    }

    function closeAll() {
        var entries = stack.slice();
        var i;
        for (i = entries.length - 1; i >= 0; i--) close(entries[i].root);
        return entries.length > 0;
    }

    function isOpen(root) {
        return findEntry(root) !== null;
    }

    function top() {
        return stack.length ? stack[stack.length - 1] : null;
    }

    function announce(root, message) {
        if (!message) return false;
        var region = null;
        if (root && root.nodeType === 1 && matchesSelector(root, STATUS_REGION_SELECTOR)) region = root;
        if (!region && root && typeof root.querySelector === 'function') {
            region = root.querySelector(STATUS_REGION_SELECTOR);
        }
        if (!region && root !== document) region = document.querySelector(DOCUMENT_STATUS_SELECTOR);
        if (!region) return false;
        region.textContent = message;
        return true;
    }

    function handleKeydown(e) {
        if (!stack.length) return;
        var entry = stack[stack.length - 1];
        if (e.key === 'Escape' || e.key === 'Esc') {
            e.preventDefault();
            close(entry.root);
            return;
        }
        if (e.key !== 'Tab') return;
        var focusable = getFocusable(entry.dialog);
        if (!focusable.length) {
            e.preventDefault();
            focusElement(entry.dialog);
            return;
        }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        var active = document.activeElement;
        var index = -1;
        var i;
        for (i = 0; i < focusable.length; i++) {
            if (focusable[i] === active) {
                index = i;
                break;
            }
        }
        if (index === -1) {
            e.preventDefault();
            focusElement(e.shiftKey ? last : first);
            return;
        }
        if (e.shiftKey && index === 0) {
            e.preventDefault();
            focusElement(last);
            return;
        }
        if (!e.shiftKey && index === focusable.length - 1) {
            e.preventDefault();
            focusElement(first);
        }
    }

    document.addEventListener('keydown', handleKeydown);

    window.ComiCineDialog = {
        open: open,
        close: close,
        closeAll: closeAll,
        isOpen: isOpen,
        top: top,
        announce: announce
    };
})();
