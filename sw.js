const CACHE = 'nosmoke-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith('http')) return;
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, clone));
        return res;
      }).catch(() => cached);
    })
  );
});

const scheduled = new Map();

function clearScheduled(tag) {
  if (tag) {
    const t = scheduled.get(tag);
    if (t) { clearTimeout(t); scheduled.delete(tag); }
  } else {
    for (const t of scheduled.values()) clearTimeout(t);
    scheduled.clear();
  }
}

function schedule(tag, when, title, body) {
  clearScheduled(tag);
  const delay = Math.max(0, when - Date.now());
  const id = setTimeout(() => {
    scheduled.delete(tag);
    self.registration.showNotification(title, {
      body,
      tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      silent: false,
    });
  }, delay);
  scheduled.set(tag, id);
}

self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type === 'schedule') {
    schedule(data.tag, data.when, data.title, data.body);
  } else if (data.type === 'cancel') {
    clearScheduled(data.tag);
  } else if (data.type === 'cancelAll') {
    clearScheduled();
  } else if (data.type === 'notify') {
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag || 'nosmoke',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
    });
  }
});

self.addEventListener('push', (e) => {
  let data = { title: 'NoSmoke', body: '' };
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: data.tag || 'nosmoke-push',
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
