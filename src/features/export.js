// Export / backup / import. Heavy libs (pdf-lib) are lazy-loaded.
import { getAll, getAsset, putRecord } from '../core/db.js';
import { toast } from '../core/store.js';
import { renderPdfPage } from './pdf.js';
import { textToHtml } from './convert.js';
import { makeZip } from './zip.js';
import { flattenCanvas, expandPages } from '../editor/canvasmode.js';

// PDF is the only export format. Importing files INTO notes is still supported.
export { importFiles } from './import.js';

// ---------------------------------------------------------------- rendering
const GRID = 32;
const live = (a) => (a || []).filter((x) => x && !x.deleted);
// map editor brushes onto tools: highlighter/marker/watercolor translucent, unknown brushes pen-like
const toolOf = (s) => { const b = s.brush || s.tool; return b === 'marker' ? 'highlighter' : b === 'watercolor' ? 'watercolor' : (b === 'highlighter' || b === 'pencil') ? b : 'pen'; };

const gradStops = (g) => {
  if (!g) return null;
  if (typeof g === 'string') return null;
  const st = g.stops || [g.from || g.a, g.to || g.b].filter(Boolean).map((c, i, a) => ({ offset: i / Math.max(1, a.length - 1), color: c }));
  return st.length >= 2 ? { stops: st.map((x, i, a) => (typeof x === 'string' ? { offset: i / (a.length - 1), color: x } : x)), angle: g.angle ?? 180 } : null;
};
const paperOf = (page, note) => { const p = page.paper || note.paperColor; return !p || p === 'transparent' ? '#ffffff' : p; };

export function drawTemplate(ctx, w, h, tpl, paper = '#ffffff', page = {}) {
  ctx.fillStyle = paper || '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const g = gradStops(page.paperGrad);
  if (g) {
    const a = (g.angle - 90) * Math.PI / 180, cx = w / 2, cy = h / 2, r = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2;
    const gr = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stops.forEach((s) => { try { gr.addColorStop(Math.min(1, Math.max(0, s.offset)), s.color); } catch { /* bad color */ } });
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  }
  const pc = page.pattern?.color ? parseColor(page.pattern.color, [0.47, 0.55, 0.67]) : null;
  const pa = page.pattern?.opacity;
  const rgbaOf = (def, a) => (pc ? `rgba(${Math.round(pc.rgb[0] * 255)},${Math.round(pc.rgb[1] * 255)},${Math.round(pc.rgb[2] * 255)},${pa ?? a})` : def);
  const line = rgbaOf('rgba(120,140,170,0.35)', 0.35), dot = rgbaOf('rgba(120,140,170,0.6)', 0.6);
  ctx.lineWidth = 1; ctx.strokeStyle = line; ctx.fillStyle = dot;
  const hline = (y, x0 = 0, x1 = w) => { ctx.beginPath(); ctx.moveTo(x0, y + 0.5); ctx.lineTo(x1, y + 0.5); ctx.stroke(); };
  const vline = (x, y0 = 0, y1 = h) => { ctx.beginPath(); ctx.moveTo(x + 0.5, y0); ctx.lineTo(x + 0.5, y1); ctx.stroke(); };
  switch (tpl) {
    case 'lined': for (let y = 80; y < h; y += GRID) hline(y); ctx.strokeStyle = 'rgba(220,90,90,0.4)'; vline(72); break;
    case 'grid': for (let y = GRID; y < h; y += GRID) hline(y); for (let x = GRID; x < w; x += GRID) vline(x); break;
    case 'dot': for (let y = GRID; y < h; y += GRID) for (let x = GRID; x < w; x += GRID) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, 6.2832); ctx.fill(); } break;
    case 'cornell': {
      const cue = Math.round(w * 0.27), sum = Math.round(h * 0.82);
      for (let y = 80; y < sum; y += GRID) hline(y, cue, w);
      ctx.strokeStyle = 'rgba(80,90,120,0.6)'; ctx.lineWidth = 1.5; vline(cue, 0, sum); hline(sum); hline(60, 0, w);
      break;
    }
    case 'todo': for (let y = 90; y < h - 20; y += 44) { hline(y + 22, 56, w - 30); ctx.strokeRect(24.5, y - 4.5, 20, 20); } break;
    default: break;
  }
}

