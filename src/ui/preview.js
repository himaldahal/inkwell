import { h, icon, openMenu, emptyState, plural } from './dom.js';
import { fmtDate } from './fmt.js';
import * as A from './actions.js';
import { getAll } from '../core/db.js';
import { noteHref } from '../core/router.js';
import { paperEl, noteMenuItems, movePicker, tagDialog } from './dialogs.js';
import { getBacklinks, extractLinks } from './links.js';
import { isNoteLocked } from './lock.js';

/** Desktop third pane: preview of the selected note + metadata + backlinks. */
export function createPreview({ onOpen }) {
  const el = h('aside', { class: 'preview', 'aria-label': 'Note preview' });
  let seq = 0;
  const empty = () => el.replaceChildren(emptyState({ icon: 'file', title: 'Select a note', text: 'Pick a note to preview it here. Double-click or press Enter to open.' }));
  empty();
  async function show(n) {
    const my = ++seq;
    if (!n) { empty(); return; }
    const locked = isNoteLocked(n);
    const nbs = await A.getNotebooks();
    const nb = nbs.find((b) => b.id === n.notebookId);
    const back = locked ? [] : await getBacklinks(n);
    if (my !== seq) return;
    const thumb = h('div', { class: 'pv-thumb' + (locked ? ' locked' : '') }, n.preview ? h('img', { src: n.preview, alt: 'Preview of ' + (n.title || 'Untitled'), class: locked ? 'blur' : '' }) : paperEl(n.template, n.paperColor), locked ? h('span', { class: 'lock-badge' }, icon('lock', 28)) : null);
    const out = !locked ? extractLinks(n) : [];
    el.replaceChildren(
      h('div', { class: 'pv-scroll' },
        thumb,
        h('h2', { class: 'pv-title' }, n.title || 'Untitled'),
        h('p', { class: 'pv-meta' }, `${locked ? 'Locked' : plural((n.pages || []).length, 'page')} - edited ${fmtDate(n.updatedAt)}${n.sharedBy ? ' - owner ' + A.ownerLabel(n) : ''}`, nb ? ` - ${nb.icon || ''} ${nb.name}` : ''),
        (n.tags || []).length ? h('div', { class: 'card-tags' }, n.tags.map((t) => h('a', { class: 'chip', href: '#/tag/' + encodeURIComponent(t) }, '#' + t))) : null,
        !locked && n.textIndex ? h('p', { class: 'pv-text' }, n.textIndex.slice(0, 280)) : null,
        out.length ? h('div', { class: 'pv-sec' }, h('h3', {}, icon('link', 14), 'Links'), h('div', { class: 'pv-links' }, out.map((t) => h('span', { class: 'chip' }, t)))) : null,
        back.length ? h('div', { class: 'pv-sec' }, h('h3', {}, icon('link', 14), 'Backlinks'), back.map((b) => h('a', { class: 'pv-back', href: noteHref(b.id) }, b.title || 'Untitled'))) : null),
      h('div', { class: 'pv-actions' },
        h('button', { class: 'btn primary grow', type: 'button', onclick: () => onOpen(n.id) }, icon('open', 18), 'Open'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': n.favorite ? 'Remove favorite' : 'Favorite', onclick: () => A.toggleFlag([n], 'favorite') }, icon('star', 20)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More actions', onclick: (e) => openMenu(noteMenuItems(n, {}), { anchor: e.currentTarget, title: n.title || 'Untitled' }) }, icon('more', 20))));
  }
  return { el, show };
}
