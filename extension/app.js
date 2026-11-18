'use strict';
/* PESU Downloader - main page controller */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const CATS = PESU.DOWNLOADABLE.map((t) => t.id); // [2,3,5,6,7,19,8,9] in portal column order
const TYPE_RANK = (t) => CATS.indexOf(t);
const typeName = (t) => PESU.TYPE_BY_ID[t].name;
const esc = (s) => MCQ.escapeHtml(s);

// ------------------------------------------------------------------ icons
const ICON = {
  2: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  3: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>',
  5: '<path d="M9 3h6v3H9z"/><path d="M7 4.5H5V21h14V4.5h-2"/><path d="m9 14 2 2 4-4"/>',
  6: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 17h.01"/>',
  7: '<path d="M4 5h11v8H8l-4 3z"/><path d="M15 9h5v8l-3-2h-6v-2"/>',
  19: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3 2.5V13M12 16.5h.01"/>',
  8: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="18" r="1.4"/>',
  9: '<path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"/>',
  folder: '<path d="M3 6.5h6l2 2h10V19H3z"/>',
  file: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24">${ICON[k] || ICON.file}</svg>`;

// ------------------------------------------------------------------ settings
// Names are automatic. Users rename things by clicking them in the preview: either one item
// (stored in settings.renames) or a style for all items of that kind (settings.naming).
// Layout: <root>/<Course>/<UnitN_Content>/{merged PDFs, MCQs/, Files/<Category>/}
const NAME_STYLES = {
  course: [['codeName', '{code} - {course}'], ['name', '{course}'], ['code', '{code}'], ['nameCode', '{course} ({code})']],
  unit: [['content', 'Unit{unit}_Content'], ['spaced', 'Unit {unit}'], ['named', 'Unit {unit} - {unit_name}']],
  merged: [['short', ''], ['code', '{code} - '], ['course', '{course} - ']], // prefix before the base name
  file: [['numbered', '{class_no} - {name}'], ['plain', '{name}'], ['unit', 'Unit {unit} - {class_no} - {name}']],
};
const NAMING_CHOICE_DEFAULTS = { course: 'codeName', unit: 'content', merged: 'short', file: 'numbered' };
const MERGED_BASE = { 'unit-category': 'Unit {unit} - {category}', category: '{category} - {units}', unit: 'Unit {unit} - Complete', all: 'Complete ({units})' };
const MCQ_NAME = 'Unit {unit} - MCQs';
const UNIT_SCOPED = new Set(['unit-category', 'unit']); // merge modes that produce one file per unit
const styleTpl = (kind, id) => (NAME_STYLES[kind].find((x) => x[0] === id) || NAME_STYLES[kind][0])[1];
const MODES = [
  { v: 'unit-category', t: 'Per unit and category', d: 'Unit 1 - Slides, Unit 1 - Notes…', art: [[4, 18], [4, 12], [4, 22], [4, 15], [4, 10]] },
  { v: 'category', t: 'Per category', d: 'All units\' slides in one PDF', art: [[7, 20], [7, 14], [7, 22]] },
  { v: 'unit', t: 'Per unit', d: 'Everything for a unit in one PDF', art: [[11, 17], [11, 22]] },
  { v: 'all', t: 'One single PDF', d: 'All selected material together', art: [[24, 22]] },
  { v: 'none', t: "Don't merge", d: 'Just the individual files', art: [[3, 8], [3, 12], [3, 7], [3, 10], [3, 8], [3, 12]] },
];

const DEFAULTS = {
  categories: [2, 3, 5, 6, 7, 19, 8, 9],
  mergeMode: 'unit-category',
  toc: true,
  separators: false,
  saveIndividual: false,
  keepOriginals: false,
  mcqAnswers: 'inline',
  mcqFormats: { pdf: true, html: true, md: true, json: false },
  rootFolder: 'PESU Academy',
  engine: 'auto',
  semesterId: null,
  naming: { ...NAMING_CHOICE_DEFAULTS },
  renames: {},
};

const state = {
  settings: structuredClone(DEFAULTS),
  semesters: [],
  courses: [],
  selectedCourses: new Set(),
  scanned: new Map(), // courseId -> { course, units, subType }
  selectedUnits: new Set(), // `${courseId}:${unitId}`
  running: false,
  job: null,
  preselect: new URLSearchParams(location.search).get('course'),
  sessionWait: null,
  sessionResolve: null,
};
const host = new NativeHost();

// ------------------------------------------------------------------ toasts / tabs / log
function toast(msg, kind = 'info', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<span class="ti">${{ ok: '✓', warn: '!', bad: '✕' }[kind] || 'i'}</span><span></span>`;
  el.lastChild.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, ms);
}

function switchTab(name) {
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
  moveInk();
  if (name === 'activity') { const l = $('#log'); l.scrollTop = l.scrollHeight; }
}
function moveInk() {
  const t = $('.tab.active');
  const ink = $('#tabInk');
  if (!t) return;
  ink.style.left = t.offsetLeft + 'px';
  ink.style.width = t.offsetWidth + 'px';
}

let problems = 0;
function log(level, msg) {
  const ol = $('#log');
  const empty = ol.querySelector('.log-empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = level;
  li.innerHTML = `<time></time><span class="lv">${{ ok: '✓', warn: '⚠', error: '✕' }[level] || '·'}</span><span class="msg"></span>`;
  li.querySelector('time').textContent = new Date().toLocaleTimeString();
  li.querySelector('.msg').textContent = msg;
  const q = $('#logSearch').value.trim().toLowerCase();
  if (q && !msg.toLowerCase().includes(q)) li.classList.add('nomatch');
  const stick = ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 30;
  ol.appendChild(li);
  if (ol.children.length > 4000) ol.firstChild.remove();
  if (stick) ol.scrollTop = ol.scrollHeight;
  if (level === 'warn' || level === 'error') {
    problems++;
    const b = $('#logBadge');
    b.textContent = problems;
    b.classList.remove('hidden');
    $('#probCount').textContent = '(' + problems + ')';
    if (state.job) (level === 'warn' ? state.job.warnings : state.job.errors).push(msg);
  }
}
Net.onLog = log;

function pill(id, cls, text) {
  const el = $(id);
  el.className = 'pill ' + (cls || '');
  el.querySelector('span').textContent = text;
}

function setRunning(on) {
  state.running = on;
  document.body.classList.toggle('running', on);
  closeRename();
  $('#btnStart').disabled = on || !planReady();
  $('#btnStart').classList.toggle('loading', on);
  $('#btnStart span').textContent = on ? 'Working…' : 'Start';
  $('#btnCancel').disabled = !on;
  $('#btnCancel').textContent = 'Cancel';
  $('#btnScan').disabled = on || !state.selectedCourses.size;
  $('#semester').disabled = on;
  $$('#stepOptions input, #stepOptions select, #stepOptions .seg button, #btnAllUnits, #btnNoUnits').forEach((e) => (e.disabled = on));
  $$('#courseList input, #unitTables input, #cats input').forEach((e) => (e.disabled = on));
  if (!on) syncExtras();
  renderPreview(selectedPlan()); // show / hide the rename affordances
}

// ------------------------------------------------------------------ settings
async function loadSettings() {
  try {
    const { settings } = await ext.storage.local.get('settings');
    if (settings) {
      state.settings = {
        ...structuredClone(DEFAULTS), ...settings,
        mcqFormats: { ...DEFAULTS.mcqFormats, ...(settings.mcqFormats || {}) },
        naming: cleanNaming(settings.naming),
        renames: cleanRenames(settings.renames),
      };
    }
  } catch (_) { /* defaults */ }
}
function cleanRenames(r) {
  const out = {};
  if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) if (typeof v === 'string' && v.trim()) out[k] = v;
  return out;
}
/** Keep only valid choices (older versions stored raw templates). */
function cleanNaming(n) {
  const out = { ...NAMING_CHOICE_DEFAULTS };
  for (const k of Object.keys(out)) if (n && NAME_STYLES[k].some((x) => x[0] === n[k])) out[k] = n[k];
  return out;
}
function saveSettings() {
  ext.storage.local.set({ settings: state.settings }).catch(() => {});
}

// ------------------------------------------------------------------ naming
const today = () => new Date().toISOString().slice(0, 10);
function rangeLabel(nums) {
  const s = [...new Set(nums)].sort((a, b) => a - b);
  if (!s.length) return '';
  const out = [];
  let a = s[0];
  let p = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (s[i] === p + 1) { p = s[i]; continue; }
    out.push(a === p ? String(a) : a + '-' + p);
    a = p = s[i];
  }
  return (s.length > 1 ? 'Units ' : 'Unit ') + out.join(', ');
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
function sameTitle(a, b) {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
}
function semesterName() {
  const s = state.semesters.find((x) => x.id === state.settings.semesterId);
  return s ? s.name : '';
}
function nameVars({ course, unit, units, type, cls, title }) {
  const smart = cls ? (title && !sameTitle(title, cls.title) ? `${cls.title} - ${title}` : cls.title) : (title || '');
  return {
    code: course ? course.code : '', course: course ? course.title : '', semester: semesterName(),
    unit: unit ? unit.idx : '', unit_name: unit ? unit.name : '', units: units ? rangeLabel(units) : unit ? rangeLabel([unit.idx]) : '',
    category: type ? typeName(type) : '', class_no: cls ? U.pad(cls.idx) : '', class: cls ? cls.title : '',
    title: title || '', name: smart, date: today(),
  };
}
/** Fill a template into ONE safe file or folder name (a "/" in a course title never makes a sub-folder). */
function fillName(tpl, vars, max = 90) {
  const raw = String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : ''));
  return fitName(raw.replace(/\s+-\s*$/, ''), max);
}
/** Like U.safeName, but a name that is too long is shortened at a word boundary, never mid-word. */
function fitName(s, max) {
  const clean = U.safeName(s, 1000);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('-'));
  return U.safeName((at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, max)).replace(/[\s\-–—,(]+$/, ''), max);
}
const NAME_MAX = { course: 70, unit: 60, merged: 90, mcq: 90, file: 90 };
function mergedTpl(mode, style) {
  if (mode === 'all' && style === 'short') return '{code} - ' + MERGED_BASE.all;
  return styleTpl('merged', style) + MERGED_BASE[mode];
}
/** The automatic name of something (no extension). x = { course, unit, units, type, cls, title, mode } */
function defaultName(kind, x, choices = state.settings.naming) {
  const v = nameVars(x);
  const tpl = { course: () => styleTpl('course', choices.course), unit: () => styleTpl('unit', choices.unit), merged: () => mergedTpl(x.mode, choices.merged), mcq: () => MCQ_NAME, file: () => styleTpl('file', choices.file) }[kind];
  return fillName(tpl ? tpl() : '', v, NAME_MAX[kind] || 90);
}
/** Key under which a one-off rename is stored. Separate files only follow a style (there can be hundreds). */
function renameKey(kind, x) {
  if (kind === 'course') return 'course:' + x.course.id;
  if (kind === 'unit') return `unit:${x.course.id}:${x.unit.idx}`;
  if (kind === 'merged') return `merged:${x.course.id}:${x.mode}:${x.gk}`;
  if (kind === 'mcq') return `mcq:${x.course.id}:${x.unit.idx}`;
  return '';
}
function nameOf(kind, x) {
  const k = renameKey(kind, x);
  const custom = k && state.settings.renames[k];
  return custom ? fitName(custom, NAME_MAX[kind]) : defaultName(kind, x);
}
const groupKey = (mode, unitIdx, type) => ({ 'unit-category': unitIdx + ':' + type, category: String(type), unit: String(unitIdx), all: 'all' }[mode]);
// Paths relative to the course folder (shared by the preview and the download job)
const courseDirOf = (course) => nameOf('course', { course });
const unitDirOf = (course, unit) => nameOf('unit', { course, unit });
function mergedPathOf(course, mode, x) {
  const name = nameOf('merged', { ...x, course, mode, gk: groupKey(mode, x.unit ? x.unit.idx : 0, x.type) });
  return (UNIT_SCOPED.has(mode) ? unitDirOf(course, x.unit) + '/' : '') + name;
}
const mcqStemOf = (course, unit) => `${unitDirOf(course, unit)}/MCQs/${nameOf('mcq', { course, unit })}`;
const fileStemOf = (course, unit, type, cls, title) =>
  `${unitDirOf(course, unit)}/Files/${U.safeName(typeName(type), 60)}/${nameOf('file', { course, unit, type, cls, title })}`;

// ------------------------------------------------------------------ options UI
function buildOptions() {
  const s = state.settings;
  // merge modes
  const box = $('#modes');
  box.innerHTML = '';
  for (const m of MODES) {
    const lab = document.createElement('label');
    lab.className = 'mode spot';
    lab.innerHTML = `<input type="radio" name="mergeMode" value="${m.v}"><div class="art">${m.art.map(([w, h]) => `<i style="width:${w}px;height:${h}px"></i>`).join('')}</div><b>${esc(m.t)}</b><small>${esc(m.d)}</small>`;
    const r = lab.querySelector('input');
    r.checked = s.mergeMode === m.v;
    r.addEventListener('change', () => { s.mergeMode = m.v; saveSettings(); syncExtras(); updatePlan(); });
    box.appendChild(lab);
  }
  const boolOpt = (sel, key) => {
    const el = $(sel);
    el.checked = !!s[key];
    el.addEventListener('change', () => { s[key] = el.checked; saveSettings(); updatePlan(); });
  };
  boolOpt('#optToc', 'toc');
  boolOpt('#optSeparators', 'separators');
  boolOpt('#optIndividual', 'saveIndividual');
  boolOpt('#optOriginals', 'keepOriginals');
  for (const [sel, key] of [['#fmtPdf', 'pdf'], ['#fmtHtml', 'html'], ['#fmtMd', 'md'], ['#fmtJson', 'json']]) {
    const el = $(sel);
    el.checked = !!s.mcqFormats[key];
    el.addEventListener('change', () => { s.mcqFormats[key] = el.checked; saveSettings(); updatePlan(); });
  }
  const seg = $('#segAnswers');
  const paintSeg = () => $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.v === s.mcqAnswers));
  $$('button', seg).forEach((b) => b.addEventListener('click', () => { s.mcqAnswers = b.dataset.v; saveSettings(); paintSeg(); }));
  paintSeg();
  const eng = $('#optEngine');
  eng.value = s.engine;
  eng.addEventListener('change', () => { s.engine = eng.value; saveSettings(); });
  const root = $('#optRoot');
  root.value = s.rootFolder;
  root.addEventListener('input', () => updatePlan());
  root.addEventListener('change', () => { s.rootFolder = U.safeName(root.value || DEFAULTS.rootFolder, 40); root.value = s.rootFolder; saveSettings(); updatePlan(); });

  syncExtras();
}

/** Extras that don't apply to the chosen combine mode are shown as such (never silently ignored). */
function syncExtras() {
  const s = state.settings;
  const none = s.mergeMode === 'none';
  const ind = $('#optIndividual');
  ind.checked = none || !!s.saveIndividual;
  ind.disabled = state.running || none;
  ind.closest('.switch').classList.toggle('na', none);
  ind.closest('.switch').querySelector('small').textContent = none ? 'Always on when files are not combined' : 'Each document as its own PDF, in a Files folder';
  for (const id of ['#optToc', '#optSeparators']) {
    const el = $(id);
    el.disabled = state.running || none;
    el.closest('.switch').classList.toggle('na', none);
  }
}

// ------------------------------------------------------------------ inline rename (in the preview tree)
const PEN = '<svg class="pen" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>';
const RENAME_STYLE_LABEL = { course: 'Style for every course folder', unit: 'Style for every unit folder', merged: 'Style for every combined PDF', file: 'Style for every separate file' };
let renameOpen = null;

function closeRename() {
  if (!renameOpen) return;
  const r = renameOpen;
  renameOpen = null;
  r.box.remove();
  r.node.classList.remove('editing');
  document.removeEventListener('pointerdown', r.outside, true);
}

/** Style choices offered under the name field (they apply to all items of that kind). */
function renameChoices(ed) {
  const s = state.settings;
  if (!NAME_STYLES[ed.kind]) return [];
  const custom = ed.key && s.renames[ed.key];
  const seen = new Set();
  const out = [];
  for (const [id] of NAME_STYLES[ed.kind]) {
    const label = defaultName(ed.kind, ed.x, { ...s.naming, [ed.kind]: id }) + (ed.ext || '');
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ id, label, on: !custom && s.naming[ed.kind] === id });
  }
  return out.length > 1 ? out : [];
}

function applyRename(ed, raw) {
  const s = state.settings;
  let v = String(raw == null ? '' : raw).trim();
  if (ed.ext && v.toLowerCase().endsWith(ed.ext.toLowerCase())) v = v.slice(0, -ed.ext.length).trim();
  if (ed.kind === 'root') {
    s.rootFolder = v ? U.safeName(v, 40) : DEFAULTS.rootFolder;
    $('#optRoot').value = s.rootFolder;
  } else if (ed.key) {
    const clean = v ? fitName(v, NAME_MAX[ed.kind]) : '';
    if (!clean || clean === defaultName(ed.kind, ed.x)) delete s.renames[ed.key];
    else s.renames[ed.key] = clean;
  }
  saveSettings();
  updatePlan();
}

function openRename(node) {
  if (state.running) { toast('Names are locked while downloading', 'warn'); return; }
  const ed = state.editables[Number(node.dataset.e)];
  if (!ed) return;
  if (renameOpen && renameOpen.node === node) return;
  closeRename();
  const box = document.createElement('div');
  box.className = 'rename';
  const free = ed.kind !== 'file';
  const chips = renameChoices(ed);
  box.innerHTML =
    (free ? '<div class="rn-field"><input type="text" spellcheck="false" maxlength="90" aria-label="New name"><span class="rn-ext"></span></div>' : '') +
    (chips.length ? '<div class="rn-label"></div><div class="rn-chips" role="radiogroup"></div>' : '') +
    '<div class="rn-hint"></div>';
  const done = () => { closeRename(); };
  let committed = false;
  const commit = (val) => { if (committed) return; committed = true; closeRename(); applyRename(ed, val); };
  if (free) {
    const inp = box.querySelector('input');
    inp.value = ed.value;
    box.querySelector('.rn-ext').textContent = ed.ext || '';
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(inp.value); }
      else if (e.key === 'Escape') { e.preventDefault(); committed = true; done(); node.focus(); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (renameOpen && renameOpen.box === box) commit(inp.value); }, 0));
  }
  if (chips.length) {
    box.querySelector('.rn-label').textContent = RENAME_STYLE_LABEL[ed.kind] || 'Suggestions';
    const wrap = box.querySelector('.rn-chips');
    for (const c of chips) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rn-chip' + (c.on ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(c.on));
      b.innerHTML = '<span></span>';
      b.firstChild.textContent = c.label;
      b.title = c.label;
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the field focused
      b.addEventListener('click', () => {
        committed = true;
        closeRename();
        state.settings.naming[ed.kind] = c.id;
        if (ed.key) delete state.settings.renames[ed.key];
        saveSettings();
        updatePlan();
      });
      wrap.appendChild(b);
    }
  }
  box.querySelector('.rn-hint').textContent = free
    ? 'Enter to save · Esc to cancel · leave empty for the automatic name'
    : 'Separate files are named after their class. Pick how every one is named.';
  node.classList.add('editing');
  node.after(box);
  const outside = (e) => { if (!box.contains(e.target) && !node.contains(e.target)) { if (free) commit(box.querySelector('input').value); else done(); } };
  renameOpen = { node, box, outside };
  document.addEventListener('pointerdown', outside, true);
  if (free) {
    const inp = box.querySelector('input');
    inp.focus();
    inp.select();
  } else {
    const first = box.querySelector('.rn-chip');
    if (first) first.focus();
  }
  box.scrollIntoView({ block: 'nearest' });
}

function resetRename(ed) {
  if (state.running) return;
  if (ed.kind === 'root') applyRename(ed, '');
  else if (ed.key) { delete state.settings.renames[ed.key]; saveSettings(); updatePlan(); }
}

function wirePreview() {
  const tree = $('#previewTree');
  tree.addEventListener('click', (e) => {
    if (e.target.closest('.rename')) return;
    const undo = e.target.closest('.undo');
    const node = e.target.closest('.node.editable');
    if (!node) return;
    if (undo) { e.stopPropagation(); resetRename(state.editables[Number(node.dataset.e)]); return; }
    openRename(node);
  });
  tree.addEventListener('keydown', (e) => {
    const node = e.target.closest && e.target.closest('.node.editable');
    if (node && e.target === node && (e.key === 'Enter' || e.key === ' ' || e.key === 'F2')) { e.preventDefault(); openRename(node); }
  });
  $('#previewFoot').addEventListener('click', (e) => {
    if (!e.target.closest('#btnResetNames') || state.running) return;
    state.settings.renames = {};
    state.settings.naming = { ...NAMING_CHOICE_DEFAULTS };
    state.settings.rootFolder = DEFAULTS.rootFolder;
    $('#optRoot').value = DEFAULTS.rootFolder;
    saveSettings();
    updatePlan();
    toast('All names are back to automatic', 'ok');
  });
}

// ------------------------------------------------------------------ session handling
function showLogin(expired) {
  $('#loginBanner').classList.remove('hidden');
  $('#loginTitle').textContent = expired ? 'Your PESU Academy session expired' : 'Log in to PESU Academy';
  $('#loginText').textContent = expired
    ? 'Log in again in the PESU Academy tab, then press Continue — the download resumes where it stopped.'
    : 'Open PESU Academy, log in, then press Continue.';
  pill('#chipSession', 'bad', 'Not logged in');
}
function hideLogin() { $('#loginBanner').classList.add('hidden'); }

async function connectSession() {
  try {
    const mode = await Net.init();
    hideLogin();
    pill('#chipSession', 'ok', 'PESU connected' + (mode === 'tab' ? ' (via tab)' : ''));
    return true;
  } catch (e) {
    if (e instanceof PESU.SessionExpiredError) showLogin(false);
    else {
      pill('#chipSession', 'bad', 'PESU unreachable');
      log('error', 'Could not reach PESU Academy: ' + e.message);
    }
    return false;
  }
}

/** Resolves when the browser reports it is online again. */
function waitOnline() {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((res) => window.addEventListener('online', () => res(), { once: true }));
}

/**
 * Runs fn, transparently surviving: a logged-out / expired PESU session (pauses, polls quietly and
 * resumes by itself once you log in again — or when you press Continue), the PESU tab being closed
 * (Net reopens one), and the internet dropping (waits for the connection to come back).
 */
async function withSession(fn) {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      if (!navigator.onLine) {
        log('warn', 'You are offline — waiting for the internet connection to come back…');
        pill('#chipSession', 'warn', 'Offline — waiting');
        await waitOnline();
        await U.sleep(1500);
        pill('#chipSession', 'ok', 'PESU connected');
        log('ok', 'Back online — continuing.');
        checkCancel();
        continue;
      }
      if (!(e instanceof PESU.SessionExpiredError)) throw e;
      if (!state.sessionWait) {
        log('warn', 'PESU session expired (logged out, timed out, or logged in elsewhere) — paused until you log in again.');
        showLogin(true);
        toast('Session expired — log in to PESU Academy; the download resumes automatically', 'warn', 8000);
        state.sessionWait = new Promise((res) => (state.sessionResolve = res));
        startSessionWatch();
      }
      await state.sessionWait;
      checkCancel();
    }
  }
}

function resumeSession() {
  stopSessionWatch();
  hideLogin();
  if (state.sessionResolve) {
    state.sessionResolve();
    state.sessionWait = null;
    state.sessionResolve = null;
    log('ok', 'Session restored — resuming.');
    toast('Logged in again — resuming', 'ok');
  }
}

// While paused for login: re-check quietly every few seconds (and immediately when a PESU page loads).
let watchTimer = null;
let watchBusy = false;
const baseTitle = document.title;
async function sessionProbe() {
  if (watchBusy) return;
  watchBusy = true;
  try {
    const mode = await Net.init();
    pill('#chipSession', 'ok', 'PESU connected' + (mode === 'tab' ? ' (via tab)' : ''));
    resumeSession();
    if (!state.semesters.length) loadSemesters();
  } catch (_) { /* still logged out */ } finally {
    watchBusy = false;
  }
}
function startSessionWatch() {
  if (watchTimer) return;
  document.title = '⚠ Log in needed — ' + baseTitle;
  watchTimer = setInterval(sessionProbe, 5000);
}
function stopSessionWatch() {
  clearInterval(watchTimer);
  watchTimer = null;
  document.title = baseTitle;
}
ext.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'pesu-page' && msg.loggedIn && (watchTimer || !Net.mode)) setTimeout(sessionProbe, 300);
  if (msg && msg.type === 'select-course' && msg.courseId) selectCourseFromPesu(String(msg.courseId));
});

/** The "PESU Downloader" button on a course page was pressed while this page was already open. */
async function selectCourseFromPesu(id) {
  if (state.running) { toast('A download is running. Wait for it to finish, or press Cancel first.', 'warn', 4500); return; }
  switchTab('download');
  if (state.selectedCourses.has(id) && state.scanned.has(id)) return; // already there
  const here = state.courses.find((c) => c.id === id);
  if (here) {
    state.selectedCourses.add(id);
    renderCourses();
    $('#stepCourses').scrollIntoView({ behavior: 'smooth', block: 'start' });
    scan();
    return;
  }
  if (!state.semesters.length) { state.preselect = id; return; } // still starting up: loadSemesters picks it up
  state.preselect = id;
  const semId = await findSemesterOf(id);
  if (semId == null) { state.preselect = null; toast('That course was not found in your semesters.', 'warn'); return; }
  $('#semester').value = semId;
  await loadCourses(semId);
}

async function onLoginContinue() {
  const btn = $('#btnLoginRetry');
  btn.disabled = true;
  const ok = await connectSession();
  btn.disabled = false;
  if (ok) {
    toast('Connected to PESU Academy', 'ok');
    resumeSession();
    if (!state.semesters.length) loadSemesters();
  } else {
    $('#loginText').textContent = 'Still not logged in. Log in at pesuacademy.com in this browser — this page notices automatically.';
  }
}

// ------------------------------------------------------------------ converter helper
async function checkHelper() {
  pill('#chipHelper', '', 'Checking converter…');
  const info = await host.ping();
  const plat = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
  if (!info) {
    pill('#chipHelper', 'warn', 'Converter not installed');
    const cmd = plat.includes('win') ? 'native-host\\install.bat' : 'bash native-host/install.sh';
    $('#helperTitle').textContent = 'Converter helper not installed';
    $('#helperText').innerHTML = 'PDFs still download and merge. To turn PPT and DOC files into PDF, run <code id="helperCmd"></code> once (see the README), then press Re-check.';
    $('#helperCmd').textContent = cmd;
    $('#btnGetLibre').classList.add('hidden');
    $('#helperBanner').classList.remove('hidden');
    return;
  }
  $('#helperBanner').classList.add('hidden');
  const o = info.office || {};
  const engines = [];
  if (o.powerpoint || o.word) engines.push('MS Office');
  if (info.libreoffice) engines.push('LibreOffice');
  pill('#chipHelper', engines.length ? 'ok' : 'warn', engines.length ? 'Converter: ' + engines.join(' + ') : 'No Office / LibreOffice');
  if (!engines.length) {
    log('warn', 'Converter helper is installed but neither MS Office nor LibreOffice was found — PPT/DOC files will be kept as originals.');
    const how = plat.includes('mac') ? ' On a Mac you can also run <code>brew install --cask libreoffice</code>.'
      : plat.includes('linux') ? ' On Linux: <code>sudo apt install libreoffice</code> (or your distro\'s package).' : '';
    $('#helperTitle').textContent = 'Install LibreOffice to convert PPT and DOC files';
    $('#helperText').innerHTML = 'The helper is ready, but it needs Microsoft Office or the free LibreOffice to do the converting. Until then, PDFs still download and merge, and PPT/DOC files are saved as they are.' + how + ' After installing, press Re-check (no need to run the installer again).';
    $('#btnGetLibre').classList.remove('hidden');
    $('#helperBanner').classList.remove('hidden');
  }
}

// ------------------------------------------------------------------ semesters / courses
async function loadSemesters() {
  try {
    // the session check already fetched this list - reuse it (one round trip to PESU fewer)
    const cached = Net.semestersHtml;
    Net.semestersHtml = null;
    const t = cached || await withSession(() => Net.text(PESU.urls.semesters()));
    state.semesters = PESU.parseSemesters(t);
  } catch (e) {
    log('error', 'Could not load semesters: ' + e.message);
    return;
  }
  const sel = $('#semester');
  sel.innerHTML = '';
  state.semesters.forEach((s) => sel.add(new Option(s.name, s.id)));
  sel.disabled = false;
  let semId = state.settings.semesterId && state.semesters.some((s) => s.id === state.settings.semesterId) ? state.settings.semesterId : state.semesters[0] && state.semesters[0].id;
  if (state.preselect) {
    const found = await findSemesterOf(state.preselect, semId);
    if (found != null) semId = found;
  }
  sel.value = semId;
  await loadCourses(semId);
}

/** Which semester holds this course? Checks the likely one first, then the rest at the same time. */
async function findSemesterOf(courseId, first = state.settings.semesterId || (state.semesters[0] && state.semesters[0].id)) {
  const has = async (semId) => (await fetchCourses(semId).catch(() => [])).some((c) => c.id === courseId);
  if (first != null && await has(first)) return first;
  const rest = state.semesters.map((s) => s.id).filter((x) => x !== first);
  const hits = await Promise.all(rest.map(async (semId) => ((await has(semId)) ? semId : null)));
  const hit = hits.find((x) => x != null);
  return hit == null ? null : hit;
}

const courseCache = new Map();
async function fetchCourses(semId) {
  if (courseCache.has(semId)) return courseCache.get(semId);
  const html = await withSession(() => Net.text(PESU.urls.courses(semId)));
  const list = PESU.parseCourses(html);
  courseCache.set(semId, list);
  return list;
}

async function loadCourses(semId) {
  state.settings.semesterId = semId;
  saveSettings();
  $('#courseList').innerHTML = '<div class="empty shimmer">Loading courses…</div>';
  try {
    state.courses = await fetchCourses(semId);
  } catch (e) {
    $('#courseList').innerHTML = '<div class="empty">Could not load courses: ' + esc(e.message) + '</div>';
    return;
  }
  state.selectedCourses.clear();
  if (state.preselect && state.courses.some((c) => c.id === state.preselect)) state.selectedCourses.add(state.preselect);
  renderCourses();
  if (state.preselect && state.selectedCourses.size) {
    state.preselect = null;
    scan();
  }
}

function courseHint() {
  const n = state.selectedCourses.size;
  $('#courseHint').textContent = n ? `${n} course${n > 1 ? 's' : ''} selected` : 'No course selected';
  $('#btnScan').disabled = !n || state.running;
}

function renderCourses() {
  const box = $('#courseList');
  box.innerHTML = '';
  if (!state.courses.length) {
    box.innerHTML = '<div class="empty">No courses in this semester.</div>';
    return;
  }
  state.courses.forEach((c, i) => {
    const lab = document.createElement('label');
    lab.className = 'course spot';
    lab.style.setProperty('--i', i);
    lab.innerHTML = `<input type="checkbox"><span class="tick">${svg('check')}</span><span class="code"></span><span class="title"></span>${c.type ? '<span class="tag"></span>' : ''}`;
    const cb = lab.querySelector('input');
    cb.checked = state.selectedCourses.has(c.id);
    lab.querySelector('.code').textContent = c.code;
    lab.querySelector('.title').textContent = c.title;
    if (c.type) lab.querySelector('.tag').textContent = c.type;
    cb.addEventListener('change', () => {
      if (cb.checked) state.selectedCourses.add(c.id);
      else state.selectedCourses.delete(c.id);
      courseHint();
    });
    box.appendChild(lab);
  });
  courseHint();
}

// ------------------------------------------------------------------ scan
async function scan() {
  const ids = [...state.selectedCourses];
  if (!ids.length) return;
  const btn = $('#btnScan');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.querySelector('span').textContent = 'Scanning…';
  state.scanned.clear();
  state.selectedUnits.clear();
  $('#unitTables').innerHTML = '<div class="empty shimmer">Reading units and classes…</div>';
  try {
    for (const id of ids) {
      const course = state.courses.find((c) => c.id === id) || { id, code: id, title: '' };
      const ch = await withSession(() => Net.text(PESU.urls.course(id)));
      const parsed = PESU.parseCourse(ch);
      const subType = parsed.subType || '4';
      const lim = U.limiter(3);
      const units = await Promise.all(parsed.units.map((u) => lim(async () => {
        const uh = await withSession(() => Net.text(PESU.urls.unit(id, u.id, subType)));
        const { classes } = PESU.parseUnit(uh);
        const counts = {};
        for (const t of CATS) counts[t] = classes.reduce((a, c) => a + ((c.cells[t] && c.cells[t].count) || 0), 0);
        return { ...u, classes, counts };
      })));
      state.scanned.set(id, { course, units, subType });
      units.forEach((u) => state.selectedUnits.add(id + ':' + u.id));
      log('info', `Scanned ${course.code}: ${units.length} units, ${units.reduce((a, u) => a + u.classes.length, 0)} classes.`);
    }
    toast(`Scanned ${ids.length} course${ids.length > 1 ? 's' : ''}`, 'ok');
    setTimeout(() => $('#stepUnits').scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
  } catch (e) {
    log('error', 'Scan failed: ' + e.message);
    toast('Scan failed — see Activity', 'bad');
    $('#unitTables').innerHTML = '<div class="empty">Scan failed: ' + esc(e.message) + '</div>';
  } finally {
    btn.classList.remove('loading');
    btn.querySelector('span').textContent = 'Scan courses';
    courseHint();
  }
  renderUnits();
}

function renderCats() {
  const box = $('#cats');
  box.innerHTML = '';
  const totals = {};
  for (const [cid, c] of state.scanned) {
    for (const u of c.units) {
      if (!state.selectedUnits.has(cid + ':' + u.id)) continue;
      for (const t of CATS) totals[t] = (totals[t] || 0) + u.counts[t];
    }
  }
  CATS.forEach((t, i) => {
    const lab = document.createElement('label');
    lab.className = 'cat';
    lab.style.setProperty('--i', i);
    lab.innerHTML = `<input type="checkbox"><span class="ic">${svg(t)}</span><span class="nm"></span>${state.scanned.size ? '<span class="n"></span>' : ''}`;
    const cb = lab.querySelector('input');
    cb.checked = state.settings.categories.includes(t);
    cb.disabled = state.running;
    lab.querySelector('.nm').textContent = typeName(t);
    if (state.scanned.size) lab.querySelector('.n').textContent = String(totals[t] || 0);
    cb.addEventListener('change', () => {
      const set = new Set(state.settings.categories);
      if (cb.checked) set.add(t);
      else set.delete(t);
      state.settings.categories = CATS.filter((x) => set.has(x));
      saveSettings();
      renderUnitTables();
      updatePlan();
    });
    box.appendChild(lab);
  });
}

function renderUnits() {
  renderCats();
  renderUnitTables();
  updatePlan();
}

function renderUnitTables() {
  const box = $('#unitTables');
  box.innerHTML = '';
  if (!state.scanned.size) {
    box.innerHTML = '<div class="empty">Scan a course to see its units here.</div>';
    $('#stepUnits').dataset.locked = 'true';
    return;
  }
  $('#stepUnits').dataset.locked = 'false';
  const cats = state.settings.categories;
  for (const [cid, c] of state.scanned) {
    const block = document.createElement('div');
    block.className = 'course-block';
    block.innerHTML = '<h4><span class="code"></span><span class="t"></span></h4><div class="table-wrap"><table class="unit-table"><thead><tr></tr></thead><tbody></tbody></table></div>';
    block.querySelector('.code').textContent = c.course.code;
    block.querySelector('.t').textContent = c.course.title;
    block.querySelector('thead tr').innerHTML = '<th></th><th class="name">Unit</th><th>Classes</th>' +
      CATS.map((t) => `<th class="${cats.includes(t) ? '' : 'dim'}" title="${esc(typeName(t))}">${esc(PESU.TYPE_BY_ID[t].short || typeName(t))}</th>`).join('');
    const body = block.querySelector('tbody');
    for (const u of c.units) {
      const key = cid + ':' + u.id;
      const tr = document.createElement('tr');
      const sel = state.selectedUnits.has(key);
      if (!sel) tr.className = 'unsel';
      tr.innerHTML = `<td><input type="checkbox" class="ucheck" aria-label="Unit ${u.idx}" ${sel ? 'checked' : ''} ${state.running ? 'disabled' : ''}></td>` +
        `<td class="name uname"><b>Unit ${u.idx}</b><span></span></td><td>${u.classes.length}</td>` +
        CATS.map((t) => {
          const n = u.counts[t];
          const wide = u.classes.some((cl) => cl.cells[t] && cl.cells[t].unitWide);
          const cls = !n ? 'zero' : cats.includes(t) ? '' : 'off';
          return `<td><span class="cnt ${cls}">${n ? n + (wide ? '<sup title="Includes whole-unit material">*</sup>' : '') : '–'}</span></td>`;
        }).join('');
      tr.querySelector('.uname span').textContent = u.name;
      const cb = tr.querySelector('input');
      const toggle = (v) => {
        if (state.running) return;
        if (v) state.selectedUnits.add(key);
        else state.selectedUnits.delete(key);
        tr.classList.toggle('unsel', !v);
        cb.checked = v;
        renderCats();
        updatePlan();
      };
      cb.addEventListener('change', () => toggle(cb.checked));
      tr.addEventListener('click', (e) => { if (e.target !== cb) toggle(!state.selectedUnits.has(key)); });
      body.appendChild(tr);
    }
    box.appendChild(block);
  }
}

// ------------------------------------------------------------------ plan + preview
function selectedPlan() {
  const cats = state.settings.categories;
  const out = [];
  for (const [cid, c] of state.scanned) {
    const units = c.units.filter((u) => state.selectedUnits.has(cid + ':' + u.id));
    if (units.length) out.push({ ...c, units });
  }
  return { courses: out, cats };
}
function planReady() {
  const p = selectedPlan();
  return p.courses.length > 0 && p.cats.length > 0;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
function updatePlan() {
  const p = selectedPlan();
  const el = $('#planSummary');
  renderPreview(p);
  if (!p.courses.length || !p.cats.length) {
    el.textContent = !state.scanned.size ? 'Scan a course first.' : !p.cats.length ? 'Pick at least one category.' : 'Pick at least one unit.';
    $('#btnStart').disabled = true;
    return;
  }
  let items = 0;
  for (const c of p.courses) for (const u of c.units) for (const t of p.cats) items += u.counts[t] || 0;
  el.textContent = `${p.courses.length} course${p.courses.length > 1 ? 's' : ''} · ${plural(p.courses.reduce((a, c) => a + c.units.length, 0), 'unit')} · ${plural(p.cats.length, 'category', 'categories')} · ~${plural(items, 'item')} → Downloads/${U.safeName($('#optRoot').value || state.settings.rootFolder, 40)}/`;
  $('#btnStart').disabled = state.running;
}

const docsLabel = (n) => `~${n} doc${n === 1 ? '' : 's'}`;
// what a kept original most likely is (only saved when it isn't already a PDF)
const ORIGINAL_EXT = (t) => (t === 2 ? '.pptx' : '.docx');

function renderPreview(p) {
  const tree = $('#previewTree');
  const foot = $('#previewFoot');
  const S = state.settings;
  if (renameOpen && tree.contains(renameOpen.node)) closeRename();
  state.editables = [];
  if (!p.courses.length || !p.cats.length) {
    tree.innerHTML = '<div class="muted small">' + (state.scanned.size ? 'Select units and categories to preview the output.' : 'Scan a course to preview the folders and files.') + '</div>';
    foot.textContent = '';
    return;
  }
  const rootName = U.safeName($('#optRoot').value || S.rootFolder, 40);
  const root = { kids: new Map() };
  // segments: a plain string is an automatic folder; {name, edit} can be renamed by clicking it
  const add = (segs, meta) => {
    let node = root;
    segs.forEach((sg, i) => {
      const last = i === segs.length - 1;
      const name = typeof sg === 'string' ? sg : sg.name;
      const id = name.toLowerCase();
      if (!node.kids.has(id)) node.kids.set(id, { name, kids: new Map(), folder: !last, meta: last ? meta : null, edit: typeof sg === 'string' ? null : sg.edit });
      node = node.kids.get(id);
    });
  };
  const edit = (kind, x, name, ext = '') => ({ name: name + ext, edit: { kind, x, ext, value: name, key: renameKey(kind, x) } });
  const mode = S.mergeMode;
  const fm = S.mcqFormats;
  const mcqExts = ['pdf', 'html', 'md', 'json'].filter((e) => fm[e]);
  const sepPdf = S.saveIndividual || mode === 'none';
  const notes = [];
  for (const c of p.courses.slice(0, 3)) {
    const course = c.course;
    const cd = edit('course', { course }, courseDirOf(course));
    const ud = (u) => edit('unit', { course, unit: u }, unitDirOf(course, u));
    const docCats = p.cats.filter((t) => t !== 8);
    const has = (u, t) => (u.counts[t] || 0) > 0;
    // combined PDFs
    if (mode !== 'none') {
      const merged = (x, meta) => {
        const ex = { ...x, course, mode, gk: groupKey(mode, x.unit ? x.unit.idx : 0, x.type) };
        const leaf = edit('merged', ex, nameOf('merged', ex), '.pdf');
        add(UNIT_SCOPED.has(mode) ? [cd, ud(x.unit), leaf] : [cd, leaf], meta);
      };
      const cats = mode === 'unit-category' ? docCats : p.cats;
      if (mode === 'unit-category') {
        for (const u of c.units) for (const t of cats) if (has(u, t)) merged({ unit: u, units: [u.idx], type: t }, docsLabel(u.counts[t]));
      } else if (mode === 'category') {
        for (const t of cats) {
          const us = c.units.filter((u) => has(u, t));
          if (us.length) merged({ unit: us[0], units: us.map((u) => u.idx), type: t }, docsLabel(us.reduce((a, u) => a + u.counts[t], 0)));
        }
      } else if (mode === 'unit') {
        for (const u of c.units) if (cats.some((t) => has(u, t))) merged({ unit: u, units: [u.idx], type: null }, docsLabel(cats.reduce((a, t) => a + (u.counts[t] || 0), 0)));
      } else {
        const us = c.units.filter((u) => cats.some((t) => has(u, t)));
        if (us.length) merged({ unit: us[0], units: us.map((u) => u.idx), type: null }, 'everything');
      }
    }
    // MCQs, in each unit's MCQs folder
    if (p.cats.includes(8)) {
      for (const u of c.units) {
        if (!has(u, 8)) continue;
        const x = { course, unit: u };
        const stem = nameOf('mcq', x);
        for (const e of mcqExts) add([cd, ud(u), 'MCQs', edit('mcq', x, stem, '.' + e)], { pdf: 'with answers', html: 'practice page', md: 'text', json: 'data' }[e]);
      }
    }
    // separate files and kept originals (a few examples)
    if (sepPdf || S.keepOriginals) {
      let shown = 0;
      for (const u of c.units) {
        for (const t of docCats) {
          for (const cl of u.classes) {
            if (!(cl.cells[t] && cl.cells[t].count) || shown >= 6) continue;
            const x = { course, unit: u, type: t, cls: cl, title: cl.title };
            const stem = nameOf('file', x);
            const dir = [cd, ud(u), 'Files', U.safeName(typeName(t), 60)];
            if (sepPdf) add([...dir, edit('file', x, stem, '.pdf')], '');
            if (S.keepOriginals) add([...dir, edit('file', x, stem, ORIGINAL_EXT(t))], 'original, if not PDF');
            shown++;
          }
        }
      }
    }
    if (p.cats.includes(9)) add([cd, '_Links.md'], 'web links, if any');
    add([cd, '_Report.txt'], 'summary');
  }

  // render
  let i = 0;
  const locked = state.running;
  const nodeHtml = (n, icon, label) => {
    const ed = n.edit;
    if (!ed) return `<span class="node">${svg(icon)}<span class="nm" title="${esc(n.name)}">${label || esc(n.name)}</span>${n.meta ? `<span class="meta">${esc(n.meta)}</span>` : ''}</span>`;
    const id = state.editables.push(ed) - 1;
    const edited = ed.kind === 'root' ? rootName !== DEFAULTS.rootFolder : !!(ed.key && S.renames[ed.key]);
    const tip = n.name + (locked ? ' (names are locked while downloading)' : ed.kind === 'file' ? ' (click to choose how separate files are named)' : ' (click to rename)');
    return `<span class="node editable${edited ? ' edited' : ''}" data-e="${id}" tabindex="${locked ? -1 : 0}" role="button" title="${esc(tip)}">${svg(icon)}<span class="nm">${label || esc(n.name)}</span>` +
      (edited && !locked ? '<button type="button" class="undo" title="Back to the automatic name" aria-label="Undo rename">↺</button>' : '') +
      (n.meta ? `<span class="meta">${esc(n.meta)}</span>` : '') + PEN + '</span>';
  };
  const renderNode = (n) => {
    const rank = (k) => (k.folder ? 1 : /\.pdf$/i.test(k.name) ? 0 : 2); // combined PDFs first, then folders, then the rest
    const kids = [...n.kids.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    const shown = kids.slice(0, 14);
    let h = '<ul>';
    for (const k of shown) {
      const cls = k.folder ? 'folder' : /\.pdf$/i.test(k.name) ? 'pdf' : 'other';
      h += `<li class="${cls}" style="--i:${i++}">${nodeHtml(k, k.folder ? 'folder' : 'file')}`;
      if (k.folder) h += renderNode(k);
      h += '</li>';
    }
    if (kids.length > shown.length) h += `<li class="more">+${kids.length - shown.length} more…</li>`;
    return h + '</ul>';
  };
  const rootNode = { name: rootName, edit: { kind: 'root', value: rootName, ext: '', key: '' } };
  tree.innerHTML = `<ul><li class="folder">${nodeHtml(rootNode, 'folder', `<span class="pre">Downloads/</span>${esc(rootName)}`)}${renderNode(root)}</li></ul>`;
  tree.classList.toggle('locked', locked);

  if (p.courses.length > 3) notes.push(`Showing 3 of ${p.courses.length} courses.`);
  if (sepPdf || S.keepOriginals) notes.push('Separate files: a few examples shown.');
  if (p.cats.includes(8) && !mcqExts.length) {
    notes.push(mode === 'unit-category' || mode === 'none' ? 'No MCQ format is ticked, so MCQs are skipped.' : 'MCQs go only into the combined PDFs (no MCQ format ticked).');
  } else if (p.cats.includes(8) && mode !== 'unit-category' && mode !== 'none') notes.push('MCQs are also added to the combined PDFs.');
  if (mode !== 'none' && (S.toc || S.separators)) notes.push(`Each combined PDF has ${[S.toc && 'a cover and contents page', S.separators && 'a divider before every document'].filter(Boolean).join(' and ')}.`);
  notes.push('Identical files are saved once.');
  const anyCustom = Object.keys(S.renames).length || rootName !== DEFAULTS.rootFolder || Object.keys(NAMING_CHOICE_DEFAULTS).some((k) => S.naming[k] !== NAMING_CHOICE_DEFAULTS[k]);
  const lead = locked
    ? '<span class="lockline"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Names are locked while downloading.</span>'
    : `<span class="hintline">${PEN}Click any name to rename it.${anyCustom ? ' <button type="button" class="linkbtn" id="btnResetNames">Reset names</button>' : ''}</span>`;
  foot.innerHTML = lead + `<span>${esc(notes.join(' '))}</span>`;
}

// ------------------------------------------------------------------ job
class Cancelled extends Error {
  constructor() { super('Cancelled'); this.name = 'Cancelled'; }
}
function checkCancel() {
  if (state.running && state.job && state.job.cancel) throw new Cancelled();
}

const PHASES = { lists: 0.12, docs: 0.6, mcq: 0.1, merge: 0.18 };
const PHASE_ORDER = ['lists', 'docs', 'mcq', 'merge'];
function progress(phaseKey, frac, label) {
  const j = state.job;
  if (!j || !state.running) return;
  let before = 0;
  for (const k of PHASE_ORDER) { if (k === phaseKey) break; before += PHASES[k]; }
  const within = before + PHASES[phaseKey] * Math.max(0, Math.min(1, frac));
  const pct = Math.min(100, Math.round(((j.courseIndex + within) / j.courseTotal) * 100));
  $('#bar').style.width = pct + '%';
  $('#pct').textContent = pct + '%';
  if (label) $('#phase').textContent = label;
  const pi = PHASE_ORDER.indexOf(phaseKey);
  $$('#phases li').forEach((li) => {
    const k = PHASE_ORDER.indexOf(li.dataset.p);
    li.classList.toggle('active', k === pi);
    li.classList.toggle('done', k >= 0 && k < pi);
  });
  renderStats();
}
const STAT_DEF = [['found', 'Found'], ['downloaded', 'Downloaded'], ['converted', 'Converted'], ['dupes', 'Duplicates skipped'], ['merged', 'Merged PDFs'], ['mcqs', 'MCQs'], ['saved', 'Files saved']];
let lastStats = {};
function renderStats() {
  const j = state.job;
  if (!j) return;
  const box = $('#stats');
  if (!box.children.length) {
    box.innerHTML = STAT_DEF.map(([k, l]) => `<div class="stat" data-k="${k}"><small>${l}</small><b>0</b></div>`).join('') +
      '<div class="stat" data-k="problems"><small>Problems</small><b>0</b></div>';
  }
  const vals = { ...j.stats, problems: j.warnings.length + j.errors.length };
  for (const [k, v] of Object.entries(vals)) {
    const el = box.querySelector(`[data-k="${k}"]`);
    if (!el) continue;
    const b = el.querySelector('b');
    if (lastStats[k] !== v) {
      FX.count(b, v);
      b.classList.remove('bump');
      void b.offsetWidth;
      b.classList.add('bump');
    }
    if (k === 'problems') el.classList.toggle('bad', v > 0);
  }
  lastStats = vals;
}

/** The PDF engine (about 1.3 MB of script) loads after the page is up, so opening the page stays instant. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('could not load ' + src));
    document.body.appendChild(el);
  });
}
let pdfEngine = null;
function ensurePdfEngine() {
  if (!pdfEngine) {
    pdfEngine = (async () => {
      if (!self.PDFLib) await loadScript('lib/pdf-lib.min.js');
      if (!self.fontkit) await loadScript('lib/fontkit.umd.min.js');
      if (!self.PDFX) await loadScript('src/pdf.js');
    })();
    pdfEngine.catch(() => { pdfEngine = null; }); // allow a retry
  }
  return pdfEngine;
}
async function ensureFonts() {
  if (ensureFonts.done) return;
  await ensurePdfEngine();
  const get = async (f) => new Uint8Array(await (await fetch(ext.runtime.getURL('fonts/' + f))).arrayBuffer());
  PDFX.setFonts({ regular: await get('DejaVuSans.ttf'), bold: await get('DejaVuSans-Bold.ttf'), mono: await get('DejaVuSansMono.ttf') });
  ensureFonts.done = true;
}

// --- saving through ext.downloads
function splitExt(name) {
  const m = name.match(/^(.*?)(\.[a-z0-9]{1,5})?$/i);
  return [m[1], m[2] || ''];
}
function cleanPath(rel) {
  const segs = rel.split('/').filter(Boolean);
  return segs.map((seg, i) => {
    if (i < segs.length - 1) return U.safeName(seg, 60);
    const [b, e] = splitExt(seg);
    return U.safeName(b, 90) + e.toLowerCase();
  }).join('/');
}
function uniquePath(rel) {
  const used = state.job.usedPaths;
  const p = cleanPath(rel);
  if (!used.has(p.toLowerCase())) { used.add(p.toLowerCase()); return p; }
  const [b, e] = splitExt(p);
  for (let i = 2; ; i++) {
    const q = `${b} (${i})${e}`;
    if (!used.has(q.toLowerCase())) { used.add(q.toLowerCase()); return q; }
  }
}
function waitDownload(id) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; ext.downloads.onChanged.removeListener(on); clearTimeout(t); fn(v); };
    const on = (d) => {
      if (d.id !== id || !d.state) return;
      if (d.state.current === 'complete') finish(resolve, id);
      if (d.state.current === 'interrupted') ext.downloads.search({ id }).then(([it]) => finish(reject, new Error('Save failed: ' + ((it && it.error) || 'interrupted'))));
    };
    const t = setTimeout(() => finish(reject, new Error('Save timed out')), 10 * 60 * 1000);
    ext.downloads.onChanged.addListener(on);
    ext.downloads.search({ id }).then(([it]) => {
      if (it && it.state === 'complete') finish(resolve, id);
      else if (it && it.state === 'interrupted') finish(reject, new Error('Save failed: ' + (it.error || 'interrupted')));
    });
  });
}
const saveLimit = U.limiter(4);
/** Save bytes to Downloads/<base>/<rel>. Returns the relative path used. */
function saveFile(base, rel, data, mime, headline) {
  const filename = uniquePath(base + '/' + rel);
  return saveLimit(async () => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    try {
      const id = await ext.downloads.download({ url, filename, conflictAction: 'overwrite', saveAs: false });
      if (id == null) throw new Error('download failed');
      await waitDownload(id);
      const j = state.job;
      j.stats.saved++;
      j.lastDownloadId = id;
      j.savedFiles.push(filename);
      if (headline) j.headline.push({ path: filename, size: blob.size, id, ...headline });
      renderStats();
      return filename;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  });
}

const clsLabel = (c) => `${U.pad(c.idx)}. ${c.title}`;
const unitLabel = (u) => `Unit ${u.idx} — ${u.name}`;

/** Like Promise.all, but waits for every task to settle before re-throwing (clean cancel). */
async function settleAll(promises) {
  const rs = await Promise.allSettled(promises);
  const bad = rs.find((r) => r.status === 'rejected' && r.reason instanceof Cancelled) || rs.find((r) => r.status === 'rejected');
  if (bad) throw bad.reason;
  return rs.map((r) => r.value);
}

async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function startJob() {
  if (state.running) return;
  const plan = selectedPlan();
  if (!plan.courses.length || !plan.cats.length) return;
  state.settings.rootFolder = U.safeName($('#optRoot').value || DEFAULTS.rootFolder, 40);
  saveSettings();
  problems = 0;
  $('#logBadge').classList.add('hidden');
  $('#probCount').textContent = '';
  state.job = {
    cancel: false, warnings: [], errors: [], savedFiles: [], usedPaths: new Set(), lastDownloadId: null, headline: [],
    stats: { found: 0, downloaded: 0, converted: 0, dupes: 0, merged: 0, mcqs: 0, saved: 0 },
    courseIndex: 0, courseTotal: plan.courses.length, started: Date.now(), reports: [],
  };
  lastStats = {};
  $('#stats').innerHTML = '';
  setRunning(true);
  const run = $('#runBox');
  run.classList.remove('hidden', 'finished');
  $('#resultBox').classList.add('hidden');
  progress('lists', 0, 'Starting…');
  run.scrollIntoView({ behavior: 'smooth', block: 'center' });
  log('info', `Started: ${plan.courses.map((c) => c.course.code).join(', ')}`);
  window.onbeforeunload = () => 'A download is in progress.';
  let uiDisabled = false;
  try {
    if (ext.downloads.setUiOptions) await ext.downloads.setUiOptions({ enabled: false });
    uiDisabled = true;
  } catch (_) { /* not supported */ }
  let outcome = 'ok';
  try {
    await ensureFonts();
    await checkHelper();
    if (!Net.mode && !(await connectSession())) await withSession(() => Net.init());
    for (const c of plan.courses) {
      checkCancel();
      await processCourse(c, plan.cats);
      state.job.courseIndex++;
    }
  } catch (e) {
    if (e instanceof Cancelled) {
      outcome = 'cancelled';
      log('warn', 'Cancelled by you.');
    } else {
      outcome = 'failed';
      log('error', 'Stopped: ' + (e && e.message ? e.message : e));
      console.error(e);
    }
  } finally {
    if (uiDisabled && ext.downloads.setUiOptions) ext.downloads.setUiOptions({ enabled: true }).catch(() => {});
    window.onbeforeunload = null;
    setRunning(false);
    showResult(outcome);
  }
}

function showResult(outcome) {
  const j = state.job;
  const run = $('#runBox');
  run.classList.add('finished');
  if (outcome === 'ok') {
    $('#bar').style.width = '100%';
    $('#pct').textContent = '100%';
    $$('#phases li').forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  } else {
    $$('#phases li.active').forEach((li) => li.classList.remove('active'));
  }
  const box = $('#resultBox');
  const probs = j.warnings.length + j.errors.length;
  box.className = 'result ' + (outcome !== 'ok' ? 'bad' : probs ? 'warn' : '');
  const title = outcome === 'ok' ? (probs ? 'Done, with a few problems' : 'All done') : outcome === 'cancelled' ? 'Stopped. Files saved so far are kept.' : 'Stopped because of an error';
  $('#phase').textContent = title;
  const s = j.stats;
  const files = j.headline.slice(0, 40);
  box.innerHTML = `
    <div class="result-head">
      <svg class="check-anim" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" fill="none"/><path fill="none" d="${outcome === 'ok' ? 'M15 27l7 7 15-16' : 'M18 18l16 16M34 18 18 34'}"/></svg>
      <div><h3>${title}</h3><div class="muted">${s.saved} file(s) saved in ${U.fmtDuration(Date.now() - j.started)} · ${s.converted} converted · ${s.dupes} duplicates skipped · ${s.mcqs} MCQs</div></div>
    </div>
    ${files.length ? `<ul class="files">${files.map((f, i) => `<li style="--i:${i}">${svg('file')}<span title="${esc(f.path)}">${esc(f.path.split('/').pop())}</span><span class="meta">${f.pages ? f.pages + ' pages · ' : ''}${U.fmtBytes(f.size)}</span></li>`).join('')}</ul>` : ''}
    ${probs ? `<ul class="probs">${[...j.errors, ...j.warnings].slice(0, 6).map((m) => `<li>${esc(m)}</li>`).join('')}${probs > 6 ? `<li>…and ${probs - 6} more in Activity / _Report.txt</li>` : ''}</ul>` : ''}
    <div class="row">
      <button class="btn primary" id="btnOpenFolder" ${j.lastDownloadId == null ? 'disabled' : ''}>${svg('folder')}<span>Open folder</span></button>
      ${probs ? '<button class="btn" id="btnShowProblems">Show problems</button>' : ''}
    </div>`;
  box.classList.remove('hidden');
  const of = $('#btnOpenFolder');
  if (of) of.onclick = () => ext.downloads.show((j.headline[0] && j.headline[0].id) || j.lastDownloadId);
  const sp = $('#btnShowProblems');
  if (sp) sp.onclick = () => { setLogFilter('problems'); switchTab('activity'); };
  toast(title, outcome === 'ok' ? (probs ? 'warn' : 'ok') : 'bad', 5000);
}

async function processCourse(c, cats) {
  const S = state.settings;
  const j = state.job;
  const course = c.course;
  const base = U.safeName(S.rootFolder || DEFAULTS.rootFolder, 40) + '/' + courseDirOf(course);
  const label = course.code;
  log('info', `── ${course.code} · ${course.title} — Units ${c.units.map((u) => u.idx).join(', ')} · ${cats.map(typeName).join(', ')}`);
  const report = { course, units: c.units, base, docs: [], mcqs: [], merged: [], problems: [], dupes: [] };
  j.reports.push(report);
  const problem = (msg) => { report.problems.push(msg); log('warn', msg); };

  // ---------- 1. content lists
  const tasks = [];
  for (const u of c.units) for (const cls of u.classes) for (const t of cats) {
    const cell = cls.cells[t];
    if (cell && cell.count > 0) tasks.push({ u, cls, t });
  }
  let doneLists = 0;
  progress('lists', 0, `${label}: reading content lists (0/${tasks.length})`);
  const lim = U.limiter(4);
  await settleAll(tasks.map((task) => lim(async () => {
    checkCancel();
    try {
      const html = await withSession(() => Net.text(PESU.urls.content(course.id, task.u.id, task.cls.uuid, task.cls.classNo, task.t, c.subType)));
      task.res = PESU.parseContent(html, task.t);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      problem(`Unit ${task.u.idx}, ${task.cls.title}: could not read ${typeName(task.t)} (${e.message})`);
    }
    doneLists++;
    progress('lists', doneLists / tasks.length, `${label}: reading content lists (${doneLists}/${tasks.length})`);
  })));

  // dedupe by document id (unit-wide material is listed under several classes), gather MCQs and links
  const docs = [];
  const seen = new Set();
  const mcqUnits = new Map();
  const links = [];
  for (const task of tasks) {
    if (!task.res) continue;
    task.res.docs.forEach((d, i) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      docs.push({ ...d, unit: task.u, cls: task.cls, type: task.t, idx: i, order: docs.length });
    });
    task.res.links.forEach((l) => links.push({ ...l, unit: task.u, cls: task.cls, type: task.t }));
    if (task.res.mcqs && task.res.mcqs.length) {
      let mu = mcqUnits.get(task.u.id);
      if (!mu) { mu = { unit: task.u, groups: new Map(), seen: new Set(), count: 0 }; mcqUnits.set(task.u.id, mu); }
      const gk = task.res.unitWide ? '_unit' : task.cls.uuid;
      for (const q of task.res.mcqs) {
        if (mu.seen.has(q.key)) continue;
        mu.seen.add(q.key);
        if (!mu.groups.has(gk)) mu.groups.set(gk, { heading: task.res.unitWide ? null : clsLabel(task.cls), questions: [] });
        mu.groups.get(gk).questions.push(q);
        mu.count++;
      }
    }
  }
  j.stats.found += docs.length;
  log('info', `${label}: ${docs.length} document(s) listed, ${[...mcqUnits.values()].reduce((a, m) => a + m.count, 0)} MCQ(s).`);

  // ---------- 2. download + convert (identical files are converted once)
  const convCache = new Map();
  let doneDocs = 0;
  const dl = U.limiter(3);
  await settleAll(docs.map((d) => dl(async () => {
    checkCancel();
    try {
      await fetchAndConvert(d, base, S, report, problem, convCache);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      problem(`${docName(d)}: ${e.message}`);
    }
    doneDocs++;
    progress('docs', doneDocs / Math.max(1, docs.length), `${label}: downloading & converting (${doneDocs}/${docs.length})`);
  })));

  // ---------- 2b. content dedupe (same file uploaded under several classes with different ids)
  const primaryByHash = new Map();
  for (const d of docs) {
    if (!d.hash) continue;
    const p = primaryByHash.get(d.hash);
    if (!p) { primaryByHash.set(d.hash, d); continue; }
    d.dupOf = p;
    d.rec.status = 'duplicate';
    j.stats.dupes++;
    report.dupes.push(`${docName(d)}  =  ${docName(p)}`);
  }
  if (report.dupes.length) log('info', `${label}: skipped ${report.dupes.length} duplicate file(s) — the same document was attached to several classes.`);

  // ---------- 2c. individual files / originals
  for (const d of docs) {
    if (d.dupOf || !d.got) continue;
    checkCancel();
    const stem = fileStemOf(course, d.unit, d.type, d.cls, d.title);
    d.stem = stem;
    const isPdf = d.kind.kind === 'pdf';
    try {
      if (d.pdf && (S.saveIndividual || S.mergeMode === 'none')) await saveFile(base, stem + '.pdf', d.pdf, 'application/pdf');
      if (!isPdf && !d.rec.savedRaw && (S.keepOriginals || !d.pdf)) await saveFile(base, stem + '.' + d.kind.ext, d.got.bytes, U.mimeFor(d.kind.ext));
    } catch (e) {
      problem(`${docName(d)}: could not save (${e.message})`);
    }
    d.got = null; // free original bytes
  }

  // ---------- 3. MCQs
  const mcqParts = [];
  let mi = 0;
  for (const mu of mcqUnits.values()) {
    checkCancel();
    const u = mu.unit;
    const groups = [...mu.groups.values()].filter((g) => g.questions.length);
    groups.sort((a, b) => (a.heading === null ? -1 : 0) - (b.heading === null ? -1 : 0));
    const meta = {
      title: `Unit ${u.idx} — MCQs`,
      subtitle: `${course.code} · ${course.title} · Unit ${u.idx}: ${u.name} · ${mu.count} questions`,
      header: `${course.code} · Unit ${u.idx} MCQs`,
    };
    const stem = mcqStemOf(course, u);
    progress('mcq', mi / mcqUnits.size, `${label}: building MCQs for Unit ${u.idx} (${mu.count})`);
    try {
      const needPdf = S.mcqFormats.pdf || !['unit-category', 'none'].includes(S.mergeMode);
      if (needPdf) {
        const data = await MCQ.toPdfData(groups, meta, (n, tot) => progress('mcq', (mi + n / tot) / mcqUnits.size));
        const pdf = await PDFX.mcqPdf(data, S.mcqAnswers);
        if (S.mcqFormats.pdf) await saveFile(base, stem + '.pdf', pdf, 'application/pdf', { kind: 'mcq' });
        mcqParts.push({ unit: u, type: 8, cls: null, idx: 0, title: `MCQs (${mu.count} questions)`, pdf });
      }
      if (S.mcqFormats.html) await saveFile(base, stem + '.html', MCQ.toHtml(groups, meta), 'text/html');
      if (S.mcqFormats.md) await saveFile(base, stem + '.md', MCQ.toMarkdown(groups, meta), 'text/markdown');
      if (S.mcqFormats.json) await saveFile(base, stem + '.json', MCQ.toJson(groups, meta), 'application/json');
      j.stats.mcqs += mu.count;
      report.mcqs.push({ unit: u.idx, count: mu.count, noAnswer: groups.reduce((a, g) => a + g.questions.filter((q) => !q.hasAnswer).length, 0) });
      log('ok', `Unit ${u.idx}: ${mu.count} MCQs exported.`);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      problem(`Unit ${u.idx} MCQs: ${e.message}`);
    }
    mi++;
    renderStats();
  }

  // ---------- 4. merge
  if (S.mergeMode !== 'none') {
    const parts = docs.filter((d) => d.pdf && !d.dupOf).map((d) => ({ unit: d.unit, type: d.type, cls: d.cls, idx: d.idx, title: d.title, pdf: d.pdf, doc: d }));
    if (S.mergeMode !== 'unit-category') parts.push(...mcqParts);
    const groups = groupParts(parts, S.mergeMode, course);
    let gi = 0;
    for (const g of groups) {
      checkCancel();
      progress('merge', gi / groups.length, `${label}: merging ${g.file} (${g.parts.length} file${g.parts.length > 1 ? 's' : ''})`);
      try {
        await mergeGroup(g, base, S, report, problem);
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        problem(`Merging ${g.file} failed: ${e.message}`);
      }
      gi++;
    }
  }
  progress('merge', 1, `${label}: finishing up`);

  // ---------- 5. links + report
  if (links.length) {
    const md = ['# External links', '', ...links.map((l) => `- Unit ${l.unit.idx} · ${typeName(l.type)} · ${l.cls.title}: [${l.title}](${l.url})`)].join('\n');
    await saveFile(base, '_Links.md', md, 'text/markdown').catch(() => {});
  }
  docs.forEach((d) => { d.pdf = null; });
  try {
    await saveFile(base, '_Report.txt', buildReport(report, cats), 'text/plain');
  } catch (e) {
    log('warn', 'Could not save report: ' + e.message);
  }
  log('ok', `${course.code} finished.`);
}

function docName(d) {
  return `Unit ${d.unit.idx} · ${typeName(d.type)} · ${d.title}`;
}

async function fetchAndConvert(d, base, S, report, problem, convCache) {
  const j = state.job;
  const rec = { unit: d.unit.idx, type: typeName(d.type), cls: d.cls.title, title: d.title, status: '', kind: '' };
  d.rec = rec;
  report.docs.push(rec);
  let got = null;
  try {
    got = await withSession(() => Net.file(d.path));
  } catch (e) {
    if (e instanceof Cancelled || e instanceof PESU.SessionExpiredError) throw e;
    log('warn', `${docName(d)}: ${e.message} — trying the browser's own downloader`);
    const stem = fileStemOf(report.course, d.unit, d.type, d.cls, d.title);
    const r = await Net.browserDownload(d.path, cleanPath(base + '/' + stem));
    rec.savedRaw = r.filename;
    j.stats.saved++;
    j.lastDownloadId = r.id;
    if (host.available) {
      const bytes = await host.readFile(r.filename);
      got = { bytes, filename: r.filename, contentType: r.mime || '', via: 'browser' };
    } else {
      j.stats.downloaded++;
      rec.status = 'saved as-is (not merged)';
      problem(`${docName(d)}: saved without merging (${r.filename})`);
      return;
    }
  }
  j.stats.downloaded++;
  checkCancel();
  d.hash = await sha256(got.bytes);
  d.got = got;
  d.kind = U.sniff(got.bytes, got.filename || d.title, got.contentType);
  rec.kind = d.kind.ext;
  if (d.kind.kind === 'html' && PESU.looksLikeLogin(new TextDecoder().decode(got.bytes.subarray(0, 300000)))) throw new PESU.SessionExpiredError();
  if (!convCache.has(d.hash)) convCache.set(d.hash, toPdf(d, got, S, problem));
  const r = await convCache.get(d.hash);
  d.pdf = r.pdf;
  rec.engine = r.engine;
  rec.status = r.pdf ? (d.kind.kind === 'pdf' ? 'ok' : 'converted') : 'original kept';
}

