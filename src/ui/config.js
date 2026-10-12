import { getMeta, setMeta } from '../core/db.js';
import { emit, on } from '../core/store.js';

/* Lazy loaders for optional UI modules owned by the sync/accounts side. import.meta.glob only
   lists files that exist, so missing modules are simply absent instead of breaking the build. */
const mods = import.meta.glob('./{auth,admin,system,share,shareView}.js');
export const hasUi = (name) => !!mods[`./${name}.js`];
export const loadUi = async (name) => (mods[`./${name}.js`] ? mods[`./${name}.js`]() : null);

let config = { mode: 'internal', registrationOpen: true };
let account = null;
export const getConfig = () => config;
export const getAccount = () => account;
export const canSystem = () => !!(account && (account.permissions || []).includes('system.read'));
let me = null;
export const getMe = () => me;
export async function loadMe() { const a = await getMeta('sync:auth', null); me = a?.token ? { ...(a.user || {}) } : null; emit('account:changed', account); return me; }
export const isStaff = () => !!((account && (account.is_staff || account.isStaff || account.role === 'admin')) || (me && (me.is_staff || me.isStaff || me.role === 'admin' || me.role === 'staff')));
export const isAuthed = async () => { const a = await getMeta('sync:auth', null); return !!(a?.token && a?.user?.id); };
export const userName = (u = me) => u?.displayName || u?.display_name || u?.name || (u?.email ? u.email.split('@')[0] : 'You');

async function base() {
  try { const a = await getMeta('sync:auth', null); return (a?.serverUrl || '').replace(/\/$/, ''); } catch { return ''; }
}
export async function loadConfig() {
  const cached = await getMeta('serverConfig', null);
  if (cached) config = { ...config, ...cached };
  emit('config:changed', config);
  if (!navigator.onLine) return config;
  try {
    const r = await fetch((await base()) + '/api/config', { headers: { Accept: 'application/json' } });
    if (r.ok) { const j = await r.json(); if (j && typeof j === 'object') { config = { ...config, ...j }; await setMeta('serverConfig', config); emit('config:changed', config); } }
  } catch { /* offline or no server: keep cached */ }
  return config;
}
export async function loadAccount() {
  account = await getMeta('accountInfo', null);
  emit('account:changed', account);
  if (!navigator.onLine) return account;
  try {
    const m = await import('../core/sync.js');
    const info = await m.getAccountInfo();
    loadMe();
    account = info || null;
    await setMeta('accountInfo', account);
  } catch (e) { if (e?.status === 401) emit('auth:expired', {}); }
  emit('account:changed', account);
  return account;
}
on('sync:status', (s) => { if (s?.state === 'idle' && s.lastSync && !account) loadAccount(); });
