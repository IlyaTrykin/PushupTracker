'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import { usePathname, useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { KeepAwake } from '@capacitor-community/keep-awake';
import './globals.css';
import { AuthProvider, useAuth } from '@/auth/provider';
import AppNav from '@/components/AppNav';
import TapSound from '@/components/TapSound';
import ThirdOfSeptemberEgg from '@/components/ThirdOfSeptemberEgg';
import { LocaleProvider, useI18n } from '@/i18n/provider';
import { nativeAppMessages } from '@/i18n/messages/features/native-app';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, getLocaleFromAcceptLanguage, isLocale, type Locale } from '@/i18n/locale';
import { clearToken, currentToken, loadToken, writeCachedUser } from '@/lib/native-auth';
import { installNativeFetch } from '@/lib/native-fetch';
import { installPushActionHandler, restoreNativePush } from '@/lib/native-push-client';
import { captureAttribution } from '@/lib/attribution-client';
import { hostOf, resolveDeepLink } from '@/lib/deep-links';
import { apiBase } from '@/lib/platform';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';

/** Экраны без входа: 401 на них не уводит на вход. */
const PUBLIC_ROUTES = ['/', '/login', '/register', '/forgot-password', '/reset-password'];
/** «Назад» на этих экранах сворачивает приложение, а не листает историю. */
const ROOT_ROUTES = ['/', '/login', '/dashboard'];

/** Локаль приложения: выбор пользователя на устройстве → язык системы → по умолчанию. */
function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {}
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  return languages.length ? getLocaleFromAcceptLanguage(languages.join(',')) : DEFAULT_LOCALE;
}

function currentPath(): string {
  const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '');
  return path || '/';
}

const subscribeNoop = () => () => {};

let appVersion = process.env.NEXT_PUBLIC_BUILD_VERSION || '';

/** Последний запрос к API дошёл до сервера (сеть есть, но сервер может быть недоступен). */
const SERVER_REACHABILITY_EVENT = 'nativeServerReachability';
let serverReachable = true;

/**
 * Перед первым экраном: токен из Keychain / EncryptedSharedPreferences и сетевой мост
 * (`/api/*` → сервер с Bearer). 401 — сессия истекла или отозвана: токен и сохранённый
 * пользователь стираются, приложение уходит на вход (очередь тренировок не трогается).
 */
