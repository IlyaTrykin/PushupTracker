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
const TOKEN_REMOVAL_KEY = 'native-token-removal-pending:v1';

let plugin: SecureTokenPlugin | null = null;
/** Токен в памяти: мосту `fetch` он нужен синхронно на каждый запрос. */
let cachedToken: string | null = null;

function secureToken(): SecureTokenPlugin {
  if (!plugin) plugin = registerPlugin<SecureTokenPlugin>('SecureToken');
  return plugin;
}

const deviceStorage: TokenStorage = {
  get: async () => (await secureToken().get()).value,
  remove: () => secureToken().remove(),
};

const removalMarker: TokenRemovalMarker = {
  isPending: () => {
    try {
      return window.localStorage.getItem(TOKEN_REMOVAL_KEY) === '1';
    } catch {
      return false;
    }
  },
  setPending: (pending) => {
    try {
      if (pending) window.localStorage.setItem(TOKEN_REMOVAL_KEY, '1');
      else window.localStorage.removeItem(TOKEN_REMOVAL_KEY);
    } catch {}
  },
};

export type TokenStorage = {
  get(): Promise<string | null>;
  remove(): Promise<void>;
};

/** Пометка «токен должен быть стёрт» (localStorage): переживает перезапуск, пока стирание не удалось. */
export type TokenRemovalMarker = {
  isPending(): boolean;
  setPending(pending: boolean): void;
};

export const TOKEN_REMOVAL_ATTEMPTS = 3;

/**
 * Стирает токен из хранилища устройства. Сначала ставит пометку — если стереть не выйдет
 * (или приложение закроют посреди), следующий запуск не возьмёт этот токен и попробует снова.
 * `true` — стёрт, пометка снята; `false` — не удалось за `attempts` попыток, пометка осталась.
 */
export async function removeStoredToken(
  storage: Pick<TokenStorage, 'remove'>,
  marker: TokenRemovalMarker,
  attempts: number = TOKEN_REMOVAL_ATTEMPTS,
): Promise<boolean> {
  marker.setPending(true);
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      await storage.remove();
      marker.setPending(false);
      return true;
    } catch {}
  }
  return false;
}

/** Токен при старте: при незавершённом стирании — не берётся (вход заново), стирание повторяется. */
export async function readStoredToken(storage: TokenStorage, marker: TokenRemovalMarker): Promise<string | null> {
  if (marker.isPending()) {
    await removeStoredToken(storage, marker);
    return null;
  }
  try {
    const value = await storage.get();
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
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

/** Токен из хранилища устройства (при старте приложения). */
export async function loadToken(): Promise<string | null> {
  if (!isNativeApp()) return null;
  cachedToken = await readStoredToken(deviceStorage, removalMarker);
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  if (!isNativeApp()) return;
  await secureToken().set({ value: token });
  removalMarker.setPending(false);
  cachedToken = token;
}

/**
 * Выход: токен забывается сразу (в памяти), из хранилища стирается с повторами. `false` — стереть
 * не удалось; тогда следующий запуск всё равно откроет вход (см. `removeStoredToken`).
 */
export async function clearToken(): Promise<boolean> {
  cachedToken = null;
  if (!isNativeApp()) return true;
  const removed = await removeStoredToken(deviceStorage, removalMarker);
  if (!removed) console.error('SecureToken: could not remove the session token, it is ignored until removed');
  return removed;
}

/** Текущий токен без обращения к хранилищу (после `loadToken`/`saveToken`). */
export function currentToken(): string | null {
  return cachedToken;
}

/**
 * Sign-in got a token but `saveToken` failed: `POST /api/logout` with that token (best effort, the
 * answer is not waited for long), so the server does not keep a session nobody can sign out of.
 */
export async function releaseUnsavedSession(token: string, deps: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<boolean> {
  const send = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 5000);
  try {
    const res = await send('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
