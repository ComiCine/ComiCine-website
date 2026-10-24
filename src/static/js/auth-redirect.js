/*
 * Copyright (C) 2026-Present Limooo Studio
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Additional terms under Section 7 apply.
 * See ADDITIONAL_TERMS.md.
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
