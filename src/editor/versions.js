// Version history: periodic compact snapshots (strokes/items/text only) stored in note.versions, capped.
const MAX = 8;

async function pack(str) {
  if (typeof CompressionStream === 'undefined') return { z: 0, d: str };
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(cs).arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { z: 1, d: btoa(bin) };
}
async function unpack(v) {
  if (!v.z) return v.d;
  const bin = atob(v.d), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).text();
}
const r1 = (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v);

export function hashOf(note) {
  let n = 0; for (const p of note.pages) n += p.strokes.length * 7 + p.items.length * 13 + (p.strokes.at(-1)?.pts.length || 0);
  return n + ':' + (note.text || '').length;
}
export async function takeSnapshot(note, reason = 'auto') {
  const data = JSON.stringify({
    pages: note.pages.map((p) => ({ ...p })), text: note.text || '', template: note.template, paperColor: note.paperColor,
  }, r1);
  const packed = await pack(data);
  if (packed.d.length > 2.5e6) return null;
  const v = { id: Math.random().toString(36).slice(2, 9), t: Date.now(), reason, n: note.pages.reduce((a, p) => a + p.strokes.length, 0), ...packed };
  note.versions = [...(note.versions || []), v].slice(-MAX);
  return v;
}
export async function loadSnapshot(v) { return JSON.parse(await unpack(v)); }
