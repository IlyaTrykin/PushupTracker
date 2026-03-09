export const LOCALE_CONFIG = {
  ru: {
    nativeLabel: 'Русский',
    flag: '🇷🇺',
    intlLocale: 'ru-RU',
    timerAudio: {
      prepare: '/audio/program-prepare.mp3',
      start: '/audio/program-start.mp3',
    },
  },
  en: {
    nativeLabel: 'English',
    flag: '🇬🇧',
    intlLocale: 'en-GB',
    timerAudio: {
      prepare: '/audio/program-prepare-en.mp3',
      start: '/audio/program-start-en.mp3',
    },
  },
} as const;

export type Locale = keyof typeof LOCALE_CONFIG;

export const SUPPORTED_LOCALES = Object.keys(LOCALE_CONFIG) as Locale[];

export const DEFAULT_LOCALE: Locale = 'ru';
export const LOCALE_COOKIE_NAME = 'preferred_locale';
export const LOCALE_STORAGE_KEY = 'preferred_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(input: unknown): Locale {
  if (typeof input !== 'string') return DEFAULT_LOCALE;

  const lower = input.trim().toLowerCase();
  if (!lower) return DEFAULT_LOCALE;

  const matched = SUPPORTED_LOCALES.find((locale) => lower === locale || lower.startsWith(`${locale}-`));
  return matched ?? DEFAULT_LOCALE;
}

export function getLocaleFromAcceptLanguage(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;

  const parts = input
    .split(',')
    .map((part) => part.split(';')[0]?.trim())
    .filter(Boolean);

  for (const part of parts) {
    const locale = normalizeLocale(part);
    if (isLocale(locale)) return locale;
  }

  return DEFAULT_LOCALE;
}

export function getLocaleNativeLabel(locale: Locale): string {
  return LOCALE_CONFIG[locale]?.nativeLabel ?? LOCALE_CONFIG[DEFAULT_LOCALE].nativeLabel;
}

export function getLocaleFlag(locale: Locale): string {
  return LOCALE_CONFIG[locale]?.flag ?? LOCALE_CONFIG[DEFAULT_LOCALE].flag;
}

export function getIntlLocaleTag(locale: Locale): string {
  return LOCALE_CONFIG[locale]?.intlLocale ?? LOCALE_CONFIG[DEFAULT_LOCALE].intlLocale;
}

export function getLocaleTimerAudio(locale: Locale) {
  return LOCALE_CONFIG[locale]?.timerAudio ?? LOCALE_CONFIG[DEFAULT_LOCALE].timerAudio;
}
