import { emit } from './store.js';

/** Hash router. Routes: / /all /favorites /recent /archive /trash /search /browse /shared /admin /auth/:sub
 *  /notebook/:id /tag/:t /smart/:id /note/:id /settings */
let cur = { name: 'all', params: {}, query: {}, path: '/' };
let prev = null;
let count = 0;
let started = false;

export function parse(hash) {
  let p = (hash || '').replace(/^#/, '') || '/';
  const [pathPart, qs = ''] = p.split('?');
  const seg = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(qs));
  const path = '/' + seg.map(encodeURIComponent).join('/');
  let name = 'all', params = {};
  const [a, b] = seg;
  if (!a) name = 'all';
  else if (['all', 'favorites', 'recent', 'archive', 'trash', 'search', 'browse', 'settings', 'shared', 'admin'].includes(a)) name = a;
  else if (a === 'auth') { name = 'auth'; params = { sub: b || 'login', rest: seg.slice(2) }; }
  else if (a === 'notebook' && b) { name = 'notebook'; params = { id: b }; }
  else if (a === 'tag' && b) { name = 'tag'; params = { tag: b }; }
  else if (a === 'smart' && b) { name = 'smart'; params = { id: b }; }
  else if (a === 'note' && b) { name = 'note'; params = { id: b }; }
  return { name, params, query, path: qs ? path + '?' + qs : path };
}
export const current = () => cur;
export const previous = () => prev;
export const href = (path) => '#' + path;
export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) { handle(); return; }
  if (replace) location.replace(target); else location.hash = target;
}
/** go back inside the app if possible, otherwise to fallback */
export function back(fallback = '/') {
  if (count > 1 && prev) history.back(); else navigate(fallback, { replace: true });
}
function handle() {
  prev = cur;
  cur = parse(location.hash);
  count++;
  emit('route:changed', cur);
}
export function startRouter() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', handle);
  cur = parse(location.hash);
  count = 1;
  emit('route:changed', cur);
}
export const noteHref = (id) => '#/note/' + encodeURIComponent(id);
