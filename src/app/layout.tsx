import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Geist, Geist_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import { AuthProvider } from '@/auth/provider';
import AppNav from '@/components/AppNav';
import RegisterSW from '@/components/RegisterSW';
import ScreenWakeLock from '@/components/ScreenWakeLock';
import { LocaleProvider } from '@/i18n/provider';
import { getRequestLocale } from '@/i18n/server';
import { getAuthUserFromSessionToken } from '@/lib/auth';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const swRecoveryScript = `
(() => {
  const version = '2026-03-08-sw-recovery-1';
  const marker = 'pushup-sw-recovery-version';

  try {
    if (sessionStorage.getItem(marker) === version) return;
  } catch {}

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

    try {
      sessionStorage.setItem(marker, version);
    } catch {}

    if (touched) {
      window.location.reload();
    }
  })().catch(() => {
    try {
      sessionStorage.setItem(marker, version);
    } catch {}
  });
})();
`;

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Pushup Tracker',
  description: 'Workout and challenge tracker with friends',
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
  appleWebApp: {
    capable: true,
    title: 'Tracker',
    statusBarStyle: 'default',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

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
            <RegisterSW />
            <AppNav />
            <div className="app-shell"><div className="app-content">{children}</div></div>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
