// Route #/s/:token — open a shared link inside the app: asks for sign-in / password, redeems it, then opens the note.
import { h } from '../core/utils.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, errText, avatarEl } from './sxkit.js';

export function mountShareView(el, { token, navigate = (p) => { location.hash = '#' + p; } } = {}) {
  ensureCss();
  const root = h('div', { class: 'sx sx-center' });
  el.replaceChildren(root);
  let info = null, msg = '', busy = false;
  const card = (...k) => root.replaceChildren(h('div', { class: 'sx-narrow sx' }, h('div', { class: 'sx-brand' }, 'Inkwell'), h('div', { class: 'sx-card' }, ...k)));

  async function redeem(password) {
    busy = true; msg = ''; paint();
    try {
      const r = await sync.apiCall('/api/share/link/redeem', { method: 'POST', json: { token, password } });
      if (r.own) return navigate('/note/' + encodeURIComponent(r.id));
      await sync.syncNow();
      navigate(r.kind === 'notebooks' ? '/notebook/' + encodeURIComponent(r.id) : '/note/' + encodeURIComponent(r.id));
    } catch (e) { msg = errText(e); busy = false; paint(); }
  }
  async function paint() {
    const auth = await sync.getAuth();
    if (!info && !msg) return card(h('p', {}, 'Opening shared link...'));
    if (!info) return card(h('h2', {}, 'Link not available'), h('p', {}, msg || 'It may have expired or been revoked.'), h('a', { href: '#/' }, 'Back to library'));
    if (!auth?.token) return card(h('h2', {}, info.title || 'Shared note'), h('p', {}, `${info.owner?.name || 'Someone'} shared this with you. Sign in to open it.`),
      h('button', { class: 'sx-btn primary', onclick: () => navigate('/auth/login?next=' + encodeURIComponent('/s/' + token)) }, 'Sign in'));
    const [l, pw] = field('Password', { type: 'password', autocomplete: 'off' });
    card(h('div', { class: 'sx-row' }, avatarEl(info.owner, 40), h('div', {}, h('h2', {}, info.title || 'Shared ' + (info.kind === 'notebooks' ? 'notebook' : 'note')), h('p', {}, `From ${info.owner?.name || 'someone'} - ${info.permission === 'write' ? 'you can edit' : 'view only'}`))),
      info.hasPassword ? l : null, msg ? h('div', { class: 'sx-err', role: 'alert' }, msg) : null,
      h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => redeem(pw.value) }, busy ? 'Opening...' : 'Open'),
      h('button', { class: 'sx-btn sm', onclick: () => sync.apiCall('/api/report', { method: 'POST', json: { kind: 'link', token, reason: 'reported from app' } }).then(() => alert('Thanks, we will review it.')).catch(() => {}) }, 'Report this link'));
  }
  sync.apiCall('/api/share/link/info?token=' + encodeURIComponent(token), { noAuth: true }).then((i) => { info = i; paint(); }, (e) => { msg = errText(e); paint(); });
  paint();
  return { destroy() { root.remove(); } };
}
export default mountShareView;
export const mount = mountShareView;
