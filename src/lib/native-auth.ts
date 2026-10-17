/**
 * Вход в приложении: токен сессии — только в нативном хранилище (плагин `SecureToken`:
 * Keychain на iOS, EncryptedSharedPreferences на Android), не в localStorage. Последний
 * известный пользователь — в localStorage: приложение открывается на нём без связи.
 * На сайте всё это не используется (cookie-сессия), функции там ничего не делают.
 */
import { registerPlugin } from '@capacitor/core';
import type { AuthUserState } from '@/auth/provider';
import { isNativeApp } from '@/lib/platform';

type SecureTokenPlugin = {
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
};

const USER_CACHE_KEY = 'native-user-cache:v1';

let plugin: SecureTokenPlugin | null = null;
/** Токен в памяти: мосту `fetch` он нужен синхронно на каждый запрос. */
let cachedToken: string | null = null;

function secureToken(): SecureTokenPlugin {
  if (!plugin) plugin = registerPlugin<SecureTokenPlugin>('SecureToken');
  return plugin;
}

/** Токен из хранилища устройства (при старте приложения). */
export async function loadToken(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { value } = await secureToken().get();
    cachedToken = typeof value === 'string' && value ? value : null;
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  if (!isNativeApp()) return;
  await secureToken().set({ value: token });
  cachedToken = token;
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  if (!isNativeApp()) return;
  try {
    await secureToken().remove();
  } catch {}
}

/** Текущий токен без обращения к хранилищу (после `loadToken`/`saveToken`). */
export function currentToken(): string | null {
  return cachedToken;
}

export function readCachedUser(): AuthUserState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUserState;
    return parsed && typeof parsed.username === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedUser(user: AuthUserState | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user?.username) window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_CACHE_KEY);
  } catch {}
}
