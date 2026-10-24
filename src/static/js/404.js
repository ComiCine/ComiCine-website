/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

(function() {
    var countdown = document.getElementById('not-found-countdown');
    var homeLink = document.querySelector('.not-found-home');
    if (!countdown || !homeLink) return;

    var marker = '__LIMOOO_SECONDS__';
    var visualCountdown;
    var digitSlot;
    var digitCurrent;
    var beforeText;
    var afterText;

    function translatedMessage(seconds) {
        if (typeof window.limoooTranslate !== 'function') return null;
        return window.limoooTranslate('not_found_redirect', { seconds: seconds });
    }

    function renderCountdown(seconds, animate) {
        var message = translatedMessage(marker);
        if (message === null || message.indexOf(marker) === -1) {
            countdown.textContent = translatedMessage(seconds) || countdown.textContent.replace(/\d+/, seconds);
            return;
        }

        var markerIndex = message.indexOf(marker);
        var before = message.slice(0, markerIndex);
        var after = message.slice(markerIndex + marker.length);
        var fullMessage = before + seconds + after;

        countdown.setAttribute('data-i18n', 'not_found_redirect;seconds=' + seconds);
        if (animate && visualCountdown && digitSlot && digitCurrent) {
            beforeText.data = before;
            afterText.data = after;
            countdown.querySelector('.not-found-countdown-sr-only').textContent = fullMessage;
            flipDigit(String(seconds));
            return;
        }

        visualCountdown = document.createElement('span');
        visualCountdown.className = 'not-found-countdown-visual';
        visualCountdown.setAttribute('aria-hidden', 'true');
        beforeText = document.createTextNode(before);
        afterText = document.createTextNode(after);
        digitSlot = document.createElement('span');
        digitSlot.className = 'not-found-countdown-slot';
        digitCurrent = document.createElement('span');
        digitCurrent.className = 'not-found-countdown-digit not-found-countdown-current';
        digitCurrent.textContent = seconds;
        digitSlot.appendChild(digitCurrent);
        visualCountdown.append(beforeText, digitSlot, afterText);

        var accessibleText = document.createElement('span');
        accessibleText.className = 'not-found-countdown-sr-only';
        accessibleText.textContent = fullMessage;
        countdown.replaceChildren(visualCountdown, accessibleText);
    }

    function flipDigit(nextValue) {
        var activeSlot = digitSlot;
        var previous = document.createElement('span');
        previous.className = 'not-found-countdown-digit not-found-countdown-previous';
        previous.setAttribute('aria-hidden', 'true');
        previous.textContent = digitCurrent.textContent;

        var next = document.createElement('span');
        next.className = 'not-found-countdown-digit not-found-countdown-next';
        next.setAttribute('aria-hidden', 'true');
        next.textContent = nextValue;

        activeSlot.classList.remove('is-flipping');
        activeSlot.replaceChildren(previous, next);
        void activeSlot.offsetWidth;
        activeSlot.classList.add('is-flipping');

        var finished = false;
        var fallbackTimer;
        function finish(event) {
            if (finished || (event && (event.target !== next || event.propertyName !== 'transform'))) return;
            finished = true;
            window.clearTimeout(fallbackTimer);
            activeSlot.classList.remove('is-flipping');
            next.className = 'not-found-countdown-digit not-found-countdown-current';
            activeSlot.replaceChildren(next);
            if (digitSlot === activeSlot) digitCurrent = next;
        }

        next.addEventListener('transitionend', finish);
        fallbackTimer = window.setTimeout(finish, 320);
    }

    var remaining = 3;
    renderCountdown(remaining, false);
    document.addEventListener('languagechange', function() {
        renderCountdown(remaining, false);
    });

    var timer = window.setInterval(function() {
        remaining -= 1;
        if (remaining <= 0) {
            window.clearInterval(timer);
            window.location.replace(homeLink.href);
            return;
        }

        renderCountdown(remaining, true);
    }, 1000);
})();
