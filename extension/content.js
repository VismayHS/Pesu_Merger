// Adds a small floating "PESU Downloader" button on PESU Academy pages.
// When the extension is reloaded or updated, background.js injects this script again into the
// PESU tabs that are already open: the new copy replaces the old (disconnected) button, so the
// button keeps working without refreshing the page.
(function () {
  const BTN_ID = 'pesu-downloader-btn';
  // Always replace: the newest copy of this script is the one that's connected to the extension.
  document.querySelectorAll('#' + BTN_ID).forEach((el) => el.remove());

  const LABEL = '⬇ PESU Downloader';
  const btn = document.createElement('button');
  btn.id = BTN_ID;
  btn.type = 'button';
  btn.textContent = LABEL;
  btn.title = 'Open PESU Downloader (download / convert / merge course material)';
  btn.style.cssText = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483646', 'padding:9px 14px',
    'border-radius:999px', 'border:0', 'background:#0b5cad', 'color:#fff', 'font:600 13px system-ui,Segoe UI,sans-serif',
    'box-shadow:0 4px 14px rgba(0,0,0,.25)', 'cursor:pointer', 'opacity:.92', 'transition:opacity .15s',
  ].join(';');
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '.92'));

  // After the extension is reloaded or updated, scripts in tabs that were already open lose their
  // connection to it. Clicking would then do nothing, so say so and offer a page refresh instead.
  const alive = () => {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; }
  };
  let stale = false;
  function markStale() {
    stale = true;
    btn.textContent = '↻ Refresh page to use PESU Downloader';
    btn.title = 'The extension was updated. Refresh this page once to reconnect.';
    btn.style.background = '#8a5a00';
  }

  function courseIdOnPage() {
    const unitLink = document.querySelector('a[onclick*="courseContentinfo"]');
    const m = unitLink && (unitLink.getAttribute('onclick') || '').match(/courseContentinfo\('(\d+)'/);
    if (m) return m[1];
    const cell = document.querySelector('[onclick*="handleclasscoursecontentunit"]');
    const mm = cell && (cell.getAttribute('onclick') || '').replace(/\s+/g, '').match(/handleclasscoursecontentunit\('[^']*','(\d+)'/);
    return mm ? mm[1] : null;
  }

  let busy = false;
  btn.addEventListener('click', () => {
    if (stale || !alive()) {
      if (stale) location.reload();
      else markStale();
      return;
    }
    if (busy) return;
    busy = true;
    btn.textContent = 'Opening…';
    const done = () => { busy = false; btn.textContent = LABEL; };
    const timer = setTimeout(done, 4000);
    try {
      chrome.runtime.sendMessage({ type: 'open-app', courseId: courseIdOnPage() }, () => {
        void chrome.runtime.lastError; // a sleeping background worker is woken up by the message itself
        clearTimeout(timer);
        done();
      });
    } catch (_) {
      clearTimeout(timer);
      busy = false;
      markStale();
    }
  });
  document.documentElement.appendChild(btn);

  // Tell an open downloader page that a PESU page finished loading (e.g. right after you log in
  // again) so a paused download can resume immediately instead of waiting for its next check.
  const ping = () => {
    if (!alive()) return;
    try {
      const loggedIn = !document.querySelector('input[type="password"]');
      chrome.runtime.sendMessage({ type: 'pesu-page', loggedIn }).catch(() => {});
    } catch (_) { /* extension reloaded */ }
  };
  if (document.readyState === 'complete') ping();
  else window.addEventListener('load', ping, { once: true });
})();