async function toPdf(d, got, S, problem) {
  const j = state.job;
  const kind = d.kind;
  try {
    switch (kind.kind) {
      case 'pdf':
        return { pdf: got.bytes };
      case 'image': {
        let bytes = got.bytes;
        let fmt = kind.ext === 'jpg' ? 'jpg' : 'png';
        if (!['png', 'jpg'].includes(kind.ext)) {
          const bmp = await createImageBitmap(new Blob([bytes]));
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          cv.getContext('2d').drawImage(bmp, 0, 0);
          bytes = new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
          fmt = 'png';
        }
        const pdf = await PDFX.imageToPdf(bytes, fmt);
        j.stats.converted++;
        return { pdf };
      }
      case 'text': {
        const pdf = await PDFX.textToPdf(new TextDecoder().decode(got.bytes), d.title);
        j.stats.converted++;
        return { pdf };
      }
      case 'office':
      case 'html':
        if (!host.canConvert()) {
          problem(`${docName(d)}: ${kind.ext.toUpperCase()} kept as-is (install the converter helper to turn it into PDF)`);
          return { pdf: null };
        }
        try {
          const r = await host.convert(got.bytes, kind.ext, got.filename || d.title, S.engine);
          j.stats.converted++;
          log('ok', `Converted ${docName(d)} (${kind.ext.toUpperCase()} → PDF via ${r.engine === 'office' ? 'MS Office' : 'LibreOffice'})`);
          return { pdf: r.bytes, engine: r.engine };
        } catch (e) {
          problem(`${docName(d)}: ${kind.ext.toUpperCase()} → PDF failed (${e.message}); original kept`);
          return { pdf: null };
        }
      default:
        problem(`${docName(d)}: ${kind.ext.toUpperCase()} isn't a document — saved as-is`);
        return { pdf: null };
    }
  } catch (e) {
    problem(`${docName(d)}: could not convert (${e.message})`);
    return { pdf: null };
  }
}

