import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LOCALE_COOKIE_NAME, type Locale, getLocaleFromAcceptLanguage, normalizeLocale } from '@/i18n/locale';
import { hitRateLimit } from '@/lib/rate-limit';
import { normalizeTimeZone } from '@/lib/calendar-day';

/** Unified auth helpers for API routes. */

export class AuthError extends Error {
  public status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
  avatarPath: string | null;
  language: string;
  favoriteExercises: string[];
  /** IANA zone of the user's calendar day (`User.timeZone`, normalized). */
  timeZone: string;
};

const AUTH_TEXT = {
  ru: {
    invalidJson: 'Некорректный JSON',
    internal: 'Внутренняя ошибка сервера',
    loginRequired: 'Имя пользователя и пароль обязательны',
    invalidCredentials: 'Неверное имя пользователя или пароль',
    accountDeleted: 'Профиль удалён. Обратитесь к администратору для восстановления.',
    fillAllFields: 'Заполните все поля',
    accountTaken: 'Ник или email уже заняты',
    invalidEmail: 'Укажите корректный email',
    USERNAME_REQUIRED: 'Укажите ник',
    USERNAME_LENGTH: 'Ник должен быть длиной от 3 до 32 символов',
    USERNAME_CHARS: 'Ник может содержать только латинские буквы, цифры и символы . _ -',
    PASSWORD_REQUIRED: 'Введите пароль',
    PASSWORD_TOO_SHORT: 'Пароль должен быть не меньше 8 символов',
    PASSWORD_TOO_LONG: 'Пароль должен быть не длиннее 128 символов',
    forgotPasswordSent: 'Если аккаунт с таким email существует, письмо со ссылкой уже отправлено.',
    passwordResetUnavailable: 'Восстановление пароля временно недоступно. Напишите администратору.',
    resetTokenRequired: 'Токен обязателен',
    resetLinkInvalid: 'Ссылка недействительна или устарела',
    currentPasswordRequired: 'Введите текущий пароль',
    currentPasswordWrong: 'Текущий пароль неверный',
    samePassword: 'Новый пароль должен отличаться от текущего',
  },
  en: {
    invalidJson: 'Invalid JSON',
    internal: 'Internal server error',
    loginRequired: 'Username and password are required',
    invalidCredentials: 'Invalid username or password',
    accountDeleted: 'This profile has been deleted. Contact the administrator to restore it.',
    fillAllFields: 'Fill in all fields',
    accountTaken: 'Username or email is already taken',
    invalidEmail: 'Enter a valid email',
    USERNAME_REQUIRED: 'Enter a username',
    USERNAME_LENGTH: 'Username must be 3 to 32 characters long',
    USERNAME_CHARS: 'Username may contain only Latin letters, digits and . _ -',
    PASSWORD_REQUIRED: 'Enter a password',
    PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
    PASSWORD_TOO_LONG: 'Password must be at most 128 characters',
    forgotPasswordSent: 'If an account with this email exists, a link has been sent.',
    passwordResetUnavailable: 'Password recovery is temporarily unavailable. Contact the administrator.',
    resetTokenRequired: 'Token is required',
    resetLinkInvalid: 'The link is invalid or has expired',
    currentPasswordRequired: 'Enter your current password',
    currentPasswordWrong: 'The current password is wrong',
    samePassword: 'The new password must differ from the current one',
  },
} as const;

export type AuthTextKey = keyof (typeof AUTH_TEXT)['ru'];

/** Texts of the sign-in / registration / password endpoints in the user's language. */
export function authText(locale: Locale): Record<AuthTextKey, string> {
  return AUTH_TEXT[locale] ?? AUTH_TEXT.ru;
}

/** Text for an `account-validation` error code (falls back to a generic one). */
export function validationErrorText(locale: Locale, code: string): string {
  const text = authText(locale) as Record<string, string>;
  return text[code] ?? text.fillAllFields;
}

/** Language for server texts: `preferred_locale` cookie, then `Accept-Language`. */
export function requestLocale(request: Request): Locale {
  const cookieLocale = parseCookieHeader(request.headers.get('cookie') || '', LOCALE_COOKIE_NAME);
  if (cookieLocale) return normalizeLocale(decodeURIComponent(cookieLocale));
  return getLocaleFromAcceptLanguage(request.headers.get('accept-language'));
}

export type LoginOutcome = 'ok' | 'invalid_credentials' | 'account_deleted';

/** A deleted account is revealed only to someone who knows its password. */
export function resolveLoginOutcome(user: { deletedAt: Date | null } | null, passwordOk: boolean): LoginOutcome {
  if (!user || !passwordOk) return 'invalid_credentials';
  return user.deletedAt ? 'account_deleted' : 'ok';
}

let dummyPasswordHash: Promise<string> | null = null;

/**
 * bcrypt check that costs the same whether or not the user exists:
 * without a hash it compares against a throwaway one and fails.
 */
export async function verifyPassword(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  if (!passwordHash) {
    dummyPasswordHash ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
    await bcrypt.compare(password, await dummyPasswordHash);
    return false;
  }
  return bcrypt.compare(password, passwordHash);
}

export type RateLimitRule = { key: string; limit: number; windowSeconds: number };

