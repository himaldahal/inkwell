// Sync & account settings panel. mountSyncSettings(el) -> { destroy() }
import { h } from '../core/utils.js';
import { on, toast } from '../core/store.js';
import * as sync from '../core/sync.js';

const CSS = `
.ss{display:grid;gap:16px;max-width:560px;color:var(--text,#1f1d2b);font:inherit}
.ss *{box-sizing:border-box}
.ss-card{background:var(--surface,#fff);border:1px solid var(--border,#e4e0d8);border-radius:14px;padding:16px;display:grid;gap:12px}
.ss h3{margin:0;font-size:1rem}.ss p{margin:0;color:var(--muted,#6b6880);font-size:.875rem;line-height:1.45}
.ss label{display:grid;gap:4px;font-size:.8rem;color:var(--muted,#6b6880)}
.ss input[type=text],.ss input[type=password],.ss input[type=email],.ss input[type=url]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#e4e0d8);background:var(--bg,#f6f3ee);color:var(--text,#1f1d2b);font:inherit;min-height:44px}
.ss input:focus-visible,.ss button:focus-visible{outline:2px solid var(--accent,#4f46e5);outline-offset:2px}
.ss-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.ss-btn{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--border,#e4e0d8);background:var(--surface,#fff);color:var(--text,#1f1d2b);font:inherit;cursor:pointer}
.ss-btn.primary{background:var(--accent,#4f46e5);border-color:var(--accent,#4f46e5);color:#fff}
.ss-btn.danger{color:#c0392b;border-color:currentColor}
.ss-btn[disabled]{opacity:.55;cursor:default}
.ss-tabs{display:flex;gap:4px;background:var(--bg,#f6f3ee);border-radius:10px;padding:3px}
.ss-tabs button{flex:1;min-height:38px;border:0;border-radius:8px;background:none;color:var(--muted,#6b6880);font:inherit;cursor:pointer}
.ss-tabs button[aria-selected=true]{background:var(--surface,#fff);color:var(--text,#1f1d2b);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.ss-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.ss-stat{background:var(--bg,#f6f3ee);border-radius:10px;padding:10px 12px}.ss-stat b{display:block;font-size:1.05rem}.ss-stat span{font-size:.75rem;color:var(--muted,#6b6880)}
.ss-badge{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;padding:3px 10px;border-radius:99px;background:var(--bg,#f6f3ee)}
.ss-badge i{width:8px;height:8px;border-radius:50%;background:#2e9e5b}.ss-badge.syncing i{background:var(--accent,#4f46e5)}.ss-badge.offline i{background:#999}.ss-badge.error i{background:#c0392b}
.ss-err{color:#c0392b;font-size:.85rem}
.ss-warn{background:rgba(224,160,40,.14);border:1px solid rgba(224,160,40,.5);border-radius:10px;padding:10px 12px;font-size:.82rem}
.ss-dev{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:8px 0;border-top:1px solid var(--border,#e4e0d8)}
.ss-dev:first-child{border-top:0}.ss-dev small{display:block;color:var(--muted,#6b6880)}
.ss details summary{cursor:pointer;color:var(--muted,#6b6880);font-size:.85rem;min-height:32px}
`;

const bytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
const ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 10 ? 'just now' : s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(ts).toLocaleDateString();
};
const STATE_LABEL = { idle: 'Up to date', syncing: 'Syncing', offline: 'Offline', error: 'Error' };