function groupParts(parts, mode, course) {
  const keyOf = (p) => groupKey(mode, p.unit.idx, p.type);
  const ci = (p) => (p.cls ? p.cls.idx : 0);
  const cmp = {
    'unit-category': (a, b) => ci(a) - ci(b) || a.idx - b.idx,
    category: (a, b) => a.unit.idx - b.unit.idx || ci(a) - ci(b) || a.idx - b.idx,
    unit: (a, b) => TYPE_RANK(a.type) - TYPE_RANK(b.type) || ci(a) - ci(b) || a.idx - b.idx,
    all: (a, b) => a.unit.idx - b.unit.idx || TYPE_RANK(a.type) - TYPE_RANK(b.type) || ci(a) - ci(b) || a.idx - b.idx,
  }[mode];
  const map = new Map();
  for (const p of parts) {
    const k = keyOf(p);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  const groups = [];
  for (const [, list] of map) {
    list.sort(cmp);
    const first = list[0];
    const units = list.map((p) => p.unit.idx);
    const file = mergedPathOf(course, mode, { unit: first.unit, units, type: mode === 'unit' || mode === 'all' ? null : first.type }) + '.pdf';
    const title = {
      'unit-category': `Unit ${first.unit.idx}: ${first.unit.name} — ${typeName(first.type)}`,
      category: `${typeName(first.type)} — ${rangeLabel(units)}`,
      unit: `Unit ${first.unit.idx}: ${first.unit.name}`,
      all: `${course.code} · ${course.title}`,
    }[mode];
    const perClass = new Map();
    const ck = (p) => p.type + ':' + p.unit.idx + ':' + p.cls.uuid;
    for (const p of list) if (p.cls) perClass.set(ck(p), (perClass.get(ck(p)) || 0) + 1);
    for (const p of list) {
      const crumbs = [];
      if (mode === 'category' || mode === 'all') crumbs.push(unitLabel(p.unit));
      if (mode === 'unit' || mode === 'all') crumbs.push(typeName(p.type));
      let leaf = p.title;
      if (p.cls) {
        if (perClass.get(ck(p)) === 1) leaf = sameTitle(p.title, p.cls.title) ? clsLabel(p.cls) : `${clsLabel(p.cls)} — ${p.title}`;
        else crumbs.push(clsLabel(p.cls));
      }
      p.crumbs = crumbs;
      p.leaf = leaf;
    }
    const typesIn = CATS.filter((t) => list.some((p) => p.type === t)).map(typeName);
    const source = `${rangeLabel(units)} · ${typesIn.join(', ')}`;
    groups.push({ file, title, source, parts: list, sortKey: [first.unit.idx, TYPE_RANK(first.type)] });
  }
  groups.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1]);
  if (mode === 'category') groups.sort((a, b) => a.sortKey[1] - b.sortKey[1]);
  return groups;
}

