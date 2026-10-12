import './styles/main.css';
import './styles/tokens.css';
import { h, icon, initToasts, isNarrow, openModal, promptDialog } from './ui/dom.js';
import { on, emit, toast } from './core/store.js';
import { startRouter, navigate, current } from './core/router.js';
import { loadSettings, getSettings, updateSettings } from './core/settings.js';
import { getMeta, setMeta, getAll } from './core/db.js';
import { createSidebar } from './ui/sidebar.js';
import { createLibrary } from './ui/library.js';
import { mountNotePage } from './ui/notePage.js';
import { setCommands, openPalette } from './ui/palette.js';
import { newNoteDialog, notebookDialog, quickNote, shortcutsDialog } from './ui/dialogs.js';
import { initInstallPrompt, canInstall, promptInstall } from './ui/install.js';
import { initAppLock } from './ui/lock.js';
import * as A from './ui/actions.js';
import { SHORTCUT_DEFAULTS, comboOf } from './ui/settingsSchema.js';
import { loadUi, loadConfig, loadAccount } from './ui/config.js';
import { isEnabled, onModuleChange } from './core/modules.js';

const LIB_ROUTES = new Set(['shared', 'all', 'favorites', 'recent', 'archive', 'trash', 'notebook', 'tag', 'smart', 'search']);

