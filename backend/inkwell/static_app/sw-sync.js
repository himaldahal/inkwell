/* Extra service-worker logic, loaded by the generated sw.js via importScripts.
 * - Background Sync / Periodic Sync: wake an open client so it runs its own sync (IndexedDB lives there)
 * - Share target: stash shared files in a cache and redirect into the app
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'inkwell-sync') event.waitUntil(wake('sync'));
});
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'inkwell-periodic') event.waitUntil(wake('periodic'));
});
async function wake(reason) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (!list.length) throw new Error('no client open'); // browser retries the sync later
  list.forEach((c) => c.postMessage({ type: 'inkwell-sync', reason }));
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const form = await event.request.formData();
        const cache = await caches.open('inkwell-share');
        for (const k of await cache.keys()) await cache.delete(k);
        const files = form.getAll('files').filter((f) => f && f.name);
        let i = 0;
        for (const f of files) {
          await cache.put('/shared/' + i++ + '/' + encodeURIComponent(f.name), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream' } }));
        }
        const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', count: i };
        await cache.put('/shared/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
      } catch (e) { /* fall through to app */ }
      return Response.redirect('/?share=1', 303);
    })());
  }
});
