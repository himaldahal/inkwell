// Page thumbnails panel + per-page menu (template, paper, background image, reorder, duplicate, delete).
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { ibtn, popover } from './ui.js';
import { paintPage } from './pages.js';
import { TEMPLATES, PAPER_COLORS } from './templates.js';

export function pageMenu(anchor, engine, i) {
  const note = engine.note, pg = note.pages[i];
  if (!pg) return;
  let all = false, pop;
  const done = (fn) => () => { pop.close(); fn(); };
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
  file.addEventListener('change', () => { const f = file.files[0]; if (f) engine.setBgImage(i, f, 'contain'); pop.close(); });
  const tplRow = h('div', { class: 'ik-tplrow' });
  TEMPLATES.forEach((t) => {
    const cur = (pg.bg || note.template || 'lined') === t.id;
    const b = h('button', { type: 'button', class: 'ik-tpl' + (cur ? ' on' : ''), title: t.name }, h('span', { class: 'tpl-ic tpl-' + t.id }), h('span', {}, t.name));
    b.addEventListener('click', () => { engine.setTemplate(all ? 'all' : i, t.id); pop.close(); });
    tplRow.append(b);
  });
  const allCb = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Apply to all pages');
  allCb.firstChild.addEventListener('change', (e) => { all = e.target.checked; });
  const sty = (patch) => { engine.setPageStyle(all ? 'all' : i, patch); pop.close(); };
  const paper = h('div', { class: 'ik-colors' });
  PAPER_COLORS.forEach((p) => paper.append(h('button', { type: 'button', class: 'ik-sw' + ((pg.paper !== undefined ? pg.paper : note.paperColor || null) === p.c && !pg.paperGrad ? ' on' : ''), title: p.name, 'aria-label': 'Paper ' + p.name, style: { background: p.c || '#fff' }, onclick: () => sty({ paper: p.c, paperGrad: null }) })));
  const cust = h('input', { type: 'color', class: 'ik-custom', title: 'Custom paper color', 'aria-label': 'Custom paper color', value: typeof pg.paper === 'string' && pg.paper[0] === '#' ? pg.paper : '#ffffff' });
  cust.addEventListener('change', () => sty({ paper: cust.value, paperGrad: null }));
  paper.append(cust, h('button', { type: 'button', class: 'ik-sw', title: 'No background (transparent)', 'aria-label': 'Transparent paper', style: { background: 'repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0/10px 10px' }, onclick: () => sty({ paper: 'none', paperGrad: null }) }));
  const grads = h('div', { class: 'ik-colors' });
  [['#fdfbfb', '#ebedee'], ['#e0c3fc', '#8ec5fc'], ['#fddb92', '#d1fdff'], ['#ffecd2', '#fcb69f'], ['#c9ffbf', '#ffafbd'], ['#1f2937', '#0b1020']].forEach((g) => grads.append(h('button', { type: 'button', class: 'ik-sw', title: 'Gradient', 'aria-label': 'Gradient paper', style: { background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }, onclick: () => sty({ paperGrad: g }) })));
  const patC = h('input', { type: 'color', class: 'ik-custom', title: 'Pattern color', 'aria-label': 'Pattern color', value: pg.pattern?.color || note.pattern?.color || '#8791b3' });
  const patO = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, class: 'ik-range', 'aria-label': 'Pattern opacity', value: pg.pattern?.opacity ?? note.pattern?.opacity ?? 1, style: { width: '110px' } });
  const patch = () => engine.setPageStyle(all ? 'all' : i, { pattern: { color: patC.value, opacity: +patO.value } });
  patC.addEventListener('change', patch); patO.addEventListener('change', patch);
  const patRow = h('div', { class: 'ik-colors', style: { padding: '4px 10px' } }, patC, patO);
  const item = (ic, label, fn, danger) => h('button', { type: 'button', class: 'ik-menu-item' + (danger ? ' danger' : ''), onclick: done(fn) }, icon(ic, 18), h('span', {}, label));
  const box = h('div', { class: 'ik-menu ik-pagemenu' },
    h('div', { class: 'ik-menu-title' }, `Page ${i + 1} template`), tplRow, allCb,
    h('div', { class: 'ik-menu-title' }, 'Paper color'), paper, h('div', { class: 'ik-menu-title' }, 'Gradient'), grads, h('div', { class: 'ik-menu-title' }, 'Pattern color / opacity'), patRow, h('div', { class: 'ik-sep' }),
    item('plus', 'Add page after', () => engine.addPage(i)),
    item('copy', 'Duplicate page', () => engine.duplicatePage(i)),
    i > 0 ? item('up', 'Move up', () => engine.movePage(i, i - 1)) : null,
    i < note.pages.length - 1 ? item('down', 'Move down', () => engine.movePage(i, i + 1)) : null,
    pg.type === 'draw' ? h('button', { type: 'button', class: 'ik-menu-item', onclick: () => file.click() }, icon('image', 18), h('span', {}, pg.bgImage ? 'Replace background image' : 'Background image...')) : null,
    pg.bgImage ? h('div', { class: 'ik-seg inl' }, ...['contain', 'cover', 'stretch'].map((f) => h('button', { type: 'button', class: 'ik-segb' + (pg.bgImage.fit === f ? ' on' : ''), onclick: done(() => engine.setBgFit(i, f)) }, f))) : null,
    pg.bgImage ? item('x', 'Remove background image', () => engine.setBgImage(i, null)) : null,
    item('file', 'Page title / bookmark...', () => { const t = prompt('Page title (leave empty to clear)', pg.title || ''); if (t != null) engine.setPageStyle(i, { title: t || null, bookmark: t ? true : null }); }),
    item('trash', 'Delete page', () => engine.deletePage(i), true), file);
  pop = popover(anchor, box, { align: 'end', cls: 'wide' });
}

