import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeLocale } from '@/i18n/locale';
import { setPreferredLocaleCookie } from '@/i18n/server';
import {
  authRateLimitRules,
  authText,
  checkRateLimits,
  createSession,
  isNativeClient,
  NATIVE_SESSION_MAX_AGE_SECONDS,
  requestLocale,
  resolveLoginOutcome,
  setSessionCookie,
  verifyPassword,
} from '@/lib/auth';
import { clientIp, tooManyRequests } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const locale = requestLocale(request);
  const text = authText(locale);
  try {
    const body = await request.json().catch(() => null);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: text.loginRequired }, { status: 400 });
    }

    const limit = await checkRateLimits(authRateLimitRules.login(clientIp(request), username));
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, locale);

    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        email: true,
        username: true,
        passwordHash: true,
        isAdmin: true,
        avatarPath: true,
        language: true,
        favoriteExercises: true,
        deletedAt: true,
      },
    });

    // bcrypt runs whether or not the user exists, so timing does not reveal accounts.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? null);
    const outcome = resolveLoginOutcome(user, passwordOk);

    if (outcome === 'invalid_credentials' || !user) {
      return NextResponse.json({ error: text.invalidCredentials }, { status: 401 });
    }
    if (outcome === 'account_deleted') {
      return NextResponse.json({ error: text.accountDeleted, code: 'ACCOUNT_DELETED' }, { status: 403 });
    }

    const native = isNativeClient(request);
    const { token, expiresAt } = await createSession(
      user.id,
      undefined,
      native ? { maxAgeSeconds: NATIVE_SESSION_MAX_AGE_SECONDS } : undefined,
    );

    const publicUser = {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: user.isAdmin,
      avatarPath: user.avatarPath ?? null,
      language: user.language,
      favoriteExercises: user.favoriteExercises,
    };

    // Native app: the token goes back in the body (stored in Keychain / EncryptedSharedPreferences
    // and sent as `Authorization: Bearer`); no cookies — the WebView is cross-site to the API.
    if (native) {
      return NextResponse.json({ ok: true, user: publicUser, token, expiresAt: expiresAt.toISOString() });
    }

    const res = NextResponse.json({ ok: true, user: publicUser });

    // Не задаём Domain — cookie привязана к текущему хосту
    setSessionCookie(res, token, request);
    setPreferredLocaleCookie(res, normalizeLocale(user.language), request);

    return res;
  } catch (e) {
    console.error('LOGIN ERROR:', e);
    return NextResponse.json({ error: text.internal }, { status: 500 });
  }
}
