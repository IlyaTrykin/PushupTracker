'use client';

import { useSyncExternalStore } from 'react';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/auth/provider';
import AppNav from '@/components/AppNav';
import ScreenWakeLock from '@/components/ScreenWakeLock';
import TapSound from '@/components/TapSound';
import ThirdOfSeptemberEgg from '@/components/ThirdOfSeptemberEgg';
import { LocaleProvider } from '@/i18n/provider';
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, getLocaleFromAcceptLanguage, isLocale, type Locale } from '@/i18n/locale';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/** Локаль приложения: выбор пользователя на устройстве → язык системы → по умолчанию. */
function detectLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {}
  const languages = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language]);
  return languages.length ? getLocaleFromAcceptLanguage(languages.join(',')) : DEFAULT_LOCALE;
}

const subscribeNoop = () => () => {};

/**
 * Корневой layout приложения (статический экспорт, клиентский). Пользователь и локаль
 * известны только на устройстве, поэтому при сборке рендерится пустая оболочка, а дерево —
 * после монтирования: без расхождения гидрации. Service worker и PWA-скрипты здесь не
 * подключаются. Сетевой мост (`installNativeFetch`) и нативные пуши ставятся здесь же
 * следующими тасками.
 */
export default function NativeRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);
  const locale = mounted ? detectLocale() : DEFAULT_LOCALE;

  return (
    <html lang={locale}>
      <head>
        <title>Pushup Tracker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#0b0b0b" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {mounted ? (
          <LocaleProvider initialLocale={locale}>
            <AuthProvider>
              <ScreenWakeLock />
              <TapSound />
              <AppNav />
              <ThirdOfSeptemberEgg />
              <div className="app-shell"><div className="app-content">{children}</div></div>
            </AuthProvider>
          </LocaleProvider>
        ) : null}
      </body>
    </html>
  );
}
