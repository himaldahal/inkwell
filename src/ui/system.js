// System panel (superuser / analytics roles). mountSystem(el, {navigate}) for route #/system
import { h } from '../core/utils.js';
import { toast } from '../core/store.js';
import * as sync from '../core/sync.js';
import { ensureCss, field, bytes, ago, errText } from './sxkit.js';

const S = (path, o) => sync.apiCall('/api/system' + path, o);
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); kids.forEach((k) => e.append(k)); return e; };
const COLORS = ['var(--accent,#ff9f0a)', 'var(--ok,#248a3d)', 'var(--danger,#ff3b30)', '#5e5ce6', '#64d2ff'];
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n * 10) / 10));

/** multi-series line chart: lines = [{label, key, color}], rows = [{date, ...}] */
function lineChart(rows, lines, { height = 150, area = false } = {}) {
  const W = 600, H = height, pad = 24, max = Math.max(1, ...rows.flatMap((r) => lines.map((l) => r[l.key] || 0)));
  const x = (i) => pad + (i / Math.max(1, rows.length - 1)) * (W - pad - 6), y = (v) => H - 18 - (v / max) * (H - 30);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sx-chart', role: 'img', 'aria-label': lines.map((l) => l.label).join(', '), preserveAspectRatio: 'none', style: 'width:100%;height:' + H + 'px' });
  for (const g of [0, 0.5, 1]) root.append(svg('line', { x1: pad, x2: W, y1: y(max * g), y2: y(max * g), stroke: 'currentColor', 'stroke-opacity': '.12' }), Object.assign(svg('text', { x: 0, y: y(max * g) + 4, 'font-size': 10, fill: 'currentColor', 'fill-opacity': '.6' }), { textContent: fmt(max * g) }));
  lines.forEach((l, li) => {
    const pts = rows.map((r, i) => `${x(i)},${y(r[l.key] || 0)}`).join(' ');
    if (area && li === 0) root.append(svg('polygon', { points: `${x(0)},${y(0)} ${pts} ${x(rows.length - 1)},${y(0)}`, fill: l.color || COLORS[li], 'fill-opacity': '.12' }));
    root.append(svg('polyline', { points: pts, fill: 'none', stroke: l.color || COLORS[li], 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
  });
  if (rows.length) { root.append(Object.assign(svg('text', { x: pad, y: H - 3, 'font-size': 10, fill: 'currentColor', 'fill-opacity': '.6' }), { textContent: rows[0].date || '' }), Object.assign(svg('text', { x: W - 4, y: H - 3, 'font-size': 10, 'text-anchor': 'end', fill: 'currentColor', 'fill-opacity': '.6' }), { textContent: rows[rows.length - 1].date || '' })); }
  const legend = h('div', { class: 'sx-row', style: { fontSize: '.78rem' } }, lines.map((l, i) => h('span', {}, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: l.color || COLORS[i], marginRight: '4px' } }), l.label)));
  return h('div', {}, root, lines.length > 1 ? legend : null);
}
const bars = (items, label = (x) => x[0], val = (x) => x[1], unit = (v) => String(v)) => {
  const max = Math.max(1, ...items.map(val));
  return h('div', { class: 'sx', style: { gap: '6px' } }, items.length ? items.map((it, i) => h('div', {}, h('div', { class: 'sx-row', style: { justifyContent: 'space-between', fontSize: '.8rem' } }, h('span', {}, label(it) || '(unknown)'), h('span', {}, unit(val(it)))),
    h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--surface-3,#ddd)' } }, h('div', { style: { height: '100%', width: (100 * val(it) / max) + '%', borderRadius: '3px', background: COLORS[i % COLORS.length] } })))) : [h('p', {}, 'No data yet')]);
};

export function mountSystem(el, { navigate = (p) => { location.hash = '#' + p; } } = {}) {
  ensureCss();
  const root = h('div', { class: 'sx', style: { padding: '16px', maxWidth: '1150px', margin: '0 auto' } });
  el.replaceChildren(root);
  const TABS = [['analytics', 'Analytics'], ['sync', 'Sync and API'], ['roles', 'Roles'], ['server', 'Server'], ['data', 'Data viewer'], ['audit', 'Audit log']];
  let tab = sessionStorage.getItem('sys-tab') || 'analytics', days = +(sessionStorage.getItem('sys-days') || 30), timer = null, seq = 0;
  const content = h('div', { class: 'sx' });
  const card = (title, ...kids) => h('div', { class: 'sx-card' }, h('h3', {}, title), ...kids);
  const stat = (l, v) => h('div', { class: 'sx-stat' }, h('b', {}, String(v)), h('span', {}, l));
  const grid = (...k) => h('div', { class: 'sx-stats', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))' } }, ...k);
  const table = (cols, rows) => h('div', { class: 'sx-tw' }, h('table', { class: 'sx-table' }, h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))), h('tbody', {}, rows.length ? rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c === null || c === undefined ? '' : c)))) : [h('tr', {}, h('td', { colspan: cols.length }, 'Nothing here'))])));
  const btn = (label, fn, cls = '') => h('button', { class: 'sx-btn sm ' + cls, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(errText(err)); } b.disabled = false; } }, label);

  const views = {
    async analytics() {
      const a = await S('/analytics?days=' + days), u = a.users, c = a.content, st = a.storage;
      const last = a.active[a.active.length - 1] || {};
      return [h('div', { class: 'sx-stats' }, stat('Users', u.total), stat('DAU / WAU / MAU', `${last.dau || 0} / ${last.wau || 0} / ${last.mau || 0}`), stat('Verified', u.verified), stat('Disabled', u.disabled), stat('Mode', u.mode),
        stat('Notes', c.notes), stat('Pages / strokes*', `${c.pages} / ${fmt(c.strokes)}`), stat('Avg note', bytes(c.avgNoteBytes)), stat('Storage', bytes(st.total)), stat('Shares', a.sharing.shares), stat('Live links', a.sharing.links), stat('Link views', a.sharing.views)),
        grid(card('User growth', lineChart(a.growth, [{ label: 'Total users', key: 'n' }], { area: true })), card('Active users', lineChart(a.active, [{ label: 'DAU', key: 'dau' }, { label: 'WAU', key: 'wau' }, { label: 'MAU', key: 'mau' }])),
          card('Sign-ups', lineChart(a.signups, [{ label: 'Sign-ups', key: 'n' }])), card('Sign-ins and failures', lineChart(a.logins.map((r, i) => ({ date: r.date, ok: r.n, bad: a.failed[i]?.n || 0 })), [{ label: 'Sign-ins', key: 'ok', color: COLORS[1] }, { label: 'Failed', key: 'bad', color: COLORS[2] }])),
          card('Notes created per day*', lineChart(c.createdPerDay, [{ label: 'Notes', key: 'n' }])), card('Collaboration activity', lineChart(a.collab.activityPerDay, [{ label: 'Activity events', key: 'n' }]), h('p', {}, `${a.collab.presenceNow} collaborator(s) present right now`))),
        card('Retention (weekly cohorts, % active N weeks after sign-up)', table(['Cohort week', 'Users', 'Wk 0', 'Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'], a.cohorts.map((r) => [r.week, String(r.size), ...r.retained.map((v) => (v == null ? '-' : v + '%'))]))),
        grid(card('Browsers', bars(a.devices.browser, (x) => x.browser, (x) => x.n)), card('Operating systems', bars(a.devices.os, (x) => x.os, (x) => x.n)), card('Device types', bars(a.devices.kind, (x) => x.kind, (x) => x.n)),
          card('Storage by file kind', bars(Object.entries(st.byKind), (x) => `${x[0]} (${x[1].count})`, (x) => x[1].bytes, bytes)), card('Top users by storage', bars(st.top, (x) => x.user, (x) => x.bytes, bytes)),
          card('Mail (range)', bars(Object.entries(a.mail), (x) => x[0], (x) => x[1])), card('Abuse', lineChart(a.abuse.events, [{ label: 'Failed sign-ins and mail alerts', key: 'n', color: COLORS[2] }]), h('p', {}, `${a.abuse.blocks} block(s), ${a.abuse.openReports} open report(s)`)),
          card(`Trash (kept ${a.trash.retentionDays} days)`, h('p', {}, `${a.trash.records} item(s) restorable`), table(['When', 'Purge'], a.trash.purges.map((p) => [ago(p.at), p.detail])))),
        h('p', {}, `* based on a sample of ${c.sampled} unencrypted notes; end-to-end encrypted notes cannot be inspected (${u.e2e} of them exist).`)];
    },

    async sync() {
      const d = await S(`/api-stats?days=${Math.max(1, Math.ceil(days / 30))}`), s = d.sync;
      return [h('div', { class: 'sx-stats' }, stat('Conflicts', s.conflicts), stat('Rejected records', s.rejected), stat('Records pushed', s.recordsPushed), stat('Sync 5xx', s.failures), stat('Latency p50', s.p50Ms + ' ms'), stat('p95', s.p95Ms + ' ms'), stat('p99', s.p99Ms + ' ms')),
        grid(card('Requests per hour', lineChart(d.hourly.map((r) => ({ date: new Date(r.hour).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' }), req: r.requests, err: r.errors })), [{ label: 'Requests', key: 'req' }, { label: 'Errors', key: 'err', color: COLORS[2] }])),
          card('Pushes and pulls per hour', lineChart(d.hourly.map((r) => ({ date: '', push: r.pushes, pull: r.pulls })), [{ label: 'Pushes', key: 'push' }, { label: 'Pulls', key: 'pull', color: COLORS[1] }]))),
        card('Endpoints', table(['Endpoint', 'Requests', 'Error %', 'Denied', 'Avg ms', 'p95 ms'], d.table.map((r) => [r.endpoint, String(r.count), r.errorRate + '%', String(r.denied), String(r.avgMs), String(r.p95Ms)])))];
    },

    async roles() {
      const d = await S('/roles'), me = await sync.getMe(), can = (me?.permissions || []).includes('roles.manage');
      const edit = (r) => {
        const checks = d.permissions.map((p) => ({ p, el: h('input', { type: 'checkbox', checked: r ? r.permissions.includes(p.key) : false, disabled: r?.builtin || !can }) }));
        const [l, name] = field('Role name', { type: 'text', value: r?.name || '', disabled: !!r });
        return h('div', { class: 'sx-card' }, h('h3', {}, r ? r.name + (r.builtin ? ' (built-in)' : '') : 'New custom role'), r ? null : l,
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '6px' } }, checks.map(({ p, el }) => h('label', { style: { flexDirection: 'row', display: 'flex', gap: '8px', alignItems: 'center' } }, el, h('span', {}, p.label)))),
          can && !r?.builtin ? h('div', { class: 'sx-row' }, btn(r ? 'Save' : 'Create', async () => { const perms = checks.filter((c) => c.el.checked).map((c) => c.p.key); if (r) await S('/roles/' + r.id, { method: 'PATCH', json: { permissions: perms } }); else await S('/roles', { method: 'POST', json: { name: name.value, permissions: perms } }); toast('Saved'); tabs(tab); }, 'primary'),
            r ? btn('Delete', async () => { if (confirm('Delete this role? Members become plain users.')) { await S('/roles/' + r.id, { method: 'DELETE' }); tabs(tab); } }, 'danger') : null) : null);
      };
      return [h('p', {}, 'Roles bundle permissions. Assign them to people in Admin > Users > Manage (needs the roles permission). Built-in roles are fixed; custom roles are editable by a superuser.'), ...d.roles.map(edit), can ? edit(null) : null];
    },

    async server() {
      const d = await S('/server'), f = d.flags;
      return [h('div', { class: 'sx-stats' }, stat('Python', d.python), stat('Django', d.django), stat('Uptime', Math.round(d.uptimeSeconds / 3600) + ' h'), stat('Database', `${d.db} ${d.dbBytes != null ? bytes(d.dbBytes) : ''}`), stat('Media', bytes(d.mediaBytes))),
        grid(card('Flags', table(['Setting', 'Value'], Object.entries(f).map(([k, v]) => [k, String(v)]))),
          card('Background jobs (run opportunistically, no cron)', table(['Job', 'State'], [['Mail queue', `${d.jobs.mailQueued} queued, ${d.jobs.mailFailed} failed`], ['Last mail flush', d.jobs.lastMailFlush ? ago(d.jobs.lastMailFlush) : 'never'], ['Last trash cleanup', d.jobs.lastTrashCleanup ? ago(d.jobs.lastTrashCleanup) : 'never']]), h('p', {}, d.jobs.note))),
        card('Table row counts', table(['Table', 'Rows'], Object.entries(d.tables).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)])))];
    },

    async data() {
      const t = await S('/data');
      const tableSel = h('select', { 'aria-label': 'Table' }, t.tables.map((x) => h('option', { value: x.name }, `${x.name} (${x.count})`)));
      const [lq, q] = field('Search', { type: 'search' });
      const out = h('div', {}); let page = 0;
      const load = async () => {
        const d = await S(`/data/${tableSel.value}?page=${page}&q=${encodeURIComponent(q.value)}`);
        const cols = d.rows[0] ? Object.keys(d.rows[0]) : [];
        out.replaceChildren(table(cols, d.rows.map((r) => cols.map((c) => (typeof r[c] === 'boolean' ? (r[c] ? 'yes' : 'no') : r[c])))),
          h('div', { class: 'sx-row' }, btn('Previous', () => { page = Math.max(0, page - 1); return load(); }), h('span', {}, `${d.total ? d.page * d.pageSize + 1 : 0}-${Math.min(d.total, (d.page + 1) * d.pageSize)} of ${d.total}`), btn('Next', () => { if ((page + 1) * d.pageSize < d.total) page++; return load(); })));
      };
      tableSel.addEventListener('change', () => { page = 0; load(); });
      q.addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(() => { page = 0; load().catch((e) => toast(errText(e))); }, 250); });
      await load();
      return [h('p', {}, 'Read-only. Password hashes, tokens and e-mail bodies are never shown; end-to-end encrypted note content is not readable.'), h('div', { class: 'sx-row' }, tableSel, h('div', { class: 'sx-grow' }, lq)), out];
    },

    async audit() {
      const [lq, q] = field('Search', { type: 'search' });
      const ev = h('select', { 'aria-label': 'Event' }, ['', 'login', 'login_failed', 'register', 'admin.', 'role.', 'share.', 'public.', 'trash.', 'data.', 'mail.'].map((v) => h('option', { value: v }, v || 'All events')));
      const out = h('div', {}), params = () => `q=${encodeURIComponent(q.value)}&event=${encodeURIComponent(ev.value)}&since=${days}&limit=500`;
      const load = async () => { const d = await sync.apiCall('/api/admin/audit?' + params()); out.replaceChildren(table(['When', 'Event', 'Who', 'Detail', 'IP'], d.events.map((e) => [new Date(e.at).toLocaleString(), e.event, e.user || e.actor || '-', e.detail, e.ip]))); };
      [q, ev].forEach((x) => x.addEventListener('input', () => { clearTimeout(load.t); load.t = setTimeout(() => load().catch(() => {}), 250); }));
      const csv = async () => { const a = await sync.getAuth(); const r = await fetch((a.serverUrl || '') + '/api/admin/audit?format=csv&limit=5000&' + params(), { headers: { Authorization: 'Bearer ' + a.token } }); const u = URL.createObjectURL(await r.blob()); h('a', { href: u, download: 'inkwell-audit.csv' }).click(); setTimeout(() => URL.revokeObjectURL(u), 5000); };
      await load();
      return [h('div', { class: 'sx-row' }, h('div', { class: 'sx-grow' }, lq), ev, btn('Export CSV', csv)), out];
    },
  };

  async function tabs(t, quiet = false) {
    tab = t; sessionStorage.setItem('sys-tab', t);
    nav.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === t)));
    const my = ++seq;
    if (!quiet) content.replaceChildren(h('p', {}, 'Loading...'));
    try { const k = [].concat(await views[t]()); if (my === seq) content.replaceChildren(...k.filter(Boolean)); }
    catch (e) { if (!quiet) content.replaceChildren(h('div', { class: 'sx-err', role: 'alert' }, e.status === 403 ? 'You do not have permission for this section.' : errText(e))); }
  }
  const nav = h('div', { class: 'sx-tabs', role: 'tablist' }, TABS.map(([k, l]) => h('button', { type: 'button', role: 'tab', 'data-t': k, 'aria-selected': String(k === tab), onclick: () => tabs(k) }, l)));
  const range = h('select', { 'aria-label': 'Date range', onchange: (e) => { days = +e.target.value; sessionStorage.setItem('sys-days', days); tabs(tab); } }, [7, 30, 90, 180, 365].map((d) => h('option', { value: d, selected: d === days }, `Last ${d} days`)));
  const auto = h('input', { type: 'checkbox', onchange: (e) => { clearInterval(timer); if (e.target.checked) timer = setInterval(() => { if (document.visibilityState === 'visible' && tab !== 'data') tabs(tab, true); }, 30000); } });
  root.append(h('div', { class: 'sx-row', style: { justifyContent: 'space-between' } }, h('h2', {}, 'System'), h('div', { class: 'sx-row' }, range, h('label', { style: { flexDirection: 'row', display: 'flex', gap: '6px', alignItems: 'center' } }, auto, 'Auto-refresh'), h('button', { class: 'sx-btn sm', onclick: () => navigate('/') }, 'Back'))), nav, content);
  tabs(tab);
  return { destroy() { clearInterval(timer); root.remove(); } };
}
export default mountSystem;
export const mount = mountSystem;
