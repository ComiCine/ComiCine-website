/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

/*
   Load portfolio images without affecting the initial view:
   Start loading thumbnails only when switching to the portfolio, so they do not compete for bandwidth.
   Once the portfolio is open, srcset selects the appropriate size.
   */
function loadWorkImages() {
    document.querySelectorAll('.work-img[data-src]').forEach(function (img) {
        if (img.dataset.srcset) img.srcset = img.dataset.srcset;
        img.src = img.dataset.src;
    });
    document.querySelectorAll('.work-img:not([data-src])').forEach(function (img) {
        img.loading = 'eager'; /* Start loading immediately after entering the portfolio. */
    });
}

/*
   Home page scroll transitions:
   - Scroll or swipe down to open the portfolio.
   - Scroll or swipe up to return to the home page.
   */

/* Animation timing constants. */
var ANIM_DELAY = { initialReveal: 200, homeExit: 250, portfolioReveal: 300, staggerStep: 150, reverseExit: 250 };
var STAGGER_BUDGET = 1500; /* Maximum total duration of the staggered portfolio card fade-in, in ms. */

/* The number of portfolio images comes from src/static/portfolio and can vary.
   Reduce the stagger interval as needed so the last image does not take several seconds to appear. */
function staggerStep() {
    var n = workBoxes.length;
    return n > 1 ? Math.min(ANIM_DELAY.staggerStep, STAGGER_BUDGET / (n - 1)) : ANIM_DELAY.staggerStep;
}
var SWIPE_THRESHOLD = 60;
var WHEEL_THRESHOLD = 30;

var homeScreen = document.getElementById('home-screen');
var portfolioScreen = document.getElementById('portfolio');
var portfolioTitle = document.getElementById('port-title');
var homeRevealItems = homeScreen.querySelectorAll('.reveal-item');
var workBoxes = document.querySelectorAll('.work-box');
var heroTitle = document.getElementById('hero-title');
var navLogo = document.getElementById('nav-logo');

function setPortfolioPath(replace) {
    var url = new URL('/portfolio', location.href);
    if (location.pathname !== url.pathname || location.hash) {
        history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search);
    }
}

/* Keep nav-logo hidden; hero-title takes its place. */
if (navLogo) navLogo.classList.add('is-hidden');

heroTitle.addEventListener('click', function() { if (!isOnHome) reverseToHome(); });

var isOnHome = true;
var isTransitioning = false;
var animSeq = 0; // Increment for each animation so pending timers from older animations can be ignored.
var touchStartY = 0;

/*
 * Scroll down: brackets fade out (233ms), fly to the navigation (200ms), fade, then show nav-logo.
 * Scroll up: hide nav-logo, fly back to center, and restore the brackets.
 */

function morphHeroToNav() {
    if (!heroTitle) return;
    var seq = animSeq;
    // Fade out the brackets.
    heroTitle.classList.add('hero-closed');
    // Fly to the upper-left after 233ms.
    setTimeout(function() {
        if (seq !== animSeq) return;
        var navRect = navLogo.getBoundingClientRect();
        var vw = window.innerWidth, vh = window.innerHeight;
        var scale = window.innerWidth >= 768 ? 0.333 : 0.5;
        var dx = (navRect.left + navRect.width / 2) - vw / 2;
        var dy = (navRect.top + navRect.height / 2) - vh / 2;
        heroTitle.classList.add('flying');
        heroTitle.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px)) scale(' + scale + ')';
        setTimeout(function() {
            if (seq !== animSeq) return;
            heroTitle.style.transition = 'opacity 67ms ease-out';
            heroTitle.style.opacity = '0';
            navLogo.classList.remove('is-hidden');
            navLogo.onclick = function(e) { e.preventDefault(); reverseToHome(); };
            setTimeout(function() {
                if (seq !== animSeq) return;
                heroTitle.style.display = 'none';
                heroTitle.style.transition = '';
                heroTitle.style.opacity = '';
            }, 67);
        }, 200);
    }, 233);
}

function morphHeroBack() {
    if (!heroTitle) return;
    var seq = animSeq;
    navLogo.onclick = null;
    navLogo.classList.add('is-hidden');
    // Restore all inline styles so transition or display values from the flight do not remain.
    heroTitle.style.display = '';
    heroTitle.style.opacity = '';
    heroTitle.style.transition = '';
    heroTitle.classList.add('flying');
    void heroTitle.offsetWidth;
    heroTitle.classList.remove('hero-closed');
    heroTitle.style.transform = 'translate(-50%, -50%)';
    setTimeout(function() {
        if (seq !== animSeq) return;
        heroTitle.classList.remove('flying');
        // reverseToHome resets isTransitioning and isOnHome in the required order.
    }, 267);
}

function showPortfolio() {
    // hero-title has reached the navigation and stays there as the logo.
    var seq = animSeq;
    portfolioScreen.scrollTop = 0; // Start at the top so no previous scroll momentum remains.
    homeScreen.style.display = 'none';
    portfolioScreen.style.visibility = 'visible';
    portfolioScreen.style.opacity = '1';
    loadWorkImages();
    // Use a dedicated path when scrolling down to the portfolio.
    setPortfolioPath(false);

    setTimeout(function() {
        if (seq !== animSeq) return;
        portfolioTitle.classList.add('show');
        workBoxes.forEach(function(box, index) {
            setTimeout(function() {
                if (seq !== animSeq) return;
                box.classList.add('show');
            }, index * staggerStep());
        });
        isOnHome = false;
        isTransitioning = false;
    }, ANIM_DELAY.portfolioReveal);
}

