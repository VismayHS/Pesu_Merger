/* MCQ helpers: HTML -> PDF tokens (with images), and HTML / Markdown / JSON exports. Browser only. */
(function (global) {
  'use strict';

  const BLOCK = new Set(['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'CENTER']);
  const imgCache = new Map();

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = src;
    });
  }

  function dataUriBytes(src) {
    const m = src.match(/^data:([^;,]+)((?:;[^;,]+)*?),(.*)$/s);
    if (!m) return null;
    const mime = m[1].toLowerCase();
    const isB64 = /;base64/i.test(m[2]);
    if (!isB64) return { mime, text: decodeURIComponent(m[3]) };
    try { return { mime, bytes: U.b64decode(m[3].replace(/\s+/g, '')) }; } catch (_) { return null; }
  }

  function cssPx(v) {
    if (v == null) return null;
    const m = String(v).match(/^\s*([\d.]+)\s*(px)?\s*$/i);
    return m ? parseFloat(m[1]) : null;
  }

  async function canvasPng(im, w, h, scale) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** <img> element -> PDF image token {t:'img', bytes, fmt, w, h} (sizes in pt) or null */
  async function imageToken(el) {
    const src = el.getAttribute('src') || '';
    if (!/^data:image\//i.test(src)) return null;
    const styleW = el.style && cssPx(el.style.width);
    const styleH = el.style && cssPx(el.style.height);
    const attrW = cssPx(el.getAttribute('width')) || styleW;
    const attrH = cssPx(el.getAttribute('height')) || styleH;
    const key = src.length + ':' + src.slice(0, 64) + src.slice(-64) + ':' + attrW + 'x' + attrH;
    if (imgCache.has(key)) return imgCache.get(key);
    let tok = null;
    try {
      const d = dataUriBytes(src);
      let im;
      let usedSrc = src;
      try {
        im = await loadImage(src);
      } catch (e) {
        if (d && d.text && /svg/.test(d.mime)) {
          usedSrc = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(d.text)));
          im = await loadImage(usedSrc);
        } else throw e;
      }
      let nw = im.naturalWidth;
      let nh = im.naturalHeight;
      if ((!nw || !nh) && d && d.text) {
        const vb = d.text.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
        if (vb) { nw = parseFloat(vb[1]); nh = parseFloat(vb[2]); }
      }
      if (!nw || !nh) { nw = 150; nh = 50; }
      let w = attrW || (attrH ? (attrH * nw) / nh : nw);
      let h = attrH || (attrW ? (attrW * nh) / nw : nh);
      const isSvg = d && /svg/.test(d.mime);
      let bytes;
      let fmt;
      if (d && d.bytes && d.mime === 'image/png') { bytes = d.bytes; fmt = 'png'; }
      else if (d && d.bytes && (d.mime === 'image/jpeg' || d.mime === 'image/jpg')) { bytes = d.bytes; fmt = 'jpg'; }
      else {
        // svg/gif/webp/bmp -> png; render svg at 3x for crisp math
        bytes = await canvasPng(im, w, h, isSvg ? 3 : 1);
        fmt = 'png';
      }
      tok = { t: 'img', bytes, fmt, w: w * 0.75, h: h * 0.75 };
    } catch (_) {
      tok = null;
    }
    imgCache.set(key, tok);
    return tok;
  }

  async function htmlToTokens(html) {
    const doc = new DOMParser().parseFromString('<div id="r">' + (html || '') + '</div>', 'text/html');
    const root = doc.getElementById('r');
    const tokens = [];
    const br = () => {
      if (tokens.length && tokens[tokens.length - 1].t !== 'br') tokens.push({ t: 'br' });
    };
    const walk = async (node, st) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          let s = c.textContent.replace(/ /g, ' ');
          if (!st.m) s = s.replace(/\s+/g, ' ');
          if (s && (st.m || s.trim() || (tokens.length && tokens[tokens.length - 1].t === 'text'))) {
            tokens.push({ t: 'text', s, b: st.b, m: st.m, sup: st.sup, sub: st.sub });
          }
          continue;
        }
        if (c.nodeType !== 1) continue;
        const tag = c.tagName;
        if (tag === 'BR') { tokens.push({ t: 'br' }); continue; }
        if (tag === 'IMG') {
          const im = await imageToken(c);
          tokens.push(im || { t: 'text', s: '[image]' });
          continue;
        }
        const ns = { ...st };
        if (tag === 'B' || tag === 'STRONG' || /^H\d$/.test(tag) || tag === 'TH') ns.b = true;
        if (tag === 'PRE' || tag === 'CODE' || tag === 'TT' || tag === 'KBD') ns.m = true;
        if (tag === 'SUP') ns.sup = true;
        if (tag === 'SUB') ns.sub = true;
        const block = BLOCK.has(tag);
        if (block) br();
        if (tag === 'LI') tokens.push({ t: 'text', s: '• ' });
        if ((tag === 'TD' || tag === 'TH') && c.previousElementSibling) tokens.push({ t: 'text', s: '  |  ' });
        await walk(c, ns);
        if (block) br();
      }
    };
    await walk(root, {});
    while (tokens.length && tokens[0].t === 'br') tokens.shift();
    while (tokens.length && tokens[tokens.length - 1].t === 'br') tokens.pop();
    // trim leading/trailing spaces
    if (tokens.length && tokens[0].t === 'text' && !tokens[0].m) tokens[0] = { ...tokens[0], s: tokens[0].s.replace(/^\s+/, '') };
    const last = tokens[tokens.length - 1];
    if (last && last.t === 'text' && !last.m) tokens[tokens.length - 1] = { ...last, s: last.s.replace(/\s+$/, '') };
    return tokens.length ? tokens : [{ t: 'text', s: '' }];
  }

  /** groups: [{heading, questions:[parsed MCQ]}] -> data for PDFX.mcqPdf */
  async function toPdfData(groups, meta, onProgress) {
    const out = [];
    let done = 0;
    const total = groups.reduce((a, g) => a + g.questions.length, 0);
    for (const g of groups) {
      const qs = [];
      for (const q of g.questions) {
        qs.push({
          q: await htmlToTokens(q.html || escapeHtml(q.text)),
          options: await Promise.all(q.options.map(async (o) => ({ tokens: await htmlToTokens(o.html || escapeHtml(o.text)), correct: o.correct }))),
          hasAnswer: q.hasAnswer,
        });
        done++;
        if (onProgress && done % 20 === 0) onProgress(done, total);
      }
      out.push({ heading: g.heading, questions: qs });
    }
    return { ...meta, groups: out };
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toMarkdown(groups, meta) {
    const L = (i) => String.fromCharCode(65 + i);
    const lines = ['# ' + meta.title, '', '_' + meta.subtitle + '_', ''];
    let n = 0;
    for (const g of groups) {
      if (g.heading) lines.push('## ' + g.heading, '');
      for (const q of g.questions) {
        n++;
        lines.push('**' + n + '.** ' + q.text.replace(/\n/g, '  \n'), '');
        q.options.forEach((o, i) => lines.push('- (' + L(i) + ') ' + (o.correct ? '**' + o.text.replace(/\n/g, ' ') + '** ✅' : o.text.replace(/\n/g, ' '))));
        const ans = q.options.map((o, i) => (o.correct ? L(i) : null)).filter(Boolean).join(', ');
        lines.push('', '> Answer: ' + (ans || 'not provided'), '');
      }
    }
    return lines.join('\n');
  }

  function toJson(groups, meta) {
    return JSON.stringify({
      ...meta,
      generated: new Date().toISOString(),
      groups: groups.map((g) => ({
        heading: g.heading,
        questions: g.questions.map((q) => ({
          text: q.text,
          html: q.html,
          multiSelect: q.multi,
          options: q.options.map((o) => ({ text: o.text, html: o.html, correct: o.correct })),
          answer: q.options.map((o, i) => (o.correct ? String.fromCharCode(65 + i) : null)).filter(Boolean),
        })),
      })),
    }, null, 2);
  }

  /** Self-contained interactive practice page (works offline). */
  function toHtml(groups, meta) {
    const data = groups.map((g) => ({
      h: g.heading,
      q: g.questions.map((q) => ({ x: q.html || escapeHtml(q.text), o: q.options.map((o) => [o.html || escapeHtml(o.text), o.correct ? 1 : 0]) })),
    }));
    const json = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, ' ');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(meta.title)}</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--text:#1a1c20;--muted:#667085;--accent:#0b5cad;--ok:#0a7a35;--okbg:#e7f6ec;--bad:#b42318;--badbg:#fdecea;--line:#e4e7ec}
