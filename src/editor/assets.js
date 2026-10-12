// Asset blob -> object URL / HTMLImageElement caches (shared by all editor views).
import { getAsset } from '../core/db.js';

const urls = new Map(), imgs = new Map(), loaded = new Map();
export function assetUrl(id) {
  if (!id) return Promise.resolve(null);
  if (!urls.has(id)) {
    urls.set(id, getAsset(id).then((r) => (r && r.blob ? URL.createObjectURL(r.blob) : null)).catch(() => null));
  }
  return urls.get(id).then((u) => { if (!u) urls.delete(id); return u; });
}
export function getImage(id) {
  if (!id) return Promise.resolve(null);
  if (!imgs.has(id)) {
    imgs.set(id, assetUrl(id).then((u) => new Promise((res) => {
      if (!u) return res(null);
      const im = new Image(); im.onload = () => { loaded.set(id, im); res(im); }; im.onerror = () => res(null); im.src = u;
    })).then((im) => { if (!im) imgs.delete(id); return im; }));
  }
  return imgs.get(id);
}
export const cachedImage = (id) => loaded.get(id);
export function seedUrl(id, blob) { urls.set(id, Promise.resolve(URL.createObjectURL(blob))); }
export function releaseAssets() {
  for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u));
  urls.clear(); imgs.clear(); loaded.clear();
}