async function mergeGroup(g, base, S, report, problem) {
  const course = report.course;
  const j = state.job;
  if (g.parts.length === 1 && !S.separators) {
    let pages = 0;
    try { pages = await PDFX.pageCount(g.parts[0].pdf); } catch (_) { /* ignore */ }
    await saveFile(base, g.file, g.parts[0].pdf, 'application/pdf', { kind: 'merged', pages });
    report.merged.push({ file: g.file, parts: 1, pages });
    j.stats.merged++;
    return;
  }
  const res = await PDFX.merge(g.parts.map((p) => ({ bytes: p.pdf, title: p.leaf, crumbs: p.crumbs })), {
    title: g.title,
    subtitle: `${course.code} · ${course.title} · ${g.parts.length} documents`,
    kicker: `PESU Academy  ·  ${course.code}${semesterName() ? '  ·  ' + semesterName() : ''}`,
    info: course.title,
    sourceLine: g.source,
    toc: S.toc,
    separators: S.separators,
    repair: host.available ? async (bytes) => {
      log('info', 'Repairing a PDF that could not be merged directly…');
      return host.repairPdf(bytes);
    } : null,
  });
  for (const f of res.failed) {
    problem(`${g.file}: left out "${f.title}" (${f.error})`);
    const p = g.parts.find((x) => x.leaf === f.title);
    if (p && p.doc && !S.saveIndividual && p.doc.stem) {
      await saveFile(base, p.doc.stem + '.pdf', p.pdf, 'application/pdf').catch(() => {});
    }
  }
  if (!res.bytes) return;
  await saveFile(base, g.file, res.bytes, 'application/pdf', { kind: 'merged', pages: res.pageCount });
  report.merged.push({ file: g.file, parts: res.included.length, pages: res.pageCount });
  j.stats.merged++;
  log('ok', `Merged ${g.file}: ${res.included.length} document(s), ${res.pageCount} pages.`);
}