function triggerCapture() {
    if (isTransitioning || !isOnHome) return;
    isTransitioning = true;
    animSeq++;
    var seq = animSeq;
    document.querySelector('.scroll-hint').style.display = 'none';
    homeRevealItems.forEach(function(item) {
        item.classList.remove('show');
        item.classList.add('exit-up');
    });
    morphHeroToNav();
    setTimeout(function() {
        if (seq !== animSeq) return;
        showPortfolio();
    }, 533);
}

/* Direct visits to /portfolio skip the scroll transition and show the portfolio immediately.
   Keep the existing staggered fade-in for work-box cards. */
function showPortfolioDirect() {
    if (isTransitioning) return;
    isTransitioning = true;
    animSeq++;
    var seq = animSeq;
    // Hide the home screen and hero title without the flight animation.
    portfolioScreen.scrollTop = 0;
    homeScreen.style.display = 'none';
    if (heroTitle) heroTitle.style.display = 'none';
    if (navLogo) {
        navLogo.classList.remove('is-hidden');
        navLogo.onclick = function(e) { e.preventDefault(); reverseToHome(); };
    }
    portfolioScreen.style.visibility = 'visible';
    portfolioScreen.style.opacity = '1';
    loadWorkImages();
    setTimeout(function() {
        if (seq !== animSeq) return;
        portfolioTitle.classList.add('show');
        workBoxes.forEach(function(box, index) {
            setTimeout(function() {
                if (seq !== animSeq) return;
                box.classList.add('show');
            }, index * staggerStep());
        });
        isOnHome = false;
        isTransitioning = false;
    }, ANIM_DELAY.portfolioReveal);
}

function resetHomeItems() {
    document.querySelector('.scroll-hint').style.display = '';
    homeRevealItems.forEach(function(item) {
        item.classList.remove('exit-up', 'show');
        item.classList.add('from-top');
    });
    void homeScreen.offsetWidth;
    requestAnimationFrame(function() {
        homeRevealItems.forEach(function(item) {
            item.classList.remove('from-top');
            item.classList.add('show');
        });
    });
}

function reverseToHome() {
    if (isOnHome || isTransitioning || portfolioScreen.scrollTop > 10) return;
    isTransitioning = true;
    animSeq++;
    var seq = animSeq;
    portfolioScreen.classList.add('portfolio-exit');
    morphHeroBack();
    // Align with morphHeroBack removing flying after 400ms to avoid an inconsistent intermediate state.
    setTimeout(function() {
        if (seq !== animSeq) return;
        portfolioScreen.style.visibility = 'hidden';
        portfolioScreen.style.opacity = '0';
        portfolioScreen.classList.remove('portfolio-exit');
        document.querySelectorAll('.work-box, #port-title').forEach(function(item) { item.classList.remove('show'); });
        homeScreen.style.display = 'flex';
        void homeScreen.offsetWidth;
        resetHomeItems();
        isOnHome = true;
        isTransitioning = false;
        // Normalize the URL to the root when returning home.
        if (location.pathname === '/portfolio' || location.hash) history.replaceState(null, '', '/' + location.search);
    }, Math.max(ANIM_DELAY.reverseExit, 400));
}

/* Listen for mouse wheel input. */
window.addEventListener('wheel', function(event) {
    // Consume wheel events during transitions so trackpad momentum cannot keep scrolling the portfolio.
    if (isTransitioning) { event.preventDefault(); return; }
    if (event.deltaY > WHEEL_THRESHOLD && isOnHome) { event.preventDefault(); triggerCapture(); return; }
    if (event.deltaY < -WHEEL_THRESHOLD && !isOnHome && portfolioScreen.scrollTop <= 0) { event.preventDefault(); reverseToHome(); }
}, { passive: false });

/* Listen for touch swipes. */
document.addEventListener('touchstart', function(event) {
    touchStartY = event.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', function(event) {
    if (isTransitioning) return;
    var swipeDistance = touchStartY - event.changedTouches[0].clientY;
    if (isOnHome && swipeDistance > SWIPE_THRESHOLD) { triggerCapture(); return; }
    if (!isOnHome && swipeDistance < -SWIPE_THRESHOLD && portfolioScreen.scrollTop <= 0) { reverseToHome(); }
}, { passive: true });

/* Keep the page in sync with the URL when navigating backward or forward. */
window.addEventListener('popstate', function() {
    if (location.pathname === '/portfolio' || location.hash === '#portfolio') {
        if (isOnHome && !isTransitioning) showPortfolioDirect();
    } else {
        if (!isOnHome && !isTransitioning) reverseToHome();
    }
});


/* Fly in the title, then fade in the arrows in sequence. */
setTimeout(function() {
    heroTitle.classList.add('visible');
}, 200);
setTimeout(function() {
    document.querySelectorAll('.scroll-hint.reveal-item').forEach(function(el) {
        el.classList.add('show');
    });
}, 500);

/* Show the portfolio on direct visits to its path; continue supporting legacy hash links. */
if (location.pathname === '/portfolio' || location.hash === '#portfolio') {
    if (location.hash === '#portfolio') history.replaceState(null, '', '/portfolio' + location.search);
    setTimeout(function() { showPortfolioDirect(); }, 100);
}
