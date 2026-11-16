// Offline-Betrieb: alle App-Dateien liegen im Gerät. Bei einer neuen Version STAND erhöhen.
const STAND = 'aufmass-1';
const DATEIEN = ['./', 'index.html', 'style.css', 'app.js', 'geo.js', 'laser.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => e.waitUntil(caches.open(STAND).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.filter(n => n !== STAND).map(n => caches.delete(n)))).then(() => self.clients.claim())));
// Erst aus dem Gerät, sonst aus dem Netz (die App hat keine Daten auf einem Server)
self.addEventListener('fetch', e => e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request))));
