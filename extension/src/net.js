/* Network access to PESU Academy with automatic fallbacks.
 *
 * Pages (HTML):
 *   1. "direct": fetch from the extension page with the browser's cookies (host permission).
 *   2. "tab":    run the fetch inside an open pesuacademy.com tab (always has the session).
 * Files:
 *   1. direct fetch of /referenceMeterials/... (follows the redirect to the signed CDN URL).
 *   2. trigger the request inside the PESU tab, capture the signed CDN redirect with webRequest,
 *      then fetch the signed URL from the extension (no cookies needed for it).
 *   3. (caller) let the browser's own downloader fetch it (chrome.downloads) - see Net.browserDownload.
 */
(function (global) {
  'use strict';

  const ORIGIN = PESU.ORIGIN;
  const PESU_TAB_PATTERNS = ['https://www.pesuacademy.com/*', 'https://pesuacademy.com/*'];
  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const err = (msg, retryable, extra) => Object.assign(new Error(msg), { retryable: !!retryable }, extra || {});

  function waitTabComplete(tabId, timeout = 45000) {
    return new Promise((resolve) => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(onUpd);
        clearTimeout(t);
        resolve();
      };
      const onUpd = (id, info) => {
        if (id === tabId && info.status === 'complete') done();
      };
      const t = setTimeout(done, timeout);
      chrome.tabs.onUpdated.addListener(onUpd);
      chrome.tabs.get(tabId).then((tab) => { if (tab && tab.status === 'complete') done(); }).catch(done);
    });
  }

  const Net = {
    mode: null,
    tabId: null,
    directFiles: true,
    onLog: null,

    log(level, msg) { if (this.onLog) this.onLog(level, msg); },

    /** Establish a working route. Throws PESU.SessionExpiredError when not logged in. */
    async init() {
      this.mode = null;
      try {
        const r = await fetch(ORIGIN + PESU.urls.semesters(), { credentials: 'include', cache: 'no-store' });
        const t = await r.text();
        if (r.ok && /<option/i.test(t)) {
          this.mode = 'direct';
          this.semestersHtml = t; // the page reuses this instead of asking PESU again
          return this.mode;
        }
      } catch (_) { /* fall through to tab mode */ }
      const r = await this.tabFetch(PESU.urls.semesters());
      if (r.ok && /<option/i.test(r.text || '')) {
        this.mode = 'tab';
        this.semestersHtml = r.text;
        return this.mode;
      }
      throw new PESU.SessionExpiredError();
    },

    async findPesuTab() {
      if (this.tabId != null) {
        try {
          const t = await chrome.tabs.get(this.tabId);
          if (t && /^https:\/\/(www\.)?pesuacademy\.com\//.test(t.url || t.pendingUrl || '')) return t;
        } catch (_) { /* closed */ }
        this.tabId = null;
      }
      const tabs = await chrome.tabs.query({ url: PESU_TAB_PATTERNS });
      const t = tabs.find((x) => x.status === 'complete') || tabs[0];
      if (t) this.tabId = t.id;
      return t || null;
    },

    async ensureTab() {
      let t = await this.findPesuTab();
      if (!t) {
        t = await chrome.tabs.create({ url: ORIGIN + '/Academy/', active: false });
        this.tabId = t.id;
        await waitTabComplete(t.id);
        this.log('info', 'Opened a background PESU Academy tab to use your login session.');
      } else if (t.status !== 'complete') {
        await waitTabComplete(t.id);
      }
      return t;
    },

    async tabFetch(path) {
      const tab = await this.ensureTab();
      let res;
      try {
        [res] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async (url) => {
            try {
              const r = await fetch(url, { credentials: 'include', cache: 'no-store' });
              return { ok: r.ok, status: r.status, text: await r.text() };
            } catch (e) {
              return { ok: false, status: 0, error: String(e) };
            }
          },
          args: [path],
        });
      } catch (e) {
        // tab navigated away / closed / not injectable -> forget it and let retry pick another
        this.tabId = null;
        throw err('PESU tab unavailable: ' + e.message, true);
      }
      return (res && res.result) || { ok: false, status: 0, error: 'no result' };
    },

    /** GET an HTML/text endpoint. */
    async text(path) {
      return U.retry(async () => {
        let r;
        if (this.mode === 'direct') {
          try {
            const resp = await fetch(ORIGIN + path, { credentials: 'include', cache: 'no-store' });
            r = { ok: resp.ok, status: resp.status, text: await resp.text() };
          } catch (e) {
            throw err('Network error: ' + e.message, true);
          }
        } else {
          r = await this.tabFetch(path);
        }
        if (!r.ok) throw err('HTTP ' + r.status + (r.error ? ' ' + r.error : ''), r.status === 0 || r.status === 429 || r.status >= 500);
        if (PESU.looksLikeLogin(r.text)) throw new PESU.SessionExpiredError();
        return r.text;
      }, {
        tries: 5,
        isRetryable: (e) => e.retryable === true,
        onRetry: (e, n, wait) => this.log('warn', `Retrying page request (${n}) in ${Math.round(wait / 1000)}s: ${e.message}`),
      });
    },

    /** Download a document. Returns { bytes, filename, contentType, via }. */
    async file(path) {
      return U.retry(async (attempt) => {
        if (this.directFiles) {
          let resp = null;
          try {
            resp = await fetch(ORIGIN + path, { credentials: 'include', cache: 'no-store' });
          } catch (e) {
            resp = null; // network/redirect problem -> try the tab route below
          }
          if (resp) {
            const ct = resp.headers.get('content-type') || '';
            const onCdn = !/^https:\/\/(www\.)?pesuacademy\.com\//.test(resp.url);
            if (resp.ok && (onCdn || !/text\/html/i.test(ct))) {
              const bytes = new Uint8Array(await resp.arrayBuffer());
              return { bytes, filename: U.filenameFrom(resp.headers.get('content-disposition'), resp.url), contentType: ct, via: 'direct' };
            }
            if (resp.ok) {
              const text = await resp.text();
              if (PESU.looksLikeLogin(text)) {
                // cookies are not sent from the extension context -> use the tab route from now on
                this.directFiles = false;
                this.log('info', 'Switching file downloads to the PESU tab route.');
              } else {
                throw err('Server returned a web page instead of the file', false);
              }
            } else if (resp.status === 404 || resp.status === 403) {
              if (onCdn) throw err('File missing on server (HTTP ' + resp.status + ')', attempt < 1);
              // 403 on www can mean an expired session
              this.directFiles = false;
            } else if (resp.status >= 500 || resp.status === 429) {
              throw err('Server busy (HTTP ' + resp.status + ')', true);
            }
          }
        }
        const signed = await this.captureSignedUrl(path);
        let resp;
        try {
          resp = await fetch(signed, { cache: 'no-store' });
        } catch (e) {
          throw err('Network error: ' + e.message, true);
        }
        if (!resp.ok) throw err('File server error (HTTP ' + resp.status + ')', resp.status >= 500 || resp.status === 429 || resp.status === 403);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        return { bytes, filename: U.filenameFrom(resp.headers.get('content-disposition'), signed), contentType: resp.headers.get('content-type') || '', via: 'tab' };
      }, {
        tries: 5,
        base: 1500,
        isRetryable: (e) => e.retryable === true,
        onRetry: (e, n, wait) => this.log('warn', `Retrying download (${n}) in ${Math.round(wait / 1000)}s: ${e.message}`),
      });
    },

    /** Ask the PESU tab to request the file and capture the signed CDN URL from the redirect. */
    async captureSignedUrl(path) {
      const id = (path.match(UUID_RE) || [''])[0].toLowerCase();
      const tab = await this.ensureTab();
      return new Promise((resolve, reject) => {
        const filter = { urls: ['https://www.pesuacademy.com/Academy/*', 'https://pesuacademy.com/Academy/*'] };
        let settled = false;
        const finish = (fn, v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          chrome.webRequest.onBeforeRedirect.removeListener(onRedirect);
          chrome.webRequest.onCompleted.removeListener(onCompleted);
          chrome.webRequest.onErrorOccurred.removeListener(onError);
          fn(v);
        };
        const mine = (d) => d.url.toLowerCase().includes(id) && d.tabId === tab.id;
        const onRedirect = (d) => {
          if (mine(d) && /^https:\/\//.test(d.redirectUrl) && !/pesuacademy\.com\/Academy\//.test(d.redirectUrl)) finish(resolve, d.redirectUrl);
        };
        const onCompleted = (d) => {
          if (!mine(d)) return;
          if (d.statusCode >= 500) finish(reject, err('Server busy (HTTP ' + d.statusCode + ')', true));
          else finish(reject, d.statusCode === 200 ? new PESU.SessionExpiredError() : err('No file link (HTTP ' + d.statusCode + ')', false));
        };
        const onError = (d) => { if (mine(d) && !/ABORTED/i.test(d.error)) finish(reject, err('Request failed: ' + d.error, true)); };
        const timer = setTimeout(() => finish(reject, err('Timed out waiting for the file link', true)), 30000);
        chrome.webRequest.onBeforeRedirect.addListener(onRedirect, filter);
        chrome.webRequest.onCompleted.addListener(onCompleted, filter);
        chrome.webRequest.onErrorOccurred.addListener(onError, filter);
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (u) => {
            const c = new AbortController();
            fetch(u, { mode: 'no-cors', credentials: 'include', cache: 'no-store', signal: c.signal }).catch(() => {});
            setTimeout(() => c.abort(), 20000);
            return true;
          },
          args: [path],
        }).catch((e) => {
          this.tabId = null;
          finish(reject, err('PESU tab unavailable: ' + e.message, true));
        });
      });
    },

    /**
     * Last resort: let the browser download the file itself (handles cookies, redirects, odd CDN behaviour).
     * relBase = path inside Downloads without extension; the server's extension is appended.
     * Resolves { id, filename (absolute), mime }.
     */
    browserDownload(path, relBase) {
      const url = ORIGIN + path;
      return new Promise((resolve, reject) => {
        let dlId = null;
        let settled = false;
        const onDetermine = (item, suggest) => {
          if (item.byExtensionId !== chrome.runtime.id || (item.id !== dlId && item.url !== url)) {
            suggest();
            return;
          }
          const ext = U.extOf(item.filename) || 'bin';
          suggest({ filename: relBase + '.' + ext, conflictAction: 'overwrite' });
        };
        const cleanup = () => {
          chrome.downloads.onDeterminingFilename.removeListener(onDetermine);
          chrome.downloads.onChanged.removeListener(onChanged);
          clearTimeout(timer);
        };
        const finish = (fn, v) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn(v);
        };
        const onChanged = async (delta) => {
          if (delta.id !== dlId || !delta.state) return;
          if (delta.state.current === 'complete') {
            const [item] = await chrome.downloads.search({ id: dlId });
            finish(resolve, { id: dlId, filename: item && item.filename, mime: item && item.mime });
          } else if (delta.state.current === 'interrupted') {
            const [item] = await chrome.downloads.search({ id: dlId });
            finish(reject, err('Browser download failed: ' + ((item && item.error) || 'interrupted'), false));
          }
        };
        const timer = setTimeout(() => finish(reject, err('Browser download timed out', false)), 10 * 60 * 1000);
        chrome.downloads.onDeterminingFilename.addListener(onDetermine);
        chrome.downloads.onChanged.addListener(onChanged);
        chrome.downloads.download({ url, saveAs: false, conflictAction: 'overwrite' }, (id) => {
          if (chrome.runtime.lastError || id == null) {
            finish(reject, err('Browser download failed: ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'unknown'), false));
            return;
          }
          dlId = id;
        });
      });
    },
  };

  global.Net = Net;
})(typeof self !== 'undefined' ? self : this);
