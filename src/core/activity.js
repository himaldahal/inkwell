// Presence + activity for shared notes. HTTP-relayed (no sockets, no peer IPs). Emits 'presence:update' and 'activity:update'.
//   startActivity({noteId, ownerId}) -> { setState(state, pageId), report(action, {pageId,count}), stop() }
import { emit } from './store.js';
import { apiCall, getAuth } from './sync.js';

const HEARTBEAT_MS = 5000;
let current = null;
const hue = (s = '') => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${x % 360} 60% 50%)`; };

/** short opaque author id to stamp on strokes/items (stable per user per device, reveals nothing) */
export async function authorId() {
  const a = await getAuth();
  return a?.user?.id ? a.user.id.slice(0, 8) : 'local';
}

export async function startActivity({ noteId, ownerId } = {}) {
  current?.stop();
  const auth = await getAuth();
  if (!auth?.token || !noteId) return { setState() {}, report() {}, stop() {} };
  let state = 'viewing', pageId = '', stopped = false, timer = null, pending = new Map();
  const beat = async () => {
    if (stopped || document.visibilityState !== 'visible' || !navigator.onLine) return;
    try {
      const r = await apiCall('/api/presence', { method: 'POST', json: { noteId, ownerId, state, pageId }, timeout: 8000 });
      emit('presence:update', { noteId, users: r.users.map((u) => ({ name: u.name, color: hue(u.id || u.name), avatar: u.avatar, id: u.id, state: u.state, pageId: u.pageId })) });
    } catch { /* offline or not a collaborator: stay quiet */ }
  };
  const flush = async () => {
    const batch = [...pending.values()]; pending.clear();
    for (const e of batch) { try { await apiCall(`/api/notes/${encodeURIComponent(noteId)}/activity`, { method: 'POST', json: { ownerId, ...e }, timeout: 8000 }); } catch { /* best effort */ } }
    if (batch.length) emit('activity:update', { noteId });
  };
  timer = setInterval(() => { beat(); flush(); }, HEARTBEAT_MS);
  beat();
  const api = {
    setState(s, p = '') { if (s !== state || p !== pageId) { state = s; pageId = p; beat(); } },
    /** coalesced locally (and again server-side within 30 s windows) */
    report(action, { pageId: pg = '', count = 1 } = {}) {
      const k = action + ':' + pg, e = pending.get(k) || { action, pageId: pg, count: 0 };
      e.count += count; pending.set(k, e);
    },
    async list({ before } = {}) { return apiCall(`/api/notes/${encodeURIComponent(noteId)}/activity?ownerId=${encodeURIComponent(ownerId || '')}` + (before ? '&before=' + encodeURIComponent(before) : '')); },
    stop() { stopped = true; clearInterval(timer); flush(); current = null; emit('presence:update', { noteId, users: [] }); },
  };
  current = api;
  return api;
}
