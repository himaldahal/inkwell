import { getSetting, setSetting } from './settings.js';
import { on } from './store.js';

/** Optional feature registry. Disabled modules are not loaded (gate imports with whenEnabled) and their UI stays hidden. */
export const MODULES = [
  { id: 'pdf', name: 'PDF import and annotate', description: 'Import PDFs and write on them.', default: true, deps: [] },
  { id: 'audio', name: 'Audio recording', description: 'Record lectures synced to your strokes.', default: true, deps: [] },
  { id: 'ocr', name: 'Handwriting search (OCR)', description: 'Make handwriting searchable. Downloads a recognition model.', default: false, deps: [], network: true },
  { id: 'tts', name: 'Read aloud', description: 'Have notes read to you with the device voice.', default: true, deps: [] },
  { id: 'dictation', name: 'Dictation', description: 'Speak to type. Uses the browser speech service, which may need a connection.', default: false, deps: [], network: true },
  { id: 'embeds', name: 'Embeds', description: 'Embed web content and videos in notes.', default: true, deps: [], network: true },
  { id: 'sketch', name: 'Sketch board (Excalidraw-style)', description: 'Diagrams and whiteboards inside notes.', default: true, deps: [] },
  { id: 'toc', name: 'Table of contents', description: 'Outline panel built from headings.', default: true, deps: [] },
  { id: 'collab', name: 'Collaboration and presence', description: 'See who is editing and edit together.', default: true, deps: [], network: true },
  { id: 'rtc', name: 'Live calls', description: 'Voice and video while collaborating.', default: false, deps: ['collab'], network: true },
  { id: 'e2ee', name: 'End-to-end encryption', description: 'Encrypt synced notes with your passphrase.', default: false, deps: [] },
  { id: 'study', name: 'CA Study Hub', description: 'Planner, revision, flashcards, mock tests and calculators for CA exams.', default: true, deps: [] },
  { id: 'fonts', name: 'Extra fonts', description: 'Additional handwriting and typing fonts.', default: true, deps: [], network: true },
];
const byId = new Map(MODULES.map((m) => [m.id, m]));
const impls = new Map();       // id -> { init, destroy, live }
const listeners = new Set();

const explicit = (id) => getSetting('modules.' + id);
export function isEnabled(id) {
  const m = byId.get(id);
  if (!m) return false;
  const v = explicit(id);
  return (v === undefined ? m.default : !!v) && m.deps.every(isEnabled);
}
export const enable = (id) => { const m = byId.get(id); return Promise.all([...(m?.deps || []).map(enable), setSetting('modules.' + id, true)]); };
export const disable = (id) => Promise.all([setSetting('modules.' + id, false), ...MODULES.filter((m) => m.deps.includes(id)).map((m) => disable(m.id))]);
export const onModuleChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** run `loader` (a dynamic import) only when the module is on; resolves null otherwise */
export const whenEnabled = async (id, loader) => (isEnabled(id) ? loader() : null);
/** features can register/replace their implementation; init runs when enabled, destroy when disabled */
export function registerModule({ id, init, destroy }) {
  impls.get(id)?.destroy?.();
  impls.set(id, { init, destroy, live: false });
  sync(id);
}
function sync(id) {
  const i = impls.get(id); if (!i) return;
  const on_ = isEnabled(id);
  if (on_ && !i.live) { i.live = true; i.init?.(); } else if (!on_ && i.live) { i.live = false; i.destroy?.(); }
}
let last = {};
on('settings:changed', () => {
  const now = Object.fromEntries(MODULES.map((m) => [m.id, isEnabled(m.id)]));
  for (const m of MODULES) if (now[m.id] !== last[m.id]) { sync(m.id); if (last[m.id] !== undefined) listeners.forEach((f) => f(m.id, now[m.id])); }
  last = now;
});
setTimeout(() => { last = Object.fromEntries(MODULES.map((m) => [m.id, isEnabled(m.id)])); }, 0);
