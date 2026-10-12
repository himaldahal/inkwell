import { h, icon } from './dom.js';
import { on, toast } from '../core/store.js';

let last = { state: 'idle', lastSync: null, pending: 0 };
on('sync:status', (s) => { last = { ...last, ...s }; });

const ago = (ts) => {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
export function describeSync(s = last) {
  const off = !navigator.onLine || s.state === 'offline';
  if (off) return { cls: 'offline', ic: 'cloudoff', text: s.pending ? `Offline - ${s.pending} pending` : 'Offline', title: "Offline. Changes are saved on this device and will sync when you're back online." };
  if (s.state === 'syncing') return { cls: 'syncing', ic: 'refresh', text: s.pending ? `Syncing ${s.pending}` : 'Syncing', title: 'Syncing now' };
  if (s.state === 'error') return { cls: 'error', ic: 'alert', text: 'Sync error', title: 'Last sync failed. Tap to retry.' };
  if (s.pending) return { cls: 'pending', ic: 'cloud', text: `${s.pending} pending`, title: `${s.pending} changes waiting to sync` };
  if (s.lastSync) return { cls: 'ok', ic: 'cloud', text: 'Synced ' + ago(s.lastSync), title: 'All changes synced' };
  return { cls: 'local', ic: 'cloud', text: 'On device', title: 'Saved on this device. Sign in under Settings to sync.' };
}
export function createSyncPill() {
  const b = h('button', { type: 'button', class: 'sync-pill' });
  const paint = () => {
    const d = describeSync();
    b.className = 'sync-pill ' + d.cls; b.title = d.title; b.setAttribute('aria-label', 'Sync status: ' + d.title);
    b.replaceChildren(icon(d.ic, 16), h('span', { class: 'sync-text' }, d.text));
  };
  b.addEventListener('click', async () => {
    try { const m = await import('../core/sync.js'); await m.syncNow(); } catch { toast('Sync is not set up yet. Open Settings to connect.'); }
  });
  paint();
  on('sync:status', paint);
  addEventListener('online', paint); addEventListener('offline', paint);
  setInterval(() => { if (b.isConnected) paint(); }, 30000);
  return b;
}