function buildReport(r, cats) {
  const S = state.settings;
  const L = [];
  L.push('PESU Downloader — report');
  L.push('='.repeat(40));
  L.push(`Course:     ${r.course.code} — ${r.course.title}`);
  L.push(`Generated:  ${new Date().toLocaleString()}`);
  L.push(`Units:      ${r.units.map((u) => `${u.idx} (${u.name})`).join('; ')}`);
  L.push(`Categories: ${cats.map(typeName).join(', ')}`);
  L.push(`Merge mode: ${(MODES.find((m) => m.v === S.mergeMode) || {}).t}`);
  L.push('');
  const by = (s) => r.docs.filter((d) => d.status === s).length;
  L.push(`Documents: ${r.docs.length} listed — ${by('ok')} PDF, ${by('converted')} converted, ${by('duplicate')} duplicates skipped, ${by('original kept')} kept as original`);
  for (const d of r.docs) L.push(`  [${(d.status || 'failed').padEnd(13)}] Unit ${d.unit} · ${d.type} · ${d.cls} · ${d.title}${d.kind ? ' (' + d.kind + (d.engine ? ' via ' + d.engine : '') + ')' : ''}`);
  if (r.dupes.length) {
    L.push('');
    L.push('Duplicates (identical content, kept once):');
    for (const x of r.dupes) L.push('  ' + x);
  }
  if (r.mcqs.length) {
    L.push('');
    L.push('MCQs:');
    for (const m of r.mcqs) L.push(`  Unit ${m.unit}: ${m.count} questions${m.noAnswer ? ` (${m.noAnswer} without an answer from the portal)` : ''}`);
  }
  if (r.merged.length) {
    L.push('');
    L.push('Merged files:');
    for (const m of r.merged) L.push(`  ${m.file} — ${m.parts} document(s)${m.pages ? ', ' + m.pages + ' pages' : ''}`);
  }
  L.push('');
  L.push(r.problems.length ? 'Problems:' : 'Problems: none');
  for (const p of r.problems) L.push('  - ' + p);
  return L.join('\r\n');
}

