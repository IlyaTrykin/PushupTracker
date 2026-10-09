import { NextResponse, after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/account-validation';
import { authRateLimitRules, authText, checkRateLimits, requestLocale } from '@/lib/auth';
import { clientIp, tooManyRequests } from '@/lib/rate-limit';
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  getPasswordResetBaseUrl,
  PasswordResetConfigError,
  sendPasswordResetEmail,
} from '@/lib/password-reset';

/** Looks the account up and mails the link; runs after the response is sent. */
async function sendResetLinkIfAccountExists(email: string, request: Request): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, username: true, deletedAt: true },
  });
  if (!user || user.deletedAt) return;

  const { token, expiresAt } = await createPasswordResetToken(user.id);
  await sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    resetUrl: buildPasswordResetUrl(token, request),
    expiresAt,
  });
}

export async function POST(request: Request) {
  const locale = requestLocale(request);
  const text = authText(locale);

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: text.invalidJson }, { status: 400 });

  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: text.invalidEmail, code: 'EMAIL_INVALID' }, { status: 400 });

  try {
    // Keys depend only on what the client sent, so a limit never tells whether the account exists.
    const limit = await checkRateLimits(authRateLimitRules.forgotPassword(clientIp(request), email));
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, locale);

    // Fail loudly on a broken setup (production without APP_URL) instead of trusting the Host header.
    getPasswordResetBaseUrl(request);

    // Same answer, same speed for any email: the lookup and the email happen after the response.
    after(() =>
      sendResetLinkIfAccountExists(email, request).catch((e) => {
        console.error('FORGOT PASSWORD SEND ERROR:', e instanceof Error ? e.message : e);
      }),
    );

    return NextResponse.json({ ok: true, message: text.forgotPasswordSent });
  } catch (e) {
    if (e instanceof PasswordResetConfigError) {
      console.error('FORGOT PASSWORD CONFIG ERROR:', e.message);
      return NextResponse.json(
        { error: text.passwordResetUnavailable, code: 'RESET_NOT_CONFIGURED' },
        { status: 500 },
      );
    }
    console.error('FORGOT PASSWORD ERROR:', e);
    return NextResponse.json({ error: text.internal }, { status: 500 });
  }
}
