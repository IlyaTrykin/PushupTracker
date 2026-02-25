import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, getSessionToken, requireUser } from '@/lib/auth';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const me = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!currentPassword) return jsonError('Введите текущий пароль');
    if (newPassword.length < 6) return jsonError('Новый пароль должен быть не меньше 6 символов');

    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { id: true, passwordHash: true, deletedAt: true },
    });

    if (!user || user.deletedAt) return jsonError('UNAUTHORIZED', 401);

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return jsonError('Текущий пароль неверный', 400);

    const same = await bcrypt.compare(newPassword, user.passwordHash);
    if (same) return jsonError('Новый пароль должен отличаться от текущего', 400);

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

    const currentToken = getSessionToken(request);
    await prisma.session.deleteMany({
      where: currentToken
        ? { userId: me.id, token: { not: currentToken } }
        : { userId: me.id },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}
