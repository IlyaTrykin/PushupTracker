import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Build version: a deploy passes GIT_SHA / BUILD_TIME as build args; otherwise every
 * build gets a unique stamp. It versions the service worker URL (`/sw.js?v=…`), so each
 * deploy installs a fresh SW instead of the byte-identical old one.
 */
// В dev версия постоянная: иначе каждая перезагрузка конфига давала бы новый URL SW.
const buildVersion = (process.env.GIT_SHA || process.env.BUILD_TIME || (isDev ? 'dev' : `b${Date.now().toString(36)}`))
  .replace(/[^A-Za-z0-9._-]/g, '')
  .slice(0, 40);

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; dev mode (React Refresh) also needs eval.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
  "media-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const baseSecurityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

/** Пользовательские файлы (аватары) — ничего не исполняют и не грузят (S17). */
const AVATAR_PATH = '/uploads/avatars';

const webConfig: NextConfig = {
  // без React Compiler, нам он не нужен
  poweredByHeader: false,
  // Оптимизатор картинок выключен: /_next/image не прогоняет загрузки через sharp (S02).
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  async headers() {
    return [
      {
        // Все пути, кроме загруженных аватаров: у них своя, более строгая CSP.
        source: '/((?!uploads/avatars/).*)',
        headers: [...baseSecurityHeaders, { key: 'Content-Security-Policy', value: contentSecurityPolicy }],
      },
      {
        source: `${AVATAR_PATH}/:path*`,
        headers: [...baseSecurityHeaders, { key: 'Content-Security-Policy', value: "default-src 'none'" }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

/**
 * Нативная сборка (`BUILD_TARGET=native`, `npm run build:native`): статический экспорт
 * только файлов `page.native.tsx` / `layout.native.tsx` — API, proxy, серверные страницы
 * и headers() в неё не попадают. Адрес сервера — из локального env `NATIVE_API_BASE`
 * (репозиторий публичный — хост не коммитится).
 */
function nativeConfig(): NextConfig {
  const apiBase = (process.env.NATIVE_API_BASE || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/.test(apiBase)) {
    throw new Error('BUILD_TARGET=native needs NATIVE_API_BASE (e.g. http://localhost:3100) in the environment');
  }
  return {
    output: 'export',
    pageExtensions: ['native.tsx'],
    distDir: '.next-native',
    poweredByHeader: false,
    images: { unoptimized: true },
    // Типы проверяет `npx tsc --noEmit` по всему проекту; проверка внутри этой сборки
    // подхватывает типы маршрутов сайта из .next/ и падает на них.
    typescript: { ignoreBuildErrors: true },
    env: {
      NEXT_PUBLIC_BUILD_VERSION: buildVersion,
      NEXT_PUBLIC_BUILD_TARGET: 'native',
      NEXT_PUBLIC_API_BASE: apiBase,
      NEXT_PUBLIC_PUBLIC_APP_URL: apiBase,
    },
  };
}

const nextConfig: NextConfig = process.env.BUILD_TARGET === 'native' ? nativeConfig() : webConfig;

export default nextConfig;
