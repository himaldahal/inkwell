// Fonts: system font enumeration (where permitted), user-imported font files (stored as assets), recents.
import { putAsset, getAsset, getMeta, setMeta } from '../core/db.js';
import { pref } from './ui.js';

const registered = new Set();
async function register(family, buf) {
  if (registered.has(family)) return;
  const ff = new FontFace(family, buf); await ff.load(); document.fonts.add(ff); registered.add(family);
}
export const fontStack = (family) => `"${family}", system-ui, sans-serif`;
export async function loadSavedFonts() {
  const list = await getMeta('fonts', []);
  for (const f of list) {
    try { const a = await getAsset(f.assetId); if (a?.blob) await register(f.family, await a.blob.arrayBuffer()); } catch (e) { console.warn('font load failed', f.family, e); }
  }
  return list.map((f) => f.family);
}
export async function importFont(file) {
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Custom font';
  const rec = await putAsset({ noteId: null, kind: 'font', blob: file, mime: file.type || 'font/ttf' });
  const list = (await getMeta('fonts', [])).filter((f) => f.family !== family);
  list.push({ family, assetId: rec.id }); await setMeta('fonts', list);
  await register(family, await file.arrayBuffer());
  return family;
}
/** bytes of an imported font (for PDF embedding), or null for system fonts */
export async function getFontBytes(family) {
  const f = (await getMeta('fonts', [])).find((x) => x.family === family);
  const a = f && (await getAsset(f.assetId));
  return a?.blob ? a.blob.arrayBuffer() : null;
}
export async function localFonts() {
  if (!window.queryLocalFonts) return null;
  try { return [...new Set((await window.queryLocalFonts()).map((f) => f.family))].sort(); } catch { return []; }
}
export const recentFonts = () => pref.get('recentfonts', []);
export function noteFont(stack) { pref.set('recentfonts', [stack, ...recentFonts().filter((x) => x !== stack)].slice(0, 5)); }
