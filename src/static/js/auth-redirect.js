/*
 * Copyright (C) 2026-Present ComiCine
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Section 7 additional terms apply when the work is used under GNU AGPL v3.
 * See ADDITIONAL_TERMS.txt.
 */

(function() {
    var script = document.currentScript;
    var target = script && script.getAttribute('data-target');
    if (!target) return;

    try {
        var destination = new URL(target);
        if (
            destination.protocol !== 'https:' ||
            destination.hostname !== 'identity.limooo.cn' ||
            destination.port !== '' ||
            destination.pathname !== '/login'
        ) return;
        window.location.replace(destination.href);
    } catch {
        return;
    }
})();
