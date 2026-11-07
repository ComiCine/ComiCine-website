/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/*
   Contact page: QR hover overlay and one-click copy.
   */

/* Place the questionnaire card last in English and first in other languages. */
function positionSurvey() {
    var block = document.getElementById('surveyBlock');
    if (!block) return;
    var list = block.parentNode;
    if (CURRENT_LANG === 'en-us') {
        list.appendChild(block);
    } else if (list.firstChild !== block) {
        list.insertBefore(block, list.firstChild);
    }
}
document.addEventListener('languagechange', positionSurvey);

/* Copy feedback duration. */
var COPY_HINT_DURATION = 2000;

/* Update the tooltip text. */
function showTip(tipEl, message, visible) {
    tipEl.innerText = message;
    if (visible) {
        tipEl.style.opacity = '1'; tipEl.style.visibility = 'visible';
        tipEl.style.transform = 'translateX(-50%) translateY(0)';
    } else {
        tipEl.style.opacity = ''; tipEl.style.visibility = '';
        tipEl.style.transform = '';
    }
}

/* Copy through a temporary textarea for browsers without the asynchronous clipboard API.
   The textarea must be in the document for execCommand to act on it, and select() moves
   focus, so it is removed again in `finally` and focus is returned to the trigger. */
function legacyCopy(text) {
    var previousFocus = document.activeElement;
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);

    var copied = false;
    try {
        area.select();
        area.setSelectionRange(0, text.length);
        copied = document.execCommand('copy');
    } catch (error) {
        copied = false;
    } finally {
        document.body.removeChild(area);
        if (previousFocus && typeof previousFocus.focus === 'function') {
            try {
                previousFocus.focus({ preventScroll: true });
            } catch (error) {
                previousFocus.focus();
            }
        }
    }
    return !!copied;
}

/* Copy text, falling back to execCommand when the asynchronous clipboard API is missing or
   rejects (it can refuse without a secure context or a user gesture). The fallback runs in
   the same task as the click: Safari drops the user activation after an await or a timer,
   and execCommand('copy') would then fail. */
function copyText(text) {
    var fallback = function() {
        return legacyCopy(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    };
    var clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return fallback();
    try {
        return clipboard.writeText(text).catch(fallback);
    } catch (error) {
        return fallback();
    }
}

/* Show a message in the card's bubble, then restore its idle hint after the feedback delay. */
function flashTip(el, message) {
    var tip = el.querySelector('.bubble-tip');
    if (!tip) return;
    showTip(tip, message, true);
    var tipKey = el.dataset.copyTip || 'click_to_copy';
    setTimeout(function() { showTip(tip, t(tipKey), false); }, COPY_HINT_DURATION);
}

/* Copy text to the clipboard and show confirmation.
   actions.js invokes data-action handlers with the element as `this` and data-arg as the
   first argument, so the value is the only parameter (it used to be read as `el`). */
function handleCopy(text) {
    var el = this;
    function onCopied() {
        flashTip(el, t('copied'));
    }
    function onFailed() {
        flashTip(el, t('toast_copy_failed'));
    }
    /* Two-argument `then`: an exception thrown while showing the confirmation must not be
       reported as a copy failure. */
    copyText(text).then(onCopied, onFailed);
}

/* On desktop, show the matching social account's QR code on hover. */
var qrDisplay, qrImage;

/* Initialize the QR overlay after the DOM has loaded. */
window.addEventListener('load', function() {
    qrDisplay = document.getElementById('qrDisplay');
    qrImage = document.getElementById('qrImage');
    var triggers = document.querySelectorAll('.qr-trigger');

    if (qrDisplay && window.matchMedia('(hover: hover)').matches) {
        triggers.forEach(function(trigger) {
            trigger.addEventListener('mouseenter', function() {
                qrImage.src = trigger.dataset.qr;
                qrDisplay.classList.add('show');
            });
            trigger.addEventListener('mouseleave', function() {
                qrDisplay.classList.remove('show');
            });
        });
    }
});


/* If the overlay is open during a language change, switch to the QR code for the new language. */
document.addEventListener('languagechange', function() {
    if (!qrImage || !qrDisplay || !qrDisplay.classList.contains('show')) return;
    var hovered = document.querySelector('.qr-trigger:hover');
    if (hovered && hovered.dataset.qr) qrImage.src = hovered.dataset.qr;
});


/* Put the questionnaire last in English and first in other languages; languagechange keeps it in sync. */
positionSurvey();

/* Stagger the fade-in of contact information. */
setTimeout(function() {
    var items = document.querySelectorAll('.reveal-item');
    items.forEach(function(el, i) {
        setTimeout(function() { el.classList.add('show'); }, i * 80);
    });
}, 100);
