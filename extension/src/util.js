(function (global) {
  'use strict';

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

  /** Make a string safe as a single Windows/Chrome path segment. */
  function safeName(name, max = 90) {
    let s = String(name == null ? '' : name)
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[<>:"/\\|?*]/g, ' ')
      .replace(/[​-‏‪-‮﻿]/g, '')
      .replace(/~/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length > max) s = s.slice(0, max).trim();
    s = s.replace(/^[.\s]+|[.\s]+$/g, '');
    if (!s) s = 'untitled';
    if (RESERVED.test(s)) s = '_' + s;
    return s;
  }

  const pad = (n, w = 2) => String(n).padStart(w, '0');

  /** Run fn with retries on retryable errors (network/5xx/429). */
  async function retry(fn, { tries = 5, base = 800, max = 15000, onRetry, isRetryable } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn(i);
      } catch (e) {
        lastErr = e;
        const retryable = isRetryable ? isRetryable(e) : e && e.retryable !== false;
        if (!retryable || i === tries - 1) throw e;
        const wait = Math.min(max, base * 2 ** i) + Math.random() * 300;
        if (onRetry) onRetry(e, i + 1, wait);
        await sleep(wait);
      }
    }
    throw lastErr;
  }

  /** Simple promise pool. */
  function limiter(n) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= n || !queue.length) return;
      active++;
      const { fn, res, rej } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(res, rej)
        .finally(() => {
          active--;
          next();
        });
    };
    return (fn) => new Promise((res, rej) => {
      queue.push({ fn, res, rej });
      next();
    });
  }

  function u8(x) {
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    throw new Error('Not binary data');
  }

  function b64encode(bytes) {
    bytes = u8(bytes);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }

  function b64decode(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function concat(chunks) {
    const total = chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  const latin1 = (bytes, start = 0, end) => {
    const b = bytes.subarray(start, end == null ? bytes.length : end);
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < b.length; i += CH) s += String.fromCharCode.apply(null, b.subarray(i, i + CH));
    return s;
  };

  const extOf = (name) => {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return m ? m[1] : '';
  };

  const OFFICE_EXT = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'odp', 'doc', 'docx', 'docm', 'dot', 'dotx', 'odt', 'rtf', 'xls', 'xlsx', 'xlsm', 'ods', 'csv']);
  const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

  /**
   * Work out what a downloaded file really is.
   * Returns { kind: 'pdf'|'office'|'image'|'text'|'html'|'zip'|'video'|'unknown', ext }
   */
  function sniff(bytes, name, contentType) {
    bytes = u8(bytes);
    const head = latin1(bytes, 0, Math.min(bytes.length, 2048));
    const nameExt = extOf(name);
    const ct = String(contentType || '').toLowerCase();

    if (head.indexOf('%PDF-') !== -1) return { kind: 'pdf', ext: 'pdf' };
    if (bytes[0] === 0x89 && head.startsWith('\x89PNG')) return { kind: 'image', ext: 'png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: 'image', ext: 'jpg' };
    if (head.startsWith('GIF8')) return { kind: 'image', ext: 'gif' };
    if (head.startsWith('BM') && nameExt === 'bmp') return { kind: 'image', ext: 'bmp' };
    if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return { kind: 'image', ext: 'webp' };
    if (head.startsWith('{\\rtf')) return { kind: 'office', ext: 'rtf' };

    if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) {
      if (OFFICE_EXT.has(nameExt)) return { kind: 'office', ext: nameExt };
      // Look at the entry names in the zip to identify OOXML / ODF.
      const scan = latin1(bytes, 0, Math.min(bytes.length, 4 * 1024 * 1024)) +
        (bytes.length > 4 * 1024 * 1024 ? latin1(bytes, bytes.length - 256 * 1024) : '');
      if (/ppt\/presentation\.xml/.test(scan)) return { kind: 'office', ext: 'pptx' };
      if (/word\/document\.xml/.test(scan)) return { kind: 'office', ext: 'docx' };
      if (/xl\/workbook\.xml/.test(scan)) return { kind: 'office', ext: 'xlsx' };
      if (/opendocument\.presentation/.test(scan)) return { kind: 'office', ext: 'odp' };
      if (/opendocument\.text/.test(scan)) return { kind: 'office', ext: 'odt' };
      if (/opendocument\.spreadsheet/.test(scan)) return { kind: 'office', ext: 'ods' };
      return { kind: 'zip', ext: nameExt || 'zip' };
    }

    if (head.startsWith('\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')) {
      if (['ppt', 'pps', 'pot', 'doc', 'dot', 'xls'].includes(nameExt)) return { kind: 'office', ext: nameExt };
      const scan = latin1(bytes, 0, Math.min(bytes.length, 2 * 1024 * 1024));
      const u16 = (s) => s.split('').join('\x00');
      if (scan.includes(u16('PowerPoint Document'))) return { kind: 'office', ext: 'ppt' };
      if (scan.includes(u16('WordDocument'))) return { kind: 'office', ext: 'doc' };
      if (scan.includes(u16('Workbook')) || scan.includes(u16('Book'))) return { kind: 'office', ext: 'xls' };
      if (/powerpoint/.test(ct)) return { kind: 'office', ext: 'ppt' };
      if (/msword/.test(ct)) return { kind: 'office', ext: 'doc' };
      if (/excel/.test(ct)) return { kind: 'office', ext: 'xls' };
      return { kind: 'office', ext: 'doc' };
    }

    if (/^\x00\x00\x00.ftyp/.test(head) || ['mp4', 'mkv', 'webm', 'mov', 'avi', 'mp3'].includes(nameExt)) return { kind: 'video', ext: nameExt || 'mp4' };

    const trimmed = head.replace(/^﻿|^\xef\xbb\xbf/, '').trimStart().toLowerCase();
    if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || /text\/html/.test(ct)) return { kind: 'html', ext: 'html' };

    if (OFFICE_EXT.has(nameExt)) return { kind: 'office', ext: nameExt };
    if (IMAGE_EXT.has(nameExt)) return { kind: 'image', ext: nameExt };

    // Mostly printable? -> text
    let printable = 0;
    const n = Math.min(bytes.length, 4096);
    for (let i = 0; i < n; i++) {
      const c = bytes[i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 128) printable++;
    }
    if (n && printable / n > 0.97 && !bytes.subarray(0, n).includes(0)) return { kind: 'text', ext: nameExt || 'txt' };
    return { kind: 'unknown', ext: nameExt || 'bin' };
  }

  const MIME = {
    pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ppt: 'application/vnd.ms-powerpoint', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    html: 'text/html', md: 'text/markdown', txt: 'text/plain', json: 'application/json', zip: 'application/zip',
  };
  const mimeFor = (ext) => MIME[ext] || 'application/octet-stream';

  /** Pull a filename out of Content-Disposition and/or a (signed) URL. */
  function filenameFrom(contentDisposition, url) {
    const cd = contentDisposition || '';
    let m = cd.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
    if (m) {
      try { return decodeURIComponent(m[1].trim().replace(/^"|"$/g, '')); } catch (_) { /* ignore */ }
    }
    m = cd.match(/filename\s*=\s*"([^"]+)"/) || cd.match(/filename\s*=\s*([^;]+)/);
    if (m) return m[1].trim();
    try {
      const u = new URL(url);
      const rcd = u.searchParams.get('response-content-disposition');
      if (rcd) {
        const n = filenameFrom(rcd, null);
        if (n) return n;
      }
      const last = decodeURIComponent(u.pathname.split('/').pop() || '');
      return last || null;
    } catch (_) {
      return null;
    }
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) {
      n /= 1024;
      i++;
    }
    return (i ? n.toFixed(1) : n) + ' ' + u[i];
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m + 'm ' + pad(s % 60) + 's';
  }

  global.U = { sleep, safeName, pad, retry, limiter, u8, b64encode, b64decode, concat, sniff, mimeFor, filenameFrom, extOf, fmtBytes, fmtDuration, OFFICE_EXT };
})(typeof self !== 'undefined' ? self : this);