export function mountSidebar(host, engine) {
  host.classList.add('ik-sidebar-in');
  const list = h('div', { class: 'ik-thumbs' });
  const add = h('button', { type: 'button', class: 'ik-btn add', onclick: () => engine.addPage(engine.pvs.length - 1) }, icon('plus', 18), ' Add page');
  host.append(list, add);
  const items = [];
  let timer;
  const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) draw(e.target._i); }, { root: list, rootMargin: '200px' });
  function draw(i) {
    const it = items[i]; if (!it) return;
    const pg = engine.note.pages[i], pv = engine.pvs[i]; if (!pg || !pv) return;
    const W = 120, k = W / pg.width, dpr = Math.min(2, window.devicePixelRatio || 1), c = it.cv;
    c.width = Math.round(W * dpr); c.height = Math.round(pg.height * k * dpr);
    c.style.aspectRatio = pg.width + '/' + pg.height;
    const ctx = c.getContext('2d'); ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    paintPage(ctx, engine.note, pg, { pdfCanvas: pv.cv.pdf, items: true });
  }
  function build() {
    io.disconnect(); list.replaceChildren(); items.length = 0;
    engine.note.pages.forEach((pg, i) => {
      const cv = h('canvas', { class: 'ik-thumb-cv' });
      const more = ibtn('more', 'Page options', (e, b) => { e.stopPropagation(); pageMenu(b, engine, i); }, 'sm more');
      const el = h('div', { class: 'ik-thumb', draggable: 'true', tabindex: 0, role: 'button', 'aria-label': 'Go to page ' + (i + 1), onclick: () => engine.goToPage(i), onkeydown: (e) => { if (e.key === 'Enter') engine.goToPage(i); } }, cv, h('span', { class: 'num' }, String(i + 1)), more);
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-ik-page', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-ik-page')) { e.preventDefault(); el.classList.add('over'); } });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); const from = +e.dataTransfer.getData('text/x-ik-page'); if (!isNaN(from)) engine.movePage(from, i); });
      cv._i = i; items.push({ el, cv }); list.append(el); io.observe(cv);
    });
    mark();
  }
  function mark() {
    items.forEach((it, i) => it.el.classList.toggle('cur', i === engine.cur));
    items[engine.cur]?.el.scrollIntoView({ block: 'nearest' });
  }
  const offs = [
    engine.on('pages', build),
    engine.on('page', mark),
    engine.on('change', (d) => {
      if (d.kind === 'pages') return;
      clearTimeout(timer);
      timer = setTimeout(() => { const i = d.page ? engine.note.pages.indexOf(d.page) : -1; if (i >= 0) draw(i); else items.forEach((_, j) => draw(j)); }, 450);
    }),
  ];
  build();
  return { refresh: build, destroy() { offs.forEach((f) => f()); io.disconnect(); clearTimeout(timer); host.replaceChildren(); } };
}
