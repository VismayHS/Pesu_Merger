// node tests/pdf_test.js <dir-with-pdfs> <out-dir>
const path = require('path');
const fs = require('fs');
const NM = process.env.NODE_DEPS;
// NODE_DEPS = optional folder containing node_modules-style pdf-lib + @pdf-lib/fontkit (else normal resolution)
const dep = (name) => require(NM ? path.join(NM, name) : name);
global.PDFLib = dep('pdf-lib');
global.fontkit = dep('@pdf-lib/fontkit');
global.self = global;
require('../extension/src/pdf.js');
const { PDFX } = global;

const fontsDir = path.join(__dirname, '..', 'extension', 'fonts');
PDFX.setFonts({
  regular: fs.readFileSync(path.join(fontsDir, 'DejaVuSans.ttf')),
  bold: fs.readFileSync(path.join(fontsDir, 'DejaVuSans-Bold.ttf')),
  mono: fs.readFileSync(path.join(fontsDir, 'DejaVuSansMono.ttf')),
});

(async () => {
  const [inDir, outDir] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const pdfs = fs.readdirSync(inDir).filter((f) => f.endsWith('.pdf')).sort();
  const parts = pdfs.map((f, i) => ({
    bytes: fs.readFileSync(path.join(inDir, f)),
    title: f.replace(/\.pdf$/, ''),
    crumbs: ['Unit ' + (1 + (i % 2)) + ' — Foundations ✓', i % 3 ? 'Slides' : 'Notes'],
  }));
  // sort like the app does (crumbs grouped)
  parts.sort((a, b) => a.crumbs.join('|').localeCompare(b.crumbs.join('|')));
  parts.push({ bytes: new Uint8Array([1, 2, 3]), title: 'broken file', crumbs: ['Unit 2 — Foundations ✓', 'Slides'] });
  if (fs.existsSync(path.join(inDir, 'encrypted.bin'))) parts.push({ bytes: fs.readFileSync(path.join(inDir, 'encrypted.bin')), title: 'encrypted', crumbs: ['Unit 2'] });

  let t0 = Date.now();
  const res = await PDFX.merge(parts, { title: 'UE24AM342AA5 — ML System Design', subtitle: 'Units 1–2 · generated test', toc: true, separators: false, kicker: 'PESU Academy · UE24AM342AA5 · Sem-5', info: 'ML System Design and AgentOps', sourceLine: 'Unit 1 · Slides, Notes', repair: async () => null });
  fs.writeFileSync(path.join(outDir, 'merged.pdf'), res.bytes);
  console.log('merged pages', res.pageCount, 'included', res.included.length, 'failed', res.failed.map((f) => f.title + ': ' + f.error), (Date.now() - t0) + 'ms');

  const res2 = await PDFX.merge(parts.slice(0, 3), { title: 'With separators', toc: false, separators: true });
  fs.writeFileSync(path.join(outDir, 'merged_sep.pdf'), res2.bytes);
  console.log('sep pages', res2.pageCount);

  // MCQ doc with an inline PNG
  const png = fs.readFileSync(path.join(inDir, 'tiny.png'));
  const T = (s, extra = {}) => ({ t: 'text', s, ...extra });
  const groups = [{
    heading: 'Class 1 · Introduction to ML system engineering',
    questions: Array.from({ length: 30 }, (_, i) => ({
      q: [T('An API succeeds on 9,990 of 10,000 eligible requests — what is its availability? Σ, ≤, ≥, →, α/β, x'), T('2', { sup: true }), T(' and H'), T('2', { sub: true }), T('O. '), ...(i % 5 === 0 ? [{ t: 'img', bytes: png, fmt: 'png', w: 120, h: 40 }, T(' inline image')] : []), ...(i % 7 === 0 ? [{ t: 'br' }, T('int main() {\n    return 0;\n}', { m: true })] : [])],
      options: [
        { tokens: [T('0.1%')], correct: false },
        { tokens: [T('99.9% — the correct one')], correct: true },
        { tokens: [T('A very long option text that should wrap across multiple lines because it is deliberately verbose and keeps going and going well past the right margin of the page.')], correct: false },
        { tokens: [T('漢字 emoji 😀 unsupported glyphs')], correct: false },
      ],
      hasAnswer: true,
    })),
  }];
  t0 = Date.now();
  const mcq = await PDFX.mcqPdf({ title: 'Unit 1 — MCQs', subtitle: 'UE24AM342AA5 · 30 questions', groups }, 'both');
  fs.writeFileSync(path.join(outDir, 'mcq.pdf'), mcq);
  console.log('mcq bytes', mcq.length, (Date.now() - t0) + 'ms');

  const txt = await PDFX.textToPdf('plain text file\nline 2 ✓', 'notes.txt');
  fs.writeFileSync(path.join(outDir, 'text.pdf'), txt);
  const img = await PDFX.imageToPdf(png, 'png');
  fs.writeFileSync(path.join(outDir, 'image.pdf'), img);
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