@media (prefers-color-scheme:dark){:root{--bg:#121417;--card:#1b1e23;--text:#e7e9ee;--muted:#98a2b3;--accent:#6aa9f0;--ok:#4ade80;--okbg:#12301f;--bad:#f87171;--badbg:#3a1616;--line:#2b3038}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--line);padding:12px 16px}
header h1{margin:0;font-size:18px;color:var(--accent)}header p{margin:2px 0 8px;color:var(--muted);font-size:13px}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,select{font:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--text);cursor:pointer}
button.primary{background:var(--accent);color:#fff;border-color:transparent}
.score{margin-left:auto;font-weight:600}
main{max-width:860px;margin:0 auto;padding:16px}
h2{font-size:15px;margin:24px 0 8px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.q{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:10px 0}
.qt{display:flex;gap:8px}.qn{font-weight:700;color:var(--accent);min-width:28px}
.opts{margin:10px 0 0 36px;display:grid;gap:6px}
.o{display:flex;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;cursor:pointer;align-items:flex-start}
.o:hover{border-color:var(--accent)}.o b.l{color:var(--muted);min-width:22px}
.o.ok{background:var(--okbg);border-color:var(--ok)}.o.ok b.l{color:var(--ok)}
.o.bad{background:var(--badbg);border-color:var(--bad)}
.q.done .o{cursor:default}
img{max-width:100%;vertical-align:middle}pre{white-space:pre-wrap;margin:4px 0}
.hidden{display:none}
</style></head><body>
<header><h1>${escapeHtml(meta.title)}</h1><p>${escapeHtml(meta.subtitle)}</p>
<div class="bar"><select id="grp"><option value="">All topics</option></select>
<button id="reveal">Show all answers</button><button id="reset">Reset</button><button id="shuffle">Shuffle</button>
<span class="score" id="score"></span></div></header>
<main id="m"></main>
<script>
const D=${json};
const m=document.getElementById('m'),grp=document.getElementById('grp'),score=document.getElementById('score');
let right=0,tried=0,shuffled=false;
function upd(){score.textContent=tried?('Score: '+right+' / '+tried):''}
function render(){
 m.innerHTML='';right=0;tried=0;upd();let n=0;
 D.forEach((g,gi)=>{
  if(grp.value!==''&&String(gi)!==grp.value){n+=g.q.length;return}
  if(g.h){const h=document.createElement('h2');h.textContent=g.h;m.appendChild(h)}
  const idx=g.q.map((_,i)=>i); if(shuffled) idx.sort(()=>Math.random()-.5);
  idx.forEach(qi=>{
   const q=g.q[qi];n++;
   const el=document.createElement('div');el.className='q';
   el.innerHTML='<div class="qt"><span class="qn">'+n+'.</span><div>'+q.x+'</div></div><div class="opts"></div>';
   const os=el.querySelector('.opts');
   q.o.forEach((o,i)=>{
    const b=document.createElement('div');b.className='o';b.dataset.c=o[1];
    b.innerHTML='<b class="l">'+String.fromCharCode(65+i)+'</b><div>'+o[0]+'</div>';
    b.onclick=()=>{
     if(el.classList.contains('done'))return;
     el.classList.add('done');tried++;if(o[1])right++;
     b.classList.add(o[1]?'ok':'bad');
     os.querySelectorAll('.o[data-c="1"]').forEach(x=>x.classList.add('ok'));upd()};
    os.appendChild(b)});
   m.appendChild(el)})})}
D.forEach((g,i)=>{if(!g.h)return;const o=document.createElement('option');o.value=i;o.textContent=g.h;grp.appendChild(o)});
if(D.length<2)grp.classList.add('hidden');
grp.onchange=render;
document.getElementById('reset').onclick=()=>{shuffled=false;render()};
document.getElementById('shuffle').onclick=()=>{shuffled=true;render()};
document.getElementById('reveal').onclick=()=>{
 document.querySelectorAll('.q').forEach(el=>el.classList.add('done'));
 document.querySelectorAll('.o[data-c="1"]').forEach(x=>x.classList.add('ok'))};
render();
</script></body></html>`;
  }

  global.MCQ = { htmlToTokens, toPdfData, toMarkdown, toJson, toHtml, escapeHtml };
})(typeof self !== 'undefined' ? self : this);
