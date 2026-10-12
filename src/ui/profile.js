// Profile dashboard (#/profile). mountProfile(el, {navigate})
import { h } from '../core/utils.js';
import { on, toast } from '../core/store.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, bytes, ago, errText, avatarEl, passwordSetup, requireAuth, shrinkImage } from './sxkit.js';

const STATE = { idle: 'Up to date', syncing: 'Syncing', offline: 'Offline', error: 'Needs attention' };

export function mountProfile(el, { navigate = (p) => { location.hash = '#' + p; } } = {}) {
  ensureCss();
  const root = h('div', { class: 'sx', style: { padding: '16px', maxWidth: '900px', margin: '0 auto' } });
  el.replaceChildren(root);
  let me = null, stats = null, devices = [], busy = false, msg = '', twofa = null, codes = null, alive = true;

  const run = async (fn, ok) => { busy = true; msg = ''; paint(); try { await fn(); if (ok) toast(ok); } catch (e) { msg = errText(e); } busy = false; await load(); };
  async function load() {
    if (!(await requireAuth(navigate, '/profile'))) return;
    try {
      me = (await sync.getAccountInfo()).user;
      [stats, devices] = await Promise.all([sync.apiCall('/api/auth/me/stats'), sync.listDevices()]);
    } catch (e) { msg = errText(e); }
    paint();
  }
  const tile = (l, v, sub) => h('div', { class: 'sx-stat' }, h('b', {}, String(v)), h('span', {}, l), sub ? h('small', { style: { display: 'block', color: 'var(--muted)' } }, sub) : null);
  const card = (title, ...k) => h('section', { class: 'sx-card', 'aria-label': title }, h('h3', {}, title), ...k);
  const table = (cols, rows) => h('div', { class: 'sx-tw' }, h('table', { class: 'sx-table' }, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))), h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))) : [h('tr', {}, h('td', { colspan: cols.length }, 'Nothing yet'))])));

  function header() {
    const [l1, name] = field('Display name', { type: 'text', maxlength: 60, value: me.displayName || '', autocomplete: 'name' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: (e) => { const f = e.target.files[0]; if (f) run(async () => { await sync.uploadAvatar(await shrinkImage(f)); }, 'Photo updated'); } });
    return h('section', { class: 'sx-card' },
      h('div', { class: 'sx-row' }, avatarEl(me, 72), h('div', { class: 'sx-grow' }, h('h2', {}, me.name), h('div', { class: 'sx-row' }, h('span', { class: 'sx-badge' }, me.role), h('span', { class: 'sx-badge' }, 'Member since ' + new Date(stats.memberSince).toLocaleDateString())), h('p', {}, me.email + ' (read-only; an administrator can change it)'))),
      h('div', { class: 'sx-row' }, file, h('button', { class: 'sx-btn sm', onclick: () => file.click() }, 'Change photo'), me.avatar ? h('button', { class: 'sx-btn sm', onclick: () => run(() => sync.updateProfile({ removeAvatar: true }), 'Photo removed') }, 'Remove photo') : null),
      l1, h('div', { class: 'sx-row' }, h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(() => sync.updateProfile({ displayName: name.value }), 'Saved') }, 'Save name'),
        (me.permissions || []).length ? h('button', { class: 'sx-btn', onclick: () => navigate('/admin') }, 'Admin dashboard') : null,
        (me.permissions || []).includes('system.read') ? h('button', { class: 'sx-btn', onclick: () => navigate('/system') }, 'System panel') : null));
  }

  function statsCard() {
    const s = stats, pct = s.storage.quota ? Math.min(100, Math.round(100 * s.storage.used / s.storage.quota)) : 0;
    return card('Overview', h('div', { class: 'sx-stats' }, tile('Notes', s.notes), tile('Notebooks', s.notebooks), tile('Pages', s.pages), tile('Shared by me', s.sharesOut), tile('Shared with me', s.sharesIn), tile('Public links', s.links), tile('Deleted items', s.trash.items, `kept ${s.trash.retentionDays} days`)),
      h('div', {}, h('div', { class: 'sx-row', style: { justifyContent: 'space-between', fontSize: '.85rem' } }, h('span', {}, 'Storage'), h('span', {}, `${bytes(s.storage.used)}${s.storage.quota ? ' of ' + bytes(s.storage.quota) : ''}`)),
        h('div', { role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', style: { height: '8px', borderRadius: '4px', background: 'var(--surface-3,#ddd)', overflow: 'hidden', marginTop: '6px' } },
          h('div', { style: { height: '100%', width: pct + '%', background: pct > 90 ? 'var(--danger,#ff3b30)' : 'var(--accent,#ff9f0a)' } }))));
  }

  function activityCard() {
    return card('Recent sign-ins', h('p', {}, 'Visible only to you.'), table(['When', 'Result', 'Browser / OS', 'IP'], stats.signins.map((e) => [ago(e.at), e.ok ? e.event : h('span', { class: 'sx-badge bad' }, 'failed'), `${e.browser || '?'} / ${e.os || '?'}`, e.ip])));
  }

  function devicesCard() {
    return card('Devices and sessions',
      h('div', { class: 'sx-list' }, devices.map((d) => h('div', {}, h('div', {}, h('b', {}, d.name || 'Device', d.current ? ' (this device)' : ''), h('small', {}, `${[d.browser, d.os].filter(Boolean).join(' on ')} - active ${ago(d.lastSeen)}`)),
        d.current ? null : h('button', { class: 'sx-btn sm danger', disabled: busy, onclick: () => { if (confirm('Sign out that device?')) run(() => sync.revokeDevice(d.id), 'Device removed'); } }, 'Revoke')))),
      h('button', { class: 'sx-btn', disabled: busy || devices.length < 2, onclick: () => run(() => sync.apiCall('/api/auth/logout-all', { method: 'POST' }), 'Signed out everywhere else') }, 'Sign out everywhere else'));
  }

  function securityCard() {
    const [a1, oldPw] = field('Current password', { type: 'password', autocomplete: 'current-password' });
    const pws = passwordSetup({ label: 'New password', email: () => me.email });
    let tf;
    if (codes) tf = h('div', { class: 'sx-warn' }, h('b', {}, 'Save your recovery codes (shown once)'), h('pre', { style: { userSelect: 'all', margin: '6px 0' } }, codes.join('\n')), h('button', { class: 'sx-btn sm primary', onclick: () => { codes = null; paint(); } }, 'I saved them'));
    else if (me.twoFactor) { const [l1, pw] = field('Password', { type: 'password', autocomplete: 'current-password' }); const [l2, code] = field('Authenticator code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code' });
      tf = h('div', { class: 'sx' }, h('span', { class: 'sx-badge ok' }, 'Two-factor is on'), l1, l2, h('button', { class: 'sx-btn danger', disabled: busy, onclick: () => run(() => sync.apiCall('/api/auth/2fa/disable', { method: 'POST', json: { password: pw.value, code: code.value } }), 'Two-factor off') }, 'Turn off')); }
    else if (twofa) { const [l1, code] = field('6-digit code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7 });
      tf = h('div', { class: 'sx' }, h('p', {}, 'Add this key to an authenticator app (time-based, 6 digits):'), h('pre', { style: { userSelect: 'all', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, twofa.secret), h('a', { href: twofa.otpauth }, 'Open in authenticator app'), l1,
        h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(async () => { const r = await sync.apiCall('/api/auth/2fa/enable', { method: 'POST', json: { code: code.value } }); codes = r.recoveryCodes; twofa = null; }) }, 'Verify and turn on')); }
    else tf = h('div', { class: 'sx' }, h('p', {}, 'Add a second step at sign-in.'), h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(async () => { twofa = await sync.apiCall('/api/auth/2fa/setup', { method: 'POST' }); }) }, 'Set up two-factor'));
    return card('Security', a1, ...pws.nodes,
      h('button', { class: 'sx-btn', disabled: busy, onclick: () => { if (!pws.valid()) { msg = 'Please choose a password that meets the rules.'; paint(); return; } run(() => sync.changePassword(oldPw.value, pws.pw.value), 'Password changed; other devices signed out'); } }, 'Change password'),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', width: '100%' } }), h('h3', {}, 'Two-factor authentication'), tf);
  }

  function prefsCard() {
    return card('Preferences', h('p', {}, 'Theme, modules and editor options live in Settings. Deleted notes stay restorable for 60 days.'),
      h('div', { class: 'sx-row' }, h('button', { class: 'sx-btn', onclick: () => navigate('/settings') }, 'Open Settings'), h('button', { class: 'sx-btn', onclick: () => navigate('/trash') }, 'Trash')));
  }

  function syncCard() {
    const s = sync.getSyncState();
    return card('Sync', h('div', { class: 'sx-row' }, h('span', { class: 'sx-badge ' + (s.state === 'error' ? 'bad' : s.state === 'idle' ? 'ok' : '') }, STATE[s.state] || s.state), h('span', {}, `Last synced ${s.lastSync ? ago(s.lastSync) : 'never'}, ${s.pending || 0} waiting`)),
      s.error ? h('div', { class: 'sx-err' }, s.error) : null, h('button', { class: 'sx-btn', disabled: s.state === 'syncing', onclick: () => run(() => sync.syncNow()) }, 'Sync now'));
  }

  function dataCard() {
    const [l, confirmIn] = field('Type DELETE to confirm', { type: 'text', autocomplete: 'off', placeholder: 'DELETE' });
    const [lp, pw] = field('Password', { type: 'password', autocomplete: 'current-password' });
    return card('Your data', h('p', {}, 'Download everything as PDFs (one ZIP) before leaving.'),
      h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(async () => { const m = await import('../features/export.js'); await m.exportNotebook('all', 'pdf'); }) }, 'Download all notes as PDFs (ZIP)'),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', width: '100%' } }), h('h3', {}, 'Delete account'),
      h('p', {}, 'Removes your cloud account and synced data permanently. Notes on this device are kept.'), l, lp,
      h('button', { class: 'sx-btn danger', disabled: busy, onclick: () => { if (confirmIn.value !== 'DELETE') { msg = 'Type DELETE to confirm.'; paint(); return; } run(async () => { await sync.deleteAccount(pw.value); navigate('/'); }, 'Account deleted'); } }, 'Delete my account'));
  }

  function paint() {
    if (!alive || !me || !stats) { if (alive && !me) root.replaceChildren(h('p', {}, msg || 'Loading...')); return; }
    const f = document.activeElement;
    if (root.contains(f) && f.tagName === 'INPUT' && f.value && !busy) return; // never clobber typing
    root.replaceChildren(h('div', { class: 'sx-row', style: { justifyContent: 'space-between' } }, h('h2', {}, 'Profile'), h('button', { class: 'sx-btn sm', onclick: () => navigate('/') }, 'Back to library')),
      msg ? h('div', { class: 'sx-err', role: 'alert' }, msg) : null, header(), statsCard(), syncCard(), activityCard(), devicesCard(), securityCard(), prefsCard(), dataCard());
  }
  const off = [on('sync:status', paint), on('auth:changed', load)];
  load();
  return { destroy() { alive = false; off.forEach((o) => o()); root.remove(); } };
}
export default mountProfile;
export const mount = mountProfile;