function drawStroke(ctx, s) {
  const p = s.pts || [];
  const n = Math.floor(p.length / 3);
  if (!n) return;
  const size = s.size || 3;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = ctx.fillStyle = s.color || '#000';
  const tool = toolOf(s);
  if (tool === 'watercolor') ctx.globalAlpha = 0.4;
  if (tool === 'highlighter') {
    ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'butt'; ctx.lineWidth = size;
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    if (n === 1) ctx.lineTo(p[0] + 0.01, p[1]);
    for (let i = 1; i < n; i++) ctx.lineTo(p[i * 3], p[i * 3 + 1]);
    ctx.stroke();
  } else {
    const pencil = tool === 'pencil';
    if (pencil) ctx.globalAlpha = 0.8;
    const wOf = (pr) => size * (pencil ? 0.5 + 0.8 * pr : 0.35 + 1.3 * pr);
    if (n === 1) {
      ctx.beginPath(); ctx.arc(p[0], p[1], wOf(p[2] || 0.5) / 2, 0, 6.2832); ctx.fill();
    } else {
      // quadratic through midpoints, width varied per segment
      let px = p[0], py = p[1];
      for (let i = 1; i < n; i++) {
        const x = p[i * 3], y = p[i * 3 + 1];
        const pr = ((p[i * 3 + 2] || 0.5) + (p[(i - 1) * 3 + 2] || 0.5)) / 2;
        const mx = (px + x) / 2, my = (py + y) / 2;
        ctx.lineWidth = wOf(pr);
        ctx.beginPath(); ctx.moveTo(i === 1 ? px : (px + p[(i - 2) * 3]) / 2, i === 1 ? py : (py + p[(i - 2) * 3 + 1]) / 2);
        ctx.quadraticCurveTo(px, py, mx, my);
        ctx.stroke();
        px = x; py = y;
      }
      ctx.lineWidth = wOf(p[(n - 1) * 3 + 2] || 0.5);
      ctx.beginPath(); ctx.moveTo((px + p[(n - 2) * 3]) / 2, (py + p[(n - 2) * 3 + 1]) / 2); ctx.lineTo(px, py); ctx.stroke();
    }
  }
  ctx.restore();
}

async function itemBitmap(it) {
  try {
    let src = it.src || it.url || it.data?.src || it.dataUrl;
    if (!src && (it.assetId || it.data?.assetId)) {
      const a = await getAsset(it.assetId || it.data.assetId);
      if (a?.blob) return await createImageBitmap(a.blob);
    }
    if (!src) return null;
    const blob = await (await fetch(src)).blob();
    return await createImageBitmap(blob);
  } catch { return null; }
}

