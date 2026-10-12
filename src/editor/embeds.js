// Embeds: strict provider allow-list -> sandboxed, click-to-load iframes. Unknown links become link cards.
const U = (s) => { try { const u = new URL(s.trim()); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
const host = (u) => u.hostname.replace(/^www\./, '');
export const FRAME_HOSTS = ['www.youtube-nocookie.com', 'player.vimeo.com', 'www.loom.com', 'docs.google.com', 'www.figma.com', 'maps.google.com', 'www.openstreetmap.org'];

/** -> {provider, kind:'iframe'|'audio'|'video'|'link', url, embedUrl?, title} | null */
export function parseEmbed(input) {
  const u = U(input || ''); if (!u) return null;
  const h = host(u), p = u.pathname, url = u.href;
  let m;
  if (h === 'youtu.be' && (m = /^\/([\w-]{6,})/.exec(p))) return fr('YouTube', url, `https://www.youtube-nocookie.com/embed/${m[1]}`);
  if (/(^|\.)youtube\.com$/.test(h)) {
    const id = u.searchParams.get('v') || (m = /^\/(?:embed|shorts|live)\/([\w-]{6,})/.exec(p)) && m[1];
    if (id) return fr('YouTube', url, `https://www.youtube-nocookie.com/embed/${id}`);
  }
  if (h === 'vimeo.com' && (m = /^\/(?:.*\/)?(\d{5,})/.exec(p))) return fr('Vimeo', url, `https://player.vimeo.com/video/${m[1]}`);
  if (h === 'loom.com' && (m = /^\/(?:share|embed)\/([\w]+)/.exec(p))) return fr('Loom', url, `https://www.loom.com/embed/${m[1]}`);
  if (h === 'docs.google.com' && (m = /^\/(document|presentation|spreadsheets)\/d\/([\w-]+)/.exec(p))) {
    const name = { document: 'Google Docs', presentation: 'Google Slides', spreadsheets: 'Google Sheets' }[m[1]];
    return fr(name, url, `https://docs.google.com/${m[1]}/d/${m[2]}/preview`);
  }
  if (h === 'figma.com' && /^\/(file|design|proto|board)\//.test(p)) return fr('Figma', url, `https://www.figma.com/embed?embed_host=inkwell&url=${encodeURIComponent(url)}`);
  if (/^(maps\.)?google\.[a-z.]+$/.test(h) && /^\/maps/.test(p)) {
    const q = u.searchParams.get('q') || (m = /\/place\/([^/]+)/.exec(p)) && decodeURIComponent(m[1].replace(/\+/g, ' '));
    if (q) return fr('Google Maps', url, `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`);
  }
  if (h === 'openstreetmap.org' && (m = /#map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(u.hash))) {
    const lat = +m[2], lon = +m[3], d = 0.02 / Math.pow(2, (+m[1] - 12) / 2);
    return fr('OpenStreetMap', url, `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d / 2},${lon + d},${lat + d / 2}&layer=mapnik&marker=${lat},${lon}`);
  }
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(p)) return { provider: 'Audio', kind: 'audio', url, embedUrl: url, title: decodeURIComponent(p.split('/').pop()) };
  if (/\.(mp4|webm|mov|m4v)$/i.test(p)) return { provider: 'Video', kind: 'video', url, embedUrl: url, title: decodeURIComponent(p.split('/').pop()) };
  if (/\.pdf$/i.test(p)) return { provider: 'PDF', kind: 'link', url, title: decodeURIComponent(p.split('/').pop()) };
  return { provider: h, kind: 'link', url, title: h };
}
const fr = (provider, url, embedUrl) => ({ provider, kind: 'iframe', url, embedUrl, title: provider });
export const isFrameable = (i) => i && (i.kind === 'iframe' || i.kind === 'audio' || i.kind === 'video');

/** build the live content element for a loaded embed (called on click) */
export function liveEmbed(it) {
  if (it.kind === 'audio' || it.kind === 'video') {
    const m = document.createElement(it.kind); m.controls = true; m.preload = 'none'; m.src = it.embedUrl; m.style.cssText = 'width:100%;height:100%'; m.setAttribute('referrerpolicy', 'no-referrer'); return m;
  }
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox');
  f.referrerPolicy = 'no-referrer'; f.loading = 'lazy'; f.allow = 'fullscreen; picture-in-picture'; f.title = it.title || it.provider; f.src = it.embedUrl;
  f.style.cssText = 'width:100%;height:100%;border:0;background:#fff'; return f;
}