function useNativeBridge(): boolean {
  const router = useRouter();
  const routerRef = useRef(router);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    // Next сам вставляет (и при навигации восстанавливает) `<meta name="viewport">` без
    // viewport-fit=cover, а WebView берёт последний такой тег: без cover env(safe-area-inset-*) = 0
    // и интерфейс уходит под вырез. Клиентский layout не может экспортировать `viewport`,
    // поэтому тег правится при старте и при каждом изменении <head>.
    const apply = () => {
      document.querySelectorAll('meta[name="viewport"]').forEach((meta) => {
        if (meta.getAttribute('content') !== VIEWPORT) meta.setAttribute('content', VIEWPORT);
      });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['content'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await loadToken();
      try {
        const info = await App.getInfo();
        if (info.version) appVersion = info.build ? `${info.version}+${info.build}` : info.version;
      } catch {}
      installNativeFetch({
        getContext: () => ({
          apiBase: apiBase(),
          token: currentToken(),
          appVersion,
          locale: document.documentElement.lang || DEFAULT_LOCALE,
        }),
        onReachability: (reachable) => {
          if (reachable === serverReachable) return;
          serverReachable = reachable;
          window.dispatchEvent(new CustomEvent(SERVER_REACHABILITY_EVENT, { detail: reachable }));
        },
        onUnauthorized: () => {
          void clearToken();
          writeCachedUser(null);
          window.dispatchEvent(new CustomEvent('authChanged', { detail: null }));
          if (!PUBLIC_ROUTES.includes(currentPath())) routerRef.current.replace('/login');
        },
      });
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

/**
 * Плашка «Нет связи — показаны сохранённые данные» для вошедшего пользователя: нет сети
 * (@capacitor/network) или сеть есть, но сервер не отвечает (последний запрос к API не дошёл).
 */
function OfflineBanner() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const [online, setOnline] = useState(true);
  const [reachable, setReachable] = useState(serverReachable);

  useEffect(() => {
    const onReachability = (event: Event) => setReachable(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener(SERVER_REACHABILITY_EVENT, onReachability);
    return () => window.removeEventListener(SERVER_REACHABILITY_EVENT, onReachability);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = Network.addListener('networkStatusChange', (status) => setOnline(status.connected));
    void Network.getStatus()
      .then((status) => {
        if (!cancelled) setOnline(status.connected);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      void handle.then((h) => h.remove());
    };
  }, []);

  if ((online && reachable) || !user?.username) return null;
  return (
    <div role="status" style={offlineBannerStyle}>
      {nativeAppMessages[locale === 'en' ? 'en' : 'ru'].offlineBanner}
    </div>
  );
}

/** Системная кнопка «назад» на Android и экран, который не гаснет (как на сайте). */
function NativeSystemHooks() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const handle = App.addListener('backButton', ({ canGoBack }) => {
      const path = (pathRef.current || '/').replace(/\/+$/, '') || '/';
      if (canGoBack && !ROOT_ROUTES.includes(path)) {
        window.history.back();
        return;
      }
      void App.minimizeApp().catch(() => App.exitApp());
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  useEffect(() => {
    void KeepAwake.keepAwake().catch(() => {});
    return () => {
      void KeepAwake.allowSleep().catch(() => {});
    };
  }, []);

  return null;
}

/**
 * Нативные пуши: нажатие на пуш открывает `toAppRoute(link)` через роутер (в том числе пуш,
 * которым приложение запустили); у вошедшего пользователя, включившего пуши, токен
 * устройства тихо обновляется на сервере при старте и входе.
 */
function NativePushHooks() {
  const router = useRouter();
  const routerRef = useRef(router);
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => installPushActionHandler((path) => routerRef.current.push(path)), []);

  useEffect(() => {
    if (userId) void restoreNativePush(userId);
  }, [userId]);

  return null;
}

/**
 * Ссылки сайта (приглашение, сброс пароля, группа по коду) открывают приложение на нужном экране:
 * `appUrlOpen` во время работы и `getLaunchUrl` для запуска ссылкой. Чужой хост и неизвестные пути
 * игнорируются (`resolveDeepLink`); одну и ту же ссылку из двух источников обрабатываем один раз.
 */
function NativeDeepLinkHooks() {
  const router = useRouter();
  const routerRef = useRef(router);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const ownHost = hostOf(apiBase());
    let lastUrl = '';
    let lastAt = 0;
    const open = (url: string) => {
      const now = Date.now();
      if (url === lastUrl && now - lastAt < 3000) return;
      const route = resolveDeepLink(url, ownHost);
      if (!route) return;
      lastUrl = url;
      lastAt = now;
      // Код приглашения запоминаем сразу: экран регистрации мог быть уже открыт и не перечитает адрес.
      const invite = /^\/register\?invite=([^&]+)/.exec(route);
      if (invite) captureAttribution(decodeURIComponent(invite[1]));
      routerRef.current.push(route);
    };
    const handle = App.addListener('appUrlOpen', ({ url }) => open(url));
    void App.getLaunchUrl()
      .then((launch) => {
        if (launch?.url) open(launch.url);
      })
      .catch(() => {});
    return () => {
      void handle.then((h) => h.remove());
    };
  }, []);

  return null;
}

/**
 * Корневой layout приложения (статический экспорт, клиентский). Пользователь и локаль
 * известны только на устройстве, поэтому при сборке рендерится пустая оболочка, а дерево —
 * после монтирования и загрузки токена: без расхождения гидрации. Service worker и
 * PWA-скрипты здесь не подключаются. Нативные пуши — `NativePushHooks`.
 */
export default function NativeRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const bridgeReady = useNativeBridge();
  const locale = mounted ? detectLocale() : DEFAULT_LOCALE;

  return (
    <html lang={locale} data-native-app="true">
      <head>
        <title>Pushup Tracker</title>
        <meta name="viewport" content={VIEWPORT} />
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {mounted && bridgeReady ? (
          <LocaleProvider initialLocale={locale}>
            <AuthProvider>
              <NativeSystemHooks />
              <NativePushHooks />
              <NativeDeepLinkHooks />
              <TapSound />
              <AppNav />
              <ThirdOfSeptemberEgg />
              <div className="app-shell"><div className="app-content">{children}</div></div>
              <OfflineBanner />
            </AuthProvider>
          </LocaleProvider>
        ) : null}
      </body>
    </html>
  );
}

const offlineBannerStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  transform: 'translateX(-50%)',
  bottom: 'calc(var(--bottom-nav-h, 64px) + var(--safe-bottom, 0px) + 40px)',
  zIndex: 60,
  maxWidth: 'calc(100vw - 32px)',
  padding: '8px 14px',
  borderRadius: 999,
  background: '#0f172a',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'center',
  boxShadow: '0 6px 18px rgba(15, 23, 42, 0.25)',
  pointerEvents: 'none',
};
