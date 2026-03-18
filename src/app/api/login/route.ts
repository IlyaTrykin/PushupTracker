import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { normalizeLocale } from '@/i18n/locale';
import { setPreferredLocaleCookie } from '@/i18n/server';

function isHttps(request: Request) {
  const xfProto = request.headers.get('x-forwarded-proto');
  if (xfProto) return xfProto.includes('https');
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password) {
      return NextResponse.json({ error: 'Имя пользователя и пароль обязательны' }, { status: 400 });
    }

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
        deletedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Неверное имя пользователя или пароль' }, { status: 401 });
    }

    if (user.deletedAt) {
      return NextResponse.json(
        { error: 'Профиль удалён. Обратитесь к администратору для восстановления.' },
        { status: 403 },
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: 'Неверное имя пользователя или пароль' }, { status: 401 });
    }

    const token = crypto.randomBytes(32).toString('hex');

    // expiresAt обязателен по твоей Prisma-схеме Session
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // +30 дней

    await prisma.session.create({
      data: { token, userId: user.id, expiresAt },
    });

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        avatarPath: user.avatarPath ?? null,
        language: user.language,
      },
    });

    // Не задаём Domain — cookie привязана к текущему хосту
    res.cookies.set('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps(request),
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    setPreferredLocaleCookie(res, normalizeLocale(user.language), request);

    return res;
  } catch {
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
