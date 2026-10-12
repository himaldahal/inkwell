// HTML <-> Markdown / text converters (pure DOM, no deps).
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'HR']);

export function htmlToMarkdown(html = '') {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const inline = (n) => [...n.childNodes].map(walk).join('');
  function list(n, depth) {
    const ordered = n.tagName === 'OL';
    let i = 0;
    return [...n.children].filter((c) => c.tagName === 'LI').map((li) => {
      i++;
      const cb = li.querySelector(':scope > input[type=checkbox]') || (li.dataset?.checked != null ? { checked: li.dataset.checked === 'true' } : null);
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
      const text = [...li.childNodes].filter((c) => !nested.includes(c) && c.nodeName !== 'INPUT').map(walk).join('').trim();
      const mark = (ordered ? i + '. ' : '- ') + (cb ? (cb.checked ? '[x] ' : '[ ] ') : '');
      return '  '.repeat(depth) + mark + text + nested.map((x) => '\n' + list(x, depth + 1)).join('');
    }).join('\n');
  }
  function walk(n) {
    if (n.nodeType === 3) return n.textContent.replace(/\s+/g, ' ');
    if (n.nodeType !== 1) return '';
    const t = n.tagName;
    switch (t) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return `\n\n${'#'.repeat(+t[1])} ${inline(n).trim()}\n\n`;
      case 'P': case 'DIV': { const s = inline(n); return s.trim() ? `\n\n${s.trim()}\n\n` : '\n'; }
      case 'BR': return '  \n';
      case 'STRONG': case 'B': return `**${inline(n).trim()}**`;
      case 'EM': case 'I': return `*${inline(n).trim()}*`;
      case 'S': case 'DEL': case 'STRIKE': return `~~${inline(n).trim()}~~`;
      case 'CODE': return n.parentElement?.tagName === 'PRE' ? n.textContent : '`' + n.textContent + '`';
      case 'PRE': return '\n\n```\n' + n.textContent.replace(/\n$/, '') + '\n```\n\n';
      case 'A': return `[${inline(n)}](${n.getAttribute('href') || ''})`;
      case 'IMG': { const s = n.getAttribute('src') || ''; return `![${n.getAttribute('alt') || 'image'}](${s.startsWith('data:') ? 'embedded-image' : s})`; }
      case 'UL': case 'OL': return '\n\n' + list(n, 0) + '\n\n';
      case 'BLOCKQUOTE': return '\n\n' + inline(n).trim().split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      case 'HR': return '\n\n---\n\n';
      case 'TABLE': {
        const rows = [...n.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inline(c).trim().replace(/\|/g, '\\|')));
        if (!rows.length) return '';
        const w = Math.max(...rows.map((r) => r.length));
        const line = (r) => '| ' + Array.from({ length: w }, (_, i) => r[i] || '').join(' | ') + ' |';
        return '\n\n' + [line(rows[0]), line(Array(w).fill('---')), ...rows.slice(1).map(line)].join('\n') + '\n\n';
      }
      case 'INPUT': return '';
      case 'SCRIPT': case 'STYLE': return '';
      default: return inline(n);
    }
  }
  return inline(doc.body).replace(/[ \t]+\n/g, (m) => (m.includes('  \n') ? m : '\n')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

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
