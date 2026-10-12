// Typed notes / outline view: contenteditable rich text stored in note.text as HTML.
import { h } from '../core/utils.js';
import { icon } from './icons.js';

export function mountTextLayer(host, note, { onChange, hooks = {} }) {
  const ed = h('div', { class: 'ik-rich', contenteditable: 'true', spellcheck: 'true', 'data-ph': 'Start typing your notes... use the toolbar for headings, lists and checklists.', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Typed notes' });
  ed.innerHTML = note.text || '';
  const exec = (c, v) => { ed.focus(); document.execCommand(c, false, v); sync(); };
  const sync = () => { note.text = ed.innerHTML === '<br>' ? '' : ed.innerHTML; onChange?.(); refresh(); };
  const btns = [];
  const mk = (ic, label, fn, state, txt) => {
    const b = h('button', { type: 'button', class: 'ik-btn sm', title: label, 'aria-label': label });
    if (txt) b.append(h('b', {}, txt)); else b.append(icon(ic, 18));
    b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn);
    btns.push([b, state]); return b;
  };
  const block = (tag) => () => { const cur = document.queryCommandValue('formatBlock').toLowerCase(); exec('formatBlock', cur === tag ? 'p' : tag); };
  const isBlock = (tag) => () => document.queryCommandValue('formatBlock').toLowerCase() === tag;
  const toggleCheck = () => {
    ed.focus();
    const inCheck = () => { const n = getSelection().anchorNode; return (n?.nodeType === 3 ? n.parentElement : n)?.closest?.('ul.ik-check'); };
    if (inCheck()) document.execCommand('insertUnorderedList');
    else {
      if (!document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList');
      const n = getSelection().anchorNode; (n?.nodeType === 3 ? n.parentElement : n)?.closest?.('ul')?.classList.add('ik-check');
    }
    sync();
  };
  const link = () => {
    const sel = getSelection(); const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    const url = prompt('Link address (https://...)', 'https://'); if (!url) return;
    ed.focus(); if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
    if (sel.isCollapsed) document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '')}" target="_blank" rel="noopener">${url.replace(/</g, '')}</a>`);
    else document.execCommand('createLink', false, url);
    sync();
  };
  const q = h('input', { type: 'search', class: 'ik-find-in', placeholder: 'Find in typed notes', 'aria-label': 'Find in typed notes' });
  const findBar = h('div', { class: 'ik-findbar', hidden: true }, q,
    h('button', { type: 'button', class: 'ik-btn sm', 'aria-label': 'Next match', onclick: () => doFind(false) }, icon('down', 18)),
    h('button', { type: 'button', class: 'ik-btn sm', 'aria-label': 'Previous match', onclick: () => doFind(true) }, icon('up', 18)));
  function doFind(back) {
    if (!q.value) return;
    ed.focus();
    if (!window.find(q.value, false, back, true, false, false, false)) { getSelection().removeAllRanges(); window.find(q.value, false, back, true); }
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); } if (e.key === 'Escape') { findBar.hidden = true; ed.focus(); } });
  const toggleFind = () => { findBar.hidden = !findBar.hidden; if (!findBar.hidden) q.focus(); };

  const bar = h('div', { class: 'ik-richbar', role: 'toolbar', 'aria-label': 'Text formatting' },
    mk(null, 'Heading 1', block('h1'), isBlock('h1'), 'H1'), mk(null, 'Heading 2', block('h2'), isBlock('h2'), 'H2'), mk(null, 'Heading 3', block('h3'), isBlock('h3'), 'H3'),
    h('span', { class: 'ik-vsep' }),
    mk(null, 'Bold (Ctrl+B)', () => exec('bold'), () => document.queryCommandState('bold'), 'B'),
    mk(null, 'Italic (Ctrl+I)', () => exec('italic'), () => document.queryCommandState('italic'), 'I'),
    mk(null, 'Underline (Ctrl+U)', () => exec('underline'), () => document.queryCommandState('underline'), 'U'),
    mk(null, 'Strikethrough', () => exec('strikeThrough'), () => document.queryCommandState('strikeThrough'), 'S'),
    h('span', { class: 'ik-vsep' }),
    mk('list', 'Bulleted list', () => exec('insertUnorderedList'), () => document.queryCommandState('insertUnorderedList')),
    mk('olist', 'Numbered list', () => exec('insertOrderedList'), () => document.queryCommandState('insertOrderedList')),
    mk('checklist', 'Checklist', toggleCheck, () => { const n = getSelection().anchorNode; return !!(n?.nodeType === 3 ? n.parentElement : n)?.closest?.('ul.ik-check'); }),
    mk('link', 'Link', link),
    mk('search', 'Find', toggleFind),
    h('span', { class: 'ik-vsep' }),
    mk('wand', 'Transform text', (e) => hooks.transform?.(e.currentTarget, ed)),
    mk('volume', 'Read aloud', (e) => hooks.read?.(e.currentTarget, ed)),
    mk('mic', 'Dictate', (e) => hooks.dictate?.(e.currentTarget, ed)));
  function refresh() { for (const [b, st] of btns) { let on = false; try { on = !!st?.(); } catch { /* ignore */ } b.classList.toggle('on', on); } }

  ed.addEventListener('input', sync);
  ed.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
  ed.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (a && (e.ctrlKey || e.metaKey)) { window.open(a.href, '_blank', 'noopener'); return; }
    const li = e.target.closest('ul.ik-check > li');
    if (li && e.target === li && e.offsetX < 28) { li.toggleAttribute('data-done'); sync(); }
  });
  ed.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(); }
    if (e.key === 'Enter') setTimeout(() => { const n = getSelection().anchorNode; (n?.nodeType === 3 ? n.parentElement : n)?.closest?.('li[data-done]')?.removeAttribute('data-done'); }, 0);
  });
  const selch = () => { if (host.contains(document.activeElement)) refresh(); };
  document.addEventListener('selectionchange', selch);
  host.append(bar, findBar, ed);
  return {
    el: ed,
    focus() { ed.focus(); },
    toggleFind,
    setHtml(html) { ed.innerHTML = html || ''; },
    append(html) { ed.insertAdjacentHTML('beforeend', html); sync(); },
    destroy() { document.removeEventListener('selectionchange', selch); host.replaceChildren(); },
  };
}
