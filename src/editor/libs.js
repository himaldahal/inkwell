// Element library: built-in flowchart / UML / icon elements plus the user's saved selections.
import { h, newId } from '../core/utils.js';
import { shapePts } from './stroke.js';
import { withData } from './items.js';
import { popover, pref } from './ui.js';

const S = (kind, x1, y1, x2, y2, extra = {}) => ({ id: newId(), tool: 'pen', color: '#1f2937', size: 2.5, shape: kind, pts: shapePts(kind, x1, y1, x2, y2), ...extra });
const T = (txt, x, y, w, hh, fs = 18) => withData({ id: newId(), type: 'text', x, y, w, h: hh, rotation: 0, html: txt, text: txt, fontSize: fs, color: '#111827', align: 'center' });
const E = (emoji) => withData({ id: newId(), type: 'sticker', emoji, x: 0, y: 0, w: 70, h: 70, rotation: 0 });
export const BUILTIN = [
  { name: 'Process', w: 160, h: 70, make: () => ({ strokes: [S('rect', 0, 0, 160, 70)], items: [T('Process', 10, 22, 140, 30)] }) },
  { name: 'Decision', w: 170, h: 110, make: () => ({ strokes: [S('diamond', 0, 0, 170, 110)], items: [T('Yes / No?', 20, 40, 130, 30)] }) },
  { name: 'Start / End', w: 170, h: 60, make: () => ({ strokes: [S('rrect', 0, 0, 170, 60, { fill: '#fde68a', fillStyle: 'solid' })], items: [T('Start', 10, 16, 150, 30)] }) },
  { name: 'Data', w: 160, h: 80, make: () => ({ strokes: [S('hexagon', 0, 0, 160, 80)], items: [T('Data', 10, 25, 140, 30)] }) },
  { name: 'Arrow', w: 140, h: 4, make: () => ({ strokes: [S('arrow', 0, 0, 140, 0)], items: [] }) },
  { name: 'Class (UML)', w: 190, h: 130, make: () => ({ strokes: [S('rect', 0, 0, 190, 130), S('line', 0, 34, 190, 34), S('line', 0, 84, 190, 84)], items: [T('ClassName', 10, 5, 170, 26, 17), T('+ attribute', 10, 42, 170, 26, 15), T('+ method()', 10, 92, 170, 26, 15)] }) },
  { name: 'Actor', w: 60, h: 120, make: () => ({ strokes: [S('ellipse', 18, 0, 42, 24), S('line', 30, 24, 30, 76), S('line', 0, 40, 60, 40), S('line', 30, 76, 6, 118), S('line', 30, 76, 54, 118)], items: [] }) },
  { name: 'Speech bubble', w: 180, h: 110, make: () => ({ strokes: [S('bubble', 0, 0, 180, 110)], items: [T('Say something', 15, 25, 150, 30)] }) },
  { name: 'Axes', w: 220, h: 160, make: () => ({ strokes: [S('axis', 0, 0, 220, 160)], items: [] }) },
  { name: 'Table', w: 240, h: 120, make: () => ({ strokes: [S('table', 0, 0, 240, 120)], items: [] }) },
  ...['⭐', '✅', '❓', '⚠️', '💡', '🎯'].map((e) => ({ name: e, w: 70, h: 70, make: () => ({ strokes: [], items: [E(e)] }) })),
];
/** concrete strokes/items (fresh ids) at offset (ox, oy) */
export function instantiate(entry, ox, oy) {
  if (entry.make) { const r = entry.make(); return { strokes: r.strokes.map((s) => shift(s, ox, oy)), items: r.items.map((i) => ({ ...i, x: i.x + ox, y: i.y + oy })) }; }
  return { strokes: entry.strokes.map((s) => shift({ ...s, id: newId() }, ox, oy)), items: entry.items.map((i) => withData({ ...i, id: newId(), x: i.x + ox, y: i.y + oy })) };
}
const shift = (s, ox, oy) => ({ ...s, id: s.id || newId(), pts: s.pts.map((v, i) => (i % 3 === 0 ? v + ox : i % 3 === 1 ? v + oy : v)) });

export function openLibrary(anchor, engine) {
  const grid = h('div', { class: 'ik-lib' });
  let pop;
  const paint = () => {
    const mine = pref.get('library', []);
    grid.replaceChildren(h('div', { class: 'ik-menu-title', style: { gridColumn: '1/-1' } }, 'Elements'),
      ...BUILTIN.map((e) => h('button', { type: 'button', class: 'ik-lib-i', onclick: () => { engine.insertLibrary(e); pop.close(); } }, e.name)),
      h('div', { class: 'ik-menu-title', style: { gridColumn: '1/-1' } }, 'My library'),
      ...(mine.length ? mine.map((e, i) => h('span', { class: 'ik-lib-w' }, h('button', { type: 'button', class: 'ik-lib-i', onclick: () => { engine.insertLibrary(e); pop.close(); } }, e.name),
        h('button', { type: 'button', class: 'ik-lib-x', 'aria-label': 'Remove ' + e.name, onclick: () => { mine.splice(i, 1); pref.set('library', mine); paint(); } }, '×'))) : [h('p', { class: 'ik-hint', style: { gridColumn: '1/-1' } }, 'Select objects, then More > Save to library.')]));
  };
  paint(); pop = popover(anchor, grid, { cls: 'wide' });
}
