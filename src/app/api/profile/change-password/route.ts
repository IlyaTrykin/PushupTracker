import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateNewPassword } from '@/lib/account-validation';
import {
  AuthError,
  authRateLimitRules,
  authText,
  checkRateLimits,
  deleteUserSessions,
  getSessionToken,
  requestLocale,
  requireUser,
  validationErrorText,
} from '@/lib/auth';
import { tooManyRequests } from '@/lib/rate-limit';

export async function POST(request: Request) {
  const locale = requestLocale(request);
  const text = authText(locale);
  const jsonError = (error: string, status = 400, code?: string) =>
    NextResponse.json(code ? { error, code } : { error }, { status });

  try {
    const me = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return jsonError(text.invalidJson);

    const limit = await checkRateLimits(authRateLimitRules.changePassword(me.id));
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, locale);

    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!currentPassword) return jsonError(text.currentPasswordRequired);
    const passwordCheck = validateNewPassword(newPassword);
    if (!passwordCheck.ok) return jsonError(validationErrorText(locale, passwordCheck.code), 400, passwordCheck.code);

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { id: true, passwordHash: true, deletedAt: true },
    });

    if (!user || user.deletedAt) return jsonError('UNAUTHORIZED', 401);

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return jsonError(text.currentPasswordWrong, 400);

    const same = await bcrypt.compare(newPassword, user.passwordHash);
    if (same) return jsonError(text.samePassword, 400);

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: { passwordHash },
      });

      await tx.userProfileHistory.create({
        data: {
          userId: me.id,
          changedById: me.id,
          changes: { passwordChanged: { at: new Date().toISOString() } },
        },
      });
    });

    // Every other device is logged out; this one stays (sessions are matched by token hash).
    await deleteUserSessions(me.id, getSessionToken(request));

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    console.error('CHANGE PASSWORD ERROR:', e);
    return jsonError(text.internal, 500);
  }
}
