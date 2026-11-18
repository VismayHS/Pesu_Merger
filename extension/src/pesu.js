/* PESU Academy endpoints + HTML parsers.
 * Pure functions over HTML strings (uses DOMParser), no network here.
 * Endpoint map was reverse-engineered from the student portal:
 *   semesters  GET /Academy/s/studentProfile/getStudentSemestersPESU          -> "<option value=..>Sem-5</option>..."
 *   courses    GET studentProfilePESUAdmin?controllerMode=6403&actionType=38&id=<semId>
 *   units      GET studentProfilePESUAdmin?controllerMode=6403&actionType=42&id=<courseId>
 *   classes    GET studentProfilePESUAdmin?controllerMode=6403&actionType=43&coursecontentid=<unitId>&selectedData=<courseId>
 *   content    GET studentProfilePESUAdmin?controllerMode=6403&actionType=60&selectedData=<courseId>&id=<type>&unitid=<classUuid>&coursecontentid=<unitId>&classno=<n>
 *   files      /Academy/a/referenceMeterials/downloadslidecoursedoc/<uuid>  (viewer copy, usually PDF)
 *              /Academy/s/referenceMeterials/downloadcoursedoc/<uuid>       (raw upload: pptx/docx/pdf/...)
 */
(function (global) {
  'use strict';

  const ORIGIN = 'https://www.pesuacademy.com';
  const ADMIN = '/Academy/s/studentProfilePESUAdmin';
  const DEFAULT_MENU_ID = '653';

  // Resource types as used by the site (column order of the class table).
  const TYPES = [
    { id: 1, key: 'av', name: 'AV Summary', downloadable: false },
    { id: 10, key: 'live', name: 'Live Videos', downloadable: false },
    { id: 2, key: 'slides', name: 'Slides', downloadable: true },
    { id: 3, key: 'notes', name: 'Notes', downloadable: true },
    { id: 5, key: 'assignments', name: 'Assignments', downloadable: true },
    { id: 6, key: 'qb', name: 'Question Bank', short: 'QB', downloadable: true },
    { id: 7, key: 'qa', name: 'Question Answers', short: 'QA', downloadable: true },
    { id: 19, key: 'faqs', name: 'FAQs', downloadable: true },
    { id: 8, key: 'mcqs', name: 'MCQs', downloadable: true, mcq: true },
    { id: 9, key: 'references', name: 'References', downloadable: true },
  ];
  const TYPE_BY_ID = Object.fromEntries(TYPES.map((t) => [t.id, t]));
  const DOWNLOADABLE = TYPES.filter((t) => t.downloadable);

  const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const q = (params) => ADMIN + '?' + new URLSearchParams(params).toString() + '&_=' + Date.now();

  const urls = {
    semesters: () => '/Academy/s/studentProfile/getStudentSemestersPESU',
    courses: (semId, menuId = DEFAULT_MENU_ID) =>
      q({ controllerMode: 6403, actionType: 38, id: semId, menuId }),
    course: (courseId, menuId = DEFAULT_MENU_ID) =>
      q({ controllerMode: 6403, actionType: 42, id: courseId, menuId }),
    unit: (courseId, unitId, subType = '4', menuId = DEFAULT_MENU_ID) =>
      q({ controllerMode: 6403, actionType: 43, coursecontentid: unitId, menuId, selectedData: courseId, subType }),
    content: (courseId, unitId, classUuid, classNo, type, subType = '4', menuId = DEFAULT_MENU_ID) =>
      q({
        controllerMode: 6403, actionType: 60, selectedData: courseId, id: type, unitid: classUuid,
        coursecontentid: unitId, classno: classNo, menuId, subType,
      }),
    slideDoc: (id) => '/Academy/a/referenceMeterials/downloadslidecoursedoc/' + id,
    rawDoc: (id) => '/Academy/s/referenceMeterials/downloadcoursedoc/' + id,
  };

  class SessionExpiredError extends Error {
    constructor(msg = 'PESU Academy session expired or not logged in') {
      super(msg);
      this.name = 'SessionExpiredError';
    }
  }
  class UnexpectedPageError extends Error {
    constructor(msg) {
      super(msg);
      this.name = 'UnexpectedPageError';
    }
  }

  const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

  function parseHTML(html) {
    return new DOMParser().parseFromString(html || '', 'text/html');
  }

  function looksLikeLogin(text) {
    if (!text) return false;
    return (
      /j_spring_security_check|name=["']j_password["']|id=["']j_password["']/i.test(text) ||
      (/type=["']password["']/i.test(text) && /login|sign\s*in/i.test(text) && text.length < 200000 && !/studentProfilePESUAdmin|handleclass/i.test(text))
    );
  }

  function assertNotLogin(text) {
    if (looksLikeLogin(text)) throw new SessionExpiredError();
  }

  // ---------- semesters ----------
  function parseSemesters(text) {
    let s = (text || '').trim();
    if (s.startsWith('"')) {
      try { s = JSON.parse(s); } catch (_) { /* keep raw */ }
    }
    if (!/<option/i.test(s)) {
      assertNotLogin(text);
      throw new UnexpectedPageError('Could not read semester list');
    }
    const doc = parseHTML('<select>' + s + '</select>');
    return [...doc.querySelectorAll('option')]
      .map((o) => ({ id: o.getAttribute('value'), name: clean(o.textContent) }))
      .filter((o) => o.id);
  }

  // ---------- courses ----------
  function parseCourses(html) {
    assertNotLogin(html);
    const doc = parseHTML(html);
    const rows = [...doc.querySelectorAll('tr[id^="rowWiseCourseContent_"]')];
    return rows.map((tr) => {
      const id = tr.id.split('_').pop();
      const tds = tr.querySelectorAll('td');
      const firstText = tds[0] ? [...tds[0].childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ') : '';
      return {
        id,
        code: clean(firstText) || clean(tds[0] && tds[0].textContent),
        title: clean(tds[1] && tds[1].textContent),
        type: clean(tds[2] && tds[2].textContent),
        status: clean(tds[3] && tds[3].textContent),
      };
    });
  }

  // ---------- course -> units ----------
  function parseCourse(html) {
    assertNotLogin(html);
    const doc = parseHTML(html);
    const links = [...doc.querySelectorAll('a[onclick*="handleclassUnit"]')];
    const seen = new Set();
    const units = [];
    links.forEach((a) => {
      const m = (a.getAttribute('onclick') || '').match(/handleclassUnit\(\s*'?(\d+)'?/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const raw = clean(a.textContent);
      units.push({ id: m[1], rawName: raw, name: raw.replace(/^unit\s*[-:]?\s*\d+\s*[:.\-–—]\s*/i, '').trim() || raw });
    });
    units.forEach((u, i) => (u.idx = i + 1));
    const subType = doc.querySelector('#subType');
    // Breadcrumb holds "CODE : Title"
    let heading = '';
    const crumb = [...doc.querySelectorAll('a[onclick*="courseContentinfo"], .breadcrumb li, h4, h3')].map((e) => clean(e.textContent)).find((t) => / : /.test(t));
    if (crumb) heading = crumb;
    if (!units.length && !/course_3|Course Units/i.test(html)) throw new UnexpectedPageError('Could not read course units');
    return { units, subType: subType ? subType.value || subType.getAttribute('value') : null, heading };
  }

  // ---------- unit -> class table ----------
  function parseUnit(html) {
    assertNotLogin(html);
    const doc = parseHTML(html);
    const classes = [];
    const rows = [...doc.querySelectorAll('tr')];
    rows.forEach((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      if (!tds.length) return;
      const withClick = tds.filter((td) => /handleclasscoursecontentunit/.test(td.getAttribute('onclick') || ''));
      if (!withClick.length) return;
      const first = withClick[0].getAttribute('onclick').replace(/\s+/g, '');
      const m = first.match(/handleclasscoursecontentunit\('([^']*)','([^']*)','([^']*)','([^']*)'/);
      if (!m) return;
      const cells = {};
      withClick.forEach((td) => {
        const mm = td.getAttribute('onclick').replace(/\s+/g, '').match(/,(\d+),event\)/);
        if (!mm) return;
        const type = Number(mm[1]);
        const txt = clean(td.textContent);
        if (td === tds[0]) return; // first column is the title cell, it carries type 1 too
        const count = txt === '-' || txt === '' ? 0 : parseInt(txt, 10) || 0;
        cells[type] = { count, unitWide: /\*/.test(txt) || !!td.querySelector('sup,.text-danger') };
      });
      classes.push({ uuid: m[1], courseId: m[2], unitId: m[3], classNo: m[4], title: clean(tds[0].textContent), cells });
    });
    classes.forEach((c, i) => (c.idx = i + 1));
    return { classes };
  }

  // ---------- content list ----------
  // Returns { docs: [{id, title, viewer:'slide'|'raw', path}], links: [{url,title}], mcqs: [...] | null, unitWide: bool }
  function parseContent(html, type) {
    assertNotLogin(html);
    const doc = parseHTML(html);
    // The page contains the tab bar for every type; restrict to the content pane when we can.
    let scope = doc.querySelector('[id^="content_' + type + '"]') || doc.querySelector('.tab-content') || doc.body;
    const unitWide = /Applicable to all classes of this unit/i.test(scope.textContent || '');
    const docs = [];
    const links = [];
    const seen = new Set();
    const addDoc = (id, title, viewer) => {
      id = id.toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      docs.push({ id, title: clean(title) || 'Document', viewer, path: viewer === 'slide' ? urls.slideDoc(id) : urls.rawDoc(id) });
    };
    scope.querySelectorAll('[onclick], a[href], iframe[src], embed[src], object[data]').forEach((el) => {
      const oc = el.getAttribute('onclick') || '';
      const href = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('data') || '';
      if (/coursvideoseMaterial|handleShowMore|courseContentinfo|submitMCQ|resetMCQ/.test(oc + href)) return;
      let m;
      if ((m = oc.match(/loadIframe\(\s*'([^']*)'/))) {
        const idm = m[1].match(UUID_RE);
        if (idm) addDoc(idm[0], el.textContent, /downloadcoursedoc\//.test(m[1]) ? 'raw' : 'slide');
        return;
      }
      if ((m = oc.match(/downloadcoursedoc\(\s*'([^']*)'/))) {
        if (UUID_RE.test(m[1])) addDoc(m[1].match(UUID_RE)[0], el.textContent, 'raw');
        return;
      }
      if ((m = (oc + ' ' + href).match(/referenceMeterials\/(downloadslidecoursedoc|downloadcoursedoc)\/([0-9a-f-]{36})/i))) {
        addDoc(m[2], el.textContent, m[1].toLowerCase() === 'downloadslidecoursedoc' ? 'slide' : 'raw');
        return;
      }
      if (/^https?:\/\//i.test(href) && !/pesuacademy\.com/i.test(href)) {
        links.push({ url: href, title: clean(el.textContent) || href });
      }
    });
    const mcqs = type === 8 ? parseMCQs(scope) : null;
    return { docs, links, mcqs, unitWide };
  }

  // ---------- MCQs ----------
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'SUB', 'SUP', 'BR', 'P', 'DIV', 'SPAN', 'PRE', 'CODE', 'IMG', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'UL', 'OL', 'LI', 'TT', 'KBD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'FONT', 'LABEL', 'MATH', 'SMALL', 'BIG', 'CENTER', 'BLOCKQUOTE']);

  function sanitizeFragment(node) {
    const out = node.cloneNode(true);
    const walk = (el) => {
      [...el.children].forEach((c) => {
        if (c.tagName === 'INPUT' || c.tagName === 'SCRIPT' || c.tagName === 'STYLE' || c.tagName === 'BUTTON') {
          c.remove();
          return;
        }
        if (!ALLOWED_TAGS.has(c.tagName)) {
          // unwrap unknown element, keep its children
          walk(c);
          c.replaceWith(...c.childNodes);
          return;
        }
        [...c.attributes].forEach((a) => {
          const n = a.name.toLowerCase();
          if (c.tagName === 'IMG' && (n === 'src' || n === 'width' || n === 'height' || n === 'alt' || n === 'style')) {
            if (n === 'src' && !/^data:image\//i.test(a.value)) c.removeAttribute(a.name);
            return;
          }
          if ((c.tagName === 'TD' || c.tagName === 'TH') && (n === 'colspan' || n === 'rowspan')) return;
          c.removeAttribute(a.name);
        });
        walk(c);
      });
    };
    walk(out);
    return out.innerHTML.trim();
  }

  function textOf(node) {
    const n = node.cloneNode(true);
    n.querySelectorAll('input,script,style').forEach((e) => e.remove());
    n.querySelectorAll('img').forEach((e) => e.replaceWith('[image]'));
    n.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
    return (n.textContent || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }

  function parseMCQs(scope) {
    const root = scope.querySelector ? scope.querySelector('#courseMaterialMCQs') : null;
    if (!root) return [];
    const questions = [];
    let cur = null;
    const children = [...root.children];
    for (const el of children) {
      if (el.classList.contains('qstn-elem-set')) {
        const content = el.querySelector('.qstn-content') || el;
        const serial = clean((el.querySelector('.qstn-serial') || {}).textContent || '').replace(/\)$/, '');
        cur = {
          id: el.id || null,
          serial,
          html: sanitizeFragment(content),
          text: textOf(content),
          options: [],
          multi: false,
        };
        questions.push(cur);
        continue;
      }
      if (!cur) continue;
      const inputs = el.querySelectorAll('input[type="radio"], input[type="checkbox"]');
      if (!inputs.length) continue;
      inputs.forEach((inp) => {
        const label = inp.closest('label') || inp.parentElement;
        if (inp.type === 'checkbox') cur.multi = true;
        const name = inp.getAttribute('name') || '';
        const qid = (name.match(UUID_RE) || [])[0];
        if (qid && !cur.qid) cur.qid = qid.toLowerCase();
        cur.options.push({
          id: (inp.id || '').replace(/^ans_/, ''),
          html: sanitizeFragment(label),
          text: textOf(label),
          correct: String(inp.getAttribute('value')).toLowerCase() === 'true',
        });
      });
    }
    questions.forEach((qq) => {
      qq.key = qq.qid || qq.id || qq.text.slice(0, 200);
      qq.hasAnswer = qq.options.some((o) => o.correct);
    });
    return questions.filter((qq) => qq.text || qq.html);
  }

  global.PESU = {
    ORIGIN, TYPES, TYPE_BY_ID, DOWNLOADABLE, urls, DEFAULT_MENU_ID,
    parseSemesters, parseCourses, parseCourse, parseUnit, parseContent, parseMCQs,
    looksLikeLogin, assertNotLogin, SessionExpiredError, UnexpectedPageError, clean,
  };
})(typeof self !== 'undefined' ? self : this);
