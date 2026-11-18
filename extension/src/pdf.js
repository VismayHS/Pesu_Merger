/* PDF utilities built on pdf-lib: merge with bookmarks + contents page, image/text -> PDF,
 * and an MCQ document renderer with inline images and Unicode fonts.
 * Works in the extension page (globals PDFLib, fontkit) and in Node (for tests).
 */
(function (global) {
  'use strict';

  const PDFLib = global.PDFLib || (typeof require !== 'undefined' ? require('pdf-lib') : null);
  const fontkit = global.fontkit || (typeof require !== 'undefined' ? require('@pdf-lib/fontkit') : null);
  const { PDFDocument, rgb, PDFName, PDFHexString, PDFNumber, PDFNull } = PDFLib;

  const A4 = [595.28, 841.89];
  const MARGIN = 50;
  const COLORS = {
    text: rgb(0.1, 0.1, 0.12),
    muted: rgb(0.42, 0.44, 0.48),
    accent: rgb(0.0, 0.33, 0.62),
    correct: rgb(0.04, 0.47, 0.2),
    rule: rgb(0.85, 0.86, 0.88),
  };

  // ---------------------------------------------------------------- fonts
  let FONT_BYTES = null; // { regular, bold, mono } Uint8Array
  let GLYPHS = null; // { regular, bold, mono } fontkit fonts for coverage checks

  function setFonts(bytes) {
    FONT_BYTES = bytes;
    GLYPHS = {};
    for (const k of Object.keys(bytes)) {
      try { GLYPHS[k] = fontkit.create(bytes[k]); } catch (_) { GLYPHS[k] = null; }
    }
  }

  async function embedFonts(doc) {
    if (!FONT_BYTES) throw new Error('Fonts not loaded');
    doc.registerFontkit(fontkit);
    const f = {};
    for (const k of ['regular', 'bold', 'mono']) {
      f[k] = await doc.embedFont(FONT_BYTES[k], { subset: true });
      f[k]._pdlKey = k;
    }
    return f;
  }

  /** Replace characters the font cannot draw (and control chars) so pdf-lib never throws. */
  function fit(font, s) {
    s = String(s || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏﻿]/g, '').replace(/\t/g, '    ');
    const g = GLYPHS && GLYPHS[font._pdlKey];
    if (!g) return s;
    let out = '';
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (cp === 10 || cp === 13 || g.hasGlyphForCodePoint(cp)) out += ch;
      else if (GLYPHS.regular && GLYPHS.regular.hasGlyphForCodePoint(cp)) out += ch; // drawn with this font anyway -> may show box; rare
      else out += '?';
    }
    return out;
  }

  const width = (font, s, size) => font.widthOfTextAtSize(s, size);

  function truncate(font, s, size, maxW) {
    s = fit(font, s);
    if (width(font, s, size) <= maxW) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (width(font, s.slice(0, mid) + '…', size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo).trimEnd() + '…';
  }

  // ---------------------------------------------------------------- rich text writer
  /**
   * Token stream: {t:'text', s, b?, m?, sup?, sub?, color?} | {t:'br'} | {t:'img', bytes, fmt:'png'|'jpg', w, h}
   */
  class Writer {
    constructor(doc, fonts, { header, pageSize = A4, margin = MARGIN } = {}) {
      this.doc = doc;
      this.f = fonts;
      this.pageSize = pageSize;
      this.margin = margin;
      this.header = header;
      this.page = null;
      this.y = 0;
      this.imgCache = new Map();
    }
    get contentWidth() { return this.pageSize[0] - 2 * this.margin; }
    get top() { return this.pageSize[1] - this.margin; }
    newPage() {
      this.page = this.doc.addPage(this.pageSize);
      this.y = this.top;
      if (this.header) {
        const s = truncate(this.f.regular, this.header, 8, this.contentWidth);
        this.page.drawText(s, { x: this.margin, y: this.pageSize[1] - 30, size: 8, font: this.f.regular, color: COLORS.muted });
      }
      return this.page;
    }
    ensure(h) {
      if (!this.page || this.y - h < this.margin) this.newPage();
    }
    space(h) {
      if (!this.page) this.newPage();
      this.y -= h;
    }
    rule() {
      this.ensure(8);
      this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.pageSize[0] - this.margin, y: this.y }, thickness: 0.6, color: COLORS.rule });
      this.y -= 8;
    }
    async embed(tok) {
      const key = tok.bytes;
      if (this.imgCache.has(key)) return this.imgCache.get(key);
      const img = tok.fmt === 'jpg' ? await this.doc.embedJpg(tok.bytes) : await this.doc.embedPng(tok.bytes);
      this.imgCache.set(key, img);
      return img;
    }
    fontFor(tok) {
      if (tok.m) return this.f.mono;
      return tok.b ? this.f.bold : this.f.regular;
    }

    /** Lay out and draw a run of tokens. opts: size, indent, prefix, prefixBold, color, lineGap */
    async rich(tokens, opts = {}) {
      const size = opts.size || 10.5;
      const indent = opts.indent || 0;
      const x0 = this.margin + indent;
      const maxW = this.contentWidth - indent;
      const baseColor = opts.color || COLORS.text;
      const maxImgH = this.top - this.margin - 40;

      // 1) atoms
      const atoms = [];
      for (const tok of tokens) {
        if (tok.t === 'br') { atoms.push({ k: 'br' }); continue; }
        if (tok.t === 'img') {
          let w = tok.w;
          let h = tok.h;
          if (w > maxW) { h = (h * maxW) / w; w = maxW; }
          if (h > maxImgH) { w = (w * maxImgH) / h; h = maxImgH; }
          atoms.push({ k: 'img', tok, w, h });
          continue;
        }
        const font = this.fontFor(tok);
        const sz = tok.sup || tok.sub ? size * 0.7 : size;
        const rise = tok.sup ? size * 0.35 : tok.sub ? -size * 0.15 : 0;
        const color = tok.color || baseColor;
        const text = fit(font, tok.s).replace(/\r\n?/g, '\n');
        // Monospace (code) keeps its line breaks and indentation; normal text collapses whitespace.
        const segs = tok.m ? text.split('\n') : [text];
        const parts = [];
        segs.forEach((seg, si) => {
          if (si) parts.push('\n');
          parts.push(...(tok.m ? seg.split(/( +)/) : seg.split(/(\s+)/)));
        });
        for (const p of parts) {
          if (!p) continue;
          if (p === '\n') { atoms.push({ k: 'br' }); continue; }
          if (/^\s+$/.test(p)) {
            atoms.push({ k: 'sp', w: tok.m ? width(font, p, sz) : width(font, ' ', sz), font, sz, keep: !!tok.m });
            continue;
          }
          // long words -> hard break
          let word = p;
          while (word.length) {
            let w = width(font, word, sz);
            if (w <= maxW) { atoms.push({ k: 'w', s: word, w, font, sz, rise, color }); break; }
            let lo = 1;
            let hi = word.length;
            while (lo < hi) {
              const mid = (lo + hi + 1) >> 1;
              if (width(font, word.slice(0, mid), sz) <= maxW) lo = mid;
              else hi = mid - 1;
            }
            const head = word.slice(0, lo);
            atoms.push({ k: 'w', s: head, w: width(font, head, sz), font, sz, rise, color });
            atoms.push({ k: 'br' });
            word = word.slice(lo);
          }
        }
      }

      // 2) lines
      const lines = [];
      let line = [];
      let lw = 0;
      const flush = () => {
        while (line.length && line[line.length - 1].k === 'sp') line.pop();
        lines.push(line);
        line = [];
        lw = 0;
      };
      for (const a of atoms) {
        if (a.k === 'br') { flush(); continue; }
        if (a.k === 'sp' && !line.length && !a.keep) continue;
        if (lw + a.w > maxW && line.length) {
          flush();
          if (a.k === 'sp') continue;
        }
        line.push(a);
        lw += a.w;
      }
      if (line.length || !lines.length) flush();
      // collapse runs of blank lines
      const finalLines = lines.filter((l, i) => l.length || (i > 0 && lines[i - 1].length));

      // 3) draw
      let first = true;
      for (const ln of finalLines) {
        let asc = size * 0.8;
        let desc = size * 0.25;
        for (const a of ln) {
          if (a.k === 'img') asc = Math.max(asc, a.h - size * 0.2);
        }
        const lh = Math.max(size * (opts.lineGap || 1.32), asc + desc + 2);
        this.ensure(lh);
        const base = this.y - asc;
        if (first && opts.prefix) {
          const pf = opts.prefixBold === false ? this.f.regular : this.f.bold;
          const ps = fit(pf, opts.prefix);
          this.page.drawText(ps, { x: x0 - (opts.prefixWidth || width(pf, ps, size) + 4), y: base, size, font: pf, color: opts.prefixColor || baseColor });
        }
        first = false;
        let x = x0;
        for (const a of ln) {
          if (a.k === 'w') {
            this.page.drawText(a.s, { x, y: base + a.rise, size: a.sz, font: a.font, color: a.color });
          } else if (a.k === 'img') {
            try {
              const img = await this.embed(a.tok);
              this.page.drawImage(img, { x, y: base - size * 0.2, width: a.w, height: a.h });
            } catch (_) {
              this.page.drawText('[image]', { x, y: base, size, font: this.f.regular, color: COLORS.muted });
            }
          }
          x += a.w;
        }
        this.y -= lh;
      }
    }

    async text(s, opts = {}) {
      return this.rich([{ t: 'text', s, b: !!opts.bold, m: !!opts.mono, color: opts.color }], opts);
    }
  }

  // ---------------------------------------------------------------- outline (bookmarks)
  /** nodes: [{title, page: PDFPage index, children: []}] */
  function addOutline(doc, nodes) {
    if (!nodes || !nodes.length) return;
    const ctx = doc.context;
    const pages = doc.getPages();
    const rootRef = ctx.nextRef();
    const build = (list, parentRef, depth) => {
      const refs = list.map(() => ctx.nextRef());
      let visible = 0;
      list.forEach((n, i) => {
        const pageIdx = Math.max(0, Math.min(pages.length - 1, n.page));
        const entries = {
          Title: PDFHexString.fromText(String(n.title || '').slice(0, 300)),
          Parent: parentRef,
          Dest: ctx.obj([pages[pageIdx].ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
        };
        if (i > 0) entries.Prev = refs[i - 1];
        if (i < refs.length - 1) entries.Next = refs[i + 1];
        if (n.children && n.children.length) {
          const sub = build(n.children, refs[i], depth + 1);
          entries.First = sub.first;
          entries.Last = sub.last;
          // top level expanded, deeper levels collapsed
          entries.Count = PDFNumber.of(depth === 0 ? sub.count : -sub.count);
          if (depth === 0) visible += sub.count;
        }
        ctx.assign(refs[i], ctx.obj(entries));
        visible += 1;
      });
      return { first: refs[0], last: refs[refs.length - 1], count: list.length, visible };
    };
    const top = build(nodes, rootRef, 0);
    ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: PDFNumber.of(top.visible) }));
    doc.catalog.set(PDFName.of('Outlines'), rootRef);
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }

  /** Build nested outline nodes from parts with crumbs [] + title, given start pages. */
  function outlineFromParts(parts) {
    const root = [];
    for (const p of parts) {
      if (p.startPage == null) continue;
      let level = root;
      for (const c of p.crumbs || []) {
        let node = level.length ? level[level.length - 1] : null;
        if (!node || node.title !== c || !node.children) {
          node = { title: c, page: p.startPage, children: [] };
          level.push(node);
        }
        level = node.children;
      }
      level.push({ title: p.title, page: p.startPage });
    }
    // Collapse "group with a single leaf that has the same title"
    const simplify = (list) => list.map((n) => {
      if (n.children) {
        n.children = simplify(n.children);
        if (n.children.length === 1 && !n.children[0].children && n.children[0].title === n.title) return { title: n.title, page: n.page };
      }
      return n;
    });
    return simplify(root);
  }

  function linkAnnot(doc, page, rect, targetPage) {
    const ctx = doc.context;
    const annot = ctx.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: rect,
      Border: [0, 0, 0],
      Dest: [targetPage.ref, 'XYZ', null, null, null],
    });
    // ctx.obj turns JS null into PDFNull and strings into names
    const ref = ctx.register(annot);
    let annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
  }

  // ---------------------------------------------------------------- loading / validation
  async function loadPdf(bytes) {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    if (doc.isEncrypted) {
      const e = new Error('PDF is encrypted');
      e.code = 'ENCRYPTED';
      throw e;
    }
    if (!doc.getPageCount()) throw new Error('PDF has no pages');
    return doc;
  }

  async function pageCount(bytes) {
    const d = await loadPdf(bytes);
    return d.getPageCount();
  }

  // ---------------------------------------------------------------- merge
  /**
   * parts: [{ bytes, title, crumbs: [..] }]
   * opts: { title, subtitle, toc: bool, separators: bool, repair: async (bytes) => bytes|null, onProgress(i,n) }
   * Returns { bytes, pageCount, included: [...], failed: [{title, error}] }
   */
  async function merge(parts, opts = {}) {
    const out = await PDFDocument.create();
    const needFonts = opts.toc || opts.separators;
    const fonts = needFonts ? await embedFonts(out) : null;
    const included = [];
    const failed = [];

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (opts.onProgress) opts.onProgress(i, parts.length, p);
      let src = null;
      try {
        src = await loadPdf(p.bytes);
      } catch (e) {
        if (opts.repair) {
          try {
            const fixed = await opts.repair(p.bytes, e);
            if (fixed) src = await loadPdf(fixed);
          } catch (e2) {
            e = e2;
          }
        }
        if (!src) {
          failed.push({ title: p.title, crumbs: p.crumbs, error: e.message || String(e) });
          continue;
        }
      }
      const start = out.getPageCount();
      if (opts.separators) {
        const w = new Writer(out, fonts);
        w.newPage();
        w.space(220);
        if (p.crumbs && p.crumbs.length) await w.text(p.crumbs.join('  ›  '), { size: 12, color: COLORS.muted });
        w.space(6);
        await w.text(p.title, { size: 22, bold: true, color: COLORS.accent });
      }
      try {
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach((pg) => out.addPage(pg));
        included.push({ ...p, startPage: start, pages: copied.length + (opts.separators ? 1 : 0) });
      } catch (e) {
        // roll back separator page if copy failed
        while (out.getPageCount() > start) out.removePage(out.getPageCount() - 1);
        failed.push({ title: p.title, crumbs: p.crumbs, error: e.message || String(e) });
      }
    }

    if (!included.length) {
      return { bytes: null, pageCount: 0, included, failed };
    }

    // Contents page(s) at the front
    let offset = 0;
    if (opts.toc) {
      offset = await insertToc(out, fonts, included, opts);
      included.forEach((p) => (p.startPage += offset));
    }
    const outline = outlineFromParts(included);
    if (offset) outline.unshift({ title: 'Cover & contents', page: 0 });
    addOutline(out, outline);

    out.setTitle(opts.title || 'PESU material');
    if (opts.subtitle) out.setSubject(opts.subtitle);
    out.setCreator('PESU Downloader (by Vismay H S)');
    out.setProducer('PESU Downloader (pdf-lib)');
    const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
    return { bytes, pageCount: out.getPageCount(), included, failed };
  }

  const CREDIT = 'Compiled with PESU Downloader — a browser extension by Vismay H S';

  /** Greedy word-wrap into at most maxLines lines (last one truncated). */
  function wrap(font, s, size, maxW, maxLines = 3) {
    const words = fit(font, s).split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (width(font, t, size) <= maxW || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const rest = lines.slice(maxLines - 1).join(' ');
      lines.length = maxLines - 1;
      lines.push(rest);
    }
    return lines.map((l) => truncate(font, l, size, maxW));
  }

  function footer(page, fonts, label) {
    const [W] = A4;
    page.drawLine({ start: { x: MARGIN, y: 42 }, end: { x: W - MARGIN, y: 42 }, thickness: 0.5, color: COLORS.rule });
    page.drawText(fit(fonts.regular, CREDIT), { x: MARGIN, y: 30, size: 7.5, font: fonts.regular, color: COLORS.muted });
    if (label) {
      const lw = width(fonts.regular, label, 7.5);
      page.drawText(label, { x: W - MARGIN - lw, y: 30, size: 7.5, font: fonts.regular, color: COLORS.muted });
    }
  }

  /**
   * Cover + contents page(s) inserted at the front.
   * opts: { title, kicker, info, sourceLine } - kicker e.g. "PESU Academy · UE24CS351A",
   * info e.g. the course title, sourceLine e.g. "Unit 1 · Slides".
   */
  async function insertToc(out, fonts, included, opts) {
    const rows = [];
    let prev = [];
    let n = 0;
    for (const p of included) {
      const crumbs = p.crumbs || [];
      let same = 0;
      while (same < crumbs.length && same < prev.length && crumbs[same] === prev[same]) same++;
      for (let d = same; d < crumbs.length; d++) rows.push({ head: true, depth: d, title: crumbs[d], part: p });
      rows.push({ head: false, depth: crumbs.length, title: p.title, part: p, n: ++n });
      prev = crumbs;
    }
    const [W, H] = A4;
    const lineH = 17;
    const bottom = 62;
    const accentLight = rgb(0.93, 0.95, 0.99);

    // measure the cover header so we know where the list starts
    const titleLines = wrap(fonts.bold, opts.title || 'Study material', 24, W - 2 * MARGIN, 3);
    const infoLines = opts.info ? wrap(fonts.regular, opts.info, 12, W - 2 * MARGIN, 2) : [];
    const headerH = MARGIN + 48 + titleLines.length * 30 + infoLines.length * 17 + 62;
    const firstTop = H - headerH;
    const top = H - MARGIN - 24;
    const perFirst = Math.max(1, Math.floor((firstTop - bottom) / lineH) + 1);
    const perPage = Math.floor((top - bottom) / lineH) + 1;
    const nPages = rows.length <= perFirst ? 1 : 1 + Math.ceil((rows.length - perFirst) / perPage);
    const pages = [];
    for (let i = 0; i < nPages; i++) pages.push(out.insertPage(i, A4));
    const totalPages = out.getPageCount();

    // cover header
    const p0 = pages[0];
    p0.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: COLORS.accent });
    let y = H - MARGIN - 14;
    if (opts.kicker) {
      p0.drawText(truncate(fonts.bold, opts.kicker.toUpperCase(), 9, W - 2 * MARGIN), { x: MARGIN, y, size: 9, font: fonts.bold, color: COLORS.accent });
    }
    y -= 34;
    for (const l of titleLines) { p0.drawText(l, { x: MARGIN, y, size: 24, font: fonts.bold, color: COLORS.text }); y -= 30; }
    for (const l of infoLines) { p0.drawText(l, { x: MARGIN, y: y + 8, size: 12, font: fonts.regular, color: COLORS.muted }); y -= 17; }
    y -= 6;
    // summary box
    const boxH = 44;
    const boxY = y - boxH + 14;
    p0.drawRectangle({ x: MARGIN, y: boxY, width: W - 2 * MARGIN, height: boxH, color: accentLight });
    p0.drawRectangle({ x: MARGIN, y: boxY, width: 3, height: boxH, color: COLORS.accent });
    const docs = included.length;
    const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const summary = `${docs} document${docs === 1 ? '' : 's'}  ·  ${totalPages} pages  ·  ${date}`;
    p0.drawText(fit(fonts.bold, summary), { x: MARGIN + 14, y: boxY + boxH - 18, size: 10.5, font: fonts.bold, color: COLORS.text });
    const src = 'Downloaded from PESU Academy' + (opts.sourceLine ? ' — ' + opts.sourceLine : '') + '. Topics included:';
    p0.drawText(truncate(fonts.regular, src, 9.5, W - 2 * MARGIN - 28), { x: MARGIN + 14, y: boxY + 9, size: 9.5, font: fonts.regular, color: COLORS.muted });

    // topic list
    let pi = 0;
    y = firstTop;
    const dotW = width(fonts.regular, '.', 8);
    for (const r of rows) {
      if (y < bottom) { pi++; y = top; }
      const page = pages[pi];
      const targetIdx = r.part.startPage + nPages;
      const x = MARGIN + r.depth * 16;
      if (r.head) {
        page.drawRectangle({ x: x - 4, y: y - 5, width: W - MARGIN - x + 4, height: lineH - 2, color: accentLight });
        page.drawText(truncate(fonts.bold, r.title, 10.5, W - MARGIN - x - 8), { x, y, size: 10.5, font: fonts.bold, color: COLORS.accent });
      } else {
        const numS = String(r.n).padStart(2, '0');
        page.drawText(numS, { x, y, size: 9, font: fonts.mono, color: COLORS.muted });
        const tx = x + width(fonts.mono, numS, 9) + 10;
        const pg = String(targetIdx + 1);
        const pgW = width(fonts.regular, pg, 10);
        const title = truncate(fonts.regular, r.title, 10, W - MARGIN - tx - pgW - 24);
        const tw = width(fonts.regular, title, 10);
        page.drawText(title, { x: tx, y, size: 10, font: fonts.regular, color: COLORS.text });
        const dend = W - MARGIN - pgW - 6;
        for (let xx = tx + tw + 8; xx + dotW < dend; xx += dotW * 2) page.drawText('.', { x: xx, y, size: 8, font: fonts.regular, color: COLORS.muted });
        page.drawText(pg, { x: W - MARGIN - pgW, y, size: 10, font: fonts.regular, color: COLORS.muted });
      }
      linkAnnot(out, page, [x - 4, y - 4, W - MARGIN, y + 11], out.getPage(Math.min(targetIdx, totalPages - 1)));
      y -= lineH;
    }
    pages.forEach((pg, i) => {
      if (i > 0) pg.drawText(truncate(fonts.bold, (opts.title || 'Contents') + ' — topics (continued)', 9, W - 2 * MARGIN), { x: MARGIN, y: H - MARGIN, size: 9, font: fonts.bold, color: COLORS.muted });
      footer(pg, fonts, nPages > 1 ? `Contents ${i + 1}/${nPages}` : 'Click a topic to jump to it');
    });
    return nPages;
  }

  // ---------------------------------------------------------------- conversions
  async function imageToPdf(bytes, fmt) {
    const doc = await PDFDocument.create();
    const img = fmt === 'jpg' || fmt === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const [W, H] = img.width > img.height ? [A4[1], A4[0]] : A4;
    const s = Math.min((W - 40) / img.width, (H - 40) / img.height, 1.5);
    const page = doc.addPage([W, H]);
    page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
    return doc.save();
  }

  async function textToPdf(text, title) {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const w = new Writer(doc, fonts, { header: title });
    w.newPage();
    await w.rich([{ t: 'text', s: text, m: true }], { size: 9 });
    return doc.save();
  }

  // ---------------------------------------------------------------- MCQs
  /**
   * data: { title, subtitle, groups: [{ heading, questions: [{ q: tokens, options: [{tokens, correct}], hasAnswer }] }] }
   * answers: 'inline' | 'end' | 'both' | 'none'
   */
  async function mcqPdf(data, answers = 'inline') {
    const doc = await PDFDocument.create();
    const fonts = await embedFonts(doc);
    const w = new Writer(doc, fonts, { header: data.header || data.title });
    w.newPage();
    await w.text(data.title, { size: 18, bold: true, color: COLORS.accent });
    if (data.subtitle) await w.text(data.subtitle, { size: 10, color: COLORS.muted });
    await w.text(CREDIT, { size: 8, color: COLORS.muted });
    w.space(6);
    w.rule();
    const inline = answers === 'inline' || answers === 'both';
    const key = [];
    const outline = [];
    let n = 0;
    for (const g of data.groups) {
      if (g.heading) {
        w.ensure(40);
        w.space(4);
        outline.push({ title: g.heading, page: doc.getPageCount() - 1, children: [] });
        await w.text(g.heading, { size: 12.5, bold: true, color: COLORS.text });
        w.space(4);
      }
      const gkey = { heading: g.heading, items: [] };
      key.push(gkey);
      for (const q of g.questions) {
        n++;
        w.ensure(60);
        const label = n + '.';
        await w.rich(q.q, { size: 10.5, indent: 24, prefix: label, prefixWidth: 24 });
        w.space(2);
        let letters = [];
        for (let i = 0; i < q.options.length; i++) {
          const o = q.options[i];
          const L = String.fromCharCode(65 + i);
          const mark = inline && o.correct;
          if (o.correct) letters.push(L);
          const toks = mark ? o.tokens.map((t) => (t.t === 'text' ? { ...t, b: true, color: COLORS.correct } : t)) : o.tokens;
          await w.rich(mark ? toks.concat([{ t: 'text', s: '  ✓', b: true, color: COLORS.correct }]) : toks, {
            size: 10, indent: 48, prefix: '(' + L + ')', prefixWidth: 22, prefixBold: mark, prefixColor: mark ? COLORS.correct : COLORS.muted,
            color: COLORS.text,
          });
        }
        if (inline && !q.hasAnswer) await w.text('Answer not provided by the portal', { size: 8.5, indent: 48, color: COLORS.muted });
        gkey.items.push({ n, ans: letters.join(', ') || '—' });
        w.space(7);
      }
    }
    if (answers === 'end' || answers === 'both') {
      w.newPage();
      outline.push({ title: 'Answer key', page: doc.getPageCount() - 1 });
      await w.text('Answer key', { size: 16, bold: true, color: COLORS.accent });
      w.space(6);
      for (const g of key) {
        if (g.heading && key.length > 1) {
          w.space(4);
          await w.text(g.heading, { size: 10.5, bold: true });
        }
        const cols = 6;
        for (let i = 0; i < g.items.length; i += cols) {
          const row = g.items.slice(i, i + cols);
          w.ensure(16);
          const colW = w.contentWidth / cols;
          row.forEach((it, j) => {
            const s = fit(fonts.regular, it.n + '. ' + it.ans);
            w.page.drawText(s, { x: w.margin + j * colW, y: w.y - 10, size: 10, font: fonts.regular, color: COLORS.text });
          });
          w.y -= 15;
        }
      }
    }
    if (outline.length > 1) addOutline(doc, outline);
    doc.setTitle(data.title);
    doc.setCreator('PESU Downloader');
    return doc.save({ useObjectStreams: true });
  }

  global.PDFX = { setFonts, embedFonts, Writer, merge, loadPdf, pageCount, imageToPdf, textToPdf, mcqPdf, addOutline, outlineFromParts, A4 };
})(typeof self !== 'undefined' ? self : this);