async function boot() {
  initInstallPrompt();
  await loadSettings();
  initToasts();

  const sidebar = createSidebar();
  const library = createLibrary();
  const libPage = h('div', { class: 'page page-lib' }, library.el);
  const setPage = h('div', { class: 'page page-settings', hidden: true });
  const main = h('main', { class: 'main', id: 'main' }, libPage, setPage);
  const tab = (path, ic, label, key) => h('a', { class: 'tab', href: '#' + path, 'data-tab': key }, icon(ic, 22), h('span', {}, label));
  const tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Primary' }, tab('/', 'file', 'Notes', 'notes'), tab('/browse', 'folder', 'Notebooks', 'browse'), tab('/search', 'search', 'Search', 'search'), tab('/settings', 'settings', 'Settings', 'settings'));
  const offline = h('div', { class: 'offline-banner', role: 'status', hidden: navigator.onLine }, icon('wifioff', 16), "Offline - changes saved on device, will sync when you're back online");
  const authScreen = h('div', { class: 'auth-screen', hidden: true });
  const noteScreen = h('div', { class: 'note-screen', hidden: true });
  const dropOv = h('div', { class: 'drop-ov', hidden: true }, h('div', {}, icon('upload', 36), h('b', {}, 'Drop to import'), h('span', {}, 'PDFs, images, Markdown and text become new notes')));
  const announcer = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  const skip = h('a', { class: 'skip', href: '#main', onclick: (e) => { e.preventDefault(); main.focus(); } }, 'Skip to content');
  main.tabIndex = -1;
  const app = h('div', { class: 'app' }, sidebar.el, main, tabbar);
  const adminPage = h('div', { class: 'page page-admin', hidden: true });
  const studyPage = h('div', { class: 'page page-study', hidden: true });
  main.append(adminPage, studyPage);
  let studyInst = null;
  document.getElementById('app').replaceChildren(skip, offline, app, authScreen, noteScreen, dropOv, announcer);

  // ----- routing -----
  let notePage = null, noteId = null, settingsMounted = null;
  async function apply(r) {
    const inNote = r.name === 'note';
    const inAuth = r.name === 'auth' || r.name === 'sharedview';
    authScreen.hidden = !inAuth;
    app.hidden = inAuth;
    if (inAuth) {
      noteScreen.hidden = true;
      const view = r.name === 'sharedview';
      const m = await loadUi(view ? 'shareView' : 'auth');
      const fn = m && (view ? (m.mountShareView || m.mountShared || m.mount) : (m.mountAuth || m.mount)) || m?.default;
      authScreen.replaceChildren();
      if (fn) fn(authScreen, { sub: r.params.sub, rest: r.params.rest, token: r.params.token, query: r.query, navigate });
      else authScreen.append(h('div', { class: 'note-state' }, h('h3', {}, 'This page is not available yet'), h('a', { class: 'btn', href: '#/' }, 'Back to library')));
      return;
    }
    document.documentElement.classList.toggle('in-note', inNote);
    app.inert = inNote;
    app.classList.toggle('browse', r.name === 'browse');
    document.documentElement.classList.remove('zen-pending');
    if (r.name === 'browse' && !isNarrow()) return navigate('/', { replace: true });
    if (inNote) {
      noteScreen.hidden = false;
      if (noteId !== r.params.id) { notePage?.destroy(); noteId = r.params.id; notePage = mountNotePage(noteScreen, noteId); }
    } else {
      noteScreen.hidden = true;
      if (notePage) { notePage.destroy(); notePage = null; noteId = null; }
    }
    const lib = LIB_ROUTES.has(r.name);
    libPage.hidden = !(lib || inNote || r.name === 'browse');
    setPage.hidden = r.name !== 'settings';
    adminPage.hidden = r.name !== 'admin';
    studyPage.hidden = r.name !== 'study';
    if (r.name === 'study') {
      libPage.hidden = true;
      if (!isEnabled('study')) { toast('Turn on the CA Study Hub under Settings > Modules'); return navigate('/settings', { replace: true }); }
      if (!studyInst) studyInst = (async () => (await import('./study/index.js')).mountStudy(studyPage))();
    }
    if (r.name === 'admin') {
      libPage.hidden = true; adminPage.replaceChildren();
      const m = await loadUi('admin'); const fn = m && (m.mountAdmin || m.mount || m.default);
      if (fn) fn(adminPage, { navigate }); else adminPage.append(h('div', { class: 'note-state' }, h('h3', {}, 'Admin is not available')));
    }
    if (lib) library.show(r);
    if (r.name === 'settings' && !settingsMounted) {
      const m = await import('./ui/settingsPage.js');
      settingsMounted = m.mountSettings(setPage);
    }
    const key = r.name === 'settings' ? 'settings' : r.name === 'browse' ? 'browse' : r.name === 'search' ? 'search' : 'notes';
    tabbar.querySelectorAll('.tab').forEach((t) => { const on_ = t.dataset.tab === key; t.classList.toggle('active', on_); on_ ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'); });
    const label = { settings: 'Settings', browse: 'Notebooks', note: 'Note' }[r.name] || 'Library';
    announcer.textContent = label;
    try {
      if (r.name !== 'auth' && r.name !== 'sharedview') localStorage.setItem('inkwell:last', location.hash);
      if (inNote) { const o = JSON.parse(localStorage.getItem('inkwell:opened') || '[]').filter((i) => i !== r.params.id); o.unshift(r.params.id); localStorage.setItem('inkwell:opened', JSON.stringify(o.slice(0, 12))); }
    } catch { /* storage unavailable */ }
    if (!inNote) document.querySelectorAll('.thumb').forEach((t) => t.style.removeProperty('view-transition-name'));
    if (!inNote) document.title = (label === 'Library' ? 'Inkwell' : label + ' - Inkwell');
  }
  on('route:changed', (r) => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || getSettings().reducedMotion;
    if (document.startViewTransition && !reduce && !document.querySelector('.backdrop')) {
      try { document.startViewTransition(() => apply(r)); return; } catch { /* fall through */ }
    }
    apply(r);
  });

  onModuleChange((id, on_) => { if (id === 'study' && !on_) { studyInst?.then((i) => i.destroy()); studyInst = null; if (current().name === 'study') navigate('/'); } });

  // ----- online/offline -----
  const net = () => { offline.hidden = navigator.onLine; };
  addEventListener('offline', net);
  addEventListener('online', () => { net(); toast('Back online'); });

  // ----- commands & shortcuts -----
  const zen = () => document.documentElement.classList.toggle('zen');
  const themeCycle = () => { const o = ['system', 'light', 'dark', 'sepia']; const t = o[(o.indexOf(getSettings().theme) + 1) % o.length]; updateSettings({ theme: t }); toast('Theme: ' + t); };
  const daily = async () => { const n = await A.openDailyNote(); navigate('/note/' + encodeURIComponent(n.id)); };
  setCommands(() => [
    { label: 'New note', ic: 'plus', hint: 'Ctrl N', run: () => newNoteDialog() },
    { label: 'Quick note (blank, no dialog)', ic: 'zap', run: () => quickNote() },
    { label: "Open today's daily note", ic: 'calendar', hint: 'Ctrl D', run: daily },
    { label: 'New notebook', ic: 'folder', hint: 'Ctrl Shift N', run: () => notebookDialog() },
    { label: 'Go to All notes', ic: 'file', run: () => navigate('/') },
    { label: 'Go to Favorites', ic: 'star', run: () => navigate('/favorites') },
    { label: 'Go to Recent', ic: 'clock', run: () => navigate('/recent') },
    { label: 'Go to Archive', ic: 'archive', run: () => navigate('/archive') },
    { label: 'Go to Trash', ic: 'trash', run: () => navigate('/trash') },
    isEnabled('study') && { label: 'CA Study Hub', ic: 'book', run: () => navigate('/study') },
    { label: 'Open settings', ic: 'settings', run: () => navigate('/settings') },
    { label: 'Toggle sidebar', ic: 'sidebar', hint: 'Ctrl \\', run: toggleSidebar },
    { label: 'Toggle focus (zen) mode', ic: 'focus', hint: 'Ctrl Shift F', run: zen },
    { label: 'Switch theme', ic: 'sun', run: themeCycle },
    { label: 'Switch to grid or list view', ic: 'grid', run: () => updateSettings({ view: getSettings().view === 'grid' ? 'list' : 'grid' }) },
    { label: 'Keyboard shortcuts', ic: 'keyboard', hint: '?', run: shortcutsDialog },
    canInstall() && { label: 'Install app', ic: 'download', run: promptInstall },
  ].filter(Boolean));
  function toggleSidebar() {
    if (isNarrow()) return navigate(current().name === 'browse' ? '/' : '/browse');
    updateSettings({ sidebarCollapsed: !getSettings().sidebarCollapsed }).then(sidebar.applyCollapsed);
  }
  const combo0 = comboOf;
  const typing = (t) => t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (document.querySelector('.backdrop, .menu-backdrop') && combo0(e) !== (({ ...SHORTCUT_DEFAULTS, ...(getSettings().shortcuts || {}) }).palette)) return;
    const inNote = current().name === 'note';
    const combo = comboOf(e), sc = { ...SHORTCUT_DEFAULTS, ...(getSettings().shortcuts || {}) };
    const is = (id) => combo === sc[id];
    if (is('palette')) { e.preventDefault(); if (document.querySelector('.pal-in')) return; openPalette(); return; }
    if (inNote) return;
    if (is('new')) { e.preventDefault(); newNoteDialog({ notebookId: current().name === 'notebook' ? current().params.id : null }); }
    else if (is('notebook')) { e.preventDefault(); notebookDialog(); }
    else if (is('daily')) { e.preventDefault(); daily(); }
    else if (is('sidebar')) { e.preventDefault(); toggleSidebar(); }
    else if (is('zen')) { e.preventDefault(); zen(); }
    else if (typing(e.target)) return;
    else if (e.key === '/' && !mod) { e.preventDefault(); if (!LIB_ROUTES.has(current().name)) navigate('/'); library.focusSearch(); }
    else if (e.key === '?') { e.preventDefault(); shortcutsDialog(); }
    else if (mod && k === 'a' && library.isSelecting()) { e.preventDefault(); library.selectAll(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && library.isSelecting()) { e.preventDefault(); library.trashSelected(); }
    else if (e.key === 'Escape') { if (document.documentElement.classList.contains('zen')) zen(); else if (library.isSelecting()) library.clearSelection(); }
    else if (e.key === 'Enter' && !document.activeElement?.closest?.('.card, button, a') && library.hasPreview) library.openFocused();
  });

  // ----- file drop import -----
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; dropOv.hidden = false; } });
  addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; dropOv.hidden = true; } });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; dropOv.hidden = true;
    if (current().name === 'note') return;
    toast('Importing...');
    try {
      const m = await import('./features/import.js');
      const { ids, failed } = await m.importFiles(e.dataTransfer.files);
      if (failed.length) toast(`${failed.length} file${failed.length > 1 ? 's' : ''} could not be imported`, { type: 'error' });
      if (ids.length === 1) navigate('/note/' + encodeURIComponent(ids[0]));
      else if (ids.length) toast(`Imported ${ids.length} notes`);
    } catch (err) { console.error(err); toast('Import failed', { type: 'error' }); }
  });

  // ----- native feel -----
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, [contenteditable], .selectable, .card, .nav-item.nb')) e.preventDefault(); });
  document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.target.closest('.tab, .fab, .btn.primary, .icon-btn, .selbtn')) navigator.vibrate?.(6); }, { passive: true });
  let sw = null;   // edge swipe back
  document.addEventListener('touchstart', (e) => { const t = e.touches[0]; sw = e.touches.length === 1 && t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!sw) return; const t = e.changedTouches[0]; const dx = t.clientX - sw.x, dy = Math.abs(t.clientY - sw.y); sw = null;
    if (dx > 90 && dy < 60 && current().name !== 'all' && !document.querySelector('.backdrop')) { navigator.vibrate?.(8); if (current().name === 'note') import('./core/router.js').then((m) => m.back('/')); else history.length > 1 ? history.back() : navigate('/'); }
  }, { passive: true });
  on('install:available', (ok) => { try { if (ok && !localStorage.getItem('inkwell:installNudge')) { localStorage.setItem('inkwell:installNudge', '1'); toast('Install Inkwell for a full-screen, offline app', { duration: 12000, action: { label: 'Install', onClick: promptInstall } }); } } catch { /* ignore */ } });

  // ----- start -----
  try { const l = localStorage.getItem('inkwell:last'); if ((!location.hash || location.hash === '#/') && l && /^#\/(note|notebook|tag|smart|favorites|recent|settings)/.test(l)) history.replaceState(null, '', l); } catch { /* ignore */ }
  loadConfig(); loadAccount();
  startRouter();
  setTimeout(() => { const sp = document.getElementById('splash'); sp?.classList.add('out'); setTimeout(() => sp?.remove(), 400); }, 450);
  initAppLock();
  A.purgeOldTrash().catch(() => {});
  onboard().catch(() => {});
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 800));
  idle(async () => {
    try { (await import('./core/pwa.js')).registerPWA(); } catch (e) { console.warn(e); }
    try { (await import('./core/sync.js')).startSync(); } catch (e) { console.warn('sync unavailable', e); }
  });
}

async function onboard() {
  if (await getMeta('onboarded', false)) return;
  const existing = await getAll('notes');
  await setMeta('onboarded', true);
  if (existing.length) return;
  const text = '<h1>Welcome to Inkwell</h1><p>Write with a pencil or finger, type, import PDFs and record audio. Everything is saved on your device first, so it works offline.</p>'
    + '<h2>Try this</h2><ul><li>Tap <b>New note</b> and pick a page style or template.</li><li>Drag notes onto a notebook in the sidebar.</li><li>Press <b>Ctrl/Cmd + K</b> to search or run any command.</li><li>Link notes with [[Double brackets]] to see backlinks.</li><li>Drop a PDF onto the library to annotate it.</li></ul>';
  const n = await A.createNote({ title: 'Welcome to Inkwell', template: 'lined', text, tags: ['welcome'] });
  await A.patchNotes([n.id], (x) => { x.pinned = true; });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').replaceChildren(h('div', { class: 'boot' }, h('p', {}, 'Inkwell could not start. ' + (e?.message || '')), h('button', { class: 'btn', onclick: () => location.reload() }, 'Reload')));
});
