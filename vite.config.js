import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const outDir = fileURLToPath(new URL('./backend/inkwell/static_app', import.meta.url));

export default defineConfig({
  // The built app is served from the site root by Django + WhiteNoise (no Node needed in production).
  base: '/',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
    sourcemap: false,
  },
  server: {
    host: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
  preview: { proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } } },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // registerPWA() in src/core/pwa.js does it
      includeAssets: ['favicon.svg', 'icons/*.png', 'offline.html', 'sw-sync.js'],
      workbox: {
        // precache the entire app shell incl. lazy chunks, pdf.js worker, wasm, cmaps and fonts
        globPatterns: ['**/*.{js,mjs,css,html,wasm,bcmap,ttf,otf,woff,woff2,pfb,svg,png,ico,webmanifest,json,txt}'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//, /^\/django-static\//, /^\/share-target/, /^\/s\//],
        cleanupOutdatedCaches: true,
        clientsClaim: false, // new versions activate only after the user accepts the update toast
        skipWaiting: false,
        importScripts: ['sw-sync.js'],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/'), handler: 'NetworkOnly' },
          {
            urlPattern: ({ request }) => request.destination === 'image' || request.destination === 'font',
            handler: 'CacheFirst',
            options: { cacheName: 'inkwell-media', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
          {
            urlPattern: ({ url, request }) => url.origin === self.location.origin && ['script', 'style', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'inkwell-runtime' },
          },
        ],
      },
      manifest: {
        id: '/',
        name: 'Inkwell',
        short_name: 'Inkwell',
        description: 'Offline-first handwriting and note-taking',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        orientation: 'any',
        theme_color: '#4f46e5',
        background_color: '#f6f3ee',
        categories: ['productivity', 'education', 'utilities'],
        lang: 'en',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'New note', short_name: 'New note', url: '/?new=1', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        file_handlers: [{ action: '/', accept: { 'application/pdf': ['.pdf'] } }],
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url', files: [{ name: 'files', accept: ['application/pdf', 'image/*', 'audio/*'] }] },
        },
        launch_handler: { client_mode: 'navigate-existing' },
      },
      devOptions: { enabled: false },
    }),
  ],
});
