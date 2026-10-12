import { h, icon } from './dom.js';
import { emit, on, toast } from '../core/store.js';

let deferred = null;
export function initInstallPrompt() {
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit('install:available', true); });
  addEventListener('appinstalled', () => { deferred = null; emit('install:available', false); toast('Inkwell installed'); });
}
export const canInstall = () => !!deferred;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice.catch(() => null);
  deferred = null; emit('install:available', false);
  return r?.outcome === 'accepted';
}
export function createInstallButton({ compact = false } = {}) {
  const b = h('button', { class: compact ? 'nav-item install' : 'btn', type: 'button', onclick: promptInstall }, icon('download', 18), h('span', { class: 'grow' }, 'Install app'));
  const sync = () => { b.hidden = !canInstall(); };
  sync(); on('install:available', sync);
  return b;
}