export function mountSyncSettings(el) {
  if (!document.getElementById('ss-style')) document.head.append(h('style', { id: 'ss-style' }, CSS));
  const root = h('div', { class: 'ss' });
  el.append(root);
  let mode = 'signin', busy = false, msg = '', auth = null, info = null, devices = null, e2e = false, alive = true;

  const run = async (fn, ok) => {
    busy = true; msg = ''; paint();
    try { await fn(); if (ok) toast(ok); } catch (e) { msg = e?.message || String(e); if (e?.name === 'TypeError') msg = 'Cannot reach the server. Check the address and your connection.'; }
    busy = false;
    await load();
  };

  async function load() {
    auth = await sync.getAuth(); e2e = await sync.isE2EEnabled();
    if (auth?.token && navigator.onLine) {
      try { info = await sync.getAccountInfo(); devices = await sync.listDevices(); } catch (e) { if (e.status === 401) info = null; }
    } else { info = null; devices = null; }
    if (alive) paint();
  }

  function field(label, attrs) {
    const input = h('input', attrs);
    return [h('label', {}, label, input), input];
  }

  function signedOut() {
    const s = sync.getSyncState();
    const [l1, user] = field('Username', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' });
    const [l2, pass] = field('Password', { type: 'password', autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
    const [l3, email] = field('Email (optional)', { type: 'email', autocomplete: 'email' });
    const [l4, server] = field('Server address (blank = this site)', { type: 'url', placeholder: 'https://notes.example.com', value: auth?.serverUrl || '' });
    const submit = () => run(async () => {
      await sync.signIn({ serverUrl: server.value.trim(), username: user.value.trim(), password: pass.value, email: email.value.trim(), register: mode === 'register' });
    }, 'Signed in. Syncing...');
    const form = h('form', { class: 'ss-card', onsubmit: (e) => { e.preventDefault(); if (!busy) submit(); } },
      h('h3', {}, 'Cloud sync'),
      h('p', {}, 'Inkwell works fully offline. Sign in to keep your notes in sync across devices. You can keep using the app without an account.'),
      h('div', { class: 'ss-tabs', role: 'tablist' },
        ['signin', 'register'].map((m) => h('button', { type: 'button', role: 'tab', 'aria-selected': mode === m, onclick: () => { mode = m; msg = ''; paint(); } }, m === 'signin' ? 'Sign in' : 'Create account'))),
      l1, l2, mode === 'register' ? l3 : null,
      h('details', {}, h('summary', {}, 'Advanced'), l4,
        h('button', { type: 'button', class: 'ss-btn', style: { marginTop: '8px' }, onclick: () => run(async () => { const r = await sync.checkServer(server.value.trim()); toast(r.ok ? 'Server reachable' + (r.registration ? '' : ' (registration closed)') : 'Server unhealthy'); }) }, 'Test connection')),
      msg ? h('div', { class: 'ss-err', role: 'alert' }, msg) : null,
      h('div', { class: 'ss-row' }, h('button', { class: 'ss-btn primary', type: 'submit', disabled: busy }, busy ? 'Please wait...' : mode === 'register' ? 'Create account' : 'Sign in')),
      h('p', {}, `${s.pending || 0} change(s) saved on this device.`));
    return form;
  }

  function signedIn() {
    const s = sync.getSyncState();
    const usage = info?.usage;
    const stats = h('div', { class: 'ss-stats' },
      stat('Last synced', ago(s.lastSync)), stat('Waiting to upload', String(s.pending || 0)),
      stat('Cloud storage', usage ? bytes(usage.assetBytes) + (usage.quotaBytes ? ' / ' + bytes(usage.quotaBytes) : '') : '-'),
      stat('Notes in cloud', usage ? String(usage.records) : '-'));
    const status = h('span', { class: 'ss-badge ' + s.state }, h('i'), STATE_LABEL[s.state] || s.state);

    const card = h('div', { class: 'ss-card' },
      h('div', { class: 'ss-row', style: { justifyContent: 'space-between' } },
        h('div', {}, h('h3', {}, auth.username), h('p', {}, auth.serverUrl || 'This site')), status),
      stats,
      s.error ? h('div', { class: 'ss-err', role: 'alert' }, s.error) : null,
      msg ? h('div', { class: 'ss-err', role: 'alert' }, msg) : null,
      h('div', { class: 'ss-row' },
        h('button', { class: 'ss-btn primary', disabled: busy || s.state === 'syncing', onclick: () => run(() => sync.syncNow()) }, s.state === 'syncing' ? 'Syncing...' : 'Sync now'),
        h('button', { class: 'ss-btn', disabled: busy, onclick: () => { if (confirm('Sign out? Notes stay on this device; unsynced changes will upload when you sign in again.')) run(() => sync.signOut(), 'Signed out'); } }, 'Sign out')));

    const devCard = h('div', { class: 'ss-card' }, h('h3', {}, 'Your devices'),
      devices ? h('div', {}, devices.map((d) => h('div', { class: 'ss-dev' },
        h('div', {}, h('b', {}, d.name || 'Device', d.current ? ' (this device)' : ''), h('small', {}, 'Last active ' + new Date(d.lastSeen).toLocaleString())),
        d.current ? null : h('button', { class: 'ss-btn danger', disabled: busy, onclick: () => { if (confirm(`Sign out "${d.name || 'device'}"? It will need to sign in again.`)) run(() => sync.revokeDevice(d.id), 'Device removed'); } }, 'Remove')))) : h('p', {}, navigator.onLine ? 'Loading...' : 'Connect to the internet to see devices.'));

    const [lp1, pw1] = field('Passphrase', { type: 'password', autocomplete: 'off', placeholder: 'At least 8 characters' });
    const e2eCard = h('div', { class: 'ss-card' }, h('h3', {}, 'End-to-end encryption'),
      h('p', {}, e2e ? 'On. Your notes and attachments are encrypted on this device before upload; the server only sees ciphertext. Use the same passphrase on every device.'
        : 'Encrypt note contents and attachments before they leave this device, so even the server owner cannot read them.'),
      h('div', { class: 'ss-warn' }, 'There is no recovery. If you lose the passphrase, your cloud copy cannot be decrypted. Titles, text, pages, tags and files are hidden; ids and timestamps are not.'),
      e2e ? h('button', { class: 'ss-btn', disabled: busy, onclick: () => { if (confirm('Turn off encryption? All data will be re-uploaded as readable text.')) run(() => sync.disableE2E(), 'Encryption turned off'); } }, 'Turn off encryption')
        : [lp1, h('button', { class: 'ss-btn primary', disabled: busy, onclick: () => run(() => sync.enableE2E(pw1.value), 'Encryption on. Re-uploading...') }, 'Turn on encryption')],
      !e2e ? h('p', {}, 'Already enabled on another device? Enter the same passphrase here to unlock.') : null);

    const [a1, oldPw] = field('Current password', { type: 'password', autocomplete: 'current-password' });
    const [a2, newPw] = field('New password', { type: 'password', autocomplete: 'new-password' });
    const acct = h('details', { class: 'ss-card' }, h('summary', {}, 'Account'),
      a1, a2,
      h('div', { class: 'ss-row' },
        h('button', { class: 'ss-btn', disabled: busy, onclick: () => run(() => sync.changePassword(oldPw.value, newPw.value), 'Password changed') }, 'Change password'),
        h('button', { class: 'ss-btn danger', disabled: busy, onclick: () => { if (confirm('Permanently delete your cloud account and all synced data? Notes on this device are kept.')) run(() => sync.deleteAccount(oldPw.value), 'Account deleted'); } }, 'Delete account')),
      h('p', {}, 'Deleting needs your current password in the first field.'));
    return [card, devCard, e2eCard, acct];
  }

  function stat(l, v) { return h('div', { class: 'ss-stat' }, h('b', {}, v), h('span', {}, l)); }

  function paint() {
    if (!alive) return;
    const focus = document.activeElement;
    // do not clobber text the user is typing
    if (root.contains(focus) && focus.tagName === 'INPUT' && focus.value && !busy) return;
    root.replaceChildren(...[auth?.token ? signedIn() : signedOut()].flat());
  }

  const off = on('sync:status', () => { if (alive) paint(); });
  const tick = setInterval(() => { if (auth?.token && !busy) paint(); }, 15000);
  load();
  return { destroy() { alive = false; off(); clearInterval(tick); root.remove(); } };
}
export default mountSyncSettings;
