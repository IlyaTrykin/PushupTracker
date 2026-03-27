/**
 * PushUp SW (safe for Next.js)
 * We cache:
 * - hashed /_next/static/* assets
 * - icons/manifest
 * - same-origin app navigations for faster repeat opens
 * We never cache:
 * - /api/*
 * - /_next/image and other dynamic internals
 */

const VERSION = 'v7';
const STATIC_CACHE = `pushup-static-${VERSION}`;
const NEXT_STATIC_CACHE = `pushup-next-static-${VERSION}`;
const NAVIGATION_CACHE = `pushup-navigation-${VERSION}`;

self.addEventListener('install', () => {
  // Новая версия SW активируется сразу
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Удаляем старые кеши
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('pushup-') && ![STATIC_CACHE, NEXT_STATIC_CACHE, NAVIGATION_CACHE].includes(k))
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
  if (event.data && event.data.type === 'CLEAR_RUNTIME_CACHES') {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('pushup-'))
          .map((k) => caches.delete(k))
      );
    })());
  }
  if (event.data && event.data.type === 'PREWARM_ROUTES' && Array.isArray(event.data.routes)) {
    event.waitUntil((async () => {
      const cache = await caches.open(NAVIGATION_CACHE);
      const routes = Array.from(new Set(event.data.routes.filter((route) => typeof route === 'string')));
      await Promise.all(routes.map(async (route) => {
        try {
          const request = new Request(route, { method: 'GET', credentials: 'include' });
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
          }
        } catch {}
      }));
    })());
  }
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function shouldBypass(url) {
  // Dynamic Next internals and API are always network-only.
  return (
    (url.pathname.startsWith('/_next/') && !url.pathname.startsWith('/_next/static/')) ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/sw.js'
  );
}

function isStaticAsset(url) {
  return (
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname === '/favicon.ico' ||
    url.pathname.startsWith('/icons/')
  );
}

function isNextStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/');
}

function isAppNavigation(url, request) {
  if (request.mode !== 'navigate') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/_next/')) return false;
  return true;
}

async function staleWhileRevalidateNavigation(request) {
  const cache = await caches.open(NAVIGATION_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  if (cached) {
    return cached;
  }

  return networkPromise;
}

async function staleWhileRevalidateAsset(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });

  if (cached) {
    return cached;
  }

  return networkPromise;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Кешируем только GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Не лезем в чужие домены
  if (!isSameOrigin(url)) return;

  // Never cache API or dynamic Next internals.
  if (shouldBypass(url)) {
    event.respondWith(fetch(req));
    return;
  }

  if (isAppNavigation(url, req)) {
    event.respondWith(
      staleWhileRevalidateNavigation(req).catch(async () => {
        const cache = await caches.open(NAVIGATION_CACHE);
        const cached = await cache.match(req);
        return cached || Response.error();
      })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidateAsset(STATIC_CACHE, req));
    return;
  }

  if (isNextStaticAsset(url)) {
    event.respondWith(staleWhileRevalidateAsset(NEXT_STATIC_CACHE, req));
    return;
  }

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
