import { h, icon } from './dom.js';
import { getRecord } from '../core/db.js';
import { back } from '../core/router.js';
import { requireUnlock } from './lock.js';
import { on } from '../core/store.js';

const editorMods = import.meta.glob('../editor/index.js');

/** Full-screen note screen: lazy-loads the editor. */
export function mountNotePage(container, noteId) {
  let dead = false, editor = null;
  const close = () => back('/');
  const state = h('div', { class: 'note-state', role: 'status' });
  const host = h('div', { class: 'editor-host' });
  container.replaceChildren(host, state);
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
      editor = await m.mountEditor(host, noteId, { onClose: close });
      state.hidden = true;
    } catch (e) {
      console.error(e);
      if (!dead) fail('Could not open the editor', e?.message || 'Something went wrong while loading.', true);
    }
  }
  start();
  const off = on('lock:relock', () => close());
  return { destroy() { dead = true; off(); try { editor?.destroy?.(); } catch (e) { console.error(e); } container.replaceChildren(); } };
}
