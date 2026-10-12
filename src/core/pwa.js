// PWA glue: service worker registration with an update prompt, launch/share handlers,
// and the "new note" shortcut. main.js calls registerPWA() once.
import { emit, toast } from './store.js';

let updateSW = null;
let registered = false;

export async function registerPWA() {
  if (registered) return;
  registered = true;
  setupLaunchHandlers();
  if (!('serviceWorker' in navigator) || import.meta.env?.DEV) return;
  try {
    const { registerSW } = await import('virtual:pwa-register');
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        emit('toast', {
          message: 'A new version of Inkwell is ready.',
          action: { label: 'Update', onClick: () => applyUpdate() },
          actionLabel: 'Update',
          onAction: () => applyUpdate(),
          duration: 0,
          sticky: true,
        });
        emit('pwa:update', { ready: true });
      },
      onOfflineReady() { toast('Inkwell is ready to work offline.'); },
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
        reg.sync?.register('inkwell-sync').catch(() => {});
        navigator.permissions?.query({ name: 'periodic-background-sync' }).then((p) => {
          if (p.state === 'granted') reg.periodicSync?.register('inkwell-periodic', { minInterval: 6 * 3600 * 1000 }).catch(() => {});
        }).catch(() => {});
      },
    });
  } catch (e) { console.warn('PWA registration failed', e); }
}

/** Apply a waiting service worker and reload. */
export async function applyUpdate() {
  try { await updateSW?.(true); } catch { location.reload(); }
}

async function openNewNote() {
  const { blankNote, putRecord } = await import('./db.js');
  const { navigate } = await import('./router.js');
  const n = await putRecord('notes', blankNote());
  navigate('/note/' + encodeURIComponent(n.id), { replace: true });
}

async function importFilesAndOpen(files) {
  if (!files.length) return;
  try {
    const m = await import('../features/import.js');
    const { ids } = await m.importFiles(files);
    if (ids?.length === 1) (await import('./router.js')).navigate('/note/' + encodeURIComponent(ids[0]));
  } catch (e) { toast('Could not import file'); console.warn(e); }
}

function setupLaunchHandlers() {
  const q = new URLSearchParams(location.search);
  if (q.get('new') === '1') {
    history.replaceState(null, '', location.pathname + location.hash);
    openNewNote();
  }
  if (q.get('share') === '1') {
    history.replaceState(null, '', location.pathname + location.hash);
    (async () => {
      try {
        const cache = await caches.open('inkwell-share');
        const files = [];
        for (const req of await cache.keys()) {
          if (req.url.endsWith('/shared/meta')) continue;
          const r = await cache.match(req);
          const name = decodeURIComponent(req.url.split('/').pop());
          files.push(new File([await r.blob()], name, { type: r.headers.get('Content-Type') || '' }));
          await cache.delete(req);
        }
        await importFilesAndOpen(files);
      } catch (e) { console.warn(e); }
    })();
  }
  // File Handling API: open .pdf files from the OS with Inkwell
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async (params) => {
      const files = [];
      for (const h of params.files || []) { try { files.push(await h.getFile()); } catch { /* ignore */ } }
      await importFilesAndOpen(files);
    });
  }
  // wake-ups from Background Sync in the service worker
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data?.type === 'inkwell-sync') import('./sync.js').then((m) => m.syncNow()).catch(() => {});
  });
}