// ------------------------------------------------------------------ activity tab
function setLogFilter(v) {
  $$('#logFilter button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  const l = $('#log');
  l.classList.toggle('f-problems', v === 'problems');
  l.classList.toggle('f-ok', v === 'ok');
}
function logText() {
  return $$('#log li:not(.log-empty)').map((li) => `${li.querySelector('time').textContent}  ${li.querySelector('.lv').textContent}  ${li.querySelector('.msg').textContent}`).join('\r\n');
}

// ------------------------------------------------------------------ wiring
function wire() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  window.addEventListener('resize', moveInk);
  $('#semester').addEventListener('change', (e) => loadCourses(e.target.value));
  $('#btnScan').addEventListener('click', scan);
  $('#btnAllUnits').addEventListener('click', () => {
    for (const [cid, c] of state.scanned) c.units.forEach((u) => state.selectedUnits.add(cid + ':' + u.id));
    renderUnits();
  });
  $('#btnNoUnits').addEventListener('click', () => { state.selectedUnits.clear(); renderUnits(); });
  $('#btnStart').addEventListener('click', startJob);
  $('#btnCancel').addEventListener('click', () => {
    if (!state.job || !state.running || state.job.cancel) return;
    state.job.cancel = true;
    const b = $('#btnCancel');
    b.disabled = true;
    b.textContent = 'Stopping…';
    $('#phase').textContent = 'Stopping after the current file — everything saved so far is kept…';
    log('warn', 'Stopping… waiting for the files in progress to finish.');
    if (state.sessionResolve) { stopSessionWatch(); state.sessionResolve(); state.sessionWait = null; state.sessionResolve = null; }
  });
  $('#btnOpenPesu').addEventListener('click', async () => {
    const t = await Net.findPesuTab();
    if (t) {
      await ext.tabs.update(t.id, { active: true });
      await ext.windows.update(t.windowId, { focused: true });
    } else {
      const nt = await ext.tabs.create({ url: PESU.ORIGIN + '/Academy/', active: true });
      Net.tabId = nt.id;
    }
  });
  $('#btnLoginRetry').addEventListener('click', onLoginContinue);
  $('#btnHelperRetry').addEventListener('click', checkHelper);
  $$('#logFilter button').forEach((b) => b.addEventListener('click', () => setLogFilter(b.dataset.v)));
  $('#logSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('#log li:not(.log-empty)').forEach((li) => li.classList.toggle('nomatch', !!q && !li.textContent.toLowerCase().includes(q)));
  });
  $('#btnCopyLog').addEventListener('click', () => navigator.clipboard.writeText(logText()).then(() => toast('Log copied', 'ok')).catch(() => toast('Could not copy', 'bad')));
  $('#btnSaveLog').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([logText()], { type: 'text/plain' }));
    ext.downloads.download({ url, filename: `${U.safeName(state.settings.rootFolder, 40)}/PESU Downloader log ${today()}.txt`, saveAs: false, conflictAction: 'uniquify' })
      .then(() => toast('Log saved to Downloads', 'ok'), (e) => toast('Could not save the log: ' + e.message, 'bad'))
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 10000));
  });
  $('#btnClearLog').addEventListener('click', () => {
    $('#log').innerHTML = '<li class="log-empty">Log cleared.</li>';
    problems = 0;
    $('#logBadge').classList.add('hidden');
    $('#probCount').textContent = '';
  });
}


