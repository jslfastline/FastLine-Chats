const CACHE_NAME = 'fastline-v2';
const STATIC_ASSETS = [
  '/',
  '/fast.html',
  '/login.html',
  '/profile.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/default-profile.png',
  '/icon-192.png',
  '/icon-512.png',
  '/scripts/firebase-config.js',
  '/scripts/mock-firebase-app.js',
  '/scripts/mock-firebase-firestore.js',
  '/scripts/mock-firebase-storage.js',
  '/components/chat.js',
  '/components/profile.js',
  '/components/video-call.js',
  '/pwa.js',
  '/app-install.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(url => !url.startsWith('https://fonts')));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.hostname.includes('firestore') || url.hostname.includes('googleapis') || url.hostname.includes('firebasestorage')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200 && request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || caches.match('/fast.html')))
  );
});

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  const title   = data.title   || 'FastLine Chats';
  const body    = data.body    || 'You have a new message';
  const icon    = data.icon    || '/icon-192.png';
  const badge   = data.badge   || '/icon-192.png';
  const tag     = data.tag     || 'fastline-msg';
  const url     = data.url     || '/fast.html';

  event.waitUntil(
    self.registration.showNotification(title, { body, icon, badge, tag, data: { url } })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/fast.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const match = list.find(c => c.url.includes('fast.html'));
      return match ? match.focus() : clients.openWindow(url);
    })
  );
});
