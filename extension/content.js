// Adds a small floating "Download course" button on PESU Academy course pages.
(function () {
  if (window.__pesuDlInjected) return;
  window.__pesuDlInjected = true;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '⬇ PESU Downloader';
  btn.title = 'Open PESU Downloader (download / convert / merge course material)';
  btn.style.cssText = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483646', 'padding:9px 14px',
    'border-radius:999px', 'border:0', 'background:#0b5cad', 'color:#fff', 'font:600 13px system-ui,Segoe UI,sans-serif',
    'box-shadow:0 4px 14px rgba(0,0,0,.25)', 'cursor:pointer', 'opacity:.92',
  ].join(';');
  btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
  btn.addEventListener('mouseleave', () => (btn.style.opacity = '.92'));
  btn.addEventListener('click', () => {
    // If a course page is open, pass its id so the app can preselect it.
    let courseId = null;
    const unitLink = document.querySelector('a[onclick*="courseContentinfo"]');
    const m = unitLink && (unitLink.getAttribute('onclick') || '').match(/courseContentinfo\('(\d+)'/);
    if (m) courseId = m[1];
    if (!courseId) {
      const cell = document.querySelector('[onclick*="handleclasscoursecontentunit"]');
      const mm = cell && (cell.getAttribute('onclick') || '').replace(/\s+/g, '').match(/handleclasscoursecontentunit\('[^']*','(\d+)'/);
      if (mm) courseId = mm[1];
    }
    try {
      chrome.runtime.sendMessage({ type: 'open-app', courseId });
    } catch (_) {
      /* extension reloaded; ignore */
    }
  });
  document.documentElement.appendChild(btn);

  // Tell an open downloader page that a PESU page finished loading (e.g. right after you log in
  // again) so a paused download can resume immediately instead of waiting for its next check.
  try {
    const loggedIn = !document.querySelector('input[type="password"]');
    chrome.runtime.sendMessage({ type: 'pesu-page', loggedIn }).catch(() => {});
  } catch (_) { /* extension reloaded */ }
})();
