// Account & sync settings panel. mountSyncSettings(el) -> { destroy() }
import { h } from '../core/utils.js';
import { on, toast } from '../core/store.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, bytes, ago, errText, avatarEl } from './sxkit.js';

const STATE = { idle: 'Up to date', syncing: 'Syncing', offline: 'Offline', error: 'Needs attention' };
const go = (p) => { location.hash = '#' + p; };

/** Downscale to a 256px square JPEG (<=200KB) before upload */
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas');
  c.width = c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 256, 256);
  for (const q of [0.9, 0.75, 0.6, 0.45]) {
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (b && b.size <= 190000) return b;
  }
  throw new Error('Image is too detailed; choose another one.');
}

export function mountSyncSettings(el) {
  ensureCss();
  const root = h('div', { class: 'sx', style: { maxWidth: '620px' } });
  el.append(root);
  let busy = false, msg = '', auth = null, info = null, devices = null, e2e = false, alive = true, twofa = null, codes = null;

  const run = async (fn, okMsg) => {
    busy = true; msg = ''; paint();
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { msg = errText(e); }
    busy = false; await load();
  };
  async function load() {
    auth = await sync.getAuth(); e2e = await sync.isE2EEnabled();
    if (auth?.token && navigator.onLine) {
      try { info = await sync.getAccountInfo(); devices = await sync.listDevices(); } catch (e) { if (e.status === 401) info = null; }
    } else { info = null; devices = null; }
    paint();
  }
  const stat = (l, v) => h('div', { class: 'sx-stat' }, h('b', {}, v), h('span', {}, l));

  function signedOut() {
    const s = sync.getSyncState();
    return h('div', { class: 'sx-card' }, h('h3', {}, 'Cloud sync'),
      h('p', {}, 'Inkwell works fully offline. Sign in to keep your notes in sync across devices and to share them.'),
      h('div', { class: 'sx-row' }, h('button', { class: 'sx-btn primary', onclick: () => go('/auth/login') }, 'Sign in'),
        h('button', { class: 'sx-btn', onclick: () => go('/auth/register') }, 'Create account')),
      h('p', {}, `${s.pending || 0} change(s) saved on this device.`));
  }

  function profile() {
    const u = info?.user || auth.user || {};
    const [l1, name] = field('Display name (shown to people you share with)', { type: 'text', maxlength: 60, value: u.displayName || '' });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (f) run(async () => { await sync.uploadAvatar(await shrink(f)); }, 'Photo updated'); } });
    return h('div', { class: 'sx-card' },
      h('div', { class: 'sx-row' }, avatarEl(u, 56), h('div', { class: 'sx-grow' }, h('h3', {}, u.name || u.email), h('p', {}, u.email + ' (changed by an administrator only)'))),
      h('div', { class: 'sx-row' }, file, h('button', { class: 'sx-btn sm', onclick: () => file.click() }, 'Change photo'),
        u.avatar ? h('button', { class: 'sx-btn sm', onclick: () => run(() => sync.updateProfile({ removeAvatar: true }), 'Photo removed') }, 'Remove') : null),
      l1, h('div', { class: 'sx-row' }, h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(() => sync.updateProfile({ displayName: name.value }), 'Saved') }, 'Save name'),
        u.isStaff ? h('button', { class: 'sx-btn', onclick: () => go('/admin') }, 'Open admin dashboard') : null));
  }

  function status() {
    const s = sync.getSyncState(), q = sync.getQueue(), usage = info?.usage;
    return h('div', { class: 'sx-card' },
      h('div', { class: 'sx-row', style: { justifyContent: 'space-between' } }, h('h3', {}, 'Sync'), h('span', { class: 'sx-badge ' + (s.state === 'error' ? 'bad' : s.state === 'idle' ? 'ok' : '') }, STATE[s.state] || s.state)),
      h('div', { class: 'sx-stats' }, stat('Last synced', s.lastSync ? ago(s.lastSync) : 'never'), stat('Waiting to upload', String(s.pending || 0)),
        stat('Cloud storage', usage ? bytes(usage.assetBytes) + (usage.quotaBytes ? ' / ' + bytes(usage.quotaBytes) : '') : '-'),
        stat('Notes', usage ? usage.notes + (usage.noteLimit ? ' / ' + usage.noteLimit : '') : '-')),
      ...q.transfers.map((t) => h('div', { class: 'sx-row' }, h('span', { class: 'sx-grow' }, `${t.dir === 'up' ? 'Uploading' : 'Downloading'} ${t.total ? Math.round(100 * t.loaded / t.total) + '%' : ''}`),
        h('button', { class: 'sx-btn sm', onclick: () => sync.cancelTransfer(t.id) }, 'Cancel'))),
      s.error ? h('div', { class: 'sx-err', role: 'alert' }, s.error) : null,
      ...q.failed.map((f) => h('div', { class: 'sx-err' }, `${f.key.split(':')[0]}: ${f.error}`)),
      msg ? h('div', { class: 'sx-err', role: 'alert' }, msg) : null,
      h('div', { class: 'sx-row' },
        h('button', { class: 'sx-btn primary', disabled: busy || s.state === 'syncing', onclick: () => run(() => (q.failed.length ? sync.retryFailed() : sync.syncNow())) }, s.state === 'syncing' ? 'Syncing...' : q.failed.length ? 'Retry failed' : 'Sync now'),
        h('button', { class: 'sx-btn', disabled: busy, onclick: () => { if (confirm('Sign out? Notes stay on this device.')) run(() => sync.signOut(), 'Signed out'); } }, 'Sign out')));
  }

  function devicesCard() {
    return h('div', { class: 'sx-card' }, h('h3', {}, 'Your devices'),
      devices ? h('div', { class: 'sx-list' }, devices.map((d) => h('div', {},
        h('div', {}, h('b', {}, d.name || 'Device', d.current ? ' (this device)' : ''), h('small', {}, `${[d.browser, d.os].filter(Boolean).join(' on ')} - active ${ago(d.lastSeen)}`)),
        d.current ? null : h('button', { class: 'sx-btn sm danger', disabled: busy, onclick: () => { if (confirm('Sign out that device?')) run(() => sync.revokeDevice(d.id), 'Device removed'); } }, 'Remove')))) : h('p', {}, navigator.onLine ? 'Loading...' : 'Connect to see devices.'),
      h('button', { class: 'sx-btn', disabled: busy || !devices || devices.length < 2, onclick: () => run(() => sync.apiCall('/api/auth/logout-all', { method: 'POST' }), 'Signed out everywhere else') }, 'Sign out all other devices'));
  }

  function twofaCard() {
    const u = info?.user || {};
    if (codes) return h('div', { class: 'sx-card' }, h('h3', {}, 'Save your recovery codes'), h('p', {}, 'Each code works once if you lose your authenticator. They are not shown again.'),
      h('pre', { style: { userSelect: 'all', margin: 0 } }, codes.join('\n')), h('button', { class: 'sx-btn primary', onclick: () => { codes = null; paint(); } }, 'I saved them'));
    if (u.twoFactor) {
      const [l1, pw] = field('Password', { type: 'password', autocomplete: 'current-password' });
      const [l2, code] = field('Authenticator code', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code' });
      return h('div', { class: 'sx-card' }, h('h3', {}, 'Two-factor authentication'), h('span', { class: 'sx-badge ok' }, 'On'), l1, l2,
        h('button', { class: 'sx-btn danger', disabled: busy, onclick: () => run(() => sync.apiCall('/api/auth/2fa/disable', { method: 'POST', json: { password: pw.value, code: code.value } }), 'Two-factor turned off') }, 'Turn off'));
    }
    if (twofa) {
      const [l1, code] = field('6-digit code from your app', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 7 });
      return h('div', { class: 'sx-card' }, h('h3', {}, 'Set up an authenticator app'),
        h('p', {}, 'Add this key to Google Authenticator, 1Password, Aegis or similar (time-based, 6 digits).'),
        h('pre', { style: { userSelect: 'all', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, twofa.secret),
        h('a', { href: twofa.otpauth }, 'Open in authenticator app'), l1,
        msg ? h('div', { class: 'sx-err' }, msg) : null,
        h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(async () => { const r = await sync.apiCall('/api/auth/2fa/enable', { method: 'POST', json: { code: code.value } }); codes = r.recoveryCodes; twofa = null; }) }, 'Verify and turn on'));
    }
    return h('div', { class: 'sx-card' }, h('h3', {}, 'Two-factor authentication'), h('p', {}, 'Add a second step at sign-in with an authenticator app.'),
      h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(async () => { twofa = await sync.apiCall('/api/auth/2fa/setup', { method: 'POST' }); }) }, 'Set up'));
  }

  function e2eCard() {
    const [lp, pw] = field('Passphrase', { type: 'password', autocomplete: 'off', placeholder: 'At least 8 characters' });
    return h('div', { class: 'sx-card' }, h('h3', {}, 'End-to-end encryption'),
      h('p', {}, e2e ? 'On. Your notes and attachments are encrypted on this device before upload. Use the same passphrase on every device.' : 'Encrypt note contents and attachments before they leave this device, so even the server owner cannot read them.'),
      h('div', { class: 'sx-warn' }, 'There is no recovery: if you lose the passphrase, your cloud copy cannot be decrypted. Sharing with other people and public links do not work for encrypted notes.'),
      e2e ? h('button', { class: 'sx-btn', disabled: busy, onclick: () => { if (confirm('Turn off encryption? Everything is re-uploaded as readable data.')) run(() => sync.disableE2E(), 'Encryption off'); } }, 'Turn off')
        : [lp, h('button', { class: 'sx-btn primary', disabled: busy, onclick: () => run(() => sync.enableE2E(pw.value), 'Encryption on. Re-uploading...') }, 'Turn on')]);
  }

  function accountCard() {
    const [a1, oldPw] = field('Current password', { type: 'password', autocomplete: 'current-password' });
    const [a2, newPw] = field('New password (10+ characters)', { type: 'password', autocomplete: 'new-password' });
    return h('details', { class: 'sx-card' }, h('summary', {}, 'Password and account'), a1, a2,
      h('div', { class: 'sx-row' },
        h('button', { class: 'sx-btn', disabled: busy, onclick: () => run(() => sync.changePassword(oldPw.value, newPw.value), 'Password changed; other devices signed out') }, 'Change password'),
        h('button', { class: 'sx-btn danger', disabled: busy, onclick: async () => {
          if (!confirm('Delete your cloud account and all synced data? Notes on this device are kept.')) return;
          if (confirm('Download all your notes as PDFs first? (recommended)')) { try { const m = await import('../features/export.js'); await m.exportNotebook('all', 'pdf'); } catch (e) { toast('Export failed: ' + errText(e)); return; } }
          run(() => sync.deleteAccount(oldPw.value), 'Account deleted');
        } }, 'Delete account')),
      h('p', {}, 'Deleting needs your current password in the first field.'));
  }

  function paint() {
    if (!alive) return;
    const f = document.activeElement;
    if (root.contains(f) && f.tagName === 'INPUT' && f.value && !busy) return; // do not clobber typing
    root.replaceChildren(...(auth?.token ? [profile(), status(), devicesCard(), twofaCard(), e2eCard(), accountCard()] : [signedOut()]));
  }
  const off = [on('sync:status', paint), on('auth:changed', load)];
  const tick = setInterval(() => { if (auth?.token && !busy) paint(); }, 15000);
  load();
  return { destroy() { alive = false; off.forEach((o) => o()); clearInterval(tick); root.remove(); } };
}
export default mountSyncSettings;
