import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildPasswordResetUrl, createPasswordResetToken, sendPasswordResetEmail } from '@/lib/password-reset';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return jsonError('Укажите email');

  const generic = {
    ok: true,
    message: 'Если аккаунт с таким email существует, письмо со ссылкой уже отправлено.',
  };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, username: true, deletedAt: true },
  });

  if (!user || user.deletedAt) {
    return NextResponse.json(generic);
  }

  const { token, expiresAt } = await createPasswordResetToken(user.id);
  const resetUrl = buildPasswordResetUrl(token, request);
  await sendPasswordResetEmail({
    to: user.email,
    username: user.username,
    resetUrl,
    expiresAt,
  });

  return NextResponse.json(generic);
}
