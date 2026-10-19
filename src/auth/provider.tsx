'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { readCachedUser, writeCachedUser } from '@/lib/native-auth';
import { isNativeApp } from '@/lib/platform';

export type AuthUserState = {
  id?: string;
  email?: string | null;
  username: string;
  isAdmin?: boolean;
  avatarPath?: string | null;
  language?: string;
  favoriteExercises?: string[];
  /** From `GET /api/me` (not in the server-rendered initial user): IANA zone, daily goal (F1). */
  timeZone?: string;
  dailyGoalPoints?: number | null;
  dailyReminderTime?: string | null;
  /** Exercises with an active training program. */
  activeProgramExercises?: string[];
  /** Данные тела из `GET /api/me` (калории без связи; в приложении — в кэше пользователя). */
  weightKg?: number | null;
  heightCm?: number | null;
  /** ISO-дата; день рождения — первые 10 символов. */
  birthDate?: string | null;
  gender?: 'male' | 'female' | 'other' | null;
} | null;

const BROWSER_ZONE_KEY_PREFIX = 'pushup-browser-tz:';

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

type AuthContextValue = {
  user: AuthUserState;
  setUser: Dispatch<SetStateAction<AuthUserState>>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser = null,
}: {
  children: ReactNode;
  initialUser?: AuthUserState;
}) {
  // В приложении сервер не рендерит пользователя: стартуем с сохранённого на устройстве
  // (без связи приложение открывается на нём), затем сверяемся с `/api/me`.
  const [user, setUser] = useState<AuthUserState>(() => initialUser ?? (isNativeApp() ? readCachedUser() : null));
  const refreshInFlight = useRef<Promise<void> | null>(null);

  // Parallel callers (provider + a page on mount) share one request.
  const refreshUser = useCallback(() => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const run = (async () => {
      try {
        const res = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
        if (res.status === 401 || res.status === 403) {
          setUser(null);
          return;
        }
        // Offline or a server hiccup keeps the current user (the dashboard refreshes on mount).
        if (!res.ok) return;
        const data = (await res.json()) as AuthUserState;
        setUser(data);
      } catch {
        // network error: keep the current user
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = run;
    return run;
  }, []);

  const userId = user?.id;
  const savedTimeZone = user?.timeZone;

  // Приложение: кэш пользователя повторяет состояние (вход, правки профиля, выход, 401).
  useEffect(() => {
    if (isNativeApp()) writeCachedUser(user);
  }, [user]);

  // Приложение: сохранённый пользователь мог устареть или сессию отозвали — сверка при старте.
  // 401 разбирает сетевой мост (вход), без связи пользователь остаётся.
  useEffect(() => {
    if (isNativeApp()) void refreshUser();
  }, [refreshUser]);

  // The server-rendered user has no zone/goal fields: load them once after sign-in.
  useEffect(() => {
    if (userId && savedTimeZone === undefined) void refreshUser();
  }, [refreshUser, savedTimeZone, userId]);

  // Quietly send the browser zone when it changed on this device and differs from the saved one.
  // A zone picked by hand in the profile stays until the browser zone itself changes (travel).
  useEffect(() => {
    if (!userId || savedTimeZone === undefined) return;
    const zone = browserTimeZone();
    if (!zone) return;
    const key = `${BROWSER_ZONE_KEY_PREFIX}${userId}`;
    const lastSeen = readStored(key);
    if (lastSeen === zone) return;
    if (zone === savedTimeZone) {
      writeStored(key, zone);
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ timeZone: zone }),
        });
        if (!res.ok) return;
        writeStored(key, zone);
        const data = (await res.json().catch(() => null)) as { user?: { timeZone?: string } } | null;
        const next = data?.user?.timeZone ?? zone;
        setUser((prev) => (prev && prev.id === userId ? { ...prev, timeZone: next } : prev));
      } catch {}
    })();
  }, [savedTimeZone, userId]);

  useEffect(() => {
    const onAuthChanged = (event: Event) => {
      const detail = (event as CustomEvent<AuthUserState>).detail;
      setUser(detail ?? null);
    };

    window.addEventListener('authChanged', onAuthChanged as EventListener);
    return () => window.removeEventListener('authChanged', onAuthChanged as EventListener);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    setUser,
    refreshUser,
  }), [refreshUser, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