async function drawItem(ctx, it) {
  ctx.save();
  const w = it.w || 100, h = it.h || 40;
  ctx.translate(it.x + w / 2, it.y + h / 2);
  if (it.rotation) ctx.rotate(it.rotation * (Math.abs(it.rotation) > 6.3 ? Math.PI / 180 : 1));
  ctx.translate(-w / 2, -h / 2);
  const d = it.data || {};
  const color = it.color || d.color || it.stroke || d.stroke || '#000';
  if (it.type === 'image') {
    const bm = await itemBitmap(it);
    if (bm) { ctx.drawImage(bm, 0, 0, w, h); bm.close?.(); }
  } else if (it.type === 'text') {
    const size = it.fontSize || d.fontSize || 18;
    ctx.fillStyle = color; ctx.textBaseline = 'top';
    ctx.font = `${it.bold || d.bold ? 'bold ' : ''}${it.italic || d.italic ? 'italic ' : ''}${size}px ${it.font || d.font || 'system-ui, sans-serif'}`;
    const text = String(it.text ?? d.text ?? '');
    let y = 0;
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (line && ctx.measureText(t).width > w) { ctx.fillText(line, 0, y); y += size * 1.3; line = word; } else line = t;
      }
      ctx.fillText(line, 0, y); y += size * 1.3;
    }
  } else if (it.type === 'shape') {
    const kind = it.shape || d.shape || it.kind || 'rect';
    ctx.strokeStyle = color; ctx.lineWidth = it.strokeWidth || d.strokeWidth || it.size || 2;
    const fill = it.fill || d.fill; if (fill && fill !== 'none') ctx.fillStyle = fill;
    ctx.beginPath();
    if (kind === 'ellipse' || kind === 'circle') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, 6.2832);
    else if (kind === 'line' || kind === 'arrow') {
      ctx.moveTo(0, 0); ctx.lineTo(w, h);
      if (kind === 'arrow') { const a = Math.atan2(h, w), L = 14; ctx.moveTo(w, h); ctx.lineTo(w - L * Math.cos(a - 0.45), h - L * Math.sin(a - 0.45)); ctx.moveTo(w, h); ctx.lineTo(w - L * Math.cos(a + 0.45), h - L * Math.sin(a + 0.45)); }
    } else if (kind === 'triangle') { ctx.moveTo(w / 2, 0); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); }
    else ctx.rect(0, 0, w, h);
    if (fill && fill !== 'none') ctx.fill();
    ctx.stroke();
  } else if (it.type === 'sticker') {
    ctx.font = `${Math.min(w, h) * 0.85}px sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.fillText(it.emoji || d.emoji || it.text || d.text || '⭐', w / 2, h / 2);
  }
  ctx.restore();
}

/**
 * Render a note page to a new canvas (page units * scale).
 * opts: { scale=2, layer: 'all'|'annotations'|'background', canvas }
 * 'annotations' = strokes + items on a transparent canvas (used for non-flattened PDF export).
 */
export async function renderPageToCanvas(page, note, opts = {}) {
  page = flattenCanvas(page);
  const scale = opts.scale || 2, layer = opts.layer || 'all';
  const W = page.width || 820, H = page.height || 1160;
  const c = opts.canvas || document.createElement('canvas');
  c.width = Math.round(W * scale); c.height = Math.round(H * scale);
  const ctx = c.getContext('2d');
  if (layer !== 'annotations') {
    if (page.type === 'pdf' && page.pdfAssetId) {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      try {
        const tmp = document.createElement('canvas');
        await renderPdfPage(page.pdfAssetId, page.pdfPage || 1, tmp, 1, { cssWidth: c.width, dpr: 1, noStyle: true, progressive: false });
        ctx.drawImage(tmp, 0, 0, c.width, c.height);
      } catch (e) { console.warn('pdf page render failed', e); }
    } else {
      ctx.save(); ctx.scale(scale, scale);
      drawTemplate(ctx, W, H, page.bg || note.template || 'blank', paperOf(page, note), page);
      ctx.restore();
    }
  }
  if (layer !== 'background') {
    ctx.save(); ctx.scale(scale, scale);
    for (const it of live(page.items)) if (it.type === 'image') await drawItem(ctx, it);
    for (const s of live(page.strokes)) drawStroke(ctx, s);
    for (const it of live(page.items)) if (it.type !== 'image') await drawItem(ctx, it);
    ctx.restore();
  }
  return c;
}

const canvasBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Canvas export failed'))), type, q));

// ---------------------------------------------------------------- download / share
const safeName = (s) => (s || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

/** Share sheet on touch devices when files are shareable, otherwise a download. */
async function deliver(blob, filename) {
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && navigator.canShare && navigator.share) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  download(blob, filename);
  return 'downloaded';
}

/** Share or copy plain text (share-target friendly). */
export async function shareText(text, title = '') {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return 'shared'; } catch (e) { if (e?.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); return 'copied'; } catch { /* fall through */ }
  download(new Blob([text], { type: 'text/plain' }), safeName(title || 'shared') + '.txt');
  return 'downloaded';
}

/** Create a note from shared text/url (Web Share Target). Returns noteId. */
export async function createNoteFromShare({ title = '', text = '', url = '' } = {}) {
  const body = [text, url].filter(Boolean).join('\n\n');
  const { blankNote } = await import('../core/db.js');
  const note = blankNote({ title: title || body.split('\n')[0].slice(0, 60) || 'Shared note', text: textToHtml(body), textIndex: body });
  await putRecord('notes', note);
  return note.id;
}

// ---------------------------------------------------------------- vector PDF building
const K = 0.75; // page unit (px) -> PDF point
const tick = () => new Promise((r) => setTimeout(r));

function parseColor(c, fallback = [0, 0, 0]) {
  if (!c) return { rgb: fallback, a: 1 };
  c = String(c).trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let x = m[1];
    if (x.length <= 4) x = x.split('').map((d) => d + d).join('');
    const n = (i) => parseInt(x.slice(i, i + 2), 16) / 255;
    return { rgb: [n(0), n(2), n(4)], a: x.length === 8 ? n(6) : 1 };
  }
  m = c.match(/rgba?\(([^)]+)\)/i);
  if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return { rgb: [p[0] / 255, p[1] / 255, p[2] / 255], a: p[3] ?? 1 }; }
  return { rgb: fallback, a: 1 };
}

/** Pressure-smoothed outline polygon for a stroke, as an SVG path string (y down, page units). */
export function strokeOutlinePath(s) {
  const p = s.pts || [];
  const size = s.size || 3;
  const pts = [];
  for (let i = 0; i + 2 < p.length + 0.5; i += 3) {
    const x = p[i], y = p[i + 1];
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - x) + Math.abs(last.y - y) < 0.4) continue;
    pts.push({ x, y, p: p[i + 2] || 0.5 });
  }
  if (pts.length < 2) return null;
  const hl = toolOf(s) === 'highlighter', pencil = toolOf(s) === 'pencil';
  // smooth pressure and positions a little
  let w = pts.map((q) => (hl ? size : size * (pencil ? 0.5 + 0.8 * q.p : 0.35 + 1.3 * q.p)));
  w = w.map((v, i) => (i && i < w.length - 1 ? (w[i - 1] + 2 * v + w[i + 1]) / 4 : v));
  const sm = pts.map((q, i) => (i && i < pts.length - 1
    ? { x: (pts[i - 1].x + 2 * q.x + pts[i + 1].x) / 4, y: (pts[i - 1].y + 2 * q.y + pts[i + 1].y) / 4 } : q));
  const L = [], R = [];
  for (let i = 0; i < sm.length; i++) {
    const a = sm[Math.max(0, i - 1)], b = sm[Math.min(sm.length - 1, i + 1)];
    let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const h = w[i] / 2;
    L.push([sm[i].x - dy * h, sm[i].y + dx * h]); R.push([sm[i].x + dy * h, sm[i].y - dx * h]);
  }
  const f = (n) => Math.round(n * 100) / 100;
  let d = `M${f(L[0][0])} ${f(L[0][1])}`;
  for (let i = 1; i < L.length; i++) d += `L${f(L[i][0])} ${f(L[i][1])}`;
  for (let i = R.length - 1; i >= 0; i--) d += `L${f(R[i][0])} ${f(R[i][1])}`;
  return d + 'Z';
}

function pdfTemplate(pg, W, H, tpl, paper, lib, page = {}) {
  const { rgb } = lib;
  const P = parseColor(paper, [1, 1, 1]);
  const pcol = page.pattern?.color ? parseColor(page.pattern.color) : null, pop = page.pattern?.opacity;
  const Wp = W * K, Hp = H * K;
  pg.drawRectangle({ x: 0, y: 0, width: Wp, height: Hp, color: rgb(...P.rgb) });
  const gs = gradStops(page.paperGrad);
  if (gs) { // approximate gradient with horizontal bands along its angle's dominant axis
    const N = 48, a = (gs.angle - 90) * Math.PI / 180, vert = Math.abs(Math.sin(a)) >= Math.abs(Math.cos(a));
    const at = (t) => { const st = gs.stops; let i = 0; while (i < st.length - 2 && t > st[i + 1].offset) i++; const A = st[i], B = st[i + 1], u = Math.min(1, Math.max(0, (t - A.offset) / ((B.offset - A.offset) || 1))); const ca = parseColor(A.color).rgb, cb = parseColor(B.color).rgb; return ca.map((v, k) => v + (cb[k] - v) * u); };
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N, fwd = vert ? Math.sin(a) >= 0 : Math.cos(a) >= 0;
      const u = fwd ? t : 1 - t;
      if (vert) pg.drawRectangle({ x: 0, y: Hp - (i + 1) * Hp / N - 0.5, width: Wp, height: Hp / N + 1, color: rgb(...at(u)) });
      else pg.drawRectangle({ x: i * Wp / N - 0.5, y: 0, width: Wp / N + 1, height: Hp, color: rgb(...at(u)) });
    }
  }
  const PC = pcol ? pcol.rgb : null;
  const line = (x0, y0, x1, y1, col = [0.47, 0.55, 0.67], op = 0.35, th = 0.75) =>
    pg.drawLine({ start: { x: x0 * K, y: Hp - y0 * K }, end: { x: x1 * K, y: Hp - y1 * K }, thickness: th, color: rgb(...(PC && col[0] === 0.47 ? PC : col)), opacity: pop != null && col[0] === 0.47 ? pop : op });
  const hl = (y, x0 = 0, x1 = W, ...r) => line(x0, y, x1, y, ...r);
  const vl = (x, y0 = 0, y1 = H, ...r) => line(x, y0, x, y1, ...r);
  switch (tpl) {
    case 'lined': for (let y = 80; y < H; y += GRID) hl(y); vl(72, 0, H, [0.86, 0.35, 0.35], 0.4); break;
    case 'grid': for (let y = GRID; y < H; y += GRID) hl(y); for (let x = GRID; x < W; x += GRID) vl(x); break;
    case 'dot':
      for (let y = GRID; y < H; y += GRID) for (let x = GRID; x < W; x += GRID)
        pg.drawCircle({ x: x * K, y: Hp - y * K, size: 1.05, color: rgb(...(PC || [0.47, 0.55, 0.67])), opacity: pop ?? 0.6 });
      break;
    case 'cornell': {
      const cue = Math.round(W * 0.27), sum = Math.round(H * 0.82);
      for (let y = 80; y < sum; y += GRID) hl(y, cue, W);
      vl(cue, 0, sum, [0.31, 0.35, 0.47], 0.6, 1.1); hl(sum, 0, W, [0.31, 0.35, 0.47], 0.6, 1.1); hl(60, 0, W, [0.31, 0.35, 0.47], 0.6, 1.1);
      break;
    }
    case 'todo':
      for (let y = 90; y < H - 20; y += 44) {
        hl(y + 22, 56, W - 30);
        pg.drawRectangle({ x: 24 * K, y: Hp - (y + 16) * K, width: 20 * K, height: 20 * K, borderColor: rgb(0.47, 0.55, 0.67), borderWidth: 0.75, borderOpacity: 0.6 });
      }
      break;
    default: break;
  }
}

function wrapLines(text, font, size, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (line && font.widthOfTextAtSize(t, size) > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}
/** replace characters the standard font cannot encode */
function winSafe(text, font) {
  const ok = new Map();
  let out = '';
  for (const ch of String(text)) {
    let g = ok.get(ch);
    if (g === undefined) { try { font.encodeText(ch); g = ch; } catch { g = ch === '•' ? '-' : /\s/.test(ch) ? ' ' : '?'; } ok.set(ch, g); }
    out += g;
  }
  return out;
}

/** Parse the typed-text HTML into [{kind:'h1'|'h2'|'h3'|'p'|'li'|'quote'|'pre', text, depth}] */
function textBlocks(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out = [];
  const inl = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  (function walk(n, depth) {
    for (const c of n.children) {
      const t = c.tagName;
      if (/^H[1-6]$/.test(t)) out.push({ kind: 'h' + Math.min(3, +t[1]), text: inl(c) });
      else if (t === 'UL' || t === 'OL') {
        let i = 0;
        for (const li of c.children) {
          i++;
          const nested = [...li.children].filter((x) => x.tagName === 'UL' || x.tagName === 'OL');
          const clone = li.cloneNode(true); clone.querySelectorAll('ul,ol').forEach((x) => x.remove());
          const cb = clone.querySelector('input[type=checkbox]');
          out.push({ kind: 'li', depth, text: (cb ? (cb.checked ? '[x] ' : '[ ] ') : t === 'OL' ? i + '. ' : '- ') + inl(clone) });
          nested.forEach((x) => walk({ children: [x] }, depth + 1));
        }
      } else if (t === 'PRE') out.push({ kind: 'pre', text: c.textContent });
      else if (t === 'BLOCKQUOTE') out.push({ kind: 'quote', text: inl(c) });
      else if (t === 'HR') out.push({ kind: 'hr', text: '' });
      else if (c.children.length && [...c.children].some((x) => /^(P|DIV|UL|OL|H[1-6]|BLOCKQUOTE|PRE)$/.test(x.tagName))) walk(c, depth);
      else if (inl(c)) out.push({ kind: 'p', text: c.innerHTML.includes('<br') ? c.innerText || inl(c) : inl(c) });
    }
  })(doc.body, 0);
  if (!out.length) { const t = doc.body.textContent.trim(); if (t) out.push({ kind: 'p', text: t }); }
  return out;
}

function addTextPages(out, note, fonts, lib, numberFor) {
  const blocks = textBlocks(note.text || '');
  if (!blocks.length) return 0;
  const { rgb } = lib;
  const PW = 612, PH = 792, M = 56;
  let pg = out.addPage([PW, PH]), y = PH - M, count = 1;
  const need = (h) => { if (y - h < M) { pg = out.addPage([PW, PH]); y = PH - M; count++; } };
  for (const b of blocks) {
    const spec = { h1: [22, 'bold', 14], h2: [17, 'bold', 10], h3: [14, 'bold', 8], p: [11, 'reg', 6], li: [11, 'reg', 3], quote: [11, 'ital', 6], pre: [9.5, 'mono', 6], hr: [6, 'reg', 6] }[b.kind];
    const [size, f, gap] = spec;
    const font = fonts[f];
    const indent = (b.depth || 0) * 16 + (b.kind === 'quote' ? 14 : 0);
    if (b.kind === 'hr') { need(14); pg.drawLine({ start: { x: M, y: y - 4 }, end: { x: PW - M, y: y - 4 }, thickness: 0.7, color: rgb(0.7, 0.7, 0.7) }); y -= 14; continue; }
    const text = winSafe(b.text, font);
    const lines = b.kind === 'pre' ? text.split('\n') : wrapLines(text, font, size, PW - 2 * M - indent);
    y -= (b.kind.startsWith('h') ? gap : 0);
    for (const ln of lines) {
      need(size * 1.35);
      y -= size * 1.15;
      if (ln) pg.drawText(ln, { x: M + indent, y, size, font, color: b.kind === 'quote' ? rgb(0.35, 0.35, 0.4) : rgb(0.1, 0.1, 0.12) });
      y -= size * 0.2;
    }
    y -= gap;
  }
  return count;
}

async function drawPageItemsAndStrokes(out, pg, page, note, lib, fonts, scale) {
  const { rgb, BlendMode } = lib;
  const W = page.width || 820, H = page.height || 1160, Hp = H * K;
  const extras = []; // items to rasterize on a shared overlay
  // images first (under ink)
  for (const it of live(page.items)) {
    if (it.type !== 'image') continue;
    let done = false;
    if (!it.rotation) {
      try {
        const aid = it.assetId || it.data?.assetId;
        let blob = aid ? (await getAsset(aid))?.blob : null;
        const src = it.src || it.url || it.data?.src;
        if (!blob && src) blob = await (await fetch(src)).blob();
        if (blob) {
          const bytes = await blob.arrayBuffer();
          const img = blob.type === 'image/jpeg' ? await out.embedJpg(bytes) : blob.type === 'image/png' ? await out.embedPng(bytes) : null;
          if (img) { pg.drawImage(img, { x: it.x * K, y: Hp - (it.y + it.h) * K, width: it.w * K, height: it.h * K }); done = true; }
        }
      } catch { /* raster fallback */ }
    }
    if (!done) extras.push(it);
  }
  // ink as vector polygons
  for (const s of live(page.strokes)) {
    const d = strokeOutlinePath(s);
    const c = parseColor(s.color);
    const hl = toolOf(s) === 'highlighter';
    const opacity = (hl ? 0.35 : toolOf(s) === 'watercolor' ? 0.4 : toolOf(s) === 'pencil' ? 0.85 : 1) * c.a;
    if (d) {
      try { pg.drawSvgPath(d, { x: 0, y: Hp, scale: K, color: rgb(...c.rgb), opacity, borderWidth: 0, blendMode: hl ? BlendMode.Multiply : undefined }); }
      catch { /* skip malformed stroke */ }
      if (!hl && s.pts.length >= 6) {
        const n = s.pts.length / 3;
        for (const i of [0, n - 1]) pg.drawCircle({ x: s.pts[i * 3] * K, y: Hp - s.pts[i * 3 + 1] * K, size: (s.size || 3) * K * (0.35 + 1.3 * (s.pts[i * 3 + 2] || 0.5)) / 2, color: rgb(...c.rgb), opacity });
      }
    } else if (s.pts?.length >= 2) {
      pg.drawCircle({ x: s.pts[0] * K, y: Hp - s.pts[1] * K, size: (s.size || 3) * K * 0.65, color: rgb(...c.rgb), opacity });
    }
  }
  // text / shapes
  for (const it of live(page.items)) {
    if (it.type === 'image') continue;
    const d = it.data || {};
    let done = false;
    if (!it.rotation) {
      try {
        if (it.type === 'text') {
          const size = (it.fontSize || d.fontSize || 18) * K;
          const font = it.bold || d.bold ? fonts.bold : fonts.reg;
          const col = parseColor(it.color || d.color || '#000');
          const lines = wrapLines(winSafe(it.text ?? d.text ?? '', font), font, size, it.w * K);
          let y = Hp - it.y * K - size;
          for (const ln of lines) { if (ln) pg.drawText(ln, { x: it.x * K, y, size, font, color: rgb(...col.rgb), opacity: col.a }); y -= size * 1.3; }
          done = true;
        } else if (it.type === 'shape') {
          const kind = it.shape || d.shape || it.kind || 'rect';
          const col = parseColor(it.color || d.color || it.stroke || d.stroke || '#000');
          const th = (it.strokeWidth || d.strokeWidth || it.size || 2) * K;
          const fill = it.fill || d.fill; const fc = fill && fill !== 'none' ? parseColor(fill) : null;
          if (kind === 'rect' || kind === 'rectangle') {
            pg.drawRectangle({ x: it.x * K, y: Hp - (it.y + it.h) * K, width: it.w * K, height: it.h * K, borderColor: rgb(...col.rgb), borderWidth: th, color: fc ? rgb(...fc.rgb) : undefined, opacity: fc ? fc.a : undefined });
            done = true;
          } else if (kind === 'ellipse' || kind === 'circle') {
            pg.drawEllipse({ x: (it.x + it.w / 2) * K, y: Hp - (it.y + it.h / 2) * K, xScale: it.w * K / 2, yScale: it.h * K / 2, borderColor: rgb(...col.rgb), borderWidth: th, color: fc ? rgb(...fc.rgb) : undefined, opacity: fc ? fc.a : undefined });
            done = true;
          } else if (kind === 'line') {
            pg.drawLine({ start: { x: it.x * K, y: Hp - it.y * K }, end: { x: (it.x + it.w) * K, y: Hp - (it.y + it.h) * K }, thickness: th, color: rgb(...col.rgb) });
            done = true;
          }
        }
      } catch { /* raster fallback */ }
    }
    if (!done) extras.push(it);
  }
  if (extras.length) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const ctx = c.getContext('2d'); ctx.scale(scale, scale);
    for (const it of extras) await drawItem(ctx, it);
    const img = await out.embedPng(await (await canvasBlob(c)).arrayBuffer());
    pg.drawImage(img, { x: 0, y: 0, width: W * K, height: Hp });
  }
}

/**
 * Build a PDF Blob for one note. Draw pages: vector template + vector ink (pressure outline polygons) + vector
 * text/shapes/images. Imported PDF pages: original page embedded as vector content, ink on top.
 * opts: { pageNumbers=false, flatten=false (raster fallback for PDF-imported pages), scale=2, includeText=true,
 *         onProgress(done,total), signal }
 */
export async function buildNotePdf(note, opts = {}) {
  const lib = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb, BlendMode } = lib;
  const out = await PDFDocument.create();
  out.setTitle(note.title || 'Untitled'); out.setProducer('Inkwell'); out.setCreator('Inkwell');
  if (note.tags?.length) out.setKeywords(note.tags); 
  out.setSubject(`${note.pages?.length || 0} page${note.pages?.length === 1 ? '' : 's'}`);
  if (note.createdAt) out.setCreationDate(new Date(note.createdAt));
  if (note.updatedAt) out.setModificationDate(new Date(note.updatedAt));
  const fonts = {
    reg: await out.embedFont(StandardFonts.Helvetica), bold: await out.embedFont(StandardFonts.HelveticaBold),
    ital: await out.embedFont(StandardFonts.HelveticaOblique), mono: await out.embedFont(StandardFonts.Courier),
  };
  const L = { rgb, BlendMode };
  const scale = opts.scale || 2;
  const srcDocs = new Map();
  const pages = expandPages(note.pages);
  const hasText = opts.includeText !== false && note.text && textBlocks(note.text).length;
  const total = pages.length + (hasText ? 1 : 0);
  let n = 0;
  for (const page of pages) {
    opts.signal?.throwIfAborted?.();
    const W = page.width || 820, H = page.height || 1160;
    const pg = out.addPage([W * K, H * K]);
    let ok = false;
    if (page.type === 'pdf' && page.pdfAssetId) {
      if (!opts.flatten) {
        try {
          if (!srcDocs.has(page.pdfAssetId)) srcDocs.set(page.pdfAssetId, await PDFDocument.load(await (await getAsset(page.pdfAssetId)).blob.arrayBuffer()));
          const [emb] = await out.embedPdf(srcDocs.get(page.pdfAssetId), [(page.pdfPage || 1) - 1]);
          pg.drawPage(emb, { x: 0, y: 0, width: W * K, height: H * K });
          ok = true;
        } catch (e) { console.warn('vector pdf page failed, rasterizing', e); }
      }
      if (!ok) {
        const c = await renderPageToCanvas({ ...page, strokes: [], items: [] }, note, { scale });
        const img = await out.embedJpg(await (await canvasBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
        pg.drawImage(img, { x: 0, y: 0, width: W * K, height: H * K });
      }
    } else {
      pdfTemplate(pg, W, H, page.bg || note.template || 'blank', paperOf(page, note), L, page);
    }
    try { await drawPageItemsAndStrokes(out, pg, page, note, L, fonts, scale); }
    catch (e) { console.warn('page annotations failed', e); }
    if (opts.pageNumbers) {
      const t = `${n + 1} / ${total}`;
      pg.drawText(t, { x: W * K - 20 - fonts.reg.widthOfTextAtSize(t, 8), y: 12, size: 8, font: fonts.reg, color: rgb(0.45, 0.45, 0.5) });
    }
    opts.onProgress?.(++n, total);
    if (n % 3 === 0) await tick();
  }
  if (hasText) {
    const start = out.getPageCount();
    addTextPages(out, note, fonts, L);
    if (opts.pageNumbers) {
      const all = out.getPages();
      for (let i = start; i < all.length; i++) {
        const t = `${i + 1} / ${all.length}`;
        all[i].drawText(t, { x: 612 - 56 - fonts.reg.widthOfTextAtSize(t, 8), y: 24, size: 8, font: fonts.reg, color: rgb(0.45, 0.45, 0.5) });
      }
    }
    opts.onProgress?.(++n, total);
  }
  if (!out.getPageCount()) out.addPage([612, 792]);
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

/** Export one note as a PDF (the only supported format). */
export async function exportNote(note, fmt = 'pdf', opts = {}) {
  if (fmt !== 'pdf') throw new Error('Only PDF export is supported.');
  try {
    const blob = await buildNotePdf(note, opts);
    return await deliver(blob, safeName(note.title) + '.pdf');
  } catch (e) {
    console.error(e); toast('Export failed: ' + (e?.message || e)); throw e;
  }
}

async function zipNotes(list, byId, opts, zipName) {
  const pathOf = (id) => { const parts = []; let n = byId.get(id), g = 0; while (n && g++ < 20) { parts.unshift(safeName(n.name)); n = byId.get(n.parentId); } return parts.join('/'); };
  const files = [];
  let i = 0;
  for (const n of list) {
    try {
      const blob = await buildNotePdf(n, { ...opts, onProgress: undefined });
      const dir = n.notebookId ? pathOf(n.notebookId) : '';
      files.push({ name: (dir ? dir + '/' : '') + safeName(n.title) + '.pdf', data: blob });
    } catch (e) { console.warn('skip note', n.id, e); }
    opts.onProgress?.(++i, list.length);
    await tick();
  }
  return deliver(await makeZip(files), zipName + '.zip');
}

/** ZIP of PDFs for a notebook and its sub-notebooks (notebookId null => unfiled notes). */
export async function exportNotebook(notebookId, opts = {}) {
  if (typeof opts === 'string') opts = arguments[2] || {}; // tolerate legacy (id, fmt, opts)
  const [notebooks, notes] = await Promise.all([getAll('notebooks'), getAll('notes')]);
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const inScope = (nbId) => {
    if (notebookId === null) return !nbId;
    for (let n = byId.get(nbId), g = 0; n && g++ < 20; n = byId.get(n.parentId)) if (n.id === notebookId) return true;
    return false;
  };
  const list = notes.filter((n) => !n.trashedAt && inScope(n.notebookId));
  if (!list.length) { toast('Nothing to export'); return 'empty'; }
  return zipNotes(list, byId, opts, safeName(byId.get(notebookId)?.name || 'Unfiled notes'));
}

/** ZIP of PDFs for every (non-trashed) note, organized into folders by notebook. */
export async function exportAll(opts = {}) {
  const [notebooks, notes] = await Promise.all([getAll('notebooks'), getAll('notes')]);
  const list = notes.filter((n) => !n.trashedAt);
  if (!list.length) { toast('Nothing to export'); return 'empty'; }
  return zipNotes(list, new Map(notebooks.map((n) => [n.id, n])), opts, 'Inkwell notes');
}
