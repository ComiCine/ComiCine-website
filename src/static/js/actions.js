/**
 * CSP-friendly event delegation layer (tasks/14).
 *
 * Templates declare data-action / data-input instead of inline onclick/oninput handlers.
 * After page load, this file delegates them to the matching global functions on window.
 * This keeps script-src at 'self' without requiring 'unsafe-inline'.
 */
(function () {
  function runAction(el, event) {
    var name = el.getAttribute("data-action");
    if (el.hasAttribute("data-stop")) event.stopPropagation();
    if (!name || name === "none") return;

    var args = [];
    if (el.hasAttribute("data-arg")) {
      var raw = el.getAttribute("data-arg");
      var kind = el.getAttribute("data-arg-type");
      if (kind === "json") {
        try { args.push(JSON.parse(raw)); } catch (_) { args.push(raw); }
      } else if (kind === "number") {
        args.push(Number(raw));
      } else {
        args.push(raw);
      }
    }
    if (el.hasAttribute("data-needs-event")) args.push(event);

    var fn = window[name];
    if (typeof fn === "function") fn.apply(el, args);
    if (el.hasAttribute("data-prevent")) event.preventDefault();
  }

  document.addEventListener("click", function (event) {
    var el = event.target.closest("[data-action]");
    if (el) runAction(el, event);
  });

  document.addEventListener("input", function (event) {
    var el = event.target.closest("[data-input]");
    if (!el) return;
    var fn = window[el.getAttribute("data-input")];
    if (typeof fn === "function") fn.call(el, event);
  });
})();
