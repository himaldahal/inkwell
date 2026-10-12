// Inkwell note editor entry: mountEditor(container, noteId, {onClose}) -> {destroy}
import './editor.css';
import { h, debounce, stripHtml, fmtDate } from '../core/utils.js';
import { getRecord, putRecord, softDelete, listNotes } from '../core/db.js';
import { on as busOn, toast } from '../core/store.js';
import { Engine, MIN_ZOOM, MAX_ZOOM } from './engine.js';
import { buildToolbar } from './toolbar.js';
import { mountSidebar, pageMenu } from './sidebar.js';
import { mountTextLayer } from './textlayer.js';
import { mountRuler } from './ruler.js';
import { mountRefView } from './refview.js';
import { paintPage } from './pages.js';
import { takeSnapshot, loadSnapshot, hashOf } from './versions.js';
import { icon } from './icons.js';
import { ibtn, popover, menu, closePopover, pref } from './ui.js';
import { releaseAssets, getImage } from './assets.js';
import { clipboard } from './tools/select.js';
import { setAuthor } from './stroke.js';

// optional modules owned by other agents; glob tolerates their absence at build time
const OPT = { share: Object.values(import.meta.glob('../ui/share.js'))[0], activity: Object.values(import.meta.glob('../core/activity.js'))[0] };
const PHONE_W = 720, WIDE_W = 900;
const fmtTime = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export function mountEditor(container, noteId, { onClose, onPresence, readOnly = false } = {}) {
  const root = h('div', { class: 'ik-root', tabindex: -1 });
  container.append(root);
  let destroyed = false, cleanup = [];
  let eng = null, lastPeers = [], setAvatars = () => {};
  const opCbs = new Set(), presCbs = new Set(), pendingOps = [];
  const handle = {
    /** live session layer API */
    applyRemoteOps(ops) { if (eng) eng.applyRemoteOps(ops); else pendingOps.push(ops); },
    onLocalOp(cb) { opCbs.add(cb); return () => opCbs.delete(cb); },
    onLocalPresence(cb) { presCbs.add(cb); return () => presCbs.delete(cb); },
    setPresence(peers) { lastPeers = peers || []; eng?.setPresence(lastPeers); setAvatars(lastPeers); },
    get note() { return eng?.note; },
    get engine() { return eng; },
    destroy() { destroyed = true; cleanup.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); cleanup = []; root.remove(); },
  };
  init().catch((e) => { console.error(e); root.replaceChildren(h('div', { class: 'ik-missing' }, 'Could not open this note.')); });
  return handle;

  async function init() {
    const note = await getRecord('notes', noteId);
    if (destroyed) return;
    if (!note || note.deleted) {
      root.replaceChildren(h('div', { class: 'ik-missing' }, h('p', {}, 'This note could not be found.'), h('button', { class: 'ik-primary', type: 'button', onclick: () => onClose?.() }, 'Go back')));
      return;
    }
    note.pages ||= []; note.tags ||= [];
    if (!note.pages.length) note.pages.push({ id: crypto.randomUUID?.() || String(Date.now()), type: 'draw', width: 820, height: 1160, strokes: [], items: [] });
    for (const p of note.pages) { p.strokes ||= []; p.items ||= []; }

    // ---------- skeleton ----------
    const scroll = h('div', { class: 'ik-scroll' });
    const pagesEl = h('div', { class: 'ik-pages' });
    scroll.append(pagesEl);
    const wrap = h('div', { class: 'ik-ink' }, scroll);
    const cursorEl = h('div', { class: 'ik-cursor' }); wrap.append(cursorEl);
    const sideHost = h('aside', { class: 'ik-side', 'aria-label': 'Pages' });
    const textHost = h('section', { class: 'ik-textpane', 'aria-label': 'Typed notes' });
    const refHost = h('aside', { class: 'ik-refpane', 'aria-label': 'Reference note' });
    const main = h('div', { class: 'ik-main' }, sideHost, wrap, textHost, refHost);
    const recbar = h('div', { class: 'ik-recbar', hidden: true });

    const engine = new Engine({ note, root, scroll, pagesEl, wrap, readOnly });
    eng = engine; if (readOnly) root.classList.add('ik-readonly');
    engine.onLocalOp((ops) => opCbs.forEach((cb) => { try { cb(ops); } catch (e) { console.error(e); } }));
    engine.onLocalPresence((m) => { presCbs.forEach((cb) => cb(m)); try { onPresence?.(m); } catch (e) { console.error(e); } });
    pendingOps.splice(0).forEach((o) => engine.applyRemoteOps(o));
    if (lastPeers.length) engine.setPresence(lastPeers);
    engine.cursorEl = cursorEl;
    cleanup.push(() => engine.destroy());
    OPT.activity?.().then((m) => Promise.resolve(m.currentAuthor?.()).then((a) => setAuthor(typeof a === 'string' ? a : a?.id))).catch(() => {});
    const ruler = mountRuler(engine); cleanup.push(() => ruler.destroy());

    // ---------- save ----------
    let dirty = false, previewDirty = false, saving = Promise.resolve(), lastHash = hashOf(note), lastSnapHash = hashOf(note);
    const indexText = () => {
      const parts = [stripHtml(note.text || '')];
      for (const p of note.pages) for (const it of p.items) if (!it.deleted && it.type === 'text') parts.push(it.text || stripHtml(it.html || ''));
      return parts.join('\n').replace(/\s+\n/g, '\n').trim();
    };
    const makePreview = () => {
      const pg = note.pages[0]; if (!pg) return null;
      const W = 360, k = W / pg.width, c = document.createElement('canvas');
      c.width = W; c.height = Math.max(1, Math.round(pg.height * k));
      const ctx = c.getContext('2d'); ctx.scale(k, k);
      paintPage(ctx, note, pg, { pdfCanvas: engine.pvs[0]?.cv.pdf });
      try { return c.toDataURL('image/jpeg', 0.62); } catch { return null; }
    };
    let baseText = note.text || '', baseTitle = note.title || '';
    const doSave = () => {
      if (readOnly || !dirty) { dirty = false; return saving; }
      baseText = note.text || ''; baseTitle = note.title || '';
      dirty = false;
      try {
        note.textIndex = indexText();
        if (previewDirty) { previewDirty = false; note.preview = makePreview() || note.preview; }
      } catch (e) { console.error(e); }
      saving = putRecord('notes', note).catch((e) => { dirty = true; console.error('save failed', e); });
      return saving;
    };
    const save = debounce(doSave, 600);
    const touch = (page) => { dirty = true; if (!page || page === note.pages[0]) previewDirty = true; save(); };
    engine.on('change', (d) => touch(d.page));
    cleanup.push(() => save.cancel());
    const flush = () => { save.cancel(); return doSave(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', flush);
    cleanup.push(() => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); });

    // snapshots
    let snapBusy = false;
    const snapshot = async (reason, force) => {
      if (snapBusy) return; const hs = hashOf(note);
      if (!force && hs === lastSnapHash) return;
      snapBusy = true;
      try { const v = await takeSnapshot(note, reason); if (v) { lastSnapHash = hs; dirty = true; save(); } } catch (e) { console.warn(e); } finally { snapBusy = false; }
    };
    const snapTimer = setInterval(() => snapshot('auto'), 5 * 60 * 1000);
    cleanup.push(() => { clearInterval(snapTimer); if (hashOf(note) !== lastSnapHash && lastHash !== lastSnapHash + 'x') { snapshot('close').then(() => flush()); } });

    // merge recordings written by the recorder module
    const offBus = busOn('notes:changed', async (d) => {
      if (!d || d.id !== note.id) return;
      const rec = await getRecord('notes', note.id);
      if (d.remote && rec && !destroyed) {
        engine.mergeRemoteNote(rec);
        const focusedText = textLayer.el.contains(document.activeElement);
        if ((note.text || '') === baseText && (rec.text || '') !== (note.text || '') && !focusedText) { note.text = rec.text || ''; baseText = note.text; textLayer.setHtml(note.text); }
        if (document.activeElement !== title && (note.title || '') === baseTitle && (rec.title || '') !== baseTitle) { note.title = baseTitle = rec.title || ''; title.value = note.title; }
        if (rec.tags) note.tags = rec.tags;
        note.favorite = rec.favorite; note.pinned = rec.pinned; paintFlags();
      }
      if (rec && rec.recordings && JSON.stringify(rec.recordings.map((r) => r.id)) !== JSON.stringify((note.recordings || []).map((r) => r.id))) {
        note.recordings = rec.recordings; refreshRecUI();
      }
    });
    cleanup.push(offBus);

    // ---------- text layer ----------
    let textOpT;
    const hooks = {
      transform: (a, root) => import('./transform.js').then((m) => m.textMenu(a, root, () => { note.text = root.innerHTML; dirty = true; save(); })),
      read: (a, root) => voiceRead(a, root),
      dictate: (b, root) => import('./voice.js').then((m) => m.toggleDictation(() => root, (on) => b.classList.toggle('rec', on))),
    };
    const textLayer = mountTextLayer(textHost, note, { hooks, onChange: () => {
      dirty = true; save();
      if (opCbs.size) { clearTimeout(textOpT); textOpT = setTimeout(() => opCbs.forEach((cb) => cb([{ type: 'text', pageId: null, data: note.text }])), 400); }
    } });
    engine.on('remoteText', (html) => { if (!textLayer.el.contains(document.activeElement)) { note.text = html; baseText = html; textLayer.setHtml(html); dirty = true; save(); } });
    if (readOnly) { textLayer.el.contentEditable = 'false'; }
    cleanup.push(() => textLayer.destroy());
    engine.on('appendTyped', (html) => { textLayer.append(html); if (view === 'ink') setView(wide() ? 'split' : view); });

    // ---------- header ----------
    const title = h('input', { class: 'ik-title', type: 'text', value: note.title || '', placeholder: 'Untitled', 'aria-label': 'Note title', maxlength: 200, enterkeyhint: 'done' });
    title.readOnly = readOnly;
    title.addEventListener('input', () => { note.title = title.value; dirty = true; save(); });
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });
    const back = ibtn('back', 'Back', async () => { await flush(); onClose?.(); }, 'back');
    const favBtn = ibtn('star', 'Favorite', () => { note.favorite = !note.favorite; dirty = true; save(); paintFlags(); }, 'nophone');
    const pinBtn = ibtn('pin', 'Pin', () => { note.pinned = !note.pinned; dirty = true; save(); paintFlags(); }, 'nophone');
    const tagBtn = ibtn('tag', 'Tags', (e, b) => tagsPop(b), 'nophone');
    const recBtn = ibtn('mic', 'Record audio', (e, b) => recClick(b), 'nophone');
    const expBtn = ibtn('file', 'Export as PDF', () => exportMenu(), 'nophone');
    const shareBtn = ibtn('users', 'Share with people', () => (OPT.share?.() || Promise.reject()).then((m) => m.openShareDialog(note.id)).catch(() => toast('Sharing is not available')), 'nophone noro');
    const avatars = h('div', { class: 'ik-avatars', 'aria-label': 'People in this note' });
    setAvatars = (peers) => {
      avatars.hidden = !peers.length; avatars.title = 'Who is editing';
      avatars.replaceChildren(...peers.slice(0, 4).map((p) => h('span', { class: 'ik-av', title: p.name || 'Guest', style: { background: p.color || '#4f46e5' } }, (p.name || '?').trim().charAt(0).toUpperCase())),
        ...(peers.length > 4 ? [h('span', { class: 'ik-av more' }, '+' + (peers.length - 4))] : []), h('span', { class: 'ik-editing-n' }, peers.length + ' editing'));
    };
    setAvatars(lastPeers); avatars.setAttribute('role', 'button'); avatars.tabIndex = 0;
    avatars.addEventListener('click', () => livePop(avatars));
    const pill = h('span', { class: 'ik-pill', hidden: !readOnly }, 'View only');
    const searchBtn = ibtn('search', 'Search typed notes', () => { setView(wide() ? 'split' : 'text'); setTimeout(() => textLayer.toggleFind(), 50); }, 'nophone');
    const sideBtn = ibtn('sidebar', 'Pages panel', () => toggleSide(), 'nophone');
    const moreBtn = ibtn('more', 'More', (e, b) => moreMenu(b), 'more');
    const paintFlags = () => { favBtn.classList.toggle('on', !!note.favorite); pinBtn.classList.toggle('on', !!note.pinned); tagBtn.classList.toggle('badge', note.tags.length > 0); };
    const viewSeg = h('div', { class: 'ik-seg view', role: 'tablist', 'aria-label': 'View' });
    const vb = {};
    for (const [id, ic, label] of [['ink', 'pen', 'Handwriting'], ['split', 'columns', 'Split view'], ['text', 'doc', 'Typed notes']]) {
      vb[id] = h('button', { type: 'button', class: 'ik-segb ' + id, role: 'tab', title: label, 'aria-label': label, onclick: () => setView(id) }, icon(ic, 18)); viewSeg.append(vb[id]);
    }
    const header = h('header', { class: 'ik-header' }, back, title, pill, avatars, viewSeg, h('div', { class: 'ik-hact' }, favBtn, pinBtn, tagBtn, searchBtn, recBtn, shareBtn, expBtn, sideBtn), moreBtn);

    // ---------- zoom / page fabs ----------
    const zPct = h('button', { type: 'button', class: 'ik-btn zp', title: 'Fit to width', 'aria-label': 'Zoom, press to fit width', onclick: () => engine.fitWidth() }, '100%');
    const zoomBox = h('div', { class: 'ik-fab zoom' },
      ibtn('minus', 'Zoom out (-)', () => engine.setZoom(engine.zoom / 1.2), 'sm'), zPct, ibtn('plus', 'Zoom in (+)', () => engine.setZoom(engine.zoom * 1.2), 'sm'), ibtn('fit', 'Fit width (0)', () => engine.fitWidth(), 'sm'));
    const pageBtn = h('button', { type: 'button', class: 'ik-fab pg', title: 'Jump to page', 'aria-label': 'Page indicator, jump to page', onclick: () => jumpPop(pageBtn) }, '1 / 1');
    wrap.append(pageBtn, zoomBox);
    engine.on('zoom', (z) => { zPct.textContent = Math.round(z * 100) + '%'; });
    engine.on('page', ({ index, count, id }) => {
      pageBtn.textContent = `${index + 1} / ${count}`;
      try { const rec = engine.audioMod?.getActiveRecorder(note.id); rec?.addMarker?.(id); } catch { /* ignore */ }
    });
    function jumpPop(anchor) {
      const inp = h('input', { type: 'number', min: 1, max: note.pages.length, value: engine.cur + 1, class: 'ik-jump', 'aria-label': 'Page number' });
      const go = () => { engine.goToPage((+inp.value || 1) - 1); pop.close(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      const pop = popover(anchor, h('div', { class: 'ik-jumpbox' }, h('span', {}, 'Go to page'), inp, h('button', { type: 'button', class: 'ik-primary', onclick: go }, 'Go')), {});
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    // ---------- toolbar ----------
    const stickerPop = (anchor) => {
      let pop; const grid = tb.emojiGrid((e) => engine.insertSticker(e), () => pop.close());
      pop = popover(anchor, grid, { cls: 'emoji' });
    };
    const imgInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
    imgInput.addEventListener('change', async () => { for (const f of imgInput.files) await engine.insertImage(f); imgInput.value = ''; });
    const pdfInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    pdfInput.addEventListener('change', () => { const f = pdfInput.files[0]; pdfInput.value = ''; if (f) importPdf(f); });
    const tb = buildToolbar(engine, {
      pickImage: () => imgInput.click(),
      stickers: stickerPop,
      toggleRuler: () => { ruler.toggle(); tb.refresh(); },
      toggleOptions: () => root.classList.toggle('ik-opt-open'),
      sticky: (c) => engine.insertSticky(c),
      read: (a) => voiceRead(a, null),
      dictate: (b) => import('./voice.js').then((m) => m.toggleDictation(() => { if (!engine.editing) { const pv = engine.currentPv(), c = engine.visibleCenter(pv); engine.insertTextBox(pv, c.x - 140, c.y - 20); } return engine.editing?.t; }, (on) => b.classList.toggle('rec', on))),
      textColor: (c) => { const ed = engine.editing; if (!ed) return; const sel = getSelection(); if (sel && !sel.isCollapsed && ed.t.contains(sel.anchorNode)) engine.fmt('foreColor', c); else ed.t.style.color = c; },
      textSize: (v) => { if (engine.editing) engine.editing.t.style.fontSize = v + 'px'; },
    });
    engine.on('ruler', () => tb.refresh());
    engine.on('menu', ({ anchor, items }) => menu(anchor, items, { align: 'start' }));
    cleanup.push(() => tb.destroy());

    root.append(header, tb.el, tb.opts, main, recbar, imgInput, pdfInput,
      h('button', { type: 'button', class: 'ik-focus-exit', title: 'Exit focus mode (F)', 'aria-label': 'Exit focus mode', onclick: () => toggleFocus(false) }, icon('focus', 18)));
    root.dataset.tool = engine.tool;
    const sidebar = mountSidebar(sideHost, engine); cleanup.push(() => sidebar.destroy());

    // ---------- views / layout ----------
    let view = 'ink', ref = null;
    const wide = () => root.clientWidth >= WIDE_W;
    function setView(v) {
      if (v === 'split' && !wide()) v = 'text';
      view = v;
      root.classList.remove('ik-view-ink', 'ik-view-split', 'ik-view-text'); root.classList.add('ik-view-' + v);
      for (const k in vb) { vb[k].classList.toggle('on', k === v); vb[k].setAttribute('aria-selected', k === v); }
      requestAnimationFrame(() => { engine.onResize(); engine.updateCurrent(true); });
      if (v === 'text') textLayer.focus();
    }
    const hasInk = note.pages.some((p) => p.strokes.some((s) => !s.deleted) || p.items.some((i) => !i.deleted) || p.type === 'pdf');
    setView(!hasInk && (note.text || '').trim() ? 'text' : 'ink');
    function toggleSide(force) {
      const on = force ?? !root.classList.contains('ik-side-open');
      root.classList.toggle('ik-side-open', on); pref.set('side', on);
      requestAnimationFrame(() => engine.onResize());
    }
    if (pref.get('side', false) && root.clientWidth >= PHONE_W) root.classList.add('ik-side-open');
    function toggleFocus(force) {
      const on = force ?? !root.classList.contains('ik-focus');
      root.classList.toggle('ik-focus', on); requestAnimationFrame(() => engine.onResize());
    }
    function toggleRef(force) {
      const on = force ?? !ref;
      if (on && !ref) {
        if (!wide()) { toast('Reference view needs a wider screen'); return; }
        root.classList.add('ik-ref-open'); ref = mountRefView(refHost, engine, { onClose: () => toggleRef(false) });
      } else if (!on && ref) { ref.destroy(); ref = null; root.classList.remove('ik-ref-open'); }
      requestAnimationFrame(() => engine.onResize());
    }
    cleanup.push(() => ref?.destroy());

    const ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      root.classList.toggle('ik-phone', w < PHONE_W);
      if (w < PHONE_W) root.classList.remove('ik-side-open');
      if (view === 'split' && w < WIDE_W) setView('text');
      if (ref && w < WIDE_W) toggleRef(false);
      engine.onResize();
    });
    ro.observe(root); cleanup.push(() => ro.disconnect());
    root.classList.toggle('ik-phone', root.clientWidth < PHONE_W);
    const vv = window.visualViewport;
    const onVV = () => { if (!vv) return; root.style.setProperty('--ik-kb', Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'); engine.onResize(); };
    vv?.addEventListener('resize', onVV); vv?.addEventListener('scroll', onVV);
    window.addEventListener('orientationchange', onVV);
    cleanup.push(() => { vv?.removeEventListener('resize', onVV); vv?.removeEventListener('scroll', onVV); window.removeEventListener('orientationchange', onVV); });

    // ---------- popovers ----------
    function livePop(anchor) {
      const st = (p) => p.state || (p.typing ? 'typing' : p.laser ? 'pointing' : p.drawing ? 'drawing on page ' + (note.pages.findIndex((x) => x.id === p.pageId) + 1) : p.pageId ? 'viewing page ' + (note.pages.findIndex((x) => x.id === p.pageId) + 1) : 'online');
      const box = h('div', { class: 'ik-info' }, h('div', { class: 'ik-menu-title' }, 'Live now'),
        ...(lastPeers.length ? lastPeers.map((p) => h('div', { class: 'ik-info-row' }, h('span', { class: 'ik-av', style: { background: p.color || '#4f46e5', marginLeft: 0 } }, (p.name || '?').charAt(0).toUpperCase()), h('b', {}, p.name || 'Guest'), h('span', {}, st(p)))) : [h('p', { class: 'ik-hint' }, 'Only you are here.')]),
        h('button', { type: 'button', class: 'ik-btn wide', onclick: () => activityPop(anchor) }, 'Activity timeline'));
      popover(anchor, box, { align: 'end' });
    }
    async function activityPop(anchor) {
      const box = h('div', { class: 'ik-versions' }, h('div', { class: 'ik-menu-title' }, 'Activity'));
      const list = h('div', { class: 'ik-vlist' }); box.append(list);
      const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };
      const paint = async () => {
        let items = [];
        try { const m = await OPT.activity?.(); items = (await m?.getActivity?.(note.id)) || []; } catch { /* optional */ }
        list.replaceChildren(...(items.length ? items.slice(0, 60).map((a) => h('div', { class: 'ik-vrow' }, h('div', {},
          h('b', {}, a.text || a.summary || `${a.name || a.author || 'Someone'} ${a.action || a.type || 'edited'}${a.count ? ' ' + a.count : ''}${a.page ? ' on page ' + a.page : ''}`), h('small', {}, ago(a.at || a.t || a.ts || a.time || Date.now()))))) : [h('p', { class: 'ik-hint' }, 'No activity yet.')]));
      };
      paint(); const off = busOn('activity:update', paint);
      popover(anchor, box, { align: 'end', cls: 'wide', onClose: off });
    }
    function tagsPop(anchor) {
      const box = h('div', { class: 'ik-tagbox' });
      const chips = h('div', { class: 'ik-chips' });
      const inp = h('input', { type: 'text', placeholder: 'Add tag, press Enter', 'aria-label': 'Add tag', maxlength: 40 });
      const paintChips = () => {
        chips.replaceChildren(...note.tags.map((t) => h('span', { class: 'ik-chip' }, t, h('button', { type: 'button', 'aria-label': 'Remove tag ' + t, onclick: () => { note.tags = note.tags.filter((x) => x !== t); dirty = true; save(); paintChips(); paintFlags(); } }, '×'))));
      };
      const add = () => { const t = inp.value.trim().replace(/^#/, ''); inp.value = ''; if (t && !note.tags.includes(t)) { note.tags = [...note.tags, t]; dirty = true; save(); paintChips(); paintFlags(); } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
      box.append(h('div', { class: 'ik-menu-title' }, 'Tags'), chips, inp); paintChips();
      popover(anchor, box, { align: 'end' }); setTimeout(() => inp.focus(), 0);
    }
    function infoPop(anchor) {
      const strokes = note.pages.reduce((a, p) => a + p.strokes.filter((s) => !s.deleted).length, 0), words = (indexText().match(/\S+/g) || []).length;
      const row = (k, v) => h('div', { class: 'ik-info-row' }, h('span', {}, k), h('b', {}, String(v)));
      popover(anchor, h('div', { class: 'ik-info' }, h('div', { class: 'ik-menu-title' }, 'Note info'),
        row('Created', new Date(note.createdAt || Date.now()).toLocaleString()), row('Modified', fmtDate(note.updatedAt || Date.now())),
        row('Pages', note.pages.length), row('Strokes', strokes), row('Words', words), row('Recordings', (note.recordings || []).length),
        row('Versions', (note.versions || []).length)), { align: 'end' });
    }
    async function exportMenu() {
      const run = (fmt) => async () => {
        await flush();
        const m = await engine.media.export();
        try {
          if (m?.exportNote) { await m.exportNote(note, fmt); return; }
        } catch (e) { console.warn(e); toast('Export failed: ' + (e.message || e)); return; }
        toast('PDF export is not available right now');
      };
      run('pdf')();
    }
    function versionsPop(anchor) {
      const box = h('div', { class: 'ik-versions' }, h('div', { class: 'ik-menu-title' }, 'Version history'));
      const listEl = h('div', { class: 'ik-vlist' });
      const paint = () => {
        const vs = [...(note.versions || [])].reverse();
        listEl.replaceChildren(...(vs.length ? vs.map((v) => h('div', { class: 'ik-vrow' }, h('div', {}, h('b', {}, new Date(v.t).toLocaleString()), h('small', {}, ` ${v.reason} · ${v.n} strokes`)),
          h('button', { type: 'button', class: 'ik-primary sm', onclick: async () => {
            try {
              await snapshot('before restore', true);
              const d = await loadSnapshot(v);
              engine.replacePages(d.pages, { template: d.template, paperColor: d.paperColor, text: d.text });
              textLayer.setHtml(d.text); dirty = previewDirty = true; save(); pop.close(); toast('Version restored');
            } catch (e) { console.error(e); toast('Could not restore that version'); }
          } }, 'Restore'))) : [h('p', { class: 'ik-hint' }, 'No versions yet. Snapshots are saved every few minutes and when you close the note.')]));
      };
      box.append(listEl, h('button', { type: 'button', class: 'ik-btn wide', onclick: async () => { await snapshot('manual', true); paint(); } }, 'Save snapshot now'));
      paint();
      const pop = popover(anchor, box, { align: 'end', cls: 'wide' });
    }
    function moreMenu(anchor) {
      const rec = engine.audioMod?.getActiveRecorder(note.id);
      menu(anchor, [
        { label: note.favorite ? 'Remove favorite' : 'Favorite', icon: 'star', run: () => favBtn.click() },
        { label: note.pinned ? 'Unpin' : 'Pin', icon: 'pin', run: () => pinBtn.click() },
        { label: 'Search in typed notes', icon: 'search', run: () => searchBtn.click() },
        { label: 'Tags...', icon: 'tag', run: () => setTimeout(() => tagsPop(anchor), 0) },
        { label: 'Note info', icon: 'info', run: () => setTimeout(() => infoPop(anchor), 0) },
        '-',
        { label: 'Page template / paper...', icon: 'bg', run: () => setTimeout(() => pageMenu(anchor, engine, engine.cur), 0) },
        { label: 'Pages panel', icon: 'sidebar', run: () => toggleSide() },
        { label: 'Fit width', icon: 'fit', run: () => engine.fitWidth() },
        { label: 'Focus mode (F)', icon: 'focus', run: () => toggleFocus(true) },
        { label: ref ? 'Close reference note' : 'Reference note (side by side)', icon: 'columns', run: () => toggleRef() },
        '-',
        { label: rec ? 'Recording...' : 'Record audio', icon: 'mic', run: () => setTimeout(() => recClick(anchor), 0) },
        { label: 'Recordings', icon: 'list', run: () => setTimeout(() => recordingsPop(anchor), 0) },
        { label: 'Import PDF...', icon: 'file', run: () => pdfInput.click() },
        { label: 'Share with people...', icon: 'users', run: () => shareBtn.click() },
        { label: 'Export as PDF', icon: 'file', run: () => exportMenu() },
        { label: 'Activity', icon: 'clock', run: () => setTimeout(() => activityPop(anchor), 0) },
        { label: 'Version history', icon: 'clock', run: () => setTimeout(() => versionsPop(anchor), 0) },
      ], { align: 'end' });
    }

    // ---------- read aloud ----------
    function pageText(i) { return note.pages[i].items.filter((x) => !x.deleted && x.type === 'text').map((x) => x.text || stripHtml(x.html || '')).join('. '); }
    function voiceRead(anchor, root) {
      import('./voice.js').then((m) => {
        const startPage = () => {
          let i = engine.cur;
          const next = () => { while (i < note.pages.length && !pageText(i).trim()) i++; if (i >= note.pages.length) return; engine.goToPage(i); const t = pageText(i); i++; m.speak(t, { onEnd: next }); };
          next();
        };
        const start = () => (root && (view !== 'ink') ? m.speak(root) : startPage());
        m.readControls(anchor, { start, onStop: () => {} }); start();
      });
    }
    // ---------- audio ----------
    let recTick = null;
    function refreshRecUI() {
      const rec = engine.audioMod?.getActiveRecorder(note.id);
      recBtn.classList.toggle('rec', !!rec && rec.state !== 'stopped');
      recbar.hidden = !rec || rec.state === 'stopped';
      recbar.classList.toggle('on', !recbar.hidden);
      if (rec && !recbar.hidden) bindRec(rec);
    }
    function bindRec(rec) {
      if (recTick === rec) return; recTick = rec;
      const time = h('b', {}, '0:00');
      const pauseBtn = h('button', { type: 'button', class: 'ik-btn sm', onclick: () => (rec.state === 'paused' ? rec.resume() : rec.pause()) }, 'Pause');
      const stopBtn = h('button', { type: 'button', class: 'ik-btn sm stop', onclick: () => stopRec(rec) }, 'Stop');
      recbar.replaceChildren(h('span', { class: 'dot' }), 'Recording ', time, pauseBtn, stopBtn);
      rec.onTick?.((t, st) => { time.textContent = fmtTime(t); pauseBtn.textContent = st === 'paused' ? 'Resume' : 'Pause'; });
    }
    async function stopRec(rec) {
      try { await rec.stop(); } catch (e) { toast('Could not stop recording'); console.warn(e); }
      recTick = null; recbar.hidden = true; recBtn.classList.remove('rec');
      const fresh = await getRecord('notes', note.id);
      if (fresh?.recordings) note.recordings = fresh.recordings;
      toast('Recording saved');
    }
    async function recClick(anchor) {
      const mod = await engine.media.audio();
      if (!mod) { toast('Audio recording is not available'); return; }
      engine.audioMod = mod;
      const cur = mod.getActiveRecorder(note.id);
      if (cur && cur.state !== 'stopped') { stopRec(cur); return; }
      if (mod.isRecordingSupported && !mod.isRecordingSupported()) { toast('Recording is not supported in this browser'); return; }
      try {
        const rec = mod.createRecorder(note.id); await rec.start();
        rec.addMarker?.(engine.currentPv()?.page.id);
        refreshRecUI();
      } catch (e) { toast(e?.message || 'Could not start recording'); }
      void anchor;
    }
    async function recordingsPop(anchor) {
      const mod = await engine.media.audio();
      const box = h('div', { class: 'ik-recs' }, h('div', { class: 'ik-menu-title' }, 'Recordings'));
      const players = [];
      if (!mod?.mountPlayer || !(note.recordings || []).length) box.append(h('p', { class: 'ik-hint' }, 'No recordings yet. Tap the microphone to record while you write; tap a stroke later to jump to that moment.'));
      else {
        for (const r of note.recordings) {
          const slot = h('div', { class: 'ik-rec-slot' }); box.append(slot);
          try {
            const p = mod.mountPlayer(slot, r, {
              pages: note.pages,
              onMarker: (pid) => engine.goToPage(note.pages.findIndex((x) => x.id === pid)),
              onPage: (pid) => engine.goToPage(note.pages.findIndex((x) => x.id === pid)),
              onDelete: async () => {
                note.recordings = note.recordings.filter((x) => x.id !== r.id); dirty = true; save(); slot.remove();
                if (r.assetId) softDelete('assets', r.assetId).catch(() => {});
              },
            });
            p.recordingId = r.id; players.push(p);
          } catch (e) { console.warn(e); }
        }
      }
      engine.players = players;
      popover(anchor, box, { align: 'end', cls: 'wide', onClose: () => { players.forEach((p) => p.destroy?.()); engine.players = []; } });
    }
    async function importPdf(file) {
      const m = await engine.media.pdf();
      if (!m?.importPdfToNote) { toast('PDF import is not available'); return; }
      toast('Importing PDF...');
      try {
        await flush();
        await m.importPdfToNote(file, note.id);
        const fresh = await getRecord('notes', note.id);
        if (fresh) { note.recordings = fresh.recordings || note.recordings; engine.replacePages(fresh.pages.map((p) => ({ ...p, strokes: p.strokes || [], items: p.items || [] }))); lastSnapHash = hashOf(note); }
        engine.goToPage(Math.max(0, note.pages.findIndex((p) => p.type === 'pdf')), false);
        toast('PDF added');
      } catch (e) { console.error(e); toast('Could not import that PDF'); }
    }
    {
      const mod = await engine.media.audio(); if (mod) engine.audioMod = mod;
      if (!destroyed) refreshRecUI();
    }

    // ---------- keyboard / clipboard / drop ----------
    const sel = () => engine.tools.select;
    const onKey = (e) => {
      if (!root.isConnected) return;
      const t = e.target, editable = t.closest?.('input,textarea,select,[contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (readOnly && !['+', '=', '-', '0', 'pagedown', 'pageup', 'f'].includes(k)) return;
      if (mod && k === 'z' && !editable) { e.preventDefault(); e.shiftKey ? engine.redo() : engine.undo(); return; }
      if (mod && k === 'y' && !editable) { e.preventDefault(); engine.redo(); return; }
      if (editable || mod && !['a', 'd'].includes(k)) return;
      if (mod && k === 'a') { e.preventDefault(); engine.setTool('select'); sel().selectAll(); return; }
      if (mod && k === 'd') { if (engine.selection) { e.preventDefault(); sel().duplicate(); } return; }
      if (e.altKey) return;
      const map = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', v: 'select', n: 'pencil', s: 'shape', l: 'laser' };
      if (map[k]) { e.preventDefault(); engine.setTool(map[k]); }
      else if (k === 'i') imgInput.click();
      else if (k === 'r') { ruler.toggle(); tb.refresh(); }
      else if (k === 'f') toggleFocus();
      else if (k === ' ') { if (!engine.spaceDown) { engine.spaceDown = true; root.classList.add('ik-space'); } e.preventDefault(); }
      else if (k === 'delete' || k === 'backspace') { if (engine.selection) { e.preventDefault(); sel().delete(); } }
      else if (k === 'escape') { if (root.classList.contains('ik-focus')) toggleFocus(false); else engine.clearSelection(); closePopover(); }
      else if (k === '+' || k === '=') engine.setZoom(engine.zoom * 1.2);
      else if (k === '-') engine.setZoom(engine.zoom / 1.2);
      else if (k === '0') engine.fitWidth();
      else if (k === 'pagedown') engine.goToPage(engine.cur + 1);
      else if (k === 'pageup') engine.goToPage(engine.cur - 1);
    };
    const inEditable = (e) => !!e.target.closest?.('input,textarea,select,[contenteditable="true"]');
    const onCopy = (e) => { if (inEditable(e) || !engine.selection) return; if (sel().copy()) e.preventDefault(); };
    const onCut = (e) => { if (inEditable(e) || !engine.selection) return; sel().cut(); e.preventDefault(); };
    const onPaste = (e) => {
      if (readOnly) return;
      if (inEditable(e) || !root.isConnected || !root.offsetParent) return;
      const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) { e.preventDefault(); files.forEach((f) => engine.insertImage(f)); return; }
      if (clipboard.data) { e.preventDefault(); sel().paste(); return; }
      const txt = e.clipboardData?.getData('text/plain');
      if (txt && txt.trim()) {
        e.preventDefault(); const pv = engine.currentPv(), c = engine.visibleCenter(pv);
        const esc = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
        engine.insertTextBox(pv, Math.max(0, c.x - 140), Math.max(0, c.y - 30), esc(txt).replace(/\n/g, '<br>'), txt);
      }
    };
    document.addEventListener('keydown', onKey); document.addEventListener('copy', onCopy); document.addEventListener('cut', onCut); document.addEventListener('paste', onPaste);
    cleanup.push(() => { document.removeEventListener('keydown', onKey); document.removeEventListener('copy', onCopy); document.removeEventListener('cut', onCut); document.removeEventListener('paste', onPaste); });
    wrap.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); wrap.classList.add('drop'); } });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
    wrap.addEventListener('drop', async (e) => {
      wrap.classList.remove('drop');
      const files = [...(e.dataTransfer?.files || [])]; if (!files.length || readOnly) return;
      e.preventDefault();
      const pv = engine.pvAtClient(e.clientX, e.clientY), r = pv.el.getBoundingClientRect();
      const at = { x: (e.clientX - r.left) / engine.zoom, y: (e.clientY - r.top) / engine.zoom };
      const rest = [];
      for (const f of files) {
        if (f.type.startsWith('image/')) await engine.insertImage(f, pv, at);
        else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) await importPdf(f);
        else rest.push(f);
      }
      if (rest.length) { const m = await engine.media.export(); if (m?.importFiles) m.importFiles(rest); else toast('Unsupported file'); }
    });

    // ---------- finish ----------
    paintFlags();
    engine.setTool('pen'); tb.refresh();
    window.addEventListener('beforeunload', flush); cleanup.push(() => window.removeEventListener('beforeunload', flush));
    zPct.textContent = Math.round(engine.zoom * 100) + '%';
    engine.updateCurrent(true);
    void listNotes; void getImage; void MIN_ZOOM; void MAX_ZOOM; void releaseAssets;
    cleanup.push(() => releaseAssets());
    cleanup.push(() => { engine.endEdit(); flush(); });
  }
}
