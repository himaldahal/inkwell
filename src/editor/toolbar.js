// Tool bar + tool options panel (colors, size, presets, eraser mode, shape kind, text formatting).
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { ibtn, pref, popover, closePopover } from './ui.js';
import { toast } from '../core/store.js';
import { enabled } from './mods.js';
import { drawStroke } from './stroke.js';
import { BRUSHES, FONTS } from './brushes.js';
import { SHAPES } from './shapes.js';
import { openColorPicker } from './colorpicker.js';

// 10 columns x 3 tones: neutrals down the first column, then red, orange, amber, green, teal, cyan, blue, violet, pink
const PALETTE = [
  '#111827', '#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#0d9488', '#0891b2', '#2563eb', '#7c3aed', '#db2777',
  '#4b5563', '#991b1b', '#9a3412', '#b45309', '#166534', '#115e59', '#155e75', '#1e40af', '#5b21b6', '#9d174d',
  '#ffffff', '#fca5a5', '#fdba74', '#fde68a', '#86efac', '#5eead4', '#67e8f9', '#93c5fd', '#c4b5fd', '#f9a8d4',
];
const HL_PALETTE = [
  '#fde047', '#fdba74', '#fca5a5', '#f9a8d4', '#c4b5fd', '#93c5fd', '#67e8f9', '#86efac',
  '#facc15', '#fb923c', '#f87171', '#f472b6', '#a78bfa', '#60a5fa', '#22d3ee', '#4ade80',
];
const RANGE = { pen: [0.5, 24, 0.5], highlighter: [6, 50, 1], pencil: [0.5, 12, 0.5], shape: [0.5, 20, 0.5], eraser: [4, 60, 1] };
const EMOJI = '😀 😂 😍 🤔 😎 😴 👍 👎 👏 🙏 💡 ⭐ ✅ ❌ ❗ ❓ 🔥 💯 🎯 📌 📎 📝 📚 🧠 ❤️ 💙 🟡 🟢 🔴 ➡️ ⬆️ ⚠️ 🎉 ☕ 🕐 📅 🔍 💬 🚀'.split(' ');

