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
  const paper = h('div', { class: 'ik-colors' });
  PAPER_COLORS.forEach((p) => paper.append(h('button', { type: 'button', class: 'ik-sw' + ((note.paperColor || null) === p.c ? ' on' : ''), title: p.name, 'aria-label': 'Paper ' + p.name, style: { background: p.c || '#fff' }, onclick: () => { engine.setPaper(p.c); pop.close(); } })));
  const item = (ic, label, fn, danger) => h('button', { type: 'button', class: 'ik-menu-item' + (danger ? ' danger' : ''), onclick: done(fn) }, icon(ic, 18), h('span', {}, label));
  const box = h('div', { class: 'ik-menu ik-pagemenu' },
    h('div', { class: 'ik-menu-title' }, `Page ${i + 1} template`), tplRow, allCb,
    h('div', { class: 'ik-menu-title' }, 'Paper color'), paper, h('div', { class: 'ik-sep' }),
    item('plus', 'Add page after', () => engine.addPage(i)),
    item('copy', 'Duplicate page', () => engine.duplicatePage(i)),
    i > 0 ? item('up', 'Move up', () => engine.movePage(i, i - 1)) : null,
    i < note.pages.length - 1 ? item('down', 'Move down', () => engine.movePage(i, i + 1)) : null,
    pg.type === 'draw' ? h('button', { type: 'button', class: 'ik-menu-item', onclick: () => file.click() }, icon('image', 18), h('span', {}, pg.bgImage ? 'Replace background image' : 'Background image...')) : null,
    pg.bgImage ? h('div', { class: 'ik-seg inl' }, ...['contain', 'cover', 'stretch'].map((f) => h('button', { type: 'button', class: 'ik-segb' + (pg.bgImage.fit === f ? ' on' : ''), onclick: done(() => engine.setBgFit(i, f)) }, f))) : null,
    pg.bgImage ? item('x', 'Remove background image', () => engine.setBgImage(i, null)) : null,
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
