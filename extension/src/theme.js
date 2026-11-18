/* Applies the saved light / dark choice before the page paints (no flash). Without a choice, the system setting is used. */
(function () {
  try {
    var t = localStorage.getItem('pesu-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (_) { /* storage blocked: follow the system */ }
})();