const fontLib = { extra: [], recent: () => pref.get('recentfonts', []), note(f) { pref.set('recentfonts', [f, ...fontLib.recent().filter((x) => x !== f)].slice(0, 5)); } };
export function buildToolbar(engine, act) {
  import('./fonts.js').then(async (m) => { const l = await m.loadSavedFonts(); fontLib.extra = l.map((f) => [f, m.fontStack(f)]); if (engine.tool === 'text') render(); }).catch(() => {});
  // two pages of tools (the chevron flips between them in the floating layout; the classic bar shows both)
  const TOOLS = [
    ['pen', 'Pen (P)', '', 1], ['highlighter', 'Highlighter (H)', '', 1], ['pencil', 'Pencil (N)', '', 1], ['eraser', 'Eraser (E)', '', 1], ['select', 'Select (V)', '', 1], 'sep1',
    ['shape', 'Shapes (S)', '', 1], ['text', 'Text box (T)', '', 1], ['hand', 'Hand / pan (Space)', '', 1], 'sep2',
    ['insert', 'Insert: image, sticker, library', 'action', 2], ['laser', 'Laser pointer (L)', '', 2], ['ruler', 'Ruler (R)', 'toggle', 2],
  ];
  // extra buttons that only exist in the floating layout's second page
  const EXTRAS = [['image', 'Add image', () => act.pickImage()], ['mic', 'Record audio', (e, el) => act.record?.(el)], ['sliders', 'Pen and touch settings', () => act.penSettings?.()]];
  const COLORED = ['pen', 'highlighter', 'pencil', 'shape', 'text'];
  const tools = h('div', { class: 'ik-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const btns = {};
  for (const t of TOOLS) {
    if (typeof t === 'string') { tools.append(h('span', { class: 'ik-tsep', 'aria-hidden': 'true', 'data-p': t === 'sep1' ? '1' : '2' })); continue; }
    const [id, label, kind, pg] = t;
    const b = ibtn(id === 'insert' ? 'plus' : id, label, (e, el) => {
      if (id === 'insert') insertMenu(el);
      else if (id === 'ruler') act.toggleRuler();
      else if (id === engine.tool) act.toggleOptions(true); // tapping the active tool opens its tray
      else { act.toggleOptions(false); engine.setTool(id); }
    }, 'tool t-' + id);
    b.dataset.tool = id; b.dataset.p = String(pg); if (!kind) b.setAttribute('aria-pressed', 'false'); btns[id] = b; tools.append(b);
  }
  for (const [ic, label, fn] of EXTRAS) { const b = ibtn(ic, label, (e, el) => fn(e, el), 'tool ik-extra'); b.dataset.p = '2'; tools.append(b); }
  function insertMenu(anchor) {
    const item = (ic, name, fn) => { const b = h('button', { type: 'button', class: 'ik-menu-item' }, icon(ic, 18), h('span', {}, name)); b.addEventListener('click', () => { closePopover(); setTimeout(fn, 0); }); return b; };
    popover(anchor, h('div', { class: 'ik-menu' }, item('image', 'Image or photo', () => act.pickImage()), item('sticker', 'Stickers', () => act.stickers(anchor)), item('library', 'Element library', () => act.library(anchor))), {});
  }
  const undo = ibtn('undo', 'Undo (Ctrl+Z)', () => engine.undo(), 'hist');
  const redo = ibtn('redo', 'Redo (Ctrl+Shift+Z)', () => engine.redo(), 'hist');
  const optBtn = ibtn('sliders', 'Tool options', () => act.toggleOptions(), 'optbtn');
  const swatchNow = h('span', { class: 'ik-now' });
  optBtn.append(swatchNow);
  let tpage = 1;
  const tpageBtn = ibtn('down', 'More tools', () => { tpage = tpage === 1 ? 2 : 1; bar.dataset.page = String(tpage); tpageBtn.setAttribute('aria-label', tpage === 1 ? 'More tools' : 'Back to drawing tools'); }, 'ik-tpage');
  const qrow = h('div', { class: 'ik-qrow', 'aria-label': 'Colour and size' });
  const bar = h('div', { class: 'ik-toolbar', 'data-page': '1' }, h('div', { class: 'ik-trow' }, tools, tpageBtn, h('div', { class: 'ik-histbtns' }, undo, redo), optBtn), qrow);
  const opts = h('div', { class: 'ik-options', role: 'group', 'aria-label': 'Tool options' });

  // ---- options rendering ----
  const preview = h('canvas', { class: 'ik-prev', width: 120, height: 40 });
  function drawPreview(tool, c) {
    const ctx = preview.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
    preview.width = 120 * dpr; preview.height = 40 * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push(12 + t * 96, 20 + Math.sin(t * 6.28) * 9, 0.25 + 0.5 * Math.sin(t * 3.14)); }
    if (tool === 'eraser') { ctx.strokeStyle = '#888'; ctx.beginPath(); ctx.arc(60, 20, Math.min(18, c.size), 0, 6.28); ctx.stroke(); return; }
    drawStroke(ctx, { id: 'prev', brush: tool === 'pen' ? c.brush : undefined, tool: tool === 'shape' ? 'pen' : tool, color: c.color, size: Math.min(c.size, 36), pts, shape: tool === 'shape' });
  }
  function colorRow(tool, c) {
    const row = h('div', { class: 'ik-colors tray', role: 'radiogroup', 'aria-label': 'Color' });
    const grid = h('div', { class: 'ik-grid' + (tool === 'highlighter' ? ' hl' : '') });
    const set = (col) => { if (engine.editing) act.textColor(col); engine.set(tool, { color: col }); };
    const list = tool === 'highlighter' ? HL_PALETTE : PALETTE;
    const mkSw = (col, cls = '') => {
      const b = h('button', { type: 'button', class: 'ik-sw ' + cls + (col.toLowerCase() === c.color.toLowerCase() ? ' on' : ''), style: { background: col }, title: col, 'aria-label': 'Color ' + col, role: 'radio', 'aria-checked': col.toLowerCase() === c.color.toLowerCase() });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => set(col)); return b;
    };
    const more = pref.get('palMore', false), cols = tool === 'highlighter' ? 8 : 10;
    (more ? list : list.slice(0, cols)).forEach((col) => grid.append(mkSw(col)));
    if (!more && !list.slice(0, cols).some((x) => x.toLowerCase() === c.color.toLowerCase()) && list.some((x) => x.toLowerCase() === c.color.toLowerCase())) grid.append(mkSw(c.color, 'recent'));
    row.append(grid);
    const extra = h('div', { class: 'ik-extra' });
    const custom = h('button', { type: 'button', class: 'ik-custom', title: 'Color picker (HSB / HEX / opacity)', 'aria-label': 'Custom color' });
    custom.addEventListener('mousedown', (e) => e.preventDefault());
    custom.addEventListener('click', () => openColorPicker(custom, { color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#000000', alpha: c.alpha ?? 1, withAlpha: tool !== 'text',
      onChange: (hex, a) => { if (engine.editing) act.textColor(hex); engine.settings[tool].color = hex; if (tool !== 'text') engine.settings[tool].alpha = a; engine.saveSettings(); swatchNow.style.background = hex; } }));
    const expand = h('button', { type: 'button', class: 'ik-more' + (more ? ' open' : ''), title: more ? 'Fewer colors' : 'More colors', 'aria-label': more ? 'Fewer colors' : 'More colors', 'aria-expanded': String(more) }, icon('down', 16));
    expand.addEventListener('mousedown', (e) => e.preventDefault());
    expand.addEventListener('click', () => { pref.set('palMore', !more); render(); });
    extra.append(custom, expand, h('span', { class: 'ik-hex', title: 'Current color' }, h('i', { style: { background: c.color } }), c.color.replace('#', '').toUpperCase().slice(0, 6)));
    const favs = pref.get('favcolors', []);
    if (favs.length) { extra.append(h('span', { class: 'ik-vsep' })); favs.slice(0, 6).forEach((col) => extra.append(mkSw(col, 'recent'))); }
    const rec = engine.recent.filter((x) => !list.includes(x)).slice(0, 6);
    if (rec.length) { extra.append(h('span', { class: 'ik-vsep' })); rec.forEach((col) => extra.append(mkSw(col, 'recent'))); }
    row.append(extra);
    return row;
  }
  function sizeRow(tool, c) {
    const [mn, mx, st] = tool === 'text' ? [10, 72, 1] : RANGE[tool];
    const key = tool === 'text' ? 'fontSize' : 'size';
    const val = h('span', { class: 'ik-val' }, String(c[key]));
    const r = h('input', { type: 'range', min: mn, max: mx, step: st, value: c[key], 'aria-label': tool === 'text' ? 'Font size' : 'Size', class: 'ik-range' });
    r.addEventListener('input', () => {
      const v = +r.value; engine.set(tool, { [key]: v }); val.textContent = v;
      if (tool === 'text') act.textSize(v); else drawPreview(tool, engine.settings[tool]);
    });
    const row = h('div', { class: 'ik-size' }, r, val);
    if (tool !== 'text') { drawPreview(tool, c); row.append(preview); }
    return row;
  }
  function presetsRow(tool, c) {
    const list = pref.get('presets', [{ tool: 'pen', color: '#1f2937', size: 2 }, { tool: 'pen', color: '#2563eb', size: 4 }, { tool: 'highlighter', color: '#fde047', size: 18 }]);
    const row = h('div', { class: 'ik-presets', 'aria-label': 'Favorite pens' });
    list.forEach((p, i) => {
      const b = h('button', { type: 'button', class: 'ik-preset', title: `${p.tool} ${p.size} (right-click to remove)`, 'aria-label': `Preset ${p.tool}` },
        h('span', { class: 'dot', style: { background: p.color, width: Math.min(20, 6 + p.size / 2) + 'px', height: Math.min(20, 6 + p.size / 2) + 'px', opacity: p.tool === 'highlighter' ? 0.6 : 1 } }));
      b.addEventListener('click', () => { engine.setTool(p.tool); engine.set(p.tool, { color: p.color, size: p.size, ...(p.brush ? { brush: p.brush } : {}), ...(p.stab != null ? { stab: p.stab } : {}), ...(p.alpha != null ? { alpha: p.alpha } : {}), ...(p.curve != null ? { curve: p.curve } : {}), ...(p.taper != null ? { taper: p.taper } : {}) }); });
      const rm = () => { list.splice(i, 1); pref.set('presets', list); render(); };
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); rm(); });
      let lp; b.addEventListener('pointerdown', () => { lp = setTimeout(rm, 650); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(lp)));
      row.append(b);
    });
    row.append(ibtn('star', 'Save current pen as favorite', () => {
      list.push({ tool, color: c.color, size: c.size, brush: c.brush, stab: c.stab, alpha: c.alpha, curve: c.curve, taper: c.taper }); pref.set('presets', list.slice(-8)); render();
    }, 'sm'));
    return row;
  }
  function hiBtn() { const b = ibtn(null, 'Highlight', () => engine.fmt('hiliteColor', '#fde68a'), 'sm'); b.append(h('b', { style: { background: '#fde68a', color: '#000', padding: '0 3px' } }, 'A')); return b; }
  function textRow() {
    const f = (cmd, ic, label, txt) => { const b = ibtn(null, label, () => engine.fmt(cmd), 'sm'); if (txt) b.append(h('b', {}, txt)); else b.append(icon(ic, 18)); return b; };
    return h('div', { class: 'ik-textfmt' },
      f('bold', null, 'Bold', 'B'), f('italic', null, 'Italic', 'I'), f('underline', null, 'Underline', 'U'), f('strikeThrough', null, 'Strikethrough', 'S'),
      ...(enabled('tts') ? [ibtn('volume', 'Read aloud', (e, b) => act.read(b), 'sm')] : []), ...(enabled('dictation') ? [ibtn('mic', 'Dictate', (e, b) => act.dictate(b), 'sm')] : []),
      f('insertUnorderedList', 'list', 'Bulleted list'), f('insertOrderedList', 'olist', 'Numbered list'), hiBtn(), f('justifyLeft', 'doc', 'Align left'), f('justifyCenter', null, 'Align center', '≡'), f('justifyRight', null, 'Align right', '▤'));
  }
  function render() {
    const tool = engine.tool, c = engine.settings[tool];
    opts.replaceChildren();
    opts.dataset.for = tool;
    const sh = tool === 'shape';
    if (['pen', 'highlighter', 'pencil', 'shape'].includes(tool)) {
      if (sh) {
        const kinds = h('div', { class: 'ik-seg', role: 'radiogroup', 'aria-label': 'Shape' });
        const shelf = h('select', { class: 'ik-ref-sel', 'aria-label': 'Shape', style: { flex: 'none', width: 'auto' } }, ...SHAPES.map(([k, name]) => h('option', { value: k }, name)));
        shelf.value = c.kind; shelf.addEventListener('change', () => engine.set('shape', { kind: shelf.value }));
        const quick = h('div', { class: 'ik-seg', role: 'radiogroup', 'aria-label': 'Quick shapes' });
        for (const k of ['line', 'arrow', 'rect', 'ellipse', 'star']) quick.append(h('button', { type: 'button', class: 'ik-segb' + (c.kind === k ? ' on' : ''), title: k, onclick: () => engine.set('shape', { kind: k }) }, SHAPES.find((x) => x[0] === k)[1]));
        const fillRow = h('div', { class: 'ik-colors', 'aria-label': 'Fill' }, h('span', { class: 'ik-hint' }, 'Fill'),
          h('button', { type: 'button', class: 'ik-sw' + (!c.fill ? ' on' : ''), title: 'No fill', style: { background: 'linear-gradient(135deg,#fff 45%,#e11 46% 54%,#fff 55%)' }, onclick: () => engine.set('shape', { fill: null }) }),
          ...PALETTE.slice(1, 9).map((col) => h('button', { type: 'button', class: 'ik-sw' + (c.fill === col ? ' on' : ''), style: { background: col }, title: 'Fill ' + col, onclick: () => engine.set('shape', { fill: col }) })));
        const dash = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Dashed');
        dash.firstChild.checked = !!c.dash; dash.firstChild.addEventListener('change', (e) => engine.set('shape', { dash: e.target.checked }));
        opts.append(quick, shelf, fillRow, dash);
        if (enabled('excalidraw')) {
          const sk = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Sketch style');
          sk.firstChild.checked = !!c.sketch; sk.firstChild.addEventListener('change', (e) => engine.set('shape', { sketch: e.target.checked }));
          const fsel = h('select', { class: 'ik-ref-sel', 'aria-label': 'Fill style', style: { flex: 'none', width: 'auto' } }, ...[['solid', 'Solid fill'], ['hachure', 'Hachure'], ['cross', 'Cross-hatch']].map(([v, n]) => h('option', { value: v }, n)));
          fsel.value = c.fillStyle || 'solid'; fsel.addEventListener('change', () => engine.set('shape', { fillStyle: fsel.value }));
          opts.append(sk, fsel);
        }
      }
      const adv = [];
      if (tool === 'pen') {
        const sel = h('select', { class: 'ik-ref-sel', 'aria-label': 'Brush', style: { flex: 'none', width: 'auto' } }, ...BRUSHES.map(([id, n]) => h('option', { value: id }, n)));
        sel.value = c.brush || 'fine'; sel.addEventListener('change', () => engine.set('pen', { brush: sel.value }));
        const st = h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: c.stab || 0, class: 'ik-range', title: 'Stabilizer', 'aria-label': 'Stabilizer', style: { width: '70px' } });
        st.addEventListener('input', () => engine.set('pen', { stab: +st.value }));
        const sl = (label, key, mn, mx, stp, dv) => { const r = h('input', { type: 'range', min: mn, max: mx, step: stp, value: c[key] ?? dv, class: 'ik-range', title: label, 'aria-label': label, style: { width: '70px' } }); r.addEventListener('input', () => engine.set('pen', { [key]: +r.value })); return h('label', { class: 'ik-check-l' }, label, r); };
        adv.push(sel, h('label', { class: 'ik-check-l' }, 'Stabilizer', st), sl('Pressure', 'curve', 0.5, 2, 0.1, 1), sl('Taper', 'taper', 0, 0.5, 0.05, 0.2));
      }
      opts.append(sizeRow(tool, c), colorRow(tool, c));
      if (tool === 'highlighter') {
        const ch = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Chisel tip');
        ch.firstChild.checked = !!c.chisel; ch.firstChild.addEventListener('change', (e) => engine.set('highlighter', { chisel: e.target.checked })); adv.push(ch);
      }
      if (tool === 'pen' || tool === 'highlighter') {
        const sn = h('label', { class: 'ik-check-l', title: 'Hold at the end of a stroke to snap lines and shapes' }, h('input', { type: 'checkbox', checked: c.snap ? '' : null }), 'Snap on hold');
        sn.firstChild.checked = !!c.snap; sn.firstChild.addEventListener('change', (e) => engine.set(tool, { snap: e.target.checked }));
        adv.push(sn);
      }
      if (adv.length) { const d = h('details', { class: 'ik-adv' }, h('summary', {}, tool === 'pen' ? 'Pen settings' : 'More settings'), h('div', { class: 'ik-adv-in' }, ...adv)); d.open = !!pref.get('advOpen', false); d.addEventListener('toggle', () => pref.set('advOpen', d.open)); opts.append(d); }
      opts.append(presetsRow(tool, c));
    } else if (tool === 'eraser') {
      const seg = h('div', { class: 'ik-seg', role: 'radiogroup', 'aria-label': 'Eraser mode' });
      for (const [m, n] of [['stroke', 'Stroke'], ['pixel', 'Pixel']]) seg.append(h('button', { type: 'button', class: 'ik-segb' + (c.mode === m ? ' on' : ''), onclick: () => engine.set('eraser', { mode: m }) }, n));
      opts.append(seg, sizeRow('eraser', c));
    } else if (tool === 'text') {
      const fs = h('select', { class: 'ik-ref-sel', 'aria-label': 'Font', style: { flex: 'none', width: 'auto', fontFamily: c.font || '' } });
      const rec = fontLib.recent();
      if (rec.length) fs.append(h('optgroup', { label: 'Recent' }, ...rec.map((f) => h('option', { value: f }, f.split(',')[0].replace(/"/g, '')))));
      fs.append(h('optgroup', { label: 'Fonts' }, ...[...FONTS, ...fontLib.extra].map(([n, f]) => h('option', { value: f, style: { fontFamily: f } }, n))));
      fs.value = c.font || FONTS[0][1];
      fs.addEventListener('change', () => { engine.set('text', { font: fs.value }); fontLib.note(fs.value); if (engine.editing) engine.editing.t.style.fontFamily = fs.value; });
      const fi = h('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', hidden: true });
      fi.addEventListener('change', async () => { const f = fi.files[0]; if (!f) return; const m = await import('./fonts.js'); const fam = await m.importFont(f); fontLib.extra.push([fam, m.fontStack(fam)]); engine.set('text', { font: m.fontStack(fam) }); render(); });
      const importBtn = ibtn(null, 'Import font file', () => fi.click(), 'sm'); importBtn.append(h('b', {}, 'Aa+'));
      const sysBtn = window.queryLocalFonts ? ibtn(null, 'Use system fonts', async () => { const m = await import('./fonts.js'); const l = await m.localFonts(); if (l?.length) { fontLib.extra.push(...l.slice(0, 400).map((n) => [n, m.fontStack(n)])); render(); } else toast('No system fonts available'); }, 'sm') : null;
      sysBtn?.append(h('b', {}, 'Sys'));
      opts.append(textRow(), fs, importBtn, sysBtn, fi, colorRow('text', c), sizeRow('text', c));
    } else if (tool === 'select') {
      const sm = c.mode === 'rect' ? 'rect' : 'free';
      const seg = h('div', { class: 'ik-seg', role: 'radiogroup', 'aria-label': 'Selection shape' },
        ...[['free', 'Freehand', 'Draw a loop around what you want'], ['rect', 'Rectangle', 'Drag a box around what you want']].map(([k, label, tip]) => {
          const b = h('button', { type: 'button', class: sm === k ? 'on' : '', role: 'radio', 'aria-checked': String(sm === k), title: tip }, label);
          b.addEventListener('click', () => engine.set('select', { mode: k })); return b;
        }));
      opts.append(seg, h('span', { class: 'ik-hint' }, sm === 'rect' ? 'Drag a rectangle to select strokes and objects, or tap one. Corners resize.' : 'Draw a loop to select strokes and objects, or tap one. Corners resize.'));
    } else if (tool === 'laser') {
      opts.append(h('span', { class: 'ik-hint' }, 'Laser pointer: drag to point. Nothing is saved.'));
    } else if (tool === 'hand') {
      opts.append(h('span', { class: 'ik-hint' }, 'Drag to pan the page. Pinch or Ctrl+scroll to zoom.'));
    }
    opts.classList.toggle('empty', !opts.childNodes.length);
    swatchNow.style.background = c?.color || 'transparent';
    paintQuick();
  }
  // ---- quick colour + size row (floating layout) ----
  const QBASE = ['#111827', '#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#db2777'];
  const QSIZE = { pen: [1.5, 3, 6], highlighter: [10, 18, 32], pencil: [1, 2.5, 5], shape: [2, 4, 8], eraser: [8, 14, 28], text: [16, 22, 36] };
  function paintQuick() {
    const tool = engine.tool, c = engine.settings[tool], sizes = QSIZE[tool];
    qrow.replaceChildren();
    const key = tool === 'text' ? 'fontSize' : 'size';
    if (!c || (!COLORED.includes(tool) && !sizes)) { qrow.hidden = true; return; }
    qrow.hidden = false;
    if (COLORED.includes(tool) && c.color) {
      const base = tool === 'highlighter' ? HL_PALETTE : QBASE;
      let list = [...new Set([...pref.get('favcolors', []).slice(0, 2), ...engine.recent.slice(0, 3), ...base].map((x) => x.toLowerCase()))].slice(0, 8);
      if (!list.includes(c.color.toLowerCase())) list = [c.color.toLowerCase(), ...list.slice(0, 7)];
      const grp = h('div', { class: 'ik-qcols', role: 'radiogroup', 'aria-label': 'Colour' });
      for (const col of list) {
        const on = col === c.color.toLowerCase();
        const b = h('button', { type: 'button', class: 'ik-qs' + (on ? ' on' : ''), style: { background: col }, 'aria-label': 'Colour ' + col, role: 'radio', 'aria-checked': String(on) });
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { if (engine.editing) act.textColor(col); engine.set(tool, { color: col }); });
        grp.append(b);
      }
      const plus = h('button', { type: 'button', class: 'ik-qs add', 'aria-label': 'More colours', title: 'More colours' }, '+');
      plus.addEventListener('mousedown', (e) => e.preventDefault());
      plus.addEventListener('click', () => openColorPicker(plus, { color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#000000', alpha: c.alpha ?? 1, withAlpha: tool !== 'text', onChange: (hex, a) => { if (engine.editing) act.textColor(hex); engine.settings[tool].color = hex; if (tool !== 'text') engine.settings[tool].alpha = a; engine.saveSettings(); engine.emit('settings', tool); } }));
      grp.append(plus); qrow.append(grp);
    }
    if (sizes) {
      if (qrow.childNodes.length) qrow.append(h('span', { class: 'ik-vsep' }));
      const cur = c[key] ?? sizes[1], near = sizes.reduce((bi, v, i) => (Math.abs(v - cur) < Math.abs(sizes[bi] - cur) ? i : bi), 0);
      const grp = h('div', { class: 'ik-qsizes', role: 'radiogroup', 'aria-label': 'Size' });
      sizes.forEach((v, i) => {
        const b = h('button', { type: 'button', class: 'ik-qz' + (i === near ? ' on' : ''), 'aria-label': 'Size ' + v, role: 'radio', 'aria-checked': String(i === near) }, h('i', { style: { width: [7, 12, 18][i] + 'px', height: [7, 12, 18][i] + 'px' } }));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { engine.set(tool, { [key]: v }); if (tool === 'text') act.textSize(v); });
        grp.append(b);
      });
      qrow.append(grp);
    }
    const more = ibtn('sliders', 'All options', () => act.toggleOptions(), 'sm ik-qmore'); qrow.append(more);
  }
  function refresh() {
    { const cc = engine.settings[engine.tool]?.color; swatchNow.style.background = cc || 'transparent'; swatchNow.style.display = cc ? '' : 'none'; }
    for (const id of COLORED) if (btns[id]) { btns[id].dataset.colored = ''; btns[id].style.setProperty('--tc', engine.settings[id]?.color || '#888'); }
    for (const id in btns) {
      if (id === 'ruler') btns[id].classList.toggle('on', !!engine.ruler?.on);
      else if (btns[id].dataset.tool === engine.tool) { btns[id].classList.add('on'); btns[id].setAttribute('aria-pressed', 'true'); }
      else { btns[id].classList.remove('on'); btns[id].setAttribute('aria-pressed', 'false'); }
    }
    undo.disabled = !engine.history.canUndo; redo.disabled = !engine.history.canRedo;
  }
  const offs = [
    engine.on('tool', () => { refresh(); render(); }),
    engine.on('settings', (t) => { if (t === engine.tool || t === 'recent') render(); refresh(); }),
    engine.on('history', refresh),
  ];
  render(); refresh();
  return {
    el: bar, opts, refresh, render,
    emojiGrid(onPick, close) {
      const g = h('div', { class: 'ik-emoji' });
      const notes = h('div', { class: 'ik-colors', style: { gridColumn: '1 / -1', padding: '4px 6px' } }, h('span', { class: 'ik-hint' }, 'Sticky note'),
        ...['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#fed7aa'].map((col) => h('button', { type: 'button', class: 'ik-sw', style: { background: col }, 'aria-label': 'Sticky note ' + col, onclick: () => { act.sticky(col); close(); } })));
      g.append(notes);
      EMOJI.forEach((e) => g.append(h('button', { type: 'button', class: 'ik-emo', onclick: () => { onPick(e); close(); } }, e)));
      return g;
    },
    destroy() { offs.forEach((f) => f()); },
  };
}
void popover;
