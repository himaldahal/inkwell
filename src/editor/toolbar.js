// Tool bar + tool options panel (colors, size, presets, eraser mode, shape kind, text formatting).
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { ibtn, pref, popover } from './ui.js';
import { toast } from '../core/store.js';
import { enabled } from './mods.js';
import { drawStroke } from './stroke.js';
import { BRUSHES, FONTS } from './brushes.js';
import { SHAPES } from './shapes.js';
import { openColorPicker } from './colorpicker.js';

const PALETTE = ['#111827', '#4f46e5', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#9333ea', '#db2777', '#6b7280', '#ffffff'];
const HL_PALETTE = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74', '#c4b5fd', '#fca5a5'];
const RANGE = { pen: [0.5, 24, 0.5], highlighter: [6, 50, 1], pencil: [0.5, 12, 0.5], shape: [0.5, 20, 0.5], eraser: [4, 60, 1] };
const EMOJI = '😀 😂 😍 🤔 😎 😴 👍 👎 👏 🙏 💡 ⭐ ✅ ❌ ❗ ❓ 🔥 💯 🎯 📌 📎 📝 📚 🧠 ❤️ 💙 🟡 🟢 🔴 ➡️ ⬆️ ⚠️ 🎉 ☕ 🕐 📅 🔍 💬 🚀'.split(' ');

const fontLib = { extra: [], recent: () => pref.get('recentfonts', []), note(f) { pref.set('recentfonts', [f, ...fontLib.recent().filter((x) => x !== f)].slice(0, 5)); } };
export function buildToolbar(engine, act) {
  import('./fonts.js').then(async (m) => { const l = await m.loadSavedFonts(); fontLib.extra = l.map((f) => [f, m.fontStack(f)]); if (engine.tool === 'text') render(); }).catch(() => {});
  const TOOLS = [
    ['pen', 'Pen (P)'], ['highlighter', 'Highlighter (H)'], ['pencil', 'Pencil (N)'], ['eraser', 'Eraser (E)'], ['select', 'Lasso select (V)'],
    ['shape', 'Shapes (S)'], ['text', 'Text box (T)'], ['image', 'Insert image (I)', 'action'], ['sticker', 'Stickers', 'action'], ['library', 'Element library', 'action'],
    ['laser', 'Laser pointer (L)'], ['hand', 'Hand / pan (Space)'], ['ruler', 'Ruler (R)', 'toggle'],
  ];
  const tools = h('div', { class: 'ik-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const btns = {};
  for (const [id, label, kind] of TOOLS) {
    const b = ibtn(id, label, (e, el) => {
      if (id === 'image') act.pickImage();
      else if (id === 'sticker') act.stickers(el);
      else if (id === 'library') act.library(el);
      else if (id === 'ruler') act.toggleRuler();
      else engine.setTool(id);
    }, 'tool t-' + id);
    b.dataset.tool = id; if (!kind) b.setAttribute('aria-pressed', 'false'); btns[id] = b; tools.append(b);
  }
  const undo = ibtn('undo', 'Undo (Ctrl+Z)', () => engine.undo(), 'hist');
  const redo = ibtn('redo', 'Redo (Ctrl+Shift+Z)', () => engine.redo(), 'hist');
  const optBtn = ibtn('sliders', 'Tool options', () => act.toggleOptions(), 'optbtn');
  const swatchNow = h('span', { class: 'ik-now' });
  optBtn.append(swatchNow);
  const bar = h('div', { class: 'ik-toolbar' }, tools, h('div', { class: 'ik-histbtns' }, undo, redo), optBtn);
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
    const row = h('div', { class: 'ik-colors', role: 'radiogroup', 'aria-label': 'Color' });
    const set = (col) => { if (engine.editing) act.textColor(col); engine.set(tool, { color: col }); };
    const list = tool === 'highlighter' ? HL_PALETTE : PALETTE;
    const mkSw = (col, cls = '') => {
      const b = h('button', { type: 'button', class: 'ik-sw ' + cls + (col.toLowerCase() === c.color.toLowerCase() ? ' on' : ''), style: { background: col }, title: col, 'aria-label': 'Color ' + col, role: 'radio', 'aria-checked': col.toLowerCase() === c.color.toLowerCase() });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => set(col)); return b;
    };
    list.forEach((col) => row.append(mkSw(col)));
    const custom = h('button', { type: 'button', class: 'ik-custom', title: 'Color picker (HSB / HEX / opacity)', 'aria-label': 'Custom color' });
    custom.addEventListener('mousedown', (e) => e.preventDefault());
    custom.addEventListener('click', () => openColorPicker(custom, { color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#000000', alpha: c.alpha ?? 1, withAlpha: tool !== 'text',
      onChange: (hex, a) => { if (engine.editing) act.textColor(hex); engine.settings[tool].color = hex; if (tool !== 'text') engine.settings[tool].alpha = a; engine.saveSettings(); swatchNow.style.background = hex; } }));
    row.append(custom);
    const favs = pref.get('favcolors', []);
    if (favs.length) { row.append(h('span', { class: 'ik-vsep' })); favs.slice(0, 6).forEach((col) => row.append(mkSw(col, 'recent'))); }
    const rec = engine.recent.filter((x) => !list.includes(x)).slice(0, 5);
    if (rec.length) { row.append(h('span', { class: 'ik-vsep' })); rec.forEach((col) => row.append(mkSw(col, 'recent'))); }
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
      if (tool === 'pen') {
        const sel = h('select', { class: 'ik-ref-sel', 'aria-label': 'Brush', style: { flex: 'none', width: 'auto' } }, ...BRUSHES.map(([id, n]) => h('option', { value: id }, n)));
        sel.value = c.brush || 'fine'; sel.addEventListener('change', () => engine.set('pen', { brush: sel.value }));
        const st = h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: c.stab || 0, class: 'ik-range', title: 'Stabilizer', 'aria-label': 'Stabilizer', style: { width: '70px' } });
        st.addEventListener('input', () => engine.set('pen', { stab: +st.value }));
        const sl = (label, key, mn, mx, stp, dv) => { const r = h('input', { type: 'range', min: mn, max: mx, step: stp, value: c[key] ?? dv, class: 'ik-range', title: label, 'aria-label': label, style: { width: '70px' } }); r.addEventListener('input', () => engine.set('pen', { [key]: +r.value })); return h('label', { class: 'ik-check-l' }, label, r); };
        opts.append(sel, h('label', { class: 'ik-check-l' }, 'Stabilizer', st), sl('Pressure', 'curve', 0.5, 2, 0.1, 1), sl('Taper', 'taper', 0, 0.5, 0.05, 0.2));
      }
      opts.append(colorRow(tool, c), sizeRow(tool, c));
      if (tool === 'highlighter') {
        const ch = h('label', { class: 'ik-check-l' }, h('input', { type: 'checkbox' }), 'Chisel tip');
        ch.firstChild.checked = !!c.chisel; ch.firstChild.addEventListener('change', (e) => engine.set('highlighter', { chisel: e.target.checked })); opts.append(ch);
      }
      if (tool === 'pen' || tool === 'highlighter') {
        const sn = h('label', { class: 'ik-check-l', title: 'Hold at the end of a stroke to snap lines and shapes' }, h('input', { type: 'checkbox', checked: c.snap ? '' : null }), 'Snap on hold');
        sn.firstChild.checked = !!c.snap; sn.firstChild.addEventListener('change', (e) => engine.set(tool, { snap: e.target.checked }));
        opts.append(sn);
      }
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
      opts.append(h('span', { class: 'ik-hint' }, 'Draw a loop to select strokes and objects, or tap one. Drag to move, corners to resize.'));
    } else if (tool === 'laser') {
      opts.append(h('span', { class: 'ik-hint' }, 'Laser pointer: drag to point. Nothing is saved.'));
    } else if (tool === 'hand') {
      opts.append(h('span', { class: 'ik-hint' }, 'Drag to pan the page. Pinch or Ctrl+scroll to zoom.'));
    }
    opts.classList.toggle('empty', !opts.childNodes.length);
    swatchNow.style.background = c?.color || 'transparent';
  }
  function refresh() {
    for (const id in btns) {
      if (id === 'ruler') btns[id].classList.toggle('on', !!engine.ruler?.on);
      else if (btns[id].dataset.tool === engine.tool) { btns[id].classList.add('on'); btns[id].setAttribute('aria-pressed', 'true'); }
      else { btns[id].classList.remove('on'); btns[id].setAttribute('aria-pressed', 'false'); }
    }
    undo.disabled = !engine.history.canUndo; redo.disabled = !engine.history.canRedo;
  }
  const offs = [
    engine.on('tool', () => { refresh(); render(); }),
    engine.on('settings', (t) => { if (t === engine.tool || t === 'recent') render(); }),
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
