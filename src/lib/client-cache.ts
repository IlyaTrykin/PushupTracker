'use client';

type CacheEnvelope<T> = {
  value: T;
  updatedAt: string;
};

export const APP_DATA_CACHE_VERSION = '20260327-2';
export const APP_DATA_CACHE_PREFIX = 'app-cache:';

export function getUserScopedCacheKey(scope: string, userId?: string, username?: string): string | null {
  const identity = userId || username;
  return identity ? `${APP_DATA_CACHE_PREFIX}${APP_DATA_CACHE_VERSION}:${scope}:${identity}` : null;
}

export function readCachedValue<T>(cacheKey: string | null): T | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    return parsed && typeof parsed === 'object' && 'value' in parsed ? parsed.value : null;
  } catch {
    return null;
  }
}

export function writeCachedValue<T>(cacheKey: string | null, value: T) {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    const payload: CacheEnvelope<T> = {
      value,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {}
}

export function clearClientDataCaches() {
  if (typeof window === 'undefined') return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(APP_DATA_CACHE_PREFIX) || key.startsWith('dashboard-workouts:'))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {}
}
