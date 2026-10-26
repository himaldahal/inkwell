// Typed notes: a writing surface (contenteditable, stored in note.text as HTML) with a calm toolbar,
// markdown shortcuts, a "/" block menu, smart paste, typewriter focus and a live word count.
import { h } from '../core/utils.js';
import { icon } from './icons.js';
import { popover, pref, closePopover } from './ui.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
const BLOCKS = [['p', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['blockquote', 'Quote'], ['pre', 'Code block']];
const FONT_CHOICES = [['', 'System'], ['Georgia, "Times New Roman", serif', 'Serif'], ['ui-monospace, Menlo, Consolas, monospace', 'Mono'], ['"Iowan Old Style", "Palatino Linotype", Palatino, serif', 'Book']];
const WIDTHS = [['Narrow', 620], ['Normal', 720], ['Wide', 920]];
const LINES = [['Tight', 1.45], ['Normal', 1.65], ['Airy', 1.9]];

/** small markdown -> html for pasted drafts (headings, lists, quotes, rules, inline emphasis, links) */
export function mdToHtml(text) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = []; let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}${list.c ? ' class="ik-check"' : ''}>${list.items.join('')}</${list.t}>`); list = null; } };
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd(); let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.t !== 'ul' || !list.c) { flushList(); list = { t: 'ul', c: 1, items: [] }; } list.items.push(`<li${m[1] !== ' ' ? ' data-done=""' : ''}>${inline(m[2])}</li>`); continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.t !== 'ul' || list.c) { flushList(); list = { t: 'ul', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.t !== 'ol') { flushList(); list = { t: 'ol', items: [] }; } list.items.push(`<li>${inline(m[1])}</li>`); continue; }
    flushList(); para.push(line);
  }
  flushPara(); flushList();
  return out.join('');
}

export function mountTextLayer(host, note, { onChange, hooks = {} }) {
  const ed = h('div', { class: 'ik-rich', contenteditable: 'true', spellcheck: 'true', 'data-ph': 'Start writing...   type / for blocks, # for a heading, - for a list', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Typed notes' });
  ed.innerHTML = note.text || '';
  const ui = { font: '', size: 0, width: 720, lh: 1.65, typewriter: false, ...pref.get('texttypo', {}) };
  const applyUi = () => {
    ed.style.fontFamily = ui.font || ''; ed.style.fontSize = ui.size ? ui.size + 'px' : ''; ed.style.lineHeight = String(ui.lh);
    ed.style.setProperty('--ik-tw', ui.width + 'px'); host.classList.toggle('ik-typewriter', !!ui.typewriter);
  };
  const saveUi = () => { pref.set('texttypo', ui); applyUi(); };

  // ---------- state helpers ----------
  const sel = () => getSelection();
  const anchorEl = () => { const n = sel().anchorNode; return n?.nodeType === 3 ? n.parentElement : n; };
  const inEditor = () => { const n = sel().anchorNode; return !!n && ed.contains(n); };
  const blockOf = (n) => { let e = n?.nodeType === 3 ? n.parentElement : n; while (e && e !== ed && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(e.tagName)) e = e.parentElement; return e && e !== ed ? e : null; };
  const exec = (c, v) => { ed.focus(); document.execCommand(c, false, v); sync(); };
  const words = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  // ---------- footer: words, reading time, save state, typography ----------
  const stat = h('span', { class: 'ik-wc' }), saved = h('span', { class: 'ik-saved' });
  let savedT = 0;
  const markSaved = () => { saved.textContent = 'Editing...'; saved.classList.remove('ok'); clearTimeout(savedT); savedT = setTimeout(() => { saved.textContent = 'Saved'; saved.classList.add('ok'); }, 900); };
  function stats() {
    const s = sel(), txt = ed.innerText || '', w = words(txt);
    const part = s && !s.isCollapsed && inEditor() ? words(String(s)) : 0;
    stat.textContent = part ? `${part} of ${w.toLocaleString()} words selected` : `${w.toLocaleString()} word${w === 1 ? '' : 's'}  ·  ${Math.max(1, Math.round(w / 230))} min read  ·  ${txt.replace(/\s/g, '').length.toLocaleString()} characters`;
    if (!w && !part) stat.textContent = 'Nothing written yet';
  }
  const typoBtn = h('button', { type: 'button', class: 'ik-foot-btn', title: 'Typography and width', 'aria-label': 'Typography and width' }, 'Aa');
  const twBtn = h('button', { type: 'button', class: 'ik-foot-btn tw', title: 'Typewriter focus: keeps the line you are writing centred', 'aria-label': 'Typewriter focus' }, icon('focus', 16));
  typoBtn.addEventListener('click', () => {
    const seg = (items, cur, set) => h('div', { class: 'ik-seg inl' }, ...items.map(([k, v]) => { const b = h('button', { type: 'button', class: 'ik-segb' + (v === cur || k === cur ? ' on' : '') }, typeof k === 'string' ? k : String(k)); b.addEventListener('click', () => { set(v); [...b.parentElement.children].forEach((x) => x.classList.toggle('on', x === b)); }); return b; }));
    const size = h('input', { type: 'range', min: 14, max: 26, step: 1, value: ui.size || 17, class: 'ik-range', 'aria-label': 'Text size' });
    size.addEventListener('input', () => { ui.size = +size.value; saveUi(); });
    popover(typoBtn, h('div', { class: 'ik-typo' },
      h('div', { class: 'ik-menu-title' }, 'Font'), seg(FONT_CHOICES.map(([v, n]) => [n, v]), ui.font, (v) => { ui.font = v; saveUi(); }),
      h('div', { class: 'ik-menu-title' }, 'Size'), h('div', { class: 'ik-typo-row' }, h('span', { class: 'ik-hint' }, 'A'), size, h('span', { class: 'ik-hint big' }, 'A')),
      h('div', { class: 'ik-menu-title' }, 'Line spacing'), seg(LINES, ui.lh, (v) => { ui.lh = v; saveUi(); }),
      h('div', { class: 'ik-menu-title' }, 'Page width'), seg(WIDTHS, ui.width, (v) => { ui.width = v; saveUi(); })), { align: 'end', cls: 'wide' });
  });
  twBtn.addEventListener('click', () => { ui.typewriter = !ui.typewriter; saveUi(); twBtn.classList.toggle('on', ui.typewriter); if (ui.typewriter) { ed.focus(); keepCentered(); } });
  twBtn.classList.toggle('on', !!ui.typewriter);
  const foot = h('div', { class: 'ik-textfoot' }, stat, h('span', { class: 'ik-foot-sp' }), saved, twBtn, typoBtn);

  // ---------- core sync ----------
  const sync = () => { note.text = ed.innerHTML === '<br>' ? '' : ed.innerHTML; onChange?.(); refresh(); stats(); markSaved(); };
  const btns = [];
  const mk = (ic, label, fn, state, txt, cls = '') => {
    const b = h('button', { type: 'button', class: 'ik-btn sm ' + cls, title: label, 'aria-label': label });
    if (txt) b.append(h('b', {}, txt)); else b.append(icon(ic, 18));
    b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', fn);
    btns.push([b, state]); return b;
  };
  const curBlock = () => { try { return (document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, ''); } catch { return 'p'; } };
  const setBlock = (tag) => { const cur = curBlock(); exec('formatBlock', cur === tag && tag !== 'p' ? 'p' : tag); };
  const isBlock = (tag) => () => curBlock() === tag;
  const inCheck = () => !!anchorEl()?.closest?.('ul.ik-check');
  const toggleCheck = () => {
    ed.focus();
    if (inCheck()) document.execCommand('insertUnorderedList');
    else { if (!document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList'); anchorEl()?.closest?.('ul')?.classList.add('ik-check'); }
    sync();
  };
  const link = () => {
    const s = sel(); const saved0 = s.rangeCount ? s.getRangeAt(0).cloneRange() : null;
    const url = prompt('Link address (https://...)', 'https://'); if (!url) return;
    ed.focus(); if (saved0) { s.removeAllRanges(); s.addRange(saved0); }
    if (s.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`);
    else document.execCommand('createLink', false, url);
    sync();
  };
  const highlight = () => { const on = document.queryCommandValue('hiliteColor'); exec('hiliteColor', /253|fde/i.test(on) || on === 'rgb(253, 230, 138)' ? 'transparent' : '#fde68a'); };
  const insertHtml = (html) => { ed.focus(); document.execCommand('insertHTML', false, html); sync(); };

  // ---------- find ----------
  const q = h('input', { type: 'search', class: 'ik-find-in', placeholder: 'Find in typed notes', 'aria-label': 'Find in typed notes' });
  const findBar = h('div', { class: 'ik-findbar', hidden: true }, q,
    h('button', { type: 'button', class: 'ik-btn sm', 'aria-label': 'Next match', onclick: () => doFind(false) }, icon('down', 18)),
    h('button', { type: 'button', class: 'ik-btn sm', 'aria-label': 'Previous match', onclick: () => doFind(true) }, icon('up', 18)));
  function doFind(back) {
    if (!q.value) return;
    ed.focus();
    if (!window.find(q.value, false, back, true, false, false, false)) { sel().removeAllRanges(); window.find(q.value, false, back, true); }
  }
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey); } if (e.key === 'Escape') { findBar.hidden = true; ed.focus(); } });
  const toggleFind = () => { findBar.hidden = !findBar.hidden; if (!findBar.hidden) q.focus(); };

  // ---------- toolbar ----------
  const blockBtn = h('button', { type: 'button', class: 'ik-blockbtn', title: 'Text style', 'aria-label': 'Text style' }, h('span', {}, 'Text'), icon('down', 14));
  blockBtn.addEventListener('mousedown', (e) => e.preventDefault());
  blockBtn.addEventListener('click', () => {
    const cur = curBlock();
    const list = h('div', { class: 'ik-menu ik-blockmenu' }, ...BLOCKS.map(([tag, name]) => {
      const it = h('button', { type: 'button', class: 'ik-menu-item' + (cur === tag ? ' on' : ''), 'data-tag': tag }, h('span', { class: 'ik-bs ik-bs-' + tag }, name));
      it.addEventListener('mousedown', (e) => e.preventDefault());
      it.addEventListener('click', () => { closePopover(); ed.focus(); exec('formatBlock', tag); });
      return it;
    }));
    popover(blockBtn, list, {});
  });
  const moreBtn = mk('more', 'More: strikethrough, divider, code, find, clear formatting', (e) => {
    const items = [
      ['Strikethrough', () => exec('strikeThrough')], ['Inline code', () => { const t = String(sel()) || 'code'; insertHtml(`<code>${esc(t)}</code>&nbsp;`); }],
      ['Divider', () => exec('insertHorizontalRule')], ['Table 3 x 3', () => insertHtml(TABLE)],
      ['Date', () => insertHtml(esc(new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })))],
      ['Find...', toggleFind], ['Clear formatting', () => { exec('removeFormat'); exec('formatBlock', 'p'); }],
      ...(hooks.transform ? [['Transform text...', () => hooks.transform(moreBtn, ed)]] : []),
      ...(hooks.tts !== false && hooks.read ? [['Read aloud', () => hooks.read(moreBtn, ed)]] : []),
      ...(hooks.dictation !== false && hooks.dictate ? [['Dictate', () => hooks.dictate(moreBtn, ed)]] : []),
    ];
    popover(moreBtn, h('div', { class: 'ik-menu' }, ...items.map(([label, fn]) => { const b = h('button', { type: 'button', class: 'ik-menu-item' }, h('span', {}, label)); b.addEventListener('mousedown', (ev) => ev.preventDefault()); b.addEventListener('click', () => { closePopover(); fn(); }); return b; })), { align: 'end' });
  });
  const sep = () => h('span', { class: 'ik-vsep' });
  const bar = h('div', { class: 'ik-richbar', role: 'toolbar', 'aria-label': 'Text formatting' },
    blockBtn, sep(),
    mk(null, 'Bold (Ctrl+B)', () => exec('bold'), () => document.queryCommandState('bold'), 'B', 'fb'),
    mk(null, 'Italic (Ctrl+I)', () => exec('italic'), () => document.queryCommandState('italic'), 'I', 'fi'),
    mk(null, 'Underline (Ctrl+U)', () => exec('underline'), () => document.queryCommandState('underline'), 'U', 'fu'),
    mk(null, 'Highlight', highlight, () => /253|fde/i.test(document.queryCommandValue('hiliteColor') || ''), 'A', 'fh'), sep(),
    mk('list', 'Bulleted list', () => exec('insertUnorderedList'), () => document.queryCommandState('insertUnorderedList') && !inCheck()),
    mk('olist', 'Numbered list', () => exec('insertOrderedList'), () => document.queryCommandState('insertOrderedList')),
    mk('checklist', 'Checklist', toggleCheck, inCheck), sep(),
    mk(null, 'Quote', () => setBlock('blockquote'), isBlock('blockquote'), '“'),
    mk('link', 'Link (Ctrl+K)', link),
    h('span', { class: 'ik-foot-sp' }), moreBtn);
  function refresh() {
    for (const [b, st] of btns) { let on = false; try { on = !!st?.(); } catch { /* ignore */ } b.classList.toggle('on', on); }
    const c = inEditor() ? curBlock() : 'p'; blockBtn.firstChild.textContent = (BLOCKS.find(([t]) => t === c) || BLOCKS[0])[1];
  }

  // ---------- markdown shortcuts ----------
  const TABLE = '<table class="ik-table"><tbody>' + '<tr><td><br></td><td><br></td><td><br></td></tr>'.repeat(3) + '</tbody></table><p><br></p>';
  /** text of the current block before the caret (collapsed selection only) */
  function beforeCaret() {
    const s = sel(); if (!s.rangeCount || !s.isCollapsed) return null;
    const b = blockOf(s.anchorNode); if (!b) return null;
    const r = document.createRange(); r.selectNodeContents(b); r.setEnd(s.anchorNode, s.anchorOffset);
    return { block: b, text: r.toString(), range: r };
  }
  const eraseBefore = (info) => { const s = sel(); s.removeAllRanges(); s.addRange(info.range); document.execCommand('delete'); };
  const TRIGGERS = [
    [/^#{1}$/, () => document.execCommand('formatBlock', false, 'h1')], [/^#{2}$/, () => document.execCommand('formatBlock', false, 'h2')], [/^#{3}$/, () => document.execCommand('formatBlock', false, 'h3')],
    [/^[-*+]$/, () => document.execCommand('insertUnorderedList')], [/^1[.)]$/, () => document.execCommand('insertOrderedList')],
    [/^(\[\]|\[ \])$/, () => { document.execCommand('insertUnorderedList'); anchorEl()?.closest?.('ul')?.classList.add('ik-check'); }],
    [/^>$/, () => document.execCommand('formatBlock', false, 'blockquote')],
  ];
  /** returns true when a block shortcut fired (the space is swallowed) */
  function blockShortcut() {
    const info = beforeCaret(); if (!info || info.block.tagName === 'LI' || info.block.tagName === 'PRE') return false;
    const hit = TRIGGERS.find(([re]) => re.test(info.text)); if (!hit) return false;
    eraseBefore(info); hit[1](); return true;
  }
  // **bold**, *italic*, _italic_, ~~strike~~ and `code` turn into formatting the moment the closing mark is typed
  const INLINE = [[/(\*\*)([^*\n]+)\*\*$/, 'b', 0], [/(\*)([^*\n]+)\*$/, 'i', 1], [/(_)([^_\n]+)_$/, 'i', 1], [/(~~)([^~\n]+)~~$/, 's', 0], [/(`)([^`\n]+)`$/, 'code', 0]];
  function inlineShortcut() {
    const s = sel(); if (!s.rangeCount || !s.isCollapsed || s.anchorNode.nodeType !== 3) return false;
    const node = s.anchorNode, off = s.anchorOffset, before = node.textContent.slice(0, off);
    for (const [re, tag, guard] of INLINE) {
      const m = re.exec(before); if (!m) continue;
      if (guard && m.index > 0 && /[\w*]/.test(before[m.index - 1])) continue; // snake_case or **x* stays as typed
      const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, off); s.removeAllRanges(); s.addRange(r);
      document.execCommand('insertHTML', false, `<${tag}>${esc(m[2])}</${tag}>`);
      const el = anchorEl()?.closest?.(tag);
      if (el && ed.contains(el)) { const r2 = document.createRange(); r2.setStartAfter(el); r2.collapse(true); s.removeAllRanges(); s.addRange(r2); }
      return true;
    }
    return false;
  }
  // ---------- slash menu ----------
  const SLASH = [
    ['Text', 'Plain paragraph', 'p'], ['Heading 1', 'Big section title', 'h1'], ['Heading 2', 'Medium section title', 'h2'], ['Heading 3', 'Small section title', 'h3'],
    ['Bulleted list', 'Simple bullets', 'ul'], ['Numbered list', 'Ordered steps', 'ol'], ['Checklist', 'Tick things off', 'check'], ['Quote', 'Pull quote', 'blockquote'],
    ['Code block', 'Monospace snippet', 'pre'], ['Divider', 'A thin rule', 'hr'], ['Table', '3 x 3 grid', 'table'], ['Today\'s date', 'Insert the date', 'date'],
  ];
  let slash = null;
  const closeSlash = () => { slash?.el.remove(); slash = null; };
  function slashInfo() {
    const info = beforeCaret(); if (!info) return null;
    const m = /(?:^|\s)\/([a-z0-9 ]{0,16})$/i.exec(info.text); return m ? { info, query: m[1].toLowerCase(), len: m[1].length + 1 } : null;
  }
  function updateSlash() {
    const si = slashInfo(); if (!si) return closeSlash();
    const items = SLASH.filter(([n]) => n.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(si.query.trim()));
    if (!items.length) return closeSlash();
    const r = sel().getRangeAt(0).cloneRange(); r.collapse(true);
    let rect = r.getClientRects()[0] || r.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height && !rect.top)) rect = si.info.block.getBoundingClientRect();
    if (!slash) slash = { el: h('div', { class: 'ik-slash', role: 'listbox', 'data-ik-ui': '' }), i: 0 };
    slash.items = items; slash.si = si; slash.i = Math.min(slash.i, items.length - 1);
    slash.el.replaceChildren(...items.map(([n, d], i) => {
      const b = h('button', { type: 'button', class: 'ik-slash-it' + (i === slash.i ? ' on' : ''), role: 'option' }, h('b', {}, n), h('span', {}, d));
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pickSlash(i); }); return b;
    }));
    const box = host.getBoundingClientRect();
    if (!slash.el.isConnected) host.append(slash.el);
    const hh = slash.el.offsetHeight || 260;
    slash.el.style.left = Math.max(8, Math.min(rect.left - box.left, box.width - 270)) + 'px';
    slash.el.style.top = (rect.bottom + hh + 12 > box.bottom ? rect.top - box.top - hh - 6 : rect.bottom - box.top + 6) + 'px';
    slash.el.children[slash.i]?.scrollIntoView({ block: 'nearest' });
  }
  function pickSlash(i) {
    const it = slash?.items[i]; if (!it) return;
    const { info, len } = slash.si; closeSlash();
    const s = sel(), node = s.anchorNode, off = s.anchorOffset, r = document.createRange();
    r.setStart(node, Math.max(0, off - len)); r.setEnd(node, off); s.removeAllRanges(); s.addRange(r); document.execCommand('delete');
    const kind = it[2]; void info;
    if (['p', 'h1', 'h2', 'h3', 'blockquote', 'pre'].includes(kind)) document.execCommand('formatBlock', false, kind);
    else if (kind === 'ul') document.execCommand('insertUnorderedList'); else if (kind === 'ol') document.execCommand('insertOrderedList');
    else if (kind === 'check') { document.execCommand('insertUnorderedList'); anchorEl()?.closest?.('ul')?.classList.add('ik-check'); }
    else if (kind === 'hr') document.execCommand('insertHorizontalRule'); else if (kind === 'table') document.execCommand('insertHTML', false, TABLE);
    else if (kind === 'date') document.execCommand('insertText', false, new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    sync();
  }

  // ---------- typewriter focus ----------
  let curBlockEl = null;
  function keepCentered() {
    if (!ui.typewriter || !inEditor()) return;
    const b = blockOf(sel().anchorNode); if (b !== curBlockEl) { curBlockEl?.classList.remove('ik-cur'); curBlockEl = b; b?.classList.add('ik-cur'); }
    const r = sel().getRangeAt(0).cloneRange(); r.collapse(true);
    const rc = r.getClientRects()[0] || b?.getBoundingClientRect(); if (!rc) return;
    const er = ed.getBoundingClientRect(), want = er.top + er.height * 0.42;
    if (Math.abs(rc.top - want) > 24) ed.scrollBy({ top: rc.top - want, behavior: 'smooth' });
  }

  // ---------- events ----------
  ed.addEventListener('input', (e) => {
    if (e.inputType === 'insertText' && e.data && /[*_`~]/.test(e.data)) inlineShortcut();
    sync(); updateSlash(); keepCentered();
  });
  ed.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (slash) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); slash.i = (slash.i + (e.key === 'ArrowDown' ? 1 : -1) + slash.items.length) % slash.items.length; updateSlash(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slash.i); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSlash(); return; }
    }
    if (mod && k === 'f') { e.preventDefault(); toggleFind(); return; }
    if (mod && k === 'k') { e.preventDefault(); link(); return; }
    if (mod && e.shiftKey && k === 'x') { e.preventDefault(); exec('strikeThrough'); return; }
    if (mod && e.altKey && ['1', '2', '3'].includes(k)) { e.preventDefault(); exec('formatBlock', 'h' + k); return; }
    if (mod && e.altKey && k === '0') { e.preventDefault(); exec('formatBlock', 'p'); return; }
    if (e.key === ' ' && !mod && !e.altKey) {
      if (blockShortcut()) { e.preventDefault(); sync(); return; }
      const info = beforeCaret();
      if (info && /(^|\s)--$/.test(info.text)) { e.preventDefault(); const s = sel(), n = s.anchorNode, o = s.anchorOffset, r = document.createRange(); r.setStart(n, o - 2); r.setEnd(n, o); s.removeAllRanges(); s.addRange(r); document.execCommand('insertText', false, '— '); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      const info = beforeCaret();
      if (info && info.block.tagName !== 'PRE' && /^(---|\*\*\*)$/.test(info.text) && info.text === info.block.textContent) { e.preventDefault(); eraseBefore(info); document.execCommand('insertHorizontalRule'); sync(); return; }
      if (info && info.block.tagName !== 'PRE' && info.text === '```' && info.text === info.block.textContent) { e.preventDefault(); eraseBefore(info); document.execCommand('formatBlock', false, 'pre'); sync(); return; }
      setTimeout(() => { anchorEl()?.closest?.('li[data-done]')?.removeAttribute('data-done'); }, 0);
    }
    if (e.key === 'Tab' && !mod) { // indent / outdent lists, 2 spaces in code blocks
      const el = anchorEl();
      if (el?.closest?.('li')) { e.preventDefault(); exec(e.shiftKey ? 'outdent' : 'indent'); }
      else if (el?.closest?.('pre')) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    }
  });
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const t = e.clipboardData.getData('text/plain'); if (!t) return;
    const s = sel();
    if (/^https?:\/\/\S+$/.test(t.trim()) && s.rangeCount && !s.isCollapsed) { document.execCommand('createLink', false, t.trim()); sync(); return; }
    if (!/\n/.test(t.trim()) && !/^(#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s)/.test(t.trim())) { document.execCommand('insertText', false, t); return; }
    document.execCommand('insertHTML', false, mdToHtml(t)); sync();
  });
  ed.addEventListener('click', (e) => {
    const a = e.target.closest('a'); const hr = a?.getAttribute('href') || '';
    if (a && hr.startsWith('#ik-')) { e.preventDefault(); if (hr.startsWith('#ik-page-')) hooks.goPage?.(+hr.slice(9) - 1); else ed.querySelector(hr)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (a && (e.ctrlKey || e.metaKey)) { window.open(a.href, '_blank', 'noopener'); return; }
    const li = e.target.closest('ul.ik-check > li');
    if (li && e.target === li && e.offsetX < 28) { li.toggleAttribute('data-done'); sync(); }
    closeSlash();
  });
  ed.addEventListener('blur', () => setTimeout(closeSlash, 120));
  const selch = () => { if (host.contains(document.activeElement)) { refresh(); stats(); keepCentered(); } };
  document.addEventListener('selectionchange', selch);
  host.append(bar, findBar, ed, foot);
  applyUi(); stats(); saved.textContent = 'Saved'; saved.classList.add('ok');
  return {
    el: ed,
    focus() { ed.focus(); },
    toggleFind,
    setHtml(html) { ed.innerHTML = html || ''; stats(); },
    append(html) { ed.insertAdjacentHTML('beforeend', html); sync(); },
    destroy() { document.removeEventListener('selectionchange', selch); clearTimeout(savedT); closeSlash(); host.replaceChildren(); },
  };
}
