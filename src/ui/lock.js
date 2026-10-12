import { getMeta, setMeta, putRecord } from '../core/db.js';
import { emit, on, toast } from '../core/store.js';
import { h, openModal, icon } from './dom.js';

/* Passcode gate. A key is derived with PBKDF2 and used to AES-GCM encrypt a known
   token; checking a passcode means decrypting that token. This gates access in the UI
   (and blurs previews); it does not re-encrypt note bodies at rest. */
const enc = new TextEncoder();
const TOKEN = 'inkwell-lock-v1';
const ITER = 150000;
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function makeLock(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await derive(pass, salt), enc.encode(TOKEN));
  return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
export async function checkLock(lock, pass) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(lock.iv) }, await derive(pass, unb64(lock.salt), lock.iter || ITER), unb64(lock.ct));
    return new TextDecoder().decode(pt) === TOKEN;
  } catch { return false; }
}

const unlocked = new Set();
let appLockObj = null;
let appIsLocked = false;
export const isNoteLocked = (n) => !!n?.lock && !unlocked.has(n.id);
export const hasLock = (n) => !!n?.lock;

function passDialog({ title, message, confirm = false, confirmLabel = 'Unlock', noClose = false }) {
  return new Promise((res) => {
    let out = null;
    const p1 = h('input', { class: 'input', type: 'password', placeholder: 'Passcode', 'aria-label': 'Passcode', autocomplete: 'off' });
    const p2 = confirm ? h('input', { class: 'input', type: 'password', placeholder: 'Repeat passcode', 'aria-label': 'Repeat passcode', autocomplete: 'off' }) : null;
    const err = h('p', { class: 'form-err', role: 'alert' });
    const m = openModal({
      title, size: 'sm', hideHead: noClose, className: noClose ? 'lockscreen' : '',
      body: [noClose && h('div', { class: 'lock-ic' }, icon('lock', 28)), noClose && h('h2', { class: 'lock-title' }, title), message && h('p', { class: 'muted-p' }, message), p1, p2, err],
      actions: [!noClose && { label: 'Cancel', kind: 'ghost' }, {
        label: confirmLabel, kind: 'primary',
        onClick: () => {
          if (p1.value.length < 4) { err.textContent = 'Use at least 4 characters.'; return false; }
          if (p2 && p2.value !== p1.value) { err.textContent = 'Passcodes do not match.'; return false; }
          out = { pass: p1.value, setErr: (t) => { err.textContent = t; } };
        },
      }].filter(Boolean),
    });
    m.closed.then(() => res(out));
    if (noClose) { m.el.closest('.backdrop').classList.add('lock-bd'); }
    setTimeout(() => p1.focus(), 30);
  });
}
async function askUntil(lock, opts) {
  for (;;) {
    const r = await passDialog(opts);
    if (!r) return false;
    if (await checkLock(lock, r.pass)) return true;
    toast('Wrong passcode', { type: 'error' });
    if (opts.noClose !== true) opts = { ...opts, message: 'That passcode was wrong. Try again.' };
  }
}
/** resolves true if the note is open for the user */
export async function requireUnlock(note) {
  if (!note?.lock || unlocked.has(note.id)) return true;
  const ok = await askUntil(note.lock, { title: 'Locked note', message: 'Enter the passcode to open this note.' });
  if (ok) { unlocked.add(note.id); emit('lock:changed', { id: note.id }); }
  return ok;
}
export async function lockNote(note) {
  const r = await passDialog({ title: 'Lock note', message: 'Choose a passcode. It cannot be recovered if you forget it.', confirm: true, confirmLabel: 'Lock note' });
  if (!r) return false;
  note.lock = await makeLock(r.pass);
  unlocked.delete(note.id);
  await putRecord('notes', note);
  toast('Note locked');
  return true;
}
export async function removeLock(note) {
  if (!(await requireUnlock(note))) return false;
  delete note.lock;
  await putRecord('notes', note);
  toast('Lock removed');
  return true;
}
export function relockAll() {
  unlocked.clear();
  emit('lock:changed', {});
}

// ---------- app lock ----------
export async function initAppLock() {
  appLockObj = await getMeta('appLock', null);
  if (appLockObj) showAppLock();
  let t;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      t = setTimeout(() => { relockAll(); emit('lock:relock'); if (appLockObj) showAppLock(); }, 10000);
    } else clearTimeout(t);
  });
}
export const appLockEnabled = () => !!appLockObj;
export async function setAppLock(enable) {
  if (enable) {
    const r = await passDialog({ title: 'App passcode', message: 'Ask for a passcode when Inkwell opens or returns from the background.', confirm: true, confirmLabel: 'Enable' });
    if (!r) return false;
    appLockObj = await makeLock(r.pass);
  } else {
    if (appLockObj && !(await askUntil(appLockObj, { title: 'Disable app lock', message: 'Enter your passcode.' }))) return false;
    appLockObj = null;
  }
  await setMeta('appLock', appLockObj);
  return true;
}
async function showAppLock() {
  if (appIsLocked || !appLockObj) return;
  appIsLocked = true;
  document.documentElement.classList.add('app-locked');
  await askUntil(appLockObj, { title: 'Inkwell is locked', message: 'Enter your passcode.', noClose: true });
  appIsLocked = false;
  document.documentElement.classList.remove('app-locked');
}
on('lock:relock', () => {});
