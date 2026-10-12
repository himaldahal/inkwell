// Tool bar + tool options panel (colors, size, presets, eraser mode, shape kind, text formatting).
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { ibtn, pref, popover } from './ui.js';
import { drawStroke } from './stroke.js';
import { BRUSHES, FONTS } from './brushes.js';

const PALETTE = ['#111827', '#4f46e5', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#9333ea', '#db2777', '#6b7280', '#ffffff'];
const HL_PALETTE = ['#fde047', '#86efac', '#7dd3fc', '#f9a8d4', '#fdba74', '#c4b5fd', '#fca5a5'];
const RANGE = { pen: [0.5, 24, 0.5], highlighter: [6, 50, 1], pencil: [0.5, 12, 0.5], shape: [0.5, 20, 0.5], eraser: [4, 60, 1] };
const EMOJI = '😀 😂 😍 🤔 😎 😴 👍 👎 👏 🙏 💡 ⭐ ✅ ❌ ❗ ❓ 🔥 💯 🎯 📌 📎 📝 📚 🧠 ❤️ 💙 🟡 🟢 🔴 ➡️ ⬆️ ⚠️ 🎉 ☕ 🕐 📅 🔍 💬 🚀'.split(' ');
const SHAPES = [['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle']];

export function buildToolbar(engine, act) {
  const TOOLS = [
    ['pen', 'Pen (P)'], ['highlighter', 'Highlighter (H)'], ['pencil', 'Pencil (N)'], ['eraser', 'Eraser (E)'], ['select', 'Lasso select (V)'],
    ['shape', 'Shapes (S)'], ['text', 'Text box (T)'], ['image', 'Insert image (I)', 'action'], ['sticker', 'Stickers', 'action'],
    ['laser', 'Laser pointer (L)'], ['hand', 'Hand / pan (Space)'], ['ruler', 'Ruler (R)', 'toggle'],
  ];
  const tools = h('div', { class: 'ik-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const btns = {};
  for (const [id, label, kind] of TOOLS) {
    const b = ibtn(id, label, (e, el) => {
      if (id === 'image') act.pickImage();
      else if (id === 'sticker') act.stickers(el);
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
    const custom = h('input', { type: 'color', class: 'ik-custom', value: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#000000', title: 'Custom color', 'aria-label': 'Custom color' });
    custom.addEventListener('input', () => set(custom.value));
    row.append(custom);
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
      b.addEventListener('click', () => { engine.setTool(p.tool); engine.set(p.tool, { color: p.color, size: p.size }); });
      const rm = () => { list.splice(i, 1); pref.set('presets', list); render(); };
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); rm(); });
      let lp; b.addEventListener('pointerdown', () => { lp = setTimeout(rm, 650); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => clearTimeout(lp)));
      row.append(b);
    });
    row.append(ibtn('star', 'Save current pen as favorite', () => {
      list.push({ tool, color: c.color, size: c.size }); pref.set('presets', list.slice(-8)); render();
    }, 'sm'));
    return row;
  }
  function textRow() {
    const f = (cmd, ic, label, txt) => { const b = ibtn(null, label, () => engine.fmt(cmd), 'sm'); if (txt) b.append(h('b', {}, txt)); else b.append(icon(ic, 18)); return b; };
    return h('div', { class: 'ik-textfmt' },
      f('bold', null, 'Bold', 'B'), f('italic', null, 'Italic', 'I'), f('underline', null, 'Underline', 'U'), f('strikeThrough', null, 'Strikethrough', 'S'),
      f('insertUnorderedList', 'list', 'Bulleted list'), f('justifyLeft', 'doc', 'Align left'), f('justifyCenter', null, 'Align center', '≡'), f('justifyRight', null, 'Align right', '▤'));
  }
  function render() {
    const tool = engine.tool, c = engine.settings[tool];
    opts.replaceChildren();
    opts.dataset.for = tool;
    const sh = tool === 'shape';
    if (['pen', 'highlighter', 'pencil', 'shape'].includes(tool)) {
      if (sh) {
        const kinds = h('div', { class: 'ik-seg', role: 'radiogroup', 'aria-label': 'Shape' });
        for (const [k, name] of SHAPES) kinds.append(h('button', { type: 'button', class: 'ik-segb' + (c.kind === k ? ' on' : ''), title: name, onclick: () => engine.set('shape', { kind: k }) }, name));
        opts.append(kinds);
      }
      if (tool === 'pen') {
        const sel = h('select', { class: 'ik-ref-sel', 'aria-label': 'Brush', style: { flex: 'none', width: 'auto' } }, ...BRUSHES.map(([id, n]) => h('option', { value: id }, n)));
        sel.value = c.brush || 'fine'; sel.addEventListener('change', () => engine.set('pen', { brush: sel.value }));
        const st = h('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: c.stab || 0, class: 'ik-range', title: 'Stabilizer', 'aria-label': 'Stabilizer', style: { width: '70px' } });
        st.addEventListener('input', () => engine.set('pen', { stab: +st.value }));
        opts.append(sel, st);
      }
      opts.append(colorRow(tool, c), sizeRow(tool, c));
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
      const fs = h('select', { class: 'ik-ref-sel', 'aria-label': 'Font', style: { flex: 'none', width: 'auto' } }, ...FONTS.map(([n, f]) => h('option', { value: f }, n)));
      fs.value = c.font || FONTS[0][1];
      fs.addEventListener('change', () => { engine.set('text', { font: fs.value }); if (engine.editing) engine.editing.t.style.fontFamily = fs.value; });
      opts.append(textRow(), fs, colorRow('text', c), sizeRow('text', c));
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
      EMOJI.forEach((e) => g.append(h('button', { type: 'button', class: 'ik-emo', onclick: () => { onPick(e); close(); } }, e)));
      return g;
    },
    destroy() { offs.forEach((f) => f()); },
  };
}
void popover;
