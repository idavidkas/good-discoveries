/* Scope-relative caching works on https://namespace.gitlab.io/project/ as well as custom domains. */
'use strict';
const CACHE_NAME = 'good-discoveries-__BUILD_VERSION__';
const APP_SHELL = [
  './', './index.html', './offline.html', './manifest.webmanifest', './demo-feed.json',
  './assets/config.js', './assets/app.js', './assets/pwa.js', './assets/styles.css',
  './assets/favicon.svg', './assets/icon-192.png', './assets/icon-512.png',
  './assets/quantum.svg', './assets/dna.svg', './assets/coral.svg', './assets/cells.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL.map(path =>
    new URL(path, self.registration.scope).href
  ))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('good-discoveries-') && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API goes directly to backend.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match(new URL('./index.html', self.registration.scope).href)) ||
      (await caches.match(new URL('./offline.html', self.registration.scope).href))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
self.addEventListener('push', event => {
  let message = { title: 'Хорошие открытия', body: 'Трёхдневный дайджест науки готов.' };
  try { if (event.data) message = { ...message, ...event.data.json() }; } catch { /* Keep safe fallback */ }
  const title = String(message.title || 'Хорошие открытия').slice(0, 110);
  const body = String(message.body || '').slice(0, 240);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: new URL('./assets/icon-192.png', self.registration.scope).href,
    badge: new URL('./assets/icon-192.png', self.registration.scope).href,
    tag: 'science-72h-digest', renotify: false,
    data: { url: new URL('./', self.registration.scope).href }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = new URL('./', self.registration.scope).href;
  event.waitUntil((async () => {
    const openClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = openClients.find(client => client.url.startsWith(self.registration.scope));
    if (existing) { await existing.focus(); if ('navigate' in existing) await existing.navigate(targetUrl); return; }
    await self.clients.openWindow(targetUrl);
  })());
});
