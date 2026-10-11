import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/auth/provider';
import AppNav from '@/components/AppNav';
import RegisterSW from '@/components/RegisterSW';
import ScreenWakeLock from '@/components/ScreenWakeLock';
import TapSound from '@/components/TapSound';
import ThirdOfSeptemberEgg from '@/components/ThirdOfSeptemberEgg';
import { LocaleProvider } from '@/i18n/provider';
import { landingMessages } from '@/i18n/messages/features/landing';
import { getRequestLocale } from '@/i18n/server';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { publicAppUrl } from '@/lib/public-url';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Одноразовая (на браузер) чистка старых service worker'ов и кешей. Маркер — в
// localStorage: в sessionStorage он терялся при каждом запуске PWA, и скрипт каждый раз
// снимал SW (а с ним и push-подписку) и перезагружал страницу (B01). Без доступного
// localStorage скрипт не запускается вовсе. Push-подписку после чистки молча
// восстанавливает RegisterSW.
const swRecoveryScript = `
(() => {
  const version = '2026-03-08-sw-recovery-1';
  const marker = 'pushup-sw-recovery-version';

  try {
    if (localStorage.getItem(marker) === version) return;
    localStorage.setItem(marker, version);
    if (localStorage.getItem(marker) !== version) return;
  } catch {
    return;
  }

  if (!('serviceWorker' in navigator) && !('caches' in window)) return;

  (async () => {
    let touched = false;

    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
        touched = true;
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      const staleKeys = keys.filter((key) => key.startsWith('pushup-'));
      if (staleKeys.length > 0) {
        await Promise.all(staleKeys.map((key) => caches.delete(key)));
        touched = true;
      }
    }

    if (touched) {
      window.location.reload();
    }
  })().catch(() => {});
})();
`;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = landingMessages[locale];
  const base = publicAppUrl();
  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: { default: m.appName, template: `%s · ${m.appName}` },
    description: m.metaDescription,
    applicationName: m.appName,
    manifest: '/manifest.webmanifest',
    icons: {
      icon: ['/icons/favicon-32.png', '/icons/favicon-16.png', '/icons/icon-192.png'],
      apple: [
        '/icons/apple-touch-icon.png',
        '/icons/apple-touch-icon-167.png',
        '/icons/apple-touch-icon-152.png',
        '/icons/apple-touch-icon-120.png',
      ],
    },
    openGraph: {
      type: 'website',
      siteName: m.appName,
      title: m.metaTitle,
      description: m.metaDescription,
      locale: locale === 'en' ? 'en_US' : 'ru_RU',
      url: '/',
      images: [{ url: `/og-image-${locale}.png`, width: 1200, height: 630, alt: m.metaTitle }],
    },
    twitter: {
      card: 'summary_large_image',
      title: m.metaTitle,
      description: m.metaDescription,
      images: [`/og-image-${locale}.png`],
    },
    appleWebApp: {
      capable: true,
      title: 'Pushup',
      statusBarStyle: 'default',
    },
    other: {
      'mobile-web-app-capable': 'yes',
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getRequestLocale();
  const cookieStore = await cookies();
  const initialUser = await getAuthUserFromSessionToken(cookieStore.get('session')?.value);

  return (
    <html lang={locale}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <LocaleProvider initialLocale={locale}>
          <AuthProvider initialUser={initialUser}>
            <Script id="sw-recovery" strategy="beforeInteractive">
              {swRecoveryScript}
            </Script>
            <ScreenWakeLock />
            <TapSound />
            <RegisterSW />
            <AppNav />
            <ThirdOfSeptemberEgg />
            <div className="app-shell"><div className="app-content">{children}</div></div>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
