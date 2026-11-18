// Opens (or focuses) the downloader page. All heavy work happens in app.html so it can
// run for as long as needed without the background script being suspended.
// Runs as a service worker in Chrome-based browsers and as a background script in Firefox.
// Firefox: the promise-based "browser" API; Chrome, Edge, Brave…: "chrome".
const ext = (typeof browser !== 'undefined' && browser.runtime && browser.runtime.id ? browser : chrome);
const APP_URL = ext.runtime.getURL('app.html');

/** Finds an open downloader page, as { tabId, windowId }, without needing the broad "tabs" permission. */
async function findAppTab() {
  if (ext.runtime.getContexts) { // Chrome, Edge, Brave…
    try {
      const ctx = await ext.runtime.getContexts({ contextTypes: ['TAB'] });
      return ctx.find((c) => c.tabId >= 0 && (c.documentUrl || '').startsWith(APP_URL)) || null;
    } catch (_) { /* fall through */ }
  }
  // Firefox: ask the page itself (it knows its own tab). No answer within a moment = not open.
  try {
    const r = await Promise.race([
      ext.runtime.sendMessage({ type: 'where-are-you' }),
      new Promise((res) => setTimeout(() => res(null), 400)),
    ]);
    return r && r.tabId >= 0 ? r : null;
  } catch (_) {
    return null; // nobody listening
  }
}

async function openApp(params) {
  const url = APP_URL + (params ? '?' + new URLSearchParams(params).toString() : '');
  const mine = await findAppTab();
  if (mine) {
    // Just bring it to the front. Never reload it: that would throw away a download in progress.
    let shown = true;
    try { await ext.tabs.update(mine.tabId, { active: true }); } catch (_) { shown = false; /* tab vanished */ }
    if (shown) {
      try { await ext.windows.update(mine.windowId, { focused: true }); } catch (_) { /* focus is best effort */ }
      if (params && params.course) ext.runtime.sendMessage({ type: 'select-course', courseId: params.course }).catch(() => {});
      return;
    }
  }
  await ext.tabs.create({ url });
}

ext.action.onClicked.addListener(() => openApp());

// After the extension is installed, reloaded or updated, the button in PESU tabs that were already
// open is disconnected. Put a fresh, working one into each of those tabs - no page refresh needed.
const PESU_PAGES = ['https://www.pesuacademy.com/Academy/*', 'https://pesuacademy.com/Academy/*'];
async function refreshPesuButtons() {
  let tabs = [];
  try { tabs = await ext.tabs.query({ url: PESU_PAGES }); } catch (_) { return; }
  for (const t of tabs) {
    ext.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => { /* tab busy or closed */ });
  }
}
ext.runtime.onInstalled.addListener(refreshPesuButtons);

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'open-app') {
    openApp(msg.courseId ? { course: msg.courseId } : null).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
