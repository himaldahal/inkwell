import { getAll } from '../core/db.js';
import { stripHtml } from '../core/utils.js';

/** [[wiki link]] helpers. Links resolve by (case-insensitive) note title. */
export const LINK_RE = /\[\[([^\[\]\n]{1,120})\]\]/g;
const norm = (s) => (s || '').trim().toLowerCase();

export function extractLinks(note) {
  const src = (note.textIndex || '') + ' ' + stripHtml(note.text || '');
  const out = new Set();
  for (const m of src.matchAll(LINK_RE)) out.add(m[1].trim());
  return [...out];
}
export async function resolveLink(title) {
  const t = norm(title);
  return (await getAll('notes')).find((n) => !n.trashedAt && norm(n.title) === t) || null;
}
/** notes that contain [[Title of this note]] */
export async function getBacklinks(noteIdOrNote) {
  const all = await getAll('notes');
  const me = typeof noteIdOrNote === 'string' ? all.find((n) => n.id === noteIdOrNote) : noteIdOrNote;
  if (!me || !me.title) return [];
  const t = norm(me.title);
  return all.filter((n) => n.id !== me.id && !n.trashedAt && extractLinks(n).some((l) => norm(l) === t));
}
/** autocomplete for typing [[...  */
export async function linkSuggestions(q, limit = 8) {
  const t = norm(q);
  return (await getAll('notes')).filter((n) => !n.trashedAt && n.title && norm(n.title).includes(t)).slice(0, limit);
}
/** wrap [[Title]] occurrences in HTML-escaped plain text with anchors to #/note/:id (async, for previews) */
export async function linkify(text) {
  const all = await getAll('notes');
  return (text || '').replace(LINK_RE, (full, title) => {
    const n = all.find((x) => !x.trashedAt && norm(x.title) === norm(title));
    return n ? `<a class="wikilink" href="#/note/${encodeURIComponent(n.id)}">${title}</a>` : `<span class="wikilink missing">${title}</span>`;
  });
}
