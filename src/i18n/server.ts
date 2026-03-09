import { cookies, headers } from 'next/headers';
import type { NextResponse } from 'next/server';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  type Locale,
  getLocaleFromAcceptLanguage,
  normalizeLocale,
} from '@/i18n/locale';

function isHttps(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto');
  if (xfProto) return xfProto.includes('https');
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getRequestLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE_NAME)?.value;
  if (cookieLocale) return normalizeLocale(cookieLocale);

  const headerStore = await headers();
  return getLocaleFromAcceptLanguage(headerStore.get('accept-language'));
}

export function setPreferredLocaleCookie(res: NextResponse, locale: Locale, request?: Request): void {
  res.cookies.set(LOCALE_COOKIE_NAME, normalizeLocale(locale), {
    httpOnly: false,
    sameSite: 'lax',
    secure: request ? isHttps(request) : false,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export function getDefaultLocale(): Locale {
  return DEFAULT_LOCALE;
}
