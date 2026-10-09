import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateNewPassword } from '@/lib/account-validation';
import { authRateLimitRules, authText, checkRateLimits, requestLocale, validationErrorText } from '@/lib/auth';
import { clientIp, tooManyRequests } from '@/lib/rate-limit';
import { consumePasswordResetToken } from '@/lib/password-reset';

export async function POST(request: Request) {
  const locale = requestLocale(request);
  const text = authText(locale);
  const jsonError = (error: string, status = 400, code?: string) =>
    NextResponse.json(code ? { error, code } : { error }, { status });

  const body = await request.json().catch(() => null);
  if (!body) return jsonError(text.invalidJson);

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  try {
    const limit = await checkRateLimits(authRateLimitRules.resetPassword(clientIp(request)));
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, locale);

    if (!token) return jsonError(text.resetTokenRequired);
    const passwordCheck = validateNewPassword(password);
    if (!passwordCheck.ok) return jsonError(validationErrorText(locale, passwordCheck.code), 400, passwordCheck.code);

    // Atomic: of two requests with the same token only one gets through.
    const consumed = await consumePasswordResetToken(token);
    if (!consumed) return jsonError(text.resetLinkInvalid, 400, 'RESET_LINK_INVALID');

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash },
      });

      await tx.userProfileHistory.create({
        data: {
          userId: consumed.userId,
          changedById: consumed.userId,
          changes: { passwordReset: { at: new Date().toISOString() } },
        },
      });

      await tx.passwordResetToken.updateMany({
        where: { userId: consumed.userId, usedAt: null },
        data: { usedAt: new Date() },
      });
    });

    await prisma.session.deleteMany({ where: { userId: consumed.userId } }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('RESET PASSWORD ERROR:', e);
    return jsonError(text.internal, 500);
  }
}
