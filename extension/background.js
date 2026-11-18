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
    try {
      const t = await chrome.tabs.update(mine.tabId, params ? { active: true, url } : { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return;
    } catch (_) { /* tab vanished - open a new one */ }
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => openApp());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'open-app') {
    openApp(msg.courseId ? { course: msg.courseId } : null).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
