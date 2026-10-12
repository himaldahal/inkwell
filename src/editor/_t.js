import { putRecord, blankNote } from '/src/core/db.js';
import { mountEditor } from '/src/editor/index.js';
import { renderNotePreviewSync } from '/src/editor/preview.js';
import { buildToc, insertToc } from '/src/editor/toc.js';
import { parseEmbed } from '/src/editor/embeds.js';
const log = []; const out = (k, v) => log.push(k + ': ' + JSON.stringify(v));
window.addEventListener('error', (e) => out('ERR', e.message + ' ' + e.filename + ':' + e.lineno));
window.addEventListener('unhandledrejection', (e) => out('REJ', String(e.reason && e.reason.stack || e.reason)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nonWhite = (url) => new Promise((res) => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200) n++; res(n); }; im.src = url; });
try {
  // 1 preview of text-only note
  const tn = blankNote({ title: 'Meeting', text: '<h1>Agenda</h1><p>Discuss the roadmap and ship dates for the next quarter</p><ul><li>Item one</li><li>Item two</li></ul>' });
  const url = renderNotePreviewSync(tn, { w: 300 }); out('text preview px', await nonWhite(url));
  const n = blankNote({ title: 'T', text: '<h1>Intro</h1><p>x</p><h2>Part A</h2><h2>Part B</h2>' }); n.pages[0].title = 'Cover'; await putRecord('notes', n);
  const A = mountEditor(document.getElementById('a'), n.id, {}); await wait(900);
  const e = A.engine, pv = e.pvs[0];
  // 2 page colors
  e.setPageStyle(0, { paperGrad: ['#ff0000', '#0000ff'] }); await wait(200);
  const px = e.pvs[0].ctx('bg').getImageData(5, 5, 1, 1).data; out('bg pixel (red-ish)', [px[0], px[1], px[2]]);
  e.setPageStyle(0, { paperGrad: null, paper: '#00ff00' }); await wait(200);
  const px2 = e.pvs[0].ctx('bg').getImageData(5, 5, 1, 1).data; out('bg pixel (green)', [px2[0], px2[1], px2[2]]);
  // 3 toc
  const ed = document.querySelector('.ik-rich'); const ents = buildToc(e.note, ed); out('toc entries', ents.map((x) => x.type + ':' + x.text));
  insertToc(e.note, ed); out('toc links', ed.querySelectorAll('[data-toc] a').length);
  // 4 embeds
  out('yt', parseEmbed('https://youtu.be/dQw4w9WgXcQ')?.embedUrl); out('evil', parseEmbed('javascript:alert(1)')); out('unknown kind', parseEmbed('https://example.com/a')?.kind);
  e.insertEmbed(parseEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')); await wait(150);
  const btn = document.querySelector('.ik-embed-btn'); out('embed placeholder', !!btn); btn?.click(); await wait(100);
  const fr = document.querySelector('.ik-embed iframe'); out('iframe sandbox', fr?.getAttribute('sandbox')?.slice(0, 30)); out('iframe referrer', fr?.referrerPolicy);
  // 5 ocr (no module) must not throw
  e.emit('ocr', { selection: false }); await wait(200);
  // 6 sketch + connectors
  e.setTool('shape'); e.set('shape', { kind: 'rect', sketch: true, fill: '#fbbf24', fillStyle: 'hachure' });
  let page = document.querySelector('.ik-page'); let r = page.getBoundingClientRect();
  const ev = (t, x, y) => page.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen', pressure: .6, clientX: r.left + x, clientY: r.top + y, buttons: t === 'pointerup' ? 0 : 1 }));
  const drag = (a, b, c, d) => { ev('pointerdown', a, b); ev('pointermove', (a + c) / 2, (b + d) / 2); ev('pointermove', c, d); ev('pointerup', c, d); };
  drag(100, 500, 220, 580); drag(500, 500, 620, 580);
  e.set('shape', { kind: 'arrow', sketch: false, fill: null }); drag(160, 540, 560, 540);
  const live = e.pvs[0].page.strokes.filter((s) => !s.deleted);
  out('shapes', live.map((s) => [s.shape, !!s.sketch, s.fillStyle || '', !!s.bind]));
  const arrow = live.find((s) => s.shape === 'arrow'); const before = arrow.pts.slice(0, 2);
  e.setTool('select'); const A1 = live[0]; e.tools.select.selectIds(e.pvs[0], [A1.id], []);
  e.tools.select.mutate((s) => ({ ...s, pts: s.pts.map((v, i) => (i % 3 === 1 ? v + 60 : v)) }), (i) => i);
  const arrow2 = e.pvs[0].page.strokes.filter((s) => !s.deleted).find((s) => s.shape === 'arrow'); out('arrow followed', [before, arrow2.pts.slice(0, 2)]);
  // 7 library
  const m = await import('/src/editor/libs.js'); const cnt = e.pvs[0].page.strokes.length; e.insertLibrary(m.BUILTIN[5]); await wait(300);
  out('library added strokes/items', [e.pvs[0].page.strokes.length - cnt, e.pvs[0].page.items.filter((i) => i.type === 'text' && !i.deleted).length]);
  // 8 lock
  e.tools.select.lock(true); e.tools.select.delete(); out('locked survives delete', e.pvs[0].page.strokes.filter((s) => !s.deleted).length > 0);
  // frame
  e.insertFrame('Group A'); await wait(100); out('frame', !!document.querySelector('.ik-frame'));
  // 9 infinite
  e.addInfinitePage(); await wait(400); const inf = e.pvs.at(-1); out('infinite', [inf.page.width, inf.page.infinite]);
  page = inf.el; r = page.getBoundingClientRect(); const h0 = inf.page.height;
  e.setTool('pen'); ev('pointerdown', 200, r.height - 120); for (let i = 1; i < 6; i++) ev('pointermove', 200 + i * 10, r.height - 100 + i * 10); ev('pointerup', 260, r.height - 40);
  out('infinite grew', e.pvs.at(-1).page.height > h0);
  await wait(900);
  out('preview saved', !!e.note.preview);
  A.destroy();
} catch (er) { out('EXC', er.stack || String(er)); }
fetch('http://127.0.0.1:5198/', { method: 'POST', mode: 'no-cors', body: log.join('\n') });
