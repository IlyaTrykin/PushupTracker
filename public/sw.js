/**
 * PushUp SW (safe for Next.js)
 * Key rule: NEVER cache /_next/* (build chunks) and never cache /api/*
 */

const VERSION = 'v4'; // при больших изменениях меняем версию, чтобы сбросить старый cache-first
const STATIC_CACHE = `pushup-static-${VERSION}`;

self.addEventListener('install', (event) => {
  // Новая версия SW активируется сразу
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Удаляем старые кеши
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('pushup-static-') && k !== STATIC_CACHE)
        .map((k) => caches.delete(k))
    );

    // Забираем контроль над открытыми вкладками
    await self.clients.claim();

    // Критично после деплоя: принудительно перезагружаем открытые вкладки,
    // чтобы сбросить старые client bundles / Server Action IDs.
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(
      allClients.map((client) => ('navigate' in client ? client.navigate(client.url) : Promise.resolve()))
    );
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldBypass(url) {
  // ВАЖНО: чанки Next и API — только сеть, без кеша
  return (
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js'
  );
}

function isStaticAsset(url) {
  // Кешируем только “безопасную” статику (иконки/manifest)
  return (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.startsWith('/icons/')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Кешируем только GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не лезем в чужие домены
  if (!isSameOrigin(url)) return;

  // Не кешируем чанки / API
  if (shouldBypass(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // Навигация: network-first (чтобы всегда брать актуальную версию страниц)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        // Можно сделать offline страницу, но пока вернём просто fallback на корень
        const cached = await caches.match('/');
        return cached || Response.error();
      })
    );
    return;
  }

  // Иконки/manifest: cache-first
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;

      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // Всё остальное: network-first без записи в кеш
  event.respondWith(fetch(req));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'PushUp Tracker';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-72.png',
    tag: data.tag || 'pushup-general',
    data: {
      link: data.link || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification?.data?.link || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetUrl = new URL(link, self.location.origin).toString();

    for (const client of allClients) {
      if (client.url === targetUrl && 'focus' in client) {
        return client.focus();
      }
    }

    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});
