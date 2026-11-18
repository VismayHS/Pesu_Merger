/* Client for the local converter helper (native messaging host "com.pesu.downloader").
 * Large payloads are chunked both ways (host -> browser messages are capped at 1 MB by Chrome).
 */
(function (global) {
  'use strict';

  const HOST = 'com.pesu.downloader';
  const SEND_CHUNK = 4 * 1024 * 1024;

  class NativeHost {
    constructor() {
      this.port = null;
      this.pending = new Map();
      this.nextId = 1;
      this.info = null;
      this.lastError = null;
      this.queue = Promise.resolve();
    }

    _connect() {
      if (this.port) return this.port;
      const port = chrome.runtime.connectNative(HOST);
      port.onMessage.addListener((m) => this._onMessage(m));
      port.onDisconnect.addListener(() => {
        const err = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Converter helper disconnected';
        this.lastError = err;
        if (this.port === port) this.port = null;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error(err));
        }
        this.pending.clear();
      });
      this.port = port;
      return port;
    }

    _onMessage(m) {
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'result') {
        if (!m.ok) {
          this._done(m.id);
          p.reject(new Error(m.error || 'Helper error'));
          return;
        }
        p.meta = m.meta || {};
        p.total = m.chunks || 0;
        p.parts = new Array(p.total);
        p.got = 0;
        if (!p.total) {
          this._done(m.id);
          p.resolve({ meta: p.meta, bytes: null });
        }
      } else if (m.type === 'chunk') {
        if (!p.parts) return;
        p.parts[m.i] = U.b64decode(m.data);
        p.got++;
        if (p.got === p.total) {
          this._done(m.id);
          p.resolve({ meta: p.meta, bytes: U.concat(p.parts) });
        }
      }
    }

    _done(id) {
      const p = this.pending.get(id);
      if (p) clearTimeout(p.timer);
      this.pending.delete(id);
    }

    /** Low-level request. Requests are serialised so big transfers don't interleave. */
    request(op, meta = {}, bytes = null, timeoutMs = 10 * 60 * 1000) {
      const run = () => new Promise((resolve, reject) => {
        let port;
        try {
          port = this._connect();
        } catch (e) {
          reject(e);
          return;
        }
        const id = this.nextId++;
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error('Converter helper timed out (' + op + ')'));
        }, timeoutMs);
        this.pending.set(id, { resolve, reject, timer });
        try {
          const data = bytes ? U.u8(bytes) : null;
          const n = data ? Math.ceil(data.length / SEND_CHUNK) : 0;
          port.postMessage({ id, op, meta, chunks: n });
          for (let i = 0; i < n; i++) {
            port.postMessage({ id, op: 'chunk', i, data: U.b64encode(data.subarray(i * SEND_CHUNK, (i + 1) * SEND_CHUNK)) });
          }
        } catch (e) {
          this._done(id);
          reject(e);
        }
      });
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }

    /** Returns helper info or null when the helper is not installed. */
    async ping() {
      try {
        const r = await this.request('ping', {}, null, 20000);
        this.info = r.meta;
        this.lastError = null;
        return this.info;
      } catch (e) {
        this.info = null;
        this.lastError = e.message;
        return null;
      }
    }

    get available() { return !!this.info; }

    canConvert() {
      if (!this.info) return false;
      const o = this.info.office || {};
      return !!(o.powerpoint || o.word || o.excel || this.info.libreoffice);
    }

    async convert(bytes, ext, name, engine = 'auto') {
      const r = await this.request('convert', { ext, name, engine }, bytes);
      return { bytes: r.bytes, engine: r.meta.engine };
    }

    async repairPdf(bytes) {
      const r = await this.request('repair_pdf', {}, bytes, 5 * 60 * 1000);
      return r.bytes;
    }

    async readFile(path) {
      const r = await this.request('read_file', { path });
      return r.bytes;
    }

    async deleteFile(path) {
      try { await this.request('delete_file', { path }, null, 20000); } catch (_) { /* ignore */ }
    }

    async openFolder(path) {
      await this.request('open_folder', { path }, null, 20000);
    }
  }

  global.NativeHost = NativeHost;
})(typeof self !== 'undefined' ? self : this);
