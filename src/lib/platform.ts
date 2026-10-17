/**
 * Где запущен интерфейс: сайт или нативное приложение (Capacitor, статическая сборка
 * `BUILD_TARGET=native`). Значения `NEXT_PUBLIC_*` подставляются при сборке, поэтому
 * `isNativeApp()` — константа сборки и годится для выбора ветки на уровне модуля.
 */

type CapacitorGlobal = {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
};

type BrowserPlugin = { open?: (options: { url: string }) => Promise<void> };

function capacitor(): CapacitorGlobal | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor) ?? null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function isNativeApp(): boolean {
  return process.env.NEXT_PUBLIC_BUILD_TARGET === 'native';
}

/** Платформа устройства в приложении; на сайте и без Capacitor — `null`. */
export function nativePlatform(): 'ios' | 'android' | null {
  if (!isNativeApp()) return null;
  const platform = capacitor()?.getPlatform?.();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

/** Адрес сервера API: на сайте — тот же origin (''), в приложении — из сборки. */
export function apiBase(): string {
  if (!isNativeApp()) return '';
  return trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE || '');
}

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

/** '/api/x' → apiBase()+'/api/x'; абсолютные адреса (и data:/blob:) не трогает. */
export function resolveApiUrl(path: string): string {
  if (!path || isAbsoluteUrl(path)) return path;
  const base = apiBase();
  if (!base) return path;
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Адрес загруженного файла (аватар, `/uploads/*`): в приложении — с сервера. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return resolveApiUrl(path);
}

/** Ссылка для людей («пригласить», «поделиться»): всегда на публичный сайт. */
export function publicLink(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  if (isNativeApp()) {
    return `${trimTrailingSlash(process.env.NEXT_PUBLIC_PUBLIC_APP_URL || '')}${suffix}`;
  }
  if (typeof window === 'undefined') return suffix;
  return `${window.location.origin}${suffix}`;
}

/** Внешняя ссылка: в приложении — системный браузер, на сайте — новая вкладка. */
export function openExternal(url: string): void {
  if (typeof window === 'undefined') return;
  if (isNativeApp()) {
    const browser = capacitor()?.Plugins?.Browser as BrowserPlugin | undefined;
    if (browser?.open) {
      void browser.open({ url }).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      return;
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Переход с полной перезагрузкой на сайте (сбрасывает состояние страниц, как раньше);
 * в приложении — переход роутера: путь без файла в бандле Capacitor отдал бы корневой
 * index.html вместо нужного экрана.
 */
export function hardNavigate(path: string, router: { replace(href: string): void }): void {
  if (isNativeApp()) {
    router.replace(path);
    return;
  }
  window.location.href = path;
}