// ------------------------------------------------------------------ light / dark
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function paintThemeButton() {
  const b = $('#btnTheme');
  const dark = currentTheme() === 'dark';
  b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  b.title = dark ? 'Light mode' : 'Dark mode';
  b.classList.toggle('is-dark', dark);
}
function wireTheme() {
  const b = $('#btnTheme');
  b.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.add('theme-anim');
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('pesu-theme', next); } catch (_) { /* fine */ }
    paintThemeButton();
    setTimeout(() => document.documentElement.classList.remove('theme-anim'), 400);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintThemeButton);
  paintThemeButton();
}

// Firefox has no runtime.getContexts: the background script asks open pages where they are instead.
ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'where-are-you') return false;
  ext.tabs.getCurrent().then((t) => sendResponse(t ? { tabId: t.id, windowId: t.windowId } : null), () => sendResponse(null));
  return true;
});

// Firefox lets people turn site access off (or asks before granting it). Without it nothing can work,
// so ask for it clearly instead of failing with confusing network errors.
const PESU_ORIGINS = ['https://www.pesuacademy.com/*', 'https://pesuacademy.com/*', 'https://files.pesuacademy.com/*'];
async function ensureSiteAccess() {
  let ok = true;
  try { ok = await ext.permissions.contains({ origins: PESU_ORIGINS }); } catch (_) { return; }
  if (ok) return;
  pill('#chipSession', 'warn', 'Needs access to pesuacademy.com');
  $('#accessBanner').classList.remove('hidden');
  await new Promise((resolve) => {
    $('#btnGrantAccess').addEventListener('click', async () => {
      let granted = false;
      try { granted = await ext.permissions.request({ origins: PESU_ORIGINS }); } catch (_) { /* dismissed */ }
      if (granted) { $('#accessBanner').classList.add('hidden'); resolve(); }
      else toast('Access is needed to read your courses on pesuacademy.com', 'warn');
    });
  });
}

(async function main() {
  FX.reveal($('#heroTitle'));
  await loadSettings();
  buildOptions();
  wire();
  wirePreview();
  wireTheme();
  requestAnimationFrame(moveInk);
  renderCats();
  updatePlan();
  checkHelper();
  // warm up the PDF engine once the page is idle, so Start doesn't wait for it later
  (self.requestIdleCallback || ((f) => setTimeout(f, 1500)))(() => ensurePdfEngine().catch(() => {}), { timeout: 4000 });
  await ensureSiteAccess();
  if (await connectSession()) await loadSemesters();
  else {
    $('#courseList').innerHTML = '<div class="empty">Log in to PESU Academy in this browser — your courses appear here automatically.</div>';
    $('#semester').innerHTML = '<option>—</option>';
    startSessionWatch(); // courses load by themselves once you log in
  }
})();
