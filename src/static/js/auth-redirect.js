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
