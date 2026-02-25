import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { consumePasswordResetToken } from '@/lib/password-reset';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const token = String(body.token || '').trim();
  const password = String(body.password || '');

  if (!token) return jsonError('Токен обязателен');
  if (password.length < 6) return jsonError('Пароль должен быть не меньше 6 символов');

  const consumed = await consumePasswordResetToken(token);
  if (!consumed) return jsonError('Ссылка недействительна или устарела', 400);

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
}
