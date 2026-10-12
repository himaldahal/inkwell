import { h, icon, iconBtn, confirmDialog, plural } from './dom.js';
import { getAll, getAllRaw } from '../core/db.js';
import { toast } from '../core/store.js';
import { getSettings, updateSettings } from '../core/settings.js';
import { TEMPLATES, PAPER_COLORS, ACCENTS } from './templates.js';
import { paperEl, shortcutsDialog } from './dialogs.js';
import { createInstallButton } from './install.js';
import { createSyncPill } from './syncStatus.js';
import { appLockEnabled, setAppLock } from './lock.js';
import { mountSyncSettings } from './syncSettings.js';

const fmtBytes = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB');

export function mountSettings(container) {
  const s = () => getSettings();
  const set = (patch) => updateSettings(patch).then(paint);
  const seg = (opts, val, onPick, label) => h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, opts.map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(val === k), class: val === k ? 'on' : '', onclick: () => onPick(k) }, l)));
  const row = (label, hint, ctl) => h('div', { class: 'set-row' }, h('div', { class: 'set-lab' }, h('b', {}, label), hint && h('small', {}, hint)), h('div', { class: 'set-ctl' }, ctl));
  const card = (title, ...kids) => h('section', { class: 'set-card' }, h('h2', {}, title), ...kids);
  const storage = h('div', { class: 'storage', 'aria-live': 'polite' }, 'Calculating...');
  const syncMount = h('div', { class: 'sync-mount' });
  let mounted = false;

  async function calcStorage() {
    try {
      const [n, nb, a] = await Promise.all([getAll('notes'), getAll('notebooks'), getAll('assets')]);
      const est = await navigator.storage?.estimate?.();
      const assetBytes = a.reduce((t, x) => t + (x.size || 0), 0);
      const pct = est?.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0;
      storage.replaceChildren(
        est ? h('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': Math.round(pct), 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Storage used' }, h('i', { style: { width: Math.max(2, pct) + '%' } })) : null,
        h('p', {}, est ? `${fmtBytes(est.usage)} used of ${fmtBytes(est.quota)} available` : 'Usage unavailable in this browser'),
        h('p', { class: 'hint' }, `${plural(n.length, 'note')}, ${plural(nb.length, 'notebook')}, ${plural(a.length, 'attachment')} (${fmtBytes(assetBytes)})`));
    } catch { storage.textContent = 'Could not read storage.'; }
  }
  const el = h('div', { class: 'settings' });
  async function paint() {
    const st = s();
    const persistBtn = h('button', { class: 'btn', type: 'button', onclick: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Storage will not be cleared automatically' : 'The browser declined persistent storage'); } }, 'Keep my data safe');
    const importIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const m = await import('../features/export.js');
        let r;
        try { r = await m.importBackup(f); } catch (err) {
          if (err.code === 'PASSPHRASE_REQUIRED') { const { promptDialog } = await import('./dom.js'); const pw = await promptDialog({ title: 'Encrypted backup', label: 'Passphrase', type: 'password', confirmLabel: 'Import' }); if (!pw) return; r = await m.importBackup(f, { passphrase: pw }); } else throw err;
        }
        toast(`Imported ${plural(r.notes, 'note')}, ${plural(r.notebooks, 'notebook')}`);
        calcStorage();
      } catch (err) { toast(err?.message || 'Import is not available', { type: 'error' }); }
      e.target.value = '';
    } });
    const penColor = h('input', { type: 'color', value: st.pen.color, 'aria-label': 'Default pen color', onchange: (e) => updateSettings({ pen: { ...st.pen, color: e.target.value } }) });
    const penSize = h('input', { type: 'range', min: 1, max: 12, step: 0.5, value: st.pen.size, 'aria-label': 'Default pen size', oninput: (e) => { out.textContent = e.target.value; }, onchange: (e) => updateSettings({ pen: { ...s().pen, size: +e.target.value } }) });
    const out = h('output', {}, String(st.pen.size));
    const accentCustom = h('input', { type: 'color', value: st.accent, 'aria-label': 'Custom accent color', onchange: (e) => set({ accent: e.target.value }) });
    el.replaceChildren(
      card('Appearance',
        row('Theme', null, seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['sepia', 'Sepia']], st.theme, (k) => set({ theme: k }), 'Theme')),
        row('Accent color', null, h('div', { class: 'swatches' }, ACCENTS.map((c) => h('button', { type: 'button', class: 'swatch' + (st.accent === c ? ' sel' : ''), style: { background: c }, 'aria-label': 'Accent ' + c, 'aria-pressed': String(st.accent === c), onclick: () => set({ accent: c }) }, st.accent === c ? icon('check', 14) : null)), accentCustom)),
        row('Paper tone', 'Background warmth', seg([['warm', 'Warm'], ['neutral', 'Neutral'], ['cool', 'Cool']], st.paperTone, (k) => set({ paperTone: k }), 'Paper tone')),
        row('Text size', null, seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], st.fontSize, (k) => set({ fontSize: k }), 'Text size')),
        row('Reduce motion', 'Turn off animations', h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.reducedMotion, onchange: (e) => set({ reducedMotion: e.target.checked }) }), h('span', {}))),
        row('High contrast', 'Stronger borders and text', h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.highContrast, onchange: (e) => set({ highContrast: e.target.checked }) }), h('span', {})))),
      card('New notes',
        row('Default page style', null, h('div', { class: 'tpl-grid compact' }, TEMPLATES.map((t) => h('button', { type: 'button', class: 'tpl' + (st.defaultTemplate === t.id ? ' sel' : ''), 'aria-pressed': String(st.defaultTemplate === t.id), onclick: () => set({ defaultTemplate: t.id }) }, paperEl(t.id, st.defaultPaper), h('span', {}, t.label))))),
        row('Default paper', null, h('div', { class: 'swatches' }, PAPER_COLORS.map((c) => h('button', { type: 'button', class: 'swatch' + (st.defaultPaper === c.v ? ' sel' : ''), style: { background: c.v || '#fff' }, title: c.label, 'aria-label': c.label, 'aria-pressed': String(st.defaultPaper === c.v), onclick: () => set({ defaultPaper: c.v }) }, st.defaultPaper === c.v ? icon('check', 14) : null)))),
        row('Library view', null, seg([['grid', 'Grid'], ['list', 'List']], st.view, (k) => set({ view: k }), 'Library view'))),
      card('Pen defaults',
        row('Tool', null, seg([['pen', 'Pen'], ['pencil', 'Pencil'], ['highlighter', 'Highlighter']], st.pen.tool, (k) => updateSettings({ pen: { ...st.pen, tool: k } }).then(paint), 'Default tool')),
        row('Color', null, penColor), row('Size', null, h('div', { class: 'range' }, penSize, out))),
      card('Privacy', row('App passcode', 'Ask for a passcode when Inkwell opens or returns from the background', h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: appLockEnabled(), onchange: async (e) => { const ok = await setAppLock(e.target.checked); if (!ok) e.target.checked = !e.target.checked; } }), h('span', {}))),
        h('p', { class: 'hint' }, 'Individual notes can be locked from their menu.')),
      card('Storage', storage, h('div', { class: 'btn-row' }, persistBtn)),
      card('Sync', syncMount),
      card('Your data',
        h('p', { class: 'hint' }, 'Back up everything (notes, notebooks, attachments) to a single file, or restore from one.'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn', type: 'button', onclick: async () => { try { const m = await import('../features/export.js'); await m.exportAll(); toast('Backup downloaded'); } catch (e) { console.error(e); toast('Backup is not available right now', { type: 'error' }); } } }, icon('download', 18), 'Export everything'),
          h('button', { class: 'btn', type: 'button', onclick: () => importIn.click() }, icon('upload', 18), 'Import backup'), importIn)),
      card('App', h('div', { class: 'btn-row' }, createInstallButton(), h('button', { class: 'btn', type: 'button', onclick: shortcutsDialog }, icon('keyboard', 18), 'Keyboard shortcuts')),
        h('p', { class: 'hint' }, 'Inkwell keeps everything on your device first, so it works without a connection.')));
    calcStorage();
    if (!mounted) { mounted = true; try { mountSyncSettings(syncMount); } catch (e) { syncMount.textContent = 'Sync settings are unavailable.'; console.error(e); } }
  }
  container.replaceChildren(h('header', { class: 'lib-head settings-head' }, h('a', { class: 'icon-btn back-btn', href: '#/', 'aria-label': 'Back to library' }, icon('back', 20)), h('div', { class: 'lib-titles' }, h('h1', { class: 'lib-title' }, 'Settings')), createSyncPill()), h('div', { class: 'settings-body' }, el));
  paint();
  return { destroy() { container.replaceChildren(); } };
}
