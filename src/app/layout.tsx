import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import AppNav from '@/components/AppNav';
import RegisterSW from '@/components/RegisterSW';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Pushup Tracker',
  description: 'Трекер тренировок и соревнований с друзьями',
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <RegisterSW />
        <AppNav />
        <div className="app-shell"><div className="app-content">{children}</div></div>
      </body>
    </html>
  );
}
