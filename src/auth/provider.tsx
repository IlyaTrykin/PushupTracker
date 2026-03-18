'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AuthUserState = {
  id?: string;
  email?: string | null;
  username: string;
  isAdmin?: boolean;
  avatarPath?: string | null;
  language?: string;
} | null;

type AuthContextValue = {
  user: AuthUserState;
  setUser: (user: AuthUserState) => void;
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
  const [user, setUser] = useState<AuthUserState>(initialUser);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch('/api/me', { cache: 'no-store', credentials: 'include' });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = (await res.json()) as AuthUserState;
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

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
