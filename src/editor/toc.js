// Auto table of contents + outline pane (typed-note headings and page titles/bookmarks).
import { h } from '../core/utils.js';
import { popover, ibtn } from './ui.js';
import { icon } from './icons.js';

export function ensureIds(ed) { [...ed.querySelectorAll('h1,h2,h3')].forEach((e, i) => { e.id = 'ik-h-' + i; }); }
export function buildToc(note, ed) {
  const out = [];
  note.pages.forEach((p, i) => { if (p.title || p.bookmark) out.push({ type: 'page', level: 1, text: p.title || 'Page ' + (i + 1), index: i }); });
  const d = ed || Object.assign(document.createElement('div'), { innerHTML: note.text || '' });
  [...d.querySelectorAll('h1,h2,h3')].forEach((e, i) => { const t = e.textContent.trim(); if (t && !e.closest('[data-toc]')) out.push({ type: 'h', level: +e.tagName[1], text: t, index: i }); });
  return out;
}
export function tocHtml(entries) {
  const li = entries.map((e) => e.type === 'page'
    ? `<li style="margin-left:0"><a href="#ik-page-${e.index + 1}">${esc(e.text)}</a> <small>p.${e.index + 1}</small></li>`
    : `<li style="margin-left:${(e.level - 1) * 18}px"><a href="#ik-h-${e.index}">${esc(e.text)}</a></li>`).join('');
  return `<div data-toc="1" contenteditable="true"><h2>Contents</h2><ul>${li || '<li>No headings yet</li>'}</ul></div>`;
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** insert or refresh the TOC block at the top of the typed notes */
export function insertToc(note, ed) {
  ensureIds(ed);
  const html = tocHtml(buildToc(note, ed)), old = ed.querySelector('[data-toc]');
  const t = document.createElement('div'); t.innerHTML = html;
  if (old) old.replaceWith(t.firstChild); else ed.prepend(t.firstChild);
  return ed.innerHTML;
}
function headingBlock(ed, el) {
  const lvl = +el.tagName[1], block = [el]; let n = el.nextElementSibling;
  while (n && !(/^H[1-3]$/.test(n.tagName) && +n.tagName[1] <= lvl)) { block.push(n); n = n.nextElementSibling; }
  return block;
}
export function moveHeading(ed, from, to) {
  const hs = [...ed.querySelectorAll(':scope > h1, :scope > h2, :scope > h3')]; if (!hs[from] || !hs[to] || from === to) return false;
  const blk = headingBlock(ed, hs[from]), tgt = hs[to];
  if (blk.includes(tgt)) return false;
  const anchor = from < to ? (headingBlock(ed, tgt).at(-1).nextSibling) : tgt;
  blk.forEach((b) => ed.insertBefore(b, anchor)); return true;
}

export function openOutline(anchor, ctx) {
  const { engine, note, ed, goHeading, changed, toast } = ctx;
  const list = h('div', { class: 'ik-vlist' });
  let pop;
  const paint = () => {
    ensureIds(ed);
    const es = buildToc(note, ed);
    list.replaceChildren(...(es.length ? es.map((e, k) => {
      const row = h('div', { class: 'ik-vrow ik-toc-row', draggable: 'true', style: { paddingLeft: 10 + (e.level - 1) * 14 + 'px' }, 'data-k': k },
        h('button', { type: 'button', class: 'ik-menu-item', style: { flex: 1, minHeight: '34px', padding: '4px 6px' }, onclick: () => { pop.close(); e.type === 'page' ? engine.goToPage(e.index) : goHeading(e.index); } },
          icon(e.type === 'page' ? 'file' : 'type', 16), h('span', {}, e.text)));
      row.addEventListener('dragstart', (ev) => ev.dataTransfer.setData('text/x-ik-toc', JSON.stringify(e)));
      row.addEventListener('dragover', (ev) => { ev.preventDefault(); row.classList.add('over'); });
      row.addEventListener('dragleave', () => row.classList.remove('over'));
      row.addEventListener('drop', (ev) => {
        ev.preventDefault(); row.classList.remove('over');
        let from; try { from = JSON.parse(ev.dataTransfer.getData('text/x-ik-toc')); } catch { return; }
        if (from.type !== e.type) { toast?.('Drop onto an entry of the same kind'); return; }
        if (e.type === 'page') engine.movePage(from.index, e.index); else if (moveHeading(ed, from.index, e.index)) changed();
        paint();
      });
      return row;
    }) : [h('p', { class: 'ik-hint' }, 'No headings or titled pages yet. Use H1-H3 in typed notes, or give a page a title.')]));
  };
  paint();
  const box = h('div', { class: 'ik-versions' }, h('div', { class: 'ik-menu-title' }, 'Outline'), list,
    h('div', { class: 'ik-hexrow' }, h('button', { type: 'button', class: 'ik-btn wide', onclick: () => { ctx.insert(); paint(); } }, 'Insert / update contents'),
      ibtn('plus', 'Refresh outline', paint, 'sm')));
  pop = popover(anchor, box, { align: 'end', cls: 'wide' });
}
