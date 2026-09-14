'use strict';
/* sw.js — offline shell for the Trading Companion PWA (Android / iOS / desktop).
 *
 * Deliberately conservative:
 *   • precaches the companion app shell so it opens with no network at all
 *   • never touches /api/ (your knowledge base is always live from the server)
 *   • assets are stale-while-revalidate, so an update shows on the next launch
 *   • every other request (including the whole main Professor Fox app) is left
 *     completely alone — this worker only exists to make the companion installable
 *     and openable offline.
 */

const VERSION = 'companion-v1';
const SHELL = [
  '/companion',
  '/companion.css',
  '/companion.js',
  '/ai.js',
  '/manifest.webmanifest',
  '/engine/embed.js',
  '/engine/chunk.js',
  '/engine/bm25.js',
  '/engine/vision.js',
  '/engine/curriculum.js',
  '/engine/distill.js',
  '/engine/coach.js',
  '/engine/paper.js',
  '/companion/packaging/pwa-192.png',
  '/companion/packaging/pwa-512.png',
  '/companion/packaging/pwa-maskable-192.png',
  '/companion/packaging/pwa-maskable-512.png'
];
const SHELL_SET = new Set(SHELL);
const isCompanionPage = (p) => p === '/companion' || p === '/companion.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Tolerate individual misses: a missing icon must not break installation.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'ping') event.source.postMessage('pong');
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // CDNs, AI providers: hands off
  if (url.pathname.startsWith('/api/')) return;         // knowledge base is always live

  // Navigations to the companion: network first, cached shell when offline.
  // Every other page (the whole main Professor Fox app) is left completely alone.
  if (req.mode === 'navigate') {
    if (!isCompanionPage(url.pathname)) return;
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('/companion', fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match('/companion');
        if (cached) return cached;
        return new Response('Offline — and the companion shell is not cached yet.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Companion shell assets: serve instantly from cache, refresh in background.
  if (SHELL_SET.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((fresh) => {
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      }).catch(() => null);
      if (hit) { refresh; return hit; }
      const fresh = await refresh;
      return fresh || hit || Response.error();
    })());
  }
});
