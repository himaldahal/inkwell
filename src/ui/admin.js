// Admin dashboard (staff only). mountAdmin(el, {navigate})
import { h } from '../core/utils.js';
import { toast } from '../core/store.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, bytes, ago, errText, spark, avatarEl } from './sxkit.js';

const A = (path, o) => sync.apiCall('/api/admin' + path, o);
const post = (path, json) => A(path, { method: 'POST', json });

export function mountAdmin(el, { navigate = (p) => { location.hash = '#' + p; } } = {}) {
  ensureCss();
  const root = h('div', { class: 'sx', style: { padding: '16px', maxWidth: '1100px', margin: '0 auto' } });
  el.replaceChildren(root);
  const TABS = [['overview', 'Overview'], ['users', 'Users'], ['shares', 'Shares & links'], ['abuse', 'Abuse'], ['storage', 'Storage & trash'], ['settings', 'Settings'], ['audit', 'Audit log'], ['health', 'System']];
  let tab = sessionStorage.getItem('admin-tab') || 'overview', content = h('div', { class: 'sx' }), alive = true;

  const table = (cols, rows) => h('div', { class: 'sx-tw' }, h('table', { class: 'sx-table' },
    h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))),
    h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))) : [h('tr', {}, h('td', { colspan: cols.length }, 'Nothing here'))])));
  const stat = (l, v) => h('div', { class: 'sx-stat' }, h('b', {}, String(v)), h('span', {}, l));
  const btn = (label, fn, cls = '') => h('button', { class: 'sx-btn sm ' + cls, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(errText(err)); } b.disabled = false; } }, label);
  const badge = (t, c = '') => h('span', { class: 'sx-badge ' + c }, t);
  const show = async (fn) => {
    content.replaceChildren(h('p', {}, 'Loading...'));
    try { content.replaceChildren(...[].concat(await fn())); } catch (e) { content.replaceChildren(h('div', { class: 'sx-err', role: 'alert' }, e.status === 403 ? 'Administrators only.' : errText(e))); }
  };

  const views = {
    async overview() {
      const o = await A('/overview'), t = o.totals;
      const chart = (title, s, c) => h('div', { class: 'sx-card' }, h('h3', {}, title), spark(s, c), h('p', {}, `${s.reduce((a, b) => a + b.n, 0)} in the last 30 days`));
      return [h('div', { class: 'sx-stats' }, stat('Users', t.users), stat('Active (30 d)', t.active30d), stat('Disabled', t.disabled), stat('Devices (7 d)', `${t.activeDevices}/${t.devices}`),
        stat('Notes', t.notes), stat('Storage', bytes(t.storageBytes)), stat('Shares', t.shares), stat('Live links', t.links), stat('Link views', t.linkViews)),
        h('div', { class: 'sx-stats', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' } }, chart('Sign-ups', o.signups), chart('Sign-ins', o.logins, 'var(--ok,#248a3d)'), chart('Failed sign-ins', o.failed, 'var(--danger,#ff3b30)'))];
    },

    async users() {
      const [l1, q] = field('Search', { type: 'search', placeholder: 'e-mail or name' });
      const sel = h('select', { 'aria-label': 'Filter' }, [['', 'All'], ['active', 'Active'], ['disabled', 'Disabled'], ['staff', 'Admins'], ['unverified', 'Unverified']].map(([v, l]) => h('option', { value: v }, l)));
      const list = h('div', {});
      const load = async () => {
        const d = await A(`/users?q=${encodeURIComponent(q.value)}&filter=${sel.value}`);
        list.replaceChildren(table(['User', 'Status', 'Plan', 'Storage', 'Notes', 'Seen', ''], d.users.map((u) => [
          h('div', { class: 'sx-row' }, avatarEl({ id: u.id, name: u.displayName || u.email }, 28), h('div', {}, h('b', {}, u.displayName || u.email.split('@')[0]), h('small', { style: { display: 'block' } }, u.email))),
          h('span', {}, u.isActive ? badge('active', 'ok') : badge('disabled', 'bad'), ' ', u.isStaff ? badge('admin') : null, ' ', u.emailVerified ? null : badge('unverified', 'warn'), ' ', u.mustChangePassword ? badge('temp password', 'warn') : null),
          u.plan, `${bytes(u.usage.assetBytes)}${u.quotaBytes ? ' / ' + bytes(u.quotaBytes) : ''}`, String(u.usage.notes), ago(u.lastLogin),
          btn('Manage', () => userDialog(u.id, load)),
        ])));
      };
      [q, sel].forEach((x) => x.addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(() => load().catch((e) => toast(errText(e))), 250); }));
      await load();
      return [h('div', { class: 'sx-row' }, h('div', { class: 'sx-grow' }, l1), sel, btn('New user', () => createDialog(load), 'primary')), list];
    },

    async shares() {
      const d = await A('/shares');
      return [h('h3', {}, 'Public and link shares'), table(['Owner', 'Title', 'Access', 'Views / edits', 'State', ''], d.links.map((l) => [
        l.owner, h('a', { href: l.path, target: '_blank', rel: 'noopener' }, l.title || l.noteId.slice(0, 8)),
        `${l.visibility} / ${l.permission}${l.hasPassword ? ' / password' : ''}`, `${l.views} / ${l.edits}`, l.revoked ? badge('disabled', 'bad') : l.expiresAt && new Date(l.expiresAt) < new Date() ? badge('expired', 'warn') : badge('live', 'ok'),
        h('span', { class: 'sx-row' }, btn(l.revoked ? 'Enable' : 'Disable', async () => { await post(`/links/${l.id}`, { action: l.revoked ? 'enable' : 'disable' }); tabs(tab); }), btn('Expire', async () => { await post(`/links/${l.id}`, { action: 'expire' }); tabs(tab); }),
          btn('Delete', async () => { if (confirm('Delete this link and its files?')) { await post(`/links/${l.id}`, { action: 'delete' }); tabs(tab); } }, 'danger')),
      ])), h('h3', {}, 'Shares between users'), table(['Owner', 'Shared with', 'Kind', 'Role', 'Via', ''], d.shares.map((s) => [s.owner, s.to, s.kind, s.role, s.viaLink ? 'link' : 'invite',
        btn('Revoke', async () => { await A(`/shares/${s.id}`, { method: 'DELETE' }); tabs(tab); }, 'danger')]))];
    },

    async abuse() {
      const d = await A('/abuse');
      const [lk, kind] = [null, h('select', { 'aria-label': 'Kind' }, ['ip', 'email', 'domain'].map((k) => h('option', {}, k)))];
      const [lv, val] = field('Value', { type: 'text', placeholder: '203.0.113.7 / user@x.com / spam.com' });
      const [lh, hrs] = field('Hours (blank = permanent)', { type: 'number', min: 1 });
      return [h('div', { class: 'sx-card' }, h('h3', {}, 'Block an IP, e-mail or domain'), h('div', { class: 'sx-row' }, kind, h('div', { class: 'sx-grow' }, lv), h('div', {}, lh), btn('Block', async () => { await post('/abuse', { kind: kind.value, value: val.value, hours: hrs.value || null }); tabs(tab); }, 'primary'))),
        h('h3', {}, 'Open reports'), table(['When', 'Kind', 'Reporter', 'Target', 'Reason', ''], d.reports.filter((r) => r.status === 'open').map((r) => [ago(r.at), r.kind, r.reporter || '-', r.target || '-', r.reason, btn('Close', async () => { await post(`/reports/${r.id}`, {}); tabs(tab); })])),
        h('h3', {}, 'Blocks'), table(['Kind', 'Value', 'Reason', 'Until', ''], d.blocks.map((b) => [b.kind, b.value, b.reason, b.expiresAt ? new Date(b.expiresAt).toLocaleString() : 'permanent', btn('Remove', async () => { await A(`/blocks/${b.id}`, { method: 'DELETE' }); tabs(tab); })])),
        h('h3', {}, 'Active lockouts'), table(['Key', 'Fails', 'Until', ''], d.lockouts.map((l) => [l.key, String(l.fails), new Date(l.until).toLocaleTimeString(), btn('Clear', async () => { await post('/blocks/0', { key: l.key }); tabs(tab); })])),
        h('h3', {}, 'Top failing IPs (24 h)'), table(['IP', 'Failures', ''], d.topFailingIps.map((x) => [x.ip, String(x.n), btn('Block 24 h', async () => { await post('/abuse', { kind: 'ip', value: x.ip, hours: 24, reason: 'failed logins' }); tabs(tab); })])),
        h('h3', {}, 'Recent failed sign-ins'), table(['When', 'E-mail', 'IP', 'Browser'], d.failedLogins.slice(0, 40).map((f) => [ago(f.at), f.username, f.ip, f.browser])),
        h('h3', {}, 'Suppressed e-mails (rate caps)'), table(['When', 'Detail'], d.suppressedMail.map((m) => [ago(m.at), m.detail])),
        h('p', {}, `Built-in disposable-domain list: ${d.disposableDomains.length} domains (extend the deny list under Settings).`)];
    },

    async storage() {
      const [u, t] = await Promise.all([A('/users'), A('/trash')]);
      return [h('h3', {}, 'Storage by user'), table(['User', 'Used', 'Quota', 'Notes', ''], u.users.slice().sort((a, b) => b.usage.assetBytes - a.usage.assetBytes).map((x) => [x.email, bytes(x.usage.assetBytes), x.quotaBytes ? bytes(x.quotaBytes) : 'unlimited', String(x.usage.notes), btn('Edit quota', () => userDialog(x.id, () => tabs(tab)))])),
        h('h3', {}, `Server-side trash (kept ${t.retentionDays} days)`), table(['User', 'Deleted items', ''], t.users.map((x) => [x.user__email, String(x.n), btn('Purge now', async () => { if (confirm('Permanently wipe their trashed items?')) { await post('/trash', { userId: x.user__public_id }); tabs(tab); } }, 'danger')])),
        btn('Purge everything past retention', async () => { const r = await post('/trash', { all: true }); toast(`Purged ${r.purged}`); tabs(tab); })];
    },

    async settings() {
      const s = await A('/settings');
      const reg = h('input', { type: 'checkbox', checked: s.registration_open }), anon = h('input', { type: 'checkbox', checked: s.allow_anonymous_links });
      const [l1, st] = field('Default storage per user (MB, 0 = unlimited)', { type: 'number', min: 0, value: s.defaultStorageMb });
      const [l2, nl] = field('Default note limit (0 = unlimited)', { type: 'number', min: 0, value: s.defaultMaxNotes });
      const [l3, allow] = field('Allowed e-mail domains (one per line; empty = any)', { tag: 'textarea', rows: 3 }); allow.value = s.email_allow_domains.join('\n');
      const [l4, deny] = field('Blocked e-mail domains (one per line)', { tag: 'textarea', rows: 3 }); deny.value = s.email_deny_domains.join('\n');
      return [h('div', { class: 'sx-card' }, h('h3', {}, `Runtime options (${s.mode} mode)`),
        h('label', { style: { display: 'flex', gap: '8px', flexDirection: 'row', alignItems: 'center' } }, reg, 'Public registration open'),
        h('label', { style: { display: 'flex', gap: '8px', flexDirection: 'row', alignItems: 'center' } }, anon, 'Allow anonymous public links (otherwise sign-in required)'),
        l1, l2, l3, l4,
        btn('Save', async () => { await post('/settings', { registration_open: reg.checked, allow_anonymous_links: anon.checked, defaultStorageMb: +st.value, defaultMaxNotes: +nl.value, email_allow_domains: allow.value, email_deny_domains: deny.value }); toast('Saved'); }, 'primary'))];
    },

    async audit() {
      const [l1, q] = field('Search', { type: 'search' });
      const ev = h('select', { 'aria-label': 'Event' }, ['', 'login', 'login_failed', 'register', 'admin.', 'share.', 'public.', 'password', 'mail.'].map((v) => h('option', { value: v }, v || 'All events')));
      const out = h('div', {});
      const params = () => `q=${encodeURIComponent(q.value)}&event=${encodeURIComponent(ev.value)}&limit=300`;
      const load = async () => { const d = await A('/audit?' + params()); out.replaceChildren(table(['When', 'Event', 'Who', 'Detail', 'IP'], d.events.map((e) => [new Date(e.at).toLocaleString(), e.event, e.user || e.actor || '-', e.detail, e.ip]))); };
      [q, ev].forEach((x) => x.addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(() => load().catch(() => {}), 250); }));
      const csv = async () => { const a = await sync.getAuth(); const r = await fetch((a.serverUrl || '') + '/api/admin/audit?format=csv&limit=5000&' + params(), { headers: { Authorization: 'Bearer ' + a.token } }); const b = await r.blob(); const u = URL.createObjectURL(b); h('a', { href: u, download: 'inkwell-audit.csv' }).click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
      await load();
      return [h('div', { class: 'sx-row' }, h('div', { class: 'sx-grow' }, l1), ev, btn('Export CSV', csv)), out];
    },

    async health() {
      const d = await A('/health');
      const [l1, to] = field('Send a test e-mail to', { type: 'email' });
      return [h('div', { class: 'sx-stats' }, stat('Mode', d.mode), stat('Database', `${d.db} ${d.dbBytes != null ? bytes(d.dbBytes) : ''}`), stat('Media files', bytes(d.mediaBytes)), stat('E-mail', d.emailBackend), stat('HTTPS', d.https ? 'yes' : 'no'), stat('Long-poll', d.longPoll ? 'on' : 'off'), stat('TURN (P2P)', d.turn ? 'configured' : 'not configured')),
        d.debug ? h('div', { class: 'sx-warn' }, 'DEBUG is on. Turn it off in production.') : null,
        h('div', { class: 'sx-card' }, h('h3', {}, 'E-mail'), h('p', {}, `From ${d.emailFrom}${d.smtpHost ? ' via ' + d.smtpHost : ''}`), h('div', { class: 'sx-row' }, h('div', { class: 'sx-grow' }, l1), btn('Send test', async () => { const r = await post('/test-email', { to: to.value }); toast('Sent via ' + r.backend); })))];
    },
  };

  async function userDialog(uid, done) {
    const { openModal } = await import('./dom.js');
    const d = await A(`/users/${uid}/full`), u = d.user;
    const [l1, name] = field('Display name', { type: 'text', value: u.displayName || '' });
    const [l2, mail] = field('E-mail (staff only can change)', { type: 'email', value: u.email });
    const [l3, sto] = field('Storage override (MB, blank = plan default)', { type: 'number', min: 0, value: u.storageMbOverride ?? '' });
    const [l4, nn] = field('Note limit override (blank = plan default)', { type: 'number', min: 0, value: u.maxNotesOverride ?? '' });
    const staff = h('input', { type: 'checkbox', checked: u.isStaff });
    const body = h('div', { class: 'sx' }, h('div', { class: 'sx-row' }, avatarEl({ id: u.id, name: u.displayName || u.email }, 44), h('div', {}, h('b', {}, u.email), h('p', {}, `Joined ${new Date(u.dateJoined).toLocaleDateString()}, last sign-in ${ago(u.lastLogin)}`))),
      l1, l2, l3, l4, h('label', { style: { display: 'flex', gap: '8px', flexDirection: 'row', alignItems: 'center' } }, staff, 'Administrator'),
      h('div', { class: 'sx-row' },
        btn('Save', async () => { await A(`/users/${uid}`, { method: 'PATCH', json: { displayName: name.value, email: mail.value, storageMb: sto.value === '' ? null : +sto.value, maxNotes: nn.value === '' ? null : +nn.value, isStaff: staff.checked } }); toast('Saved'); m.close(); done?.(); }, 'primary'),
        btn(u.isActive ? 'Disable' : 'Enable', async () => { await A(`/users/${uid}`, { method: 'PATCH', json: { isActive: !u.isActive } }); m.close(); done?.(); }),
        btn('Reset password', async () => { if (!confirm('Generate a temporary password and sign them out?')) return; const r = await post(`/users/${uid}/reset`, {}); prompt('Temporary password (shown once). They must change it at next sign-in:', r.tempPassword); done?.(); }),
        d.user.email ? btn('Send reset e-mail', async () => { await post(`/users/${uid}/send-reset`, {}); toast('Reset e-mail sent'); }) : null,
        btn('Sign out everywhere', async () => { await post(`/users/${uid}/revoke-sessions`, {}); toast('Sessions revoked'); }),
        btn('Delete', async () => { if (confirm(`Delete ${u.email} and ALL their data? This cannot be undone.`)) { await A(`/users/${uid}`, { method: 'DELETE' }); m.close(); done?.(); } }, 'danger')),
      h('h3', {}, 'Devices and sessions'),
      table(['Device', 'Browser / OS', 'First IP', 'Last IP', 'First seen', 'Last seen', ''], d.devices.map((v) => [v.name || v.kind || 'device', `${v.browser || '?'} / ${v.os || '?'} (${v.kind || '?'})`, v.firstIp, v.lastIp, new Date(v.firstSeen).toLocaleDateString(), ago(v.lastSeen),
        btn('Revoke', async () => { await post(`/users/${uid}/revoke-sessions?device=${encodeURIComponent(v.id)}`, {}); toast('Revoked'); })])),
      h('h3', {}, 'Sign-in history'),
      table(['When', 'Result', 'IP', 'Browser / OS'], d.history.map((e) => [new Date(e.at).toLocaleString(), e.ok ? e.event : badge('failed', 'bad'), e.ip, `${e.browser || '?'} / ${e.os || '?'}`])));
    const m = openModal({ title: 'Manage user', body, size: 'lg' });
  }

  async function createDialog(done) {
    const { openModal } = await import('./dom.js');
    const [l1, mail] = field('E-mail', { type: 'email', required: true });
    const [l2, name] = field('Display name', { type: 'text' });
    const [l3, sto] = field('Storage (MB, blank = default)', { type: 'number', min: 0 });
    const staff = h('input', { type: 'checkbox' });
    const m = openModal({ title: 'New user', body: h('div', { class: 'sx' }, l1, l2, l3, h('label', { style: { display: 'flex', gap: '8px', flexDirection: 'row', alignItems: 'center' } }, staff, 'Administrator'), h('p', {}, 'A temporary password is generated. The user must change it at first sign-in.')),
      actions: [{ label: 'Create', kind: 'primary', onClick: async () => {
        try { const r = await post('/users', { email: mail.value, displayName: name.value, storageMb: sto.value === '' ? null : +sto.value, isStaff: staff.checked }); prompt('Temporary password (shown once):', r.tempPassword); done?.(); } catch (e) { toast(errText(e)); return false; } } }] });
  }

  function tabs(t) {
    tab = t; sessionStorage.setItem('admin-tab', t);
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    show(views[t]);
  }
  const nav = h('div', { class: 'sx-tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-t': k, 'aria-selected': String(k === tab), onclick: () => tabs(k) }, l)));
  root.append(h('div', { class: 'sx-row', style: { justifyContent: 'space-between' } }, h('h2', {}, 'Admin'), h('button', { class: 'sx-btn sm', onclick: () => navigate('/') }, 'Back to library')), nav, content);
  tabs(tab);
  return { destroy() { alive = false; root.remove(); } };
}
export default mountAdmin;
export const mount = mountAdmin;
