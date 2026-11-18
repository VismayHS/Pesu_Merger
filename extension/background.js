// Opens (or focuses) the downloader page. All heavy work happens in app.html so it can
// run for as long as needed without the service worker being suspended.
const APP_URL = chrome.runtime.getURL('app.html');

async function openApp(params) {
  const url = APP_URL + (params ? '?' + new URLSearchParams(params).toString() : '');
  // getContexts finds our own page without needing the broad "tabs" permission.
  let ctx = [];
  try {
    ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
  } catch (_) { /* older browser */ }
  const mine = ctx.find((c) => c.tabId >= 0 && (c.documentUrl || '').startsWith(APP_URL));
  if (mine) {
    // Just bring it to the front. Never reload it: that would throw away a download in progress.
    let shown = true;
    try { await chrome.tabs.update(mine.tabId, { active: true }); } catch (_) { shown = false; /* tab vanished */ }
    if (shown) {
      try { await chrome.windows.update(mine.windowId, { focused: true }); } catch (_) { /* focus is best effort */ }
      if (params && params.course) chrome.runtime.sendMessage({ type: 'select-course', courseId: params.course }).catch(() => {});
      return;
    }
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => openApp());

// After the extension is installed, reloaded or updated, the button in PESU tabs that were already
// open is disconnected. Put a fresh, working one into each of those tabs - no page refresh needed.
const PESU_PAGES = ['https://www.pesuacademy.com/Academy/*', 'https://pesuacademy.com/Academy/*'];
async function refreshPesuButtons() {
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: PESU_PAGES }); } catch (_) { return; }
  for (const t of tabs) {
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] }).catch(() => { /* tab busy or closed */ });
  }
}
chrome.runtime.onInstalled.addListener(refreshPesuButtons);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'open-app') {
    openApp(msg.courseId ? { course: msg.courseId } : null).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
