const CACHE_NAME = 'fastline-v7';

function asset(path) {
  return new URL(path, self.location).href;
}

const STATIC_ASSETS = [
  './',
  './index.html',
  './fast.html',
  './login.html',
  './profile.html',
  './style.css',
  './app.js',
  './manifest.json',
  './default-profile.png',
  './icon-192.png',
  './icon-512.png',
  './scripts/firebase-config.js',
  './scripts/theme-boot.js',
  './scripts/session.js',
  './scripts/nav.js',
  './scripts/pwa-install.js',
  './components/chat.js',
  './components/profile.js',
  './components/video-call.js',
  './components/image-cropper.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] precache partial fail', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebasestorage.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('emailjs.com')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(cached =>
          cached || caches.match(asset('./index.html'))
        )
      )
  );
});

self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'FastLine Chats', {
      body: data.body || 'You have a new message',
      icon: asset('./icon-192.png'),
      badge: asset('./icon-192.png'),
      tag: data.tag || 'fastline-msg',
      data: { url: data.url || asset('./fast.html') }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || asset('./fast.html');
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const match = list.find(c => c.url.includes('fast.html'));
      return match ? match.focus() : clients.openWindow(url);
    })
  );
});
