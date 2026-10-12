import { h, icon, confirmDialog, plural, overlayRoot } from './dom.js';
import { getAll, getDB } from '../core/db.js';
import { toast, on } from '../core/store.js';
import { getSettings, getSetting, setSetting, resetSettings, DEFAULTS } from '../core/settings.js';
import { paperEl, shortcutsDialog } from './dialogs.js';
import { createInstallButton } from './install.js';
import { createSyncPill } from './syncStatus.js';
import { appLockEnabled, setAppLock } from './lock.js';
import { mountSyncSettings } from './syncSettings.js';
import { getConfig } from './config.js';
import { SECTIONS, RESETTABLE, SHORTCUT_DEFAULTS, SHORTCUT_LABELS, comboOf, prettyCombo } from './settingsSchema.js';
import { getNotebooks } from './actions.js';

const fmtBytes = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');
const VERSION = '0.1.0';

export function mountSettings(container) {
  const syncMount = h('div', { class: 'sync-mount' });
  let mounted = false, query = '', notebooks = [];
  const el = h('div', { class: 'set-main' });
  const nav = h('nav', { class: 'set-nav', 'aria-label': 'Settings sections' });
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); paint(); });
  const set = (k, v) => setSetting(k, v);

  // ----- controls (instant apply; each control repaints itself) -----
  function control(it) {
    const val = getSetting(it.key);
    const wrap = h('div', { class: 'set-ctl' });
    const put = (v) => { set(it.key, v); paintCtl(); };
    const paintCtl = () => wrap.replaceChildren(build(it, getSetting(it.key), put));
    paintCtl(); return wrap;
  }
  function build(it, val, put) {
    switch (it.type) {
      case 'seg': return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': it.label }, it.options.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(val === k), class: val === k ? 'on' : '', onclick: () => put(k) }, l)));
      case 'switch': return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: !!val, 'aria-label': it.label, onchange: (e) => put(e.target.checked) }), h('span', {}));
      case 'range': { const out = h('output', {}, val + (it.unit || '')); return h('div', { class: 'range' }, h('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: val, 'aria-label': it.label, oninput: (e) => { out.textContent = e.target.value + (it.unit || ''); }, onchange: (e) => set(it.key, +e.target.value) }), out); }
      case 'color': return h('input', { type: 'color', value: val || '#000000', 'aria-label': it.label, onchange: (e) => set(it.key, e.target.value) });
      case 'select': {
        const sel = h('select', { class: 'input', 'aria-label': it.label, onchange: (e) => { const raw = e.target.value; const m = it.options?.find(([k]) => String(k) === raw); put(it.async === 'notebooks' ? (raw || null) : m && typeof m[0] === 'number' ? +raw : raw); } });
        const fill = (opts) => { sel.replaceChildren(...opts.map(([k, l]) => h('option', { value: k ?? '', selected: String(k ?? '') === String(val ?? '') }, l))); };
        if (it.async === 'notebooks') fill([[null, 'Library (none)'], ...notebooks.map((n) => [n.id, (n.icon || '') + ' ' + n.name])]);
        else if (it.async === 'voices') { const f = () => fill([['', 'System default'], ...(typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().map((v) => [v.name, `${v.name} (${v.lang})`]) : [])]); f(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = f; }
        else fill(it.options);
        return sel;
      }
      case 'accent': return h('div', { class: 'swatches' }, it.options.map((c) => h('button', { type: 'button', class: 'swatch' + (val === c ? ' sel' : ''), style: { background: c }, 'aria-label': 'Accent ' + c, 'aria-pressed': String(val === c), onclick: () => put(c) }, val === c ? icon('check', 14) : null)), h('input', { type: 'color', value: val, 'aria-label': 'Custom accent', onchange: (e) => put(e.target.value) }));
      case 'paper': return h('div', { class: 'swatches' }, it.options.map((c) => h('button', { type: 'button', class: 'swatch' + (val === c.v ? ' sel' : ''), style: { background: c.v || '#fff' }, title: c.label, 'aria-label': c.label, 'aria-pressed': String(val === c.v), onclick: () => put(c.v) }, val === c.v ? icon('check', 14) : null)));
      default: return h('span', {});
    }
  }
  const row = (label, hint, ctl) => h('div', { class: 'set-row', 'data-s': (label + ' ' + (hint || '')).toLowerCase() }, h('div', { class: 'set-lab' }, h('b', {}, label), hint && h('small', {}, hint)), ctl);
  const btn = (label, fn, cls = '', ic) => h('button', { class: 'btn ' + cls, type: 'button', onclick: fn }, ic ? icon(ic, 18) : null, label);

  // ----- custom blocks -----
  async function storageBlock() {
    const box = h('div', { class: 'storage', 'data-s': 'storage usage cache offline' }, 'Calculating...');
    try {
      const [n, nb, a] = await Promise.all([getAll('notes'), getAll('notebooks'), getAll('assets')]);
      const est = await navigator.storage?.estimate?.();
      const by = (k) => a.filter((x) => x.kind === k).reduce((t, x) => t + (x.size || 0), 0);
      const pct = est?.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
      box.replaceChildren(est ? h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-label': 'Storage used' }, h('i', { style: { width: Math.max(2, pct) + '%' } })) : null,
        h('p', {}, est ? `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)}` : 'Usage unavailable'),
        h('p', { class: 'hint' }, `${plural(n.length, 'note')}, ${plural(nb.length, 'notebook')} - images ${fmtBytes(by('image'))}, PDFs ${fmtBytes(by('pdf'))}, audio ${fmtBytes(by('audio'))}`),
        h('div', { class: 'btn-row' }, btn('Keep my data safe', async () => toast((await navigator.storage?.persist?.()) ? 'Storage will not be cleared automatically' : 'The browser declined persistent storage')), btn('Clear caches', clearCaches)));
    } catch { box.textContent = 'Could not read storage.'; }
    return box;
  }
  async function clearCaches() {
    try { for (const k of await caches.keys()) if (!/precache/i.test(k)) await caches.delete(k); sessionStorage.clear(); toast('Caches cleared'); } catch { toast('Nothing to clear'); }
  }
  function offlineBlock() {
    const on_ = getSetting('offlineNotebooks') || {};
    return h('div', { 'data-s': 'offline availability notebooks' }, h('p', { class: 'hint' }, 'Keep these notebooks available offline (used by sync when it ships selective download).'),
      notebooks.length ? notebooks.map((n) => row((n.icon || '') + ' ' + n.name, null, h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: on_[n.id] !== false, onchange: (e) => set('offlineNotebooks', { ...(getSetting('offlineNotebooks') || {}), [n.id]: e.target.checked }) }), h('span', {})))) : h('p', { class: 'hint' }, 'No notebooks yet.'));
  }
  function shortcutsBlock() {
    const box = h('div', { 'data-s': 'shortcuts keyboard keys' });
    const paint = () => box.replaceChildren(...Object.keys(SHORTCUT_DEFAULTS).map((id) => {
      const cur = (getSetting('shortcuts') || {})[id] || SHORTCUT_DEFAULTS[id];
      const b = h('button', { class: 'btn kbtn', type: 'button' }, prettyCombo(cur));
      b.addEventListener('click', () => {
        b.textContent = 'Press keys...';
        const on_ = (e) => { e.preventDefault(); e.stopPropagation(); if (['Control', 'Meta', 'Shift', 'Alt'].includes(e.key)) return; document.removeEventListener('keydown', on_, true); if (e.key !== 'Escape') { const c = comboOf(e); if (!c.startsWith('mod') && !c.startsWith('alt')) { toast('Use Ctrl/Cmd or Alt in the combo', { type: 'error' }); } else set('shortcuts', { ...(getSetting('shortcuts') || {}), [id]: c }); } paint(); };
        document.addEventListener('keydown', on_, true);
      });
      return row(SHORTCUT_LABELS[id], null, h('div', { class: 'set-ctl' }, b));
    }), h('div', { class: 'btn-row' }, btn('Show all shortcuts', shortcutsDialog), btn('Restore defaults', () => { set('shortcuts', {}); paint(); })));
    paint(); return box;
  }
  async function devicesBlock() {
    const box = h('div', { 'data-s': 'devices signed in' }, h('b', {}, 'Signed-in devices'));
    try {
      const m = await import('../core/sync.js'); const list = await m.listDevices();
      box.append(...list.map((d) => h('div', { class: 'set-row' }, h('div', { class: 'set-lab' }, h('b', {}, d.name || 'Device'), h('small', {}, d.current ? 'This device' : (d.lastSeen || ''))), d.current ? null : btn('Sign out', async () => { await m.revokeDevice(d.id); toast('Device signed out'); paint(); }, 'sm'))));
      if (!list.length) box.append(h('p', { class: 'hint' }, 'No other devices.'));
    } catch { box.append(h('p', { class: 'hint' }, 'Sign in under Sync to manage devices.')); }
    return box;
  }
  function aboutBlock() {
    const info = h('pre', { class: 'dev-info' }, getSetting('devMode') ? `Inkwell ${VERSION}\n${navigator.userAgent}\nonline: ${navigator.onLine}\nstandalone: ${matchMedia('(display-mode: standalone)').matches}\nservice worker: ${navigator.serviceWorker?.controller ? 'active' : 'none'}` : '');
    return h('div', { 'data-s': 'about version developer' }, row('Inkwell', `Version ${VERSION}. Notes live on your device first and sync when you are online.`, createInstallButton()), info);
  }
  function resetBlock() {
    return h('div', { 'data-s': 'reset app danger' }, row('Reset settings', 'Restore every preference to its default', btn('Reset all', async () => { if (await confirmDialog({ title: 'Reset all settings?', message: 'Your notes are not affected.', confirmLabel: 'Reset', danger: true })) { await resetSettings(Object.keys(DEFAULTS)); paint(); } })),
      row('Erase local data', 'Delete every note and setting on this device. Synced notes can be downloaded again.', btn('Erase everything', async () => {
        if (!(await confirmDialog({ title: 'Erase all local data?', message: 'This removes all notes, attachments and settings from this device.', confirmLabel: 'Erase', danger: true }))) return;
        try { (await getDB()).close(); } catch { /* ignore */ }
        await new Promise((r) => { const q = indexedDB.deleteDatabase('inkwell'); q.onsuccess = q.onerror = q.onblocked = r; });
        localStorage.clear(); try { for (const k of await caches.keys()) await caches.delete(k); } catch { /* ignore */ }
        location.hash = '#/'; location.reload();
      }, 'danger')));
  }

  async function item(it) {
    switch (it.type) {
      case 'info': return row(it.label, it.text, h('span', {}));
      case 'sync': { if (!mounted) { mounted = true; try { mountSyncSettings(syncMount); } catch (e) { syncMount.textContent = 'Sync settings are unavailable.'; } } syncMount.dataset.s = 'sync account sign in server'; return syncMount; }
      case 'applock': return row('App passcode', 'Ask for a passcode when Inkwell opens or returns from the background', h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: appLockEnabled(), onchange: async (e) => { if (!(await setAppLock(e.target.checked))) e.target.checked = !e.target.checked; } }), h('span', {})));
      case 'clearcache': return row('Local cache', 'Remove cached files (notes are kept)', btn('Clear cache', clearCaches, 'sm'));
      case 'devices': return devicesBlock();
      case 'storage': return storageBlock();
      case 'offline': return offlineBlock();
      case 'shortcuts': return shortcutsBlock();
      case 'about': return aboutBlock();
      case 'reset': return resetBlock();
      default:
        if (it.commercial && getConfig().mode !== 'commercial') return null;
        return row(it.label, it.hint, control(it));
    }
  }
  async function paint() {
    notebooks = await getNotebooks();
    const frag = [];
    nav.replaceChildren(...SECTIONS.map((s) => h('a', { class: 'set-link', href: '#/settings', onclick: (e) => { e.preventDefault(); search.value = ''; query = ''; paint().then(() => el.querySelector('#set-' + s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })); } }, icon(s.icon, 18), h('span', {}, s.title))));
    for (const s of SECTIONS) {
      const nodes = (await Promise.all(s.items.map(item))).filter(Boolean);
      const match = (n) => !query || s.title.toLowerCase().includes(query) || (n.dataset?.s || n.textContent || '').toLowerCase().includes(query);
      const shown = nodes.filter(match);
      if (!shown.length) continue;
      const resettable = RESETTABLE(s);
      frag.push(h('section', { class: 'set-card', id: 'set-' + s.id }, h('h2', {}, s.title, resettable.length ? h('button', { class: 'reset', type: 'button', onclick: async () => { await resetSettings(resettable); paint(); toast(s.title + ' reset'); } }, 'Reset') : null), ...shown));
    }
    el.replaceChildren(search, ...(frag.length ? frag : [h('p', { class: 'hint' }, 'No settings match your search.')]));
  }
  container.replaceChildren(h('header', { class: 'lib-head settings-head' }, h('a', { class: 'icon-btn back-btn', href: '#/', 'aria-label': 'Back to library' }, icon('back', 20)), h('div', { class: 'lib-titles' }, h('h1', { class: 'lib-title' }, 'Settings')), createSyncPill()), h('div', { class: 'set-layout' }, nav, el));
  search.classList.add('set-search');
  paint();
  return { destroy() { container.replaceChildren(); } };
}
