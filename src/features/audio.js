// Audio recording + playback with page markers.
import { putAsset, getAsset, getRecord, putRecord, softDelete, newId } from '../core/db.js';
import { emit, toast } from '../core/store.js';
import { h } from '../core/utils.js';

const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
export function bestAudioMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIMES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';
}
export const isRecordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

function micError(e) {
  const n = e?.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone access was denied. Allow it in your browser settings and try again.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found.';
  if (n === 'NotReadableError') return 'The microphone is in use by another app.';
  return 'Could not start recording' + (e?.message ? ': ' + e.message : '.');
}

// Recorders live at module level, so recording keeps running while the user switches pages/notes.
const active = new Map();
/** the in-progress recorder for a note (or null) */
export const getActiveRecorder = (noteId) => active.get(noteId) || null;
export const getAnyActiveRecorder = () => active.values().next().value || null;

/**
 * Tag a stroke with the recording position at which it was written: stroke.at = {r: recordingId, t: seconds}.
 * Call from the editor when a stroke is committed, if getActiveRecorder(noteId) is recording.
 */
export function stampStroke(stroke, recorder) {
  if (!recorder || recorder.state !== 'recording') return stroke;
  stroke.at = { r: recorder.recordingId, t: Math.round(recorder.getElapsed() * 10) / 10 };
  return stroke;
}
/**
 * Tap a stroke -> seek audio. `players` is a player handle from mountPlayer (or an array of them).
 * Returns true if some player owns the stroke's recording and was seeked.
 */
export function seekForStroke(stroke, players, { play = true, lead = 1 } = {}) {
  const at = stroke?.at;
  if (!at) return false;
  for (const p of [].concat(players || [])) {
    if (p?.recordingId === at.r) { p.seek(Math.max(0, at.t - lead)); if (play) p.play(); return true; }
  }
  return false;
}

/**
 * createRecorder(noteId) -> { start, pause, resume, stop, onTick(cb), addMarker(pageId), getElapsed, markers, state }
 * state: 'idle'|'recording'|'paused'|'stopped' (getter). start() rejects with a friendly Error on permission problems.
 * stop() resolves to the saved recording {id,assetId,duration,createdAt,markers} (also pushed into note.recordings).
 */
export function createRecorder(noteId) {
  let state = 'idle', stream, mr, chunks = [], mime = '';
  let accum = 0, segStart = 0, timer;
  const ticks = new Set();
  const markers = [];
  const recordingId = newId();
  let actx, analyser;
  const elapsed = () => accum + (state === 'recording' ? (performance.now() - segStart) / 1000 : 0);
  const tick = () => ticks.forEach((cb) => { try { cb(elapsed(), state); } catch (e) { console.error(e); } });
  const cleanup = () => { clearInterval(timer); try { actx?.close(); } catch { /* ignore */ } actx = analyser = null; if (active.get(noteId) === api) active.delete(noteId); stream?.getTracks().forEach((t) => t.stop()); stream = null; };

  const api = {
    get state() { return state; },
    markers,
    recordingId,
    /** live input level 0..1 (for a waveform meter) */
    level() {
      if (!analyser) return 0;
      const d = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(d);
      let m = 0; for (const v of d) m = Math.max(m, Math.abs(v - 128)); return m / 128;
    },
    getElapsed: elapsed,
    mime: () => mime,
    onTick(cb) { ticks.add(cb); return () => ticks.delete(cb); },
    addMarker(pageId) { return addMarker(api, pageId); },
    async start() {
      if (state !== 'idle') return;
      if (!isRecordingSupported()) throw new Error('Audio recording is not supported in this browser.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch (e) { throw new Error(micError(e)); }
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = actx.createAnalyser(); analyser.fftSize = 512;
        actx.createMediaStreamSource(stream).connect(analyser);
      } catch { actx = analyser = null; }
      mime = bestAudioMime();
      try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
      catch (e) { cleanup(); throw new Error(micError(e)); }
      mime = mr.mimeType || mime || 'audio/webm';
      chunks = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      mr.start(1000);
      state = 'recording'; segStart = performance.now(); accum = 0;
      active.set(noteId, api);
      timer = setInterval(tick, 250);
      tick();
    },
    pause() {
      if (state !== 'recording') return;
      accum = elapsed(); state = 'paused';
      try { mr.pause(); } catch { /* ignore */ }
      tick();
    },
    resume() {
      if (state !== 'paused') return;
      try { mr.resume(); } catch { /* ignore */ }
      state = 'recording'; segStart = performance.now(); tick();
    },
    async stop() {
      if (state !== 'recording' && state !== 'paused') return null;
      const duration = elapsed();
      state = 'stopped';
      const done = new Promise((res) => { mr.onstop = res; });
      try { mr.stop(); } catch { /* ignore */ }
      await done;
      cleanup();
      tick();
      const blob = new Blob(chunks, { type: mime });
      chunks = [];
      if (!blob.size) return null;
      const asset = await putAsset({ noteId, kind: 'audio', blob, mime: blob.type || mime });
      const rec = { id: recordingId, assetId: asset.id, duration, createdAt: Date.now(), markers: markers.slice() };
      const note = await getRecord('notes', noteId);
      if (note) {
        note.recordings = (note.recordings || []).concat(rec);
        await putRecord('notes', note);
        emit('notes:changed', { id: noteId, recordings: true });
      }
      return rec;
    },
    /** abort without saving */
    cancel() {
      if (mr && state !== 'stopped' && state !== 'idle') { mr.onstop = null; try { mr.stop(); } catch { /* ignore */ } }
      chunks = []; state = 'stopped'; cleanup();
    },
  };
  return api;
}

