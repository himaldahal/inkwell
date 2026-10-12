// Read aloud (speechSynthesis with word highlighting) and dictation (SpeechRecognition).
import { h } from '../core/utils.js';
import { popover } from './ui.js';
import { toast } from '../core/store.js';

export const ttsSupported = () => 'speechSynthesis' in window;
export const dictationSupported = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
const pr = { rate: 1, pitch: 1, voice: '' };

function textMap(root) {
  const nodes = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let text = '', n;
  while ((n = w.nextNode())) { nodes.push({ n, at: text.length }); text += n.data + (n.parentElement?.closest('li,p,div,h1,h2,h3') && !n.nextSibling ? ' ' : ''); }
  return { nodes, text };
}
function rangeFor(map, i, len) {
  let a = null;
  for (const m of map.nodes) if (m.at <= i && (!a || m.at >= a.at)) a = m;
  if (!a) return null;
  const r = new Range(), off = Math.min(i - a.at, a.n.length); r.setStart(a.n, off); r.setEnd(a.n, Math.min(a.n.length, off + (len || 1))); return r;
}
let utter = null, state = 'idle';
export function stopReading() { if (ttsSupported()) speechSynthesis.cancel(); utter = null; state = 'idle'; CSS.highlights?.delete('ik-read'); }

/** speak(textOrRoot): root element => highlights words as spoken. Returns promise resolved at end. */
export function speak(src, { onEnd } = {}) {
  if (!ttsSupported()) { toast('Read aloud is not supported on this device'); return; }
  stopReading();
  let text, map = null;
  if (typeof src === 'string') text = src; else {
    const sel = getSelection(), rg = sel.rangeCount && !sel.isCollapsed && src.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
    map = textMap(src); text = map.text;
    if (rg) { // read only the selection
      const pre = new Range(); pre.setStart(src, 0); pre.setEnd(rg.startContainer, rg.startOffset);
      const start = textMap(src); void start; const startIdx = Math.min(text.length, pre.toString().length); text = text.slice(startIdx, startIdx + rg.toString().length); map.base = startIdx;
    }
  }
  if (!text.trim()) { toast('Nothing to read'); onEnd?.(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.rate = pr.rate; u.pitch = pr.pitch;
  const v = speechSynthesis.getVoices().find((x) => x.voiceURI === pr.voice); if (v) u.voice = v;
  u.onboundary = (e) => {
    if (!map || !CSS.highlights || e.name === 'sentence') return;
    const r = rangeFor(map, (map.base || 0) + e.charIndex, e.charLength || 6); if (r) CSS.highlights.set('ik-read', new Highlight(r));
  };
  u.onend = u.onerror = () => { if (utter === u) { stopReading(); onEnd?.(); } };
  utter = u; state = 'playing'; speechSynthesis.speak(u);
}
export function readControls(anchor, { start, onStop }) {
  const rate = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: pr.rate, class: 'ik-range', 'aria-label': 'Speed' });
  const pitch = h('input', { type: 'range', min: 0.5, max: 2, step: 0.1, value: pr.pitch, class: 'ik-range', 'aria-label': 'Pitch' });
  const voices = h('select', { class: 'ik-ref-sel', 'aria-label': 'Voice' });
  const fill = () => { voices.replaceChildren(h('option', { value: '' }, 'Default voice'), ...speechSynthesis.getVoices().map((v) => h('option', { value: v.voiceURI }, `${v.name} (${v.lang})`))); voices.value = pr.voice; };
  if (ttsSupported()) { fill(); speechSynthesis.onvoiceschanged = fill; }
  rate.oninput = () => { pr.rate = +rate.value; }; pitch.oninput = () => { pr.pitch = +pitch.value; }; voices.onchange = () => { pr.voice = voices.value; };
  const btn = (t, fn) => h('button', { type: 'button', class: 'ik-btn', onclick: fn }, t);
  const box = h('div', { class: 'ik-tagbox' }, h('div', { class: 'ik-menu-title' }, 'Read aloud'),
    h('div', { class: 'ik-hexrow' }, btn('Play', () => start()), btn('Pause', () => { speechSynthesis.pause(); }), btn('Resume', () => speechSynthesis.resume()), btn('Stop', () => { stopReading(); onStop?.(); })),
    h('label', { class: 'ik-check-l' }, 'Speed', rate), h('label', { class: 'ik-check-l' }, 'Pitch', pitch), voices,
    ttsSupported() ? null : h('p', { class: 'ik-hint' }, 'Speech synthesis is not available in this browser.'));
  return popover(anchor, box, { align: 'end' });
}

// ---- dictation ----
let rec = null;
export const dictating = () => !!rec;
export function stopDictation() { rec?.stop(); }
/** target(): returns the contenteditable element to insert into (or null) */
export function toggleDictation(target, onState) {
  if (rec) { rec.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Dictation is not supported in this browser'); return; }
  const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
  let span = null;
  const clear = () => { span?.remove(); span = null; };
  r.onresult = (ev) => {
    const el = target(); if (!el) return;
    let fin = '', interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) (ev.results[i].isFinal ? (fin += ev.results[i][0].transcript) : (interim += ev.results[i][0].transcript));
    el.focus();
    if (fin) { clear(); document.execCommand('insertText', false, fin + ' '); }
    if (interim) {
      if (!span) { span = h('span', { class: 'ik-interim' }); const s = getSelection(); if (s.rangeCount) { const g = s.getRangeAt(0); g.collapse(false); g.insertNode(span); } else el.append(span); }
      span.textContent = interim;
    }
  };
  r.onerror = (e) => {
    const m = { 'not-allowed': 'Microphone permission was denied', 'service-not-allowed': 'Dictation is blocked on this device', network: 'Dictation needs an internet connection in this browser', 'no-speech': 'No speech heard' }[e.error];
    toast(m || 'Dictation error: ' + e.error);
  };
  r.onend = () => { clear(); rec = null; onState?.(false); };
  try { r.start(); rec = r; onState?.(true); toast('Listening...'); } catch (e) { toast('Could not start dictation'); }
}
