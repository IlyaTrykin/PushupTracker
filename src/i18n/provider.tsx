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
import { getMessages, type Messages } from '@/i18n/messages';
import {
  LOCALE_COOKIE_NAME,
  LOCALE_STORAGE_KEY,
  type Locale,
  normalizeLocale,
} from '@/i18n/locale';

type LocaleContextValue = {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function persistLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {}

  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  document.documentElement.lang = locale;
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(normalizeLocale(initialLocale));

  const setLocale = useCallback((nextLocale: Locale) => {
    const normalized = normalizeLocale(nextLocale);
    setLocaleState(normalized);
    persistLocale(normalized);
  }, []);

  useEffect(() => {
    const preferred = (() => {
      try {
        const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
        if (saved) return normalizeLocale(saved);
      } catch {}

      return normalizeLocale(navigator.language);
    })();

    if (preferred !== locale) {
      setLocaleState(preferred);
      persistLocale(preferred);
      return;
    }

    persistLocale(locale);
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    messages: getMessages(locale),
    setLocale,
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useI18n must be used within LocaleProvider');
  return ctx;
}
