// DOM rendering of page "items" (images, text boxes, stickers). Items live in a layer scaled by zoom.
import { h } from '../core/utils.js';
import { assetUrl } from './assets.js';
import { liveEmbed } from './embeds.js';

export function syncItems(pv) {
  const layer = pv.items, items = (pv.page.items || []).filter((i) => !i.deleted);
  const have = new Map();
  for (const el of [...layer.children]) have.set(el.dataset.id, el);
  const seen = new Set();
  let prev = null;
  for (const it of items) {
    seen.add(it.id);
    let el = have.get(it.id);
    if (!el) { el = h('div', { class: 'ik-item', 'data-id': it.id, 'data-type': it.type }); }
    paintItem(el, it, pv);
    if (prev ? prev.nextSibling !== el : layer.firstChild !== el) layer.insertBefore(el, prev ? prev.nextSibling : layer.firstChild);
    prev = el;
  }
  for (const [id, el] of have) if (!seen.has(id)) el.remove();
}
export function clearItems(pv) { pv.items.replaceChildren(); }

export function paintItem(el, it, pv) {
  const s = el.style;
  s.left = it.x + 'px'; s.top = it.y + 'px'; s.width = it.w + 'px'; s.height = it.type === 'text' ? 'auto' : it.h + 'px';
  if (it.type === 'text') s.minHeight = it.h + 'px';
  s.transform = it.rotation ? `rotate(${it.rotation}deg)` : '';
  if (it.type === 'image') {
    let img = el.firstChild;
    if (!img) { img = h('img', { draggable: 'false', alt: '' }); el.append(img); }
    if (img._aid !== it.assetId) {
      img._aid = it.assetId; img.removeAttribute('src'); el.classList.add('loading');
      assetUrl(it.assetId).then((u) => { if (img._aid === it.assetId && u) { img.src = u; el.classList.remove('loading'); } });
    }
  } else if (it.type === 'frame') {
    el.classList.add('ik-frame');
    let l = el.firstChild; if (!l) { l = h('div', { class: 'ik-frame-t' }); el.append(l); }
    l.textContent = it.title || 'Frame';
  } else if (it.type === 'embed') {
    let c = el.firstChild; const key = it.embedUrl + '|' + it.title;
    if (!c || c._key !== key) {
      c = h('div', { class: 'ik-embed', 'data-kind': it.kind }); c._key = key; el.replaceChildren(c);
      const body = h('div', { class: 'ik-embed-b' });
      const open = () => h('a', { class: 'ik-embed-btn', href: it.url, target: '_blank', rel: 'noopener noreferrer', 'data-ik-ui': '' }, 'Open link');
      if (it.kind === 'link') body.append(open());
      else {
        const load = h('button', { type: 'button', class: 'ik-embed-btn', 'data-ik-ui': '' }, navigator.onLine ? 'Load ' + (it.provider || 'embed') : 'Offline - tap to retry');
        load.addEventListener('click', () => { if (!navigator.onLine) { load.textContent = 'You are offline'; return; } body.replaceChildren(liveEmbed(it)); c.classList.add('live'); });
        body.append(load, h('small', {}, 'Nothing loads until you tap. Use the hand tool to interact.'));
      }
      c.append(h('div', { class: 'ik-embed-h' }, h('b', {}, it.provider || 'Link'), h('span', {}, it.title || it.url)), body);
    }
  } else if (it.type === 'sticker') {
    el.textContent = it.emoji || '⭐';
    s.fontSize = Math.min(it.w, it.h) * 0.82 + 'px'; s.lineHeight = it.h + 'px'; s.textAlign = 'center';
  } else if (it.type === 'text') {
    let t = el.firstChild;
    if (!t) { t = h('div', { class: 'ik-text' }); el.append(t); }
    if (!el.classList.contains('ik-editing') && t._html !== it.html) { t.innerHTML = it.html || ''; t._html = it.html; }
    t.style.fontSize = (it.fontSize || 20) + 'px'; t.style.color = it.color || '#111827';
    t.style.textAlign = it.align || 'left'; t.style.fontFamily = it.font || '';
    s.background = it.bg || ''; s.padding = it.bg ? '12px' : ''; s.borderRadius = it.bg ? '4px' : ''; s.boxShadow = it.sticky ? '0 4px 10px rgba(0,0,0,.25)' : '';
  }
}
export function itemRect(pv, it) {
  let hh = it.h;
  if (it.type === 'text') {
    const el = pv.items.querySelector(`[data-id="${it.id}"]`);
    if (el && el.offsetHeight) hh = Math.max(it.h, el.offsetHeight);
  }
  return { x: it.x, y: it.y, w: it.w, h: hh };
}
/** keep export/other-module friendly mirrors in item.data */
export function withData(it) {
  /* mirrors for export/other modules; `by` is stamped on commit */
  const d = {};
  for (const k of ['assetId', 'text', 'html', 'fontSize', 'color', 'emoji']) if (it[k] != null) d[k] = it[k];
  return { ...it, data: d, u: Date.now() };
}
