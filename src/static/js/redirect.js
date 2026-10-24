/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.md.
 */

(function () {
        document.documentElement.lang = document.body.getAttribute('data-lang') || 'en-us';
        var target = document.body.getAttribute('data-to') || '/';
        var rels = JSON.parse(document.body.getAttribute('data-preload') || '[]');
        function go() { location.replace(target); }

        /* When the target is limooo.cn, <link rel=preload> in the head already warms the home portfolio images.
           Use new Image() to observe the same URLs; in-flight requests and cached images are reused.
           Redirect as soon as they are ready, with an 800ms limit to avoid slowing a login return. */
        if (rels.length === 0) { go(); return; }

        var pending = rels.length;
        var fired = false;
        function finish() {
            if (fired) return;
            fired = true;
            go();
        }
        rels.forEach(function (rel) {
            var img = new Image();
            img.referrerPolicy = 'origin';
            img.onload = img.onerror = function () {
                pending -= 1;
                if (pending <= 0) finish();
            };
            img.src = rel.indexOf('http') === 0 ? rel : rel;
        });
        setTimeout(finish, 800);
    })();
