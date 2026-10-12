import { h, icon } from './dom.js';
import { getRecord } from '../core/db.js';
import { back } from '../core/router.js';
import { requireUnlock } from './lock.js';
import { on } from '../core/store.js';

const initials = (n) => (n || '?').trim().split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

const editorMods = import.meta.glob('../editor/index.js');

/** Full-screen note screen: lazy-loads the editor. */
export function mountNotePage(container, noteId) {
  let dead = false, editor = null;
  const close = () => back('/');
  const presence = h('div', { class: 'presence', hidden: true, 'aria-label': 'People editing now', role: 'group' });
  const showPresence = (users) => {
    const list = (users || []).filter(Boolean);
    presence.hidden = !list.length;
    presence.replaceChildren(...list.slice(0, 5).map((u) => h('span', { class: 'avatar', title: u.name || 'Collaborator', style: { background: u.color || 'var(--accent)' } }, u.avatar ? h('img', { src: u.avatar, alt: '' }) : initials(u.name))), list.length > 5 ? h('span', { class: 'avatar more' }, '+' + (list.length - 5)) : null);
  };
  const offP = on('presence:update', (d) => { if (!d || !d.noteId || d.noteId === noteId) showPresence(d?.users || d); });
  const state = h('div', { class: 'note-state', role: 'status' });
  const host = h('div', { class: 'editor-host' });
  container.replaceChildren(host, presence, state);
  const loading = () => state.replaceChildren(h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, 'Opening note...'));
  const fail = (title, msg, retry) => { state.hidden = false; state.replaceChildren(icon('alert', 32), h('h3', {}, title), h('p', {}, msg), h('div', { class: 'empty-actions' }, retry && h('button', { class: 'btn primary', type: 'button', onclick: start }, 'Try again'), h('button', { class: 'btn', type: 'button', onclick: close }, 'Back to library'))); };
  async function start() {
    state.hidden = false; loading();
    const note = await getRecord('notes', noteId).catch(() => null);
    if (dead) return;
    if (!note || note.deleted) return fail('Note not found', 'It may have been deleted or not synced to this device yet.');
    if (!(await requireUnlock(note))) { if (!dead) close(); return; }
    try {
      const loader = editorMods['../editor/index.js'];
      if (!loader) throw new Error('The editor is not installed in this build.');
      const m = await loader();
      if (dead) return;
      editor = await m.mountEditor(host, noteId, { onClose: close, onPresence: showPresence });
      state.hidden = true;
    } catch (e) {
      console.error(e);
      if (!dead) fail('Could not open the editor', e?.message || 'Something went wrong while loading.', true);
    }
  }
  start();
  const off0 = on('lock:relock', () => close());
  const off = () => { off0(); offP(); };
  return { destroy() { dead = true; off(); try { editor?.destroy?.(); } catch (e) { console.error(e); } container.replaceChildren(); } };
}
