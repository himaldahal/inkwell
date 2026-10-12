// Optional peer-to-peer live channel (opt-in). To protect everyone's IP address it ONLY runs through a TURN relay
// (iceTransportPolicy: 'relay'). Without TURN on the server it is unavailable and the HTTP relay (adaptive polling)
// keeps collaborators in sync. Signalling travels over the normal API (polled), never WebSockets.
//   const room = await joinRoom({noteId, ownerId, onMessage}); room.send({...}); room.leave();
import { apiCall } from './sync.js';

export async function p2pAvailable() {
  try { return !!(await apiCall('/api/rtc/ice')).p2p; } catch { return false; }
}

export async function joinRoom({ noteId, ownerId, onMessage = () => {}, onPeers = () => {} }) {
  const ice = await apiCall('/api/rtc/ice');
  if (!ice.p2p || !('RTCPeerConnection' in window)) return null; // caller falls back to HTTP polling
  const me = Math.random().toString(36).slice(2, 12);
  const peers = new Map(); // peerId -> {pc, dc}
  let since = 0, alive = true;
  const post = (type, to, payload) => apiCall('/api/rtc/signal', { method: 'POST', json: { noteId, ownerId, peer: me, to, type, payload }, timeout: 8000 }).catch(() => {});
  const report = () => onPeers([...peers.entries()].filter(([, p]) => p.dc?.readyState === 'open').map(([id]) => id));

  function make(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceTransportPolicy: 'relay' });
    const p = { pc, dc: null };
    peers.set(id, p);
    pc.onicecandidate = (e) => { if (e.candidate && e.candidate.type === 'relay') post('ice', id, e.candidate.toJSON()); }; // never forward non-relay candidates
    pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { peers.delete(id); report(); } };
    const wire = (dc) => { p.dc = dc; dc.onopen = report; dc.onclose = report; dc.onmessage = (e) => { try { onMessage(JSON.parse(e.data), id); } catch { /* ignore */ } }; };
    if (initiator) wire(pc.createDataChannel('inkwell', { ordered: true })); else pc.ondatachannel = (e) => wire(e.channel);
    return p;
  }

  async function handle(m) {
    let p = peers.get(m.from);
    if (m.type === 'hello') { if (!p && me < m.from) { p = make(m.from, true); await p.pc.setLocalDescription(await p.pc.createOffer()); post('offer', m.from, p.pc.localDescription.toJSON()); } }
    else if (m.type === 'offer') { p = p || make(m.from, false); await p.pc.setRemoteDescription(m.payload); await p.pc.setLocalDescription(await p.pc.createAnswer()); post('answer', m.from, p.pc.localDescription.toJSON()); }
    else if (m.type === 'answer' && p) await p.pc.setRemoteDescription(m.payload);
    else if (m.type === 'ice' && p && p.pc.remoteDescription) await p.pc.addIceCandidate(m.payload).catch(() => {});
    else if (m.type === 'bye') { p?.pc.close(); peers.delete(m.from); report(); }
  }
  async function poll() {
    if (!alive) return;
    try {
      const r = await apiCall(`/api/rtc/signal?noteId=${encodeURIComponent(noteId)}&ownerId=${encodeURIComponent(ownerId || '')}&peer=${me}&since=${since}`, { timeout: 8000 });
      since = r.last; for (const m of r.messages) await handle(m);
    } catch { /* retry */ }
    setTimeout(poll, peers.size ? 2500 : 1500);
  }
  post('hello', '', {});
  const hi = setInterval(() => { if (!peers.size) post('hello', '', {}); }, 10000);
  poll();
  return {
    send(obj) { const s = JSON.stringify(obj); let n = 0; for (const { dc } of peers.values()) if (dc?.readyState === 'open') { dc.send(s); n++; } return n > 0; },
    get peerCount() { return [...peers.values()].filter((p) => p.dc?.readyState === 'open').length; },
    leave() { alive = false; clearInterval(hi); post('bye', '', {}); for (const { pc } of peers.values()) pc.close(); peers.clear(); },
  };
}
