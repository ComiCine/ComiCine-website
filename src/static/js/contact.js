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

/* Copy text to the clipboard and show confirmation. */
function handleCopy(el, text) {
    navigator.clipboard.writeText(text).then(function() {
        var tip = el.querySelector('.bubble-tip');
        if (tip) {
            showTip(tip, t('copied'), true);
            var tipKey = el.dataset.copyTip || 'click_to_copy';
            setTimeout(function() { showTip(tip, t(tipKey), false); }, COPY_HINT_DURATION);
        }
    });
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