const MINUTES_15 = 15 * 60;
const HOUR = 60 * 60;

/** Limits of story 5 (fixed windows in `RateLimitBucket`). */
export const authRateLimitRules = {
  login: (ip: string, username: string): RateLimitRule[] => [
    { key: `login:ip-user:${ip}:${username.trim().toLowerCase()}`, limit: 10, windowSeconds: MINUTES_15 },
    { key: `login:ip:${ip}`, limit: 50, windowSeconds: MINUTES_15 },
  ],
  register: (ip: string): RateLimitRule[] => [{ key: `register:ip:${ip}`, limit: 5, windowSeconds: HOUR }],
  forgotPassword: (ip: string, email: string): RateLimitRule[] => [
    { key: `forgot-password:email:${email}`, limit: 3, windowSeconds: HOUR },
    { key: `forgot-password:ip:${ip}`, limit: 10, windowSeconds: HOUR },
  ],
  resetPassword: (ip: string): RateLimitRule[] => [{ key: `reset-password:ip:${ip}`, limit: 10, windowSeconds: HOUR }],
  changePassword: (userId: string): RateLimitRule[] => [
    { key: `change-password:user:${userId}`, limit: 5, windowSeconds: MINUTES_15 },
  ],
};

/** Counts the attempt against every rule; rejected if any is exceeded (waits for the longest). */
export async function checkRateLimits(rules: RateLimitRule[]): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  let ok = true;
  let retryAfterSeconds = 0;
  for (const rule of rules) {
    const result = await hitRateLimit(rule.key, rule.limit, rule.windowSeconds);
    if (!result.ok) {
      ok = false;
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    }
  }
  return { ok, retryAfterSeconds };
}

type RequestWithOptionalCookies = Request & {
  cookies?: {
    get?: (name: string) => { value?: string } | undefined;
  };
};

const authUserSelect = {
  id: true,
  username: true,
  email: true,
  isAdmin: true,
  avatarPath: true,
  language: true,
  favoriteExercises: true,
  timeZone: true,
  deletedAt: true,
} as const;

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** Sessions are looked up by SHA-256 (hex) of the cookie token (`Session.tokenHash`). */
export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

type SessionStore = {
  session: {
    create(args: { data: { tokenHash: string; userId: string; expiresAt: Date } }): Promise<unknown>;
    deleteMany(args: { where: { expiresAt: { lt: Date } } }): Promise<unknown>;
  };
};

/**
 * Opens a session: the raw token goes only to the cookie, the database keeps its hash.
 * Expired sessions of everybody are cleaned up on the way (best effort).
 */
export async function createSession(
  userId: string,
  db: SessionStore = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_MAX_AGE_SECONDS * 1000);
  await db.session.create({ data: { tokenHash: hashSessionToken(token), userId, expiresAt } });
  await Promise.resolve(db.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })).catch(() => {});
  return { token, expiresAt };
}

/** Logs the user out everywhere except the session carried by `keepToken` (if any). */
export async function deleteUserSessions(userId: string, keepToken?: string | null): Promise<void> {
  await prisma.session.deleteMany({
    where: keepToken ? { userId, NOT: { tokenHash: hashSessionToken(keepToken) } } : { userId },
  });
}

async function getAuthUserByToken(token: string): Promise<AuthUser | null> {
  const tokenHash = hashSessionToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      expiresAt: true,
      user: { select: authUserSelect },
    },
  });

  if (!session?.user) return null;

  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  if (session.user.deletedAt) {
    await prisma.session.deleteMany({ where: { tokenHash } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    email: session.user.email ?? null,
    isAdmin: session.user.isAdmin,
    avatarPath: session.user.avatarPath ?? null,
    language: session.user.language || 'ru',
    favoriteExercises: session.user.favoriteExercises ?? [],
    timeZone: normalizeTimeZone(session.user.timeZone),
  };
}

function parseCookieHeader(cookieHeader: string, name: string): string | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

export function getSessionToken(request: Request): string | null {
  const requestWithCookies = request as RequestWithOptionalCookies;
  try {
    const v = requestWithCookies.cookies?.get?.('session')?.value;
    if (typeof v === 'string' && v) return v;
  } catch {
    // ignore
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const token = parseCookieHeader(cookieHeader, 'session');
  return token || null;
}

/** Secure in production always (behind the proxy the hop may be plain http); elsewhere only over https. */
export function shouldUseSecureCookie(request?: Request | null): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return request ? isHttps(request) : false;
}

function isHttps(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto');
  if (xfProto) return xfProto.includes('https');
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;
  return getAuthUserByToken(token);
}

export async function getAuthUserFromSessionToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  return getAuthUserByToken(token);
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const u = await getAuthUser(request);
  if (!u) throw new AuthError('UNAUTHORIZED', 401);
  return u;
}

export async function requireAdmin(request: Request): Promise<AuthUser> {
  const u = await requireUser(request);
  if (!u.isAdmin) throw new AuthError('FORBIDDEN', 403);
  return u;
}

export async function invalidateSession(request: Request): Promise<void> {
  const token = getSessionToken(request);
  if (!token) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } }).catch(() => {});
}

export function setSessionCookie(
  res: NextResponse,
  token: string,
  request: Request,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): void {
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set('session', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function authJsonError(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
