/* Small interaction effects, written in vanilla JS (ideas inspired by React Bits):
 * spotlight cards, count-up numbers, word reveal and a click spark.
 * Everything is skipped when the user prefers reduced motion. */
(function (g) {
  'use strict';
  const reduce = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Spotlight: any .spot element gets --mx / --my at the pointer position (CSS draws the glow).
  document.addEventListener('pointermove', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.spot') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', e.clientX - r.left + 'px');
    el.style.setProperty('--my', e.clientY - r.top + 'px');
  }, { passive: true });

  /** Animate a number from its current value to `to`. */
  function count(el, to) {
    to = Number(to);
    const from = el.dataset.v != null ? Number(el.dataset.v) : (parseFloat(el.textContent) || 0);
    el.dataset.v = to;
    if (reduce || from === to || !Number.isFinite(to)) { el.textContent = String(to); return; }
    const t0 = performance.now();
    const dur = Math.min(900, 280 + Math.abs(to - from) * 18);
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  /** Split an element's text into words that rise in one after another. */
  function reveal(el) {
    if (!el || reduce) return;
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'w';
      s.style.setProperty('--i', i);
      s.textContent = w;
      el.append(s, ' ');
    });
  }

  // Click spark on primary buttons.
  document.addEventListener('click', (e) => {
    if (reduce) return;
    const b = e.target && e.target.closest ? e.target.closest('.btn.primary') : null;
    if (!b || b.disabled || !e.clientX) return;
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      s.style.left = e.clientX + 'px';
      s.style.top = e.clientY + 'px';
      s.style.setProperty('--a', (i / 8) * 360 + 'deg');
      document.body.appendChild(s);
      setTimeout(() => s.remove(), 650);
    }
  });

  g.FX = { count, reveal, reduce };
})(self);
