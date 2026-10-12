// HTML <-> Markdown / text converters (pure DOM, no deps).


export function htmlToText(html = '') {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('li').forEach((l) => l.prepend('• '));
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,pre').forEach((b) => b.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inlineMd = (s) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>').replace(/~~([^~]+)~~/g, '<s>$1</s>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
/** Small Markdown -> HTML (headings, lists, checklists, quotes, code, hr, paragraphs). */
export function markdownToHtml(md = '') {
  const out = []; const lines = md.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    if ((m = l.match(/^(#{1,6})\s+(.*)/))) { out.push(`<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
      const ord = /^\s*\d+\./.test(l); const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        let t = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
        const c = t.match(/^\[( |x)\]\s+(.*)/i);
        items.push(c ? `<li><input type="checkbox" disabled${c[1] !== ' ' ? ' checked' : ''}> ${inlineMd(c[2])}</li>` : `<li>${inlineMd(t)}</li>`);
        i++;
      }
      out.push(`<${ord ? 'ol' : 'ul'}>${items.join('')}</${ord ? 'ol' : 'ul'}>`); continue;
    }
    if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${inlineMd(buf.join(' '))}</blockquote>`); continue; }
    if (!l.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inlineMd).join('<br>')}</p>`);
  }
  return out.join('\n');
}
export const textToHtml = (t = '') => t.replace(/\r/g, '').split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