/**
 * Record that `pageId` is being written now. `target` is a live recorder (uses its clock)
 * or a recording object (pass t explicitly). Consecutive markers for the same page are collapsed.
 */
export function addMarker(target, pageId, t) {
  if (!target || !pageId) return null;
  const list = target.markers || (target.markers = []);
  if (t == null) {
    if (typeof target.getElapsed !== 'function') return null;
    if (target.state !== 'recording' && target.state !== 'paused') return null;
    t = target.getElapsed();
  }
  const last = list[list.length - 1];
  if (last && last.pageId === pageId) return last;
  const m = { t: Math.round(t * 10) / 10, pageId };
  list.push(m);
  return m;
}

// ---- player ---------------------------------------------------------------
const CSS = `
.iw-player{--_bg:var(--surface,var(--bg,#fff));display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--border,#e5e0d8);border-radius:12px;background:var(--_bg);color:var(--text,#1f1d1a);font:13px/1.3 system-ui,sans-serif}
.iw-player *{box-sizing:border-box}
.iw-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.iw-btn{min-width:36px;height:36px;padding:0 10px;border:1px solid var(--border,#e5e0d8);border-radius:18px;background:transparent;color:inherit;font:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.iw-btn:hover{background:color-mix(in srgb,var(--accent,#4f46e5) 12%,transparent)}
.iw-btn:focus-visible,.iw-scrub:focus-visible,.iw-chip:focus-visible{outline:2px solid var(--accent,#4f46e5);outline-offset:2px}
.iw-play{background:var(--accent,#4f46e5);border-color:var(--accent,#4f46e5);color:#fff;min-width:44px;height:44px;border-radius:22px;font-size:16px}
.iw-play:hover{background:var(--accent,#4f46e5);filter:brightness(1.1)}
.iw-time{font-variant-numeric:tabular-nums;color:var(--muted,#7a746b);min-width:88px;text-align:right;margin-left:auto}
.iw-scrub{width:100%;accent-color:var(--accent,#4f46e5);margin:0;height:24px}
.iw-chips{display:flex;gap:6px;flex-wrap:wrap}
.iw-chip{padding:3px 10px;border-radius:12px;border:1px solid var(--border,#e5e0d8);background:transparent;color:var(--muted,#7a746b);font:inherit;font-size:12px;cursor:pointer}
.iw-chip.on{background:var(--accent,#4f46e5);border-color:var(--accent,#4f46e5);color:#fff}
.iw-wave{width:100%;height:40px;display:block;cursor:pointer;border-radius:6px}
.iw-del{color:#c0392b}
.iw-err{color:#c0392b}
`;
function ensureCss() {
  if (document.getElementById('iw-player-css')) return;
  const s = document.createElement('style'); s.id = 'iw-player-css'; s.textContent = CSS; document.head.append(s);
}
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), r = s % 60, hr = Math.floor(m / 60);
  return (hr ? hr + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * mountPlayer(el, recording, opts) -> { destroy, seek(t), play(), pause(), audio }
 * opts: { pages: note.pages (for chip labels), onMarker(pageId), onPage(pageId) (fires while playing), onDelete(recording) }
 */
export function mountPlayer(el, recording, opts = {}) {
  ensureCss();
  const audio = new Audio();
  audio.preload = 'metadata';
  let url, dead = false, dur = recording.duration || 0, activePage = null;
  const root = h('div', { class: 'iw-player', role: 'group', 'aria-label': 'Audio recording' });
  const playBtn = h('button', { class: 'iw-btn iw-play', type: 'button', 'aria-label': 'Play' }, '▶');
  const back = h('button', { class: 'iw-btn', type: 'button', 'aria-label': 'Back 10 seconds', title: 'Back 10s' }, '−10');
  const fwd = h('button', { class: 'iw-btn', type: 'button', 'aria-label': 'Forward 10 seconds', title: 'Forward 10s' }, '+10');
  const speed = h('select', { class: 'iw-btn', 'aria-label': 'Playback speed' },
    SPEEDS.map((s) => h('option', { value: s, selected: s === 1 }, s + '×')));
  const delBtn = h('button', { class: 'iw-btn iw-del', type: 'button', 'aria-label': 'Delete recording', title: 'Delete recording' }, '\u{1F5D1}');
  const time = h('span', { class: 'iw-time', 'aria-live': 'off' }, `0:00 / ${fmt(dur)}`);
  const scrub = h('input', { class: 'iw-scrub', type: 'range', min: 0, max: Math.max(1, dur), step: 0.1, value: 0, 'aria-label': 'Seek' });
  const msg = h('div', { class: 'iw-err', role: 'alert', hidden: true });
  const chipsBox = h('div', { class: 'iw-chips', role: 'list', 'aria-label': 'Page markers' });
  const wave = h('canvas', { class: 'iw-wave', width: 600, height: 80, 'aria-hidden': 'true' });
  root.append(h('div', { class: 'iw-row' }, playBtn, back, fwd, speed, time, delBtn), wave, scrub, chipsBox, msg);
  el.append(root);

  const pageIds = (opts.pages || []).map((p) => p.id);
  const pageLabel = (id) => {
    let i = pageIds.indexOf(id);
    if (i < 0) { const u = [...new Set((recording.markers || []).map((m) => m.pageId))]; i = u.indexOf(id); }
    return 'Page ' + (i + 1);
  };
  const markers = (recording.markers || []).slice().sort((a, b) => a.t - b.t);
  const chips = markers.map((m) => {
    const c = h('button', { class: 'iw-chip', type: 'button', role: 'listitem', title: 'Jump to ' + fmt(m.t),
      'aria-label': `${pageLabel(m.pageId)} at ${fmt(m.t)}`, onclick: () => { seek(m.t); opts.onMarker?.(m.pageId); play(); } },
    `${pageLabel(m.pageId)} · ${fmt(m.t)}`);
    chipsBox.append(c); return c;
  });
  if (!markers.length) chipsBox.hidden = true;

  function setPlaying(p) {
    playBtn.textContent = p ? '⏸' : '▶';
    playBtn.setAttribute('aria-label', p ? 'Pause' : 'Play');
  }
  function update() {
    const t = audio.currentTime || 0;
    if (Number.isFinite(audio.duration) && audio.duration > 0) dur = audio.duration;
    scrub.max = Math.max(dur, t, 1);
    if (!scrubbing) scrub.value = t;
    time.textContent = `${fmt(t)} / ${fmt(dur)}`;
    drawWave(dur ? t / dur : 0);
    let idx = -1;
    markers.forEach((m, i) => { if (m.t <= t + 0.05) idx = i; });
    chips.forEach((c, i) => c.classList.toggle('on', i === idx));
    const pid = idx >= 0 ? markers[idx].pageId : null;
    if (pid && pid !== activePage && !audio.paused) opts.onPage?.(pid);
    activePage = pid;
  }
  let peaks = null;
  function drawWave(frac) {
    const ctx = wave.getContext('2d'); const W = wave.width, H = wave.height;
    ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(root);
    const muted = cs.getPropertyValue('--muted').trim() || '#9a948a', accent = cs.getPropertyValue('--accent').trim() || '#4f46e5';
    const n = peaks ? peaks.length : 100;
    const bw = W / n;
    for (let i = 0; i < n; i++) {
      const v = peaks ? peaks[i] : 0.04;
      const hh = Math.max(3, v * H * 0.95);
      ctx.fillStyle = i / n <= frac ? accent : muted;
      ctx.globalAlpha = i / n <= frac ? 1 : 0.5;
      ctx.fillRect(i * bw + 1, (H - hh) / 2, Math.max(1, bw - 2), hh);
    }
    ctx.globalAlpha = 1;
  }
  async function computePeaks() {
    try {
      const a = await getAsset(recording.assetId);
      if (!a?.blob || a.blob.size > 40e6 || dead) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const buf = await ctx.decodeAudioData(await a.blob.arrayBuffer());
      ctx.close();
      const ch = buf.getChannelData(0), N = 120, step = Math.floor(ch.length / N) || 1;
      const p = new Float32Array(N); let mx = 0;
      for (let i = 0; i < N; i++) { let m = 0; for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(ch[j])); p[i] = m; mx = Math.max(mx, m); }
      if (mx > 0) for (let i = 0; i < N; i++) p[i] /= mx;
      if (!dead) { peaks = p; if (!(buf.duration > 0) || !recording.duration) dur = buf.duration; update(); }
    } catch { /* waveform is optional */ }
  }
  wave.addEventListener('click', (e) => { const r = wave.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * dur); });
  let scrubbing = false;
  async function load() {
    if (url) return true;
    const a = await getAsset(recording.assetId);
    if (!a?.blob) { msg.hidden = false; msg.textContent = 'Audio data is not available on this device yet.'; return false; }
    url = URL.createObjectURL(a.blob);
    audio.src = url;
    return true;
  }
  async function play() {
    if (!(await load()) || dead) return;
    try { await audio.play(); } catch (e) { msg.hidden = false; msg.textContent = 'Could not play: ' + (e?.message || e); }
  }
  function pause() { audio.pause(); }
  function seek(t) {
    t = Math.min(Math.max(0, t), dur || t);
    if (!url) { load().then(() => { audio.currentTime = t; update(); }); return; }
    audio.currentTime = t; update();
  }
  playBtn.onclick = () => (audio.paused ? play() : pause());
  back.onclick = () => seek((audio.currentTime || 0) - 10);
  fwd.onclick = () => seek((audio.currentTime || 0) + 10);
  speed.onchange = () => { audio.playbackRate = Number(speed.value); };
  scrub.addEventListener('input', () => { scrubbing = true; time.textContent = `${fmt(scrub.value)} / ${fmt(dur)}`; });
  scrub.addEventListener('change', () => { scrubbing = false; seek(Number(scrub.value)); });
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => { setPlaying(false); update(); });
  audio.addEventListener('timeupdate', update);
  audio.addEventListener('durationchange', update);
  audio.addEventListener('error', () => { msg.hidden = false; msg.textContent = 'This recording could not be played.'; });
  root.addEventListener('keydown', (e) => {
    if (e.target === scrub || e.target === speed) return;
    if (e.key === 'ArrowLeft') { seek((audio.currentTime || 0) - 10); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { seek((audio.currentTime || 0) + 10); e.preventDefault(); }
  });
  delBtn.onclick = async () => {
    if (!confirm('Delete this recording?')) return;
    audio.pause();
    try {
      const a = await getAsset(recording.assetId);
      const noteId = a?.noteId || opts.noteId;
      await softDelete('assets', recording.assetId);
      if (noteId) {
        const note = await getRecord('notes', noteId);
        if (note) {
          note.recordings = (note.recordings || []).filter((r) => r.id !== recording.id);
          await putRecord('notes', note);
          emit('notes:changed', { id: noteId, recordings: true });
        }
      }
      opts.onDelete?.(recording);
      toast('Recording deleted');
    } catch (e) { toast('Could not delete recording'); console.error(e); }
    destroy();
  };
  function destroy() {
    if (dead) return; dead = true;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    if (url) URL.revokeObjectURL(url);
    root.remove();
  }
  drawWave(0);
  (window.requestIdleCallback || setTimeout)(computePeaks);
  return { destroy, seek, play, pause, audio, recordingId: recording.id, recording };
}
