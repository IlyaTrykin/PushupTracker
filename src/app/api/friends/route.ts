import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';


// Список друзей текущего пользователя
export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
      return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [{ userId }, { friendId: userId }],
      },
      include: {
        user: { select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true } },
        friend: { select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const friends = friendships
      .map(f => {
      const isInitiator = f.userId === userId;
      const other = isInitiator ? f.friend : f.user;

      if ((other as any).deletedAt) return null;

      return {
        friendshipId: f.id,
        userId: other.id,
        username: other.username,
        email: other.email,
        avatarPath: (other as any).avatarPath ?? null,
        since: f.createdAt,
      };
    })
    .filter(Boolean) as any[];

    return NextResponse.json(friends);
  } catch (e: any) {
    console.error('FRIENDS GET ERROR:', e);
    return NextResponse.json(
      {
        error: 'Внутренняя ошибка сервера (GET /api/friends)',
        details: e?.message ?? String(e),
      },
      { status: 500 },
    );
  }
}

// Добавить друга по нику
export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
      return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }

    const bodyText = await request.text();
    let body: any = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return NextResponse.json(
        { error: 'Ожидался корректный JSON в теле запроса' },
        { status: 400 },
      );
    }

    const { username } = body;
    if (!username || typeof username !== 'string') {
      return NextResponse.json(
        { error: 'Укажите ник друга (username)' },
        { status: 400 },
      );
    }

    const friendUser = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true },
    });

    if (!friendUser || friendUser.deletedAt) {
      return NextResponse.json(
        { error: 'Пользователь с таким ником не найден' },
        { status: 404 },
      );
    }

    if (friendUser.id === userId) {
      return NextResponse.json(
        { error: 'Нельзя добавить в друзья самого себя' },
        { status: 400 },
      );
    }

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId: friendUser.id },
          { userId: friendUser.id, friendId: userId },
        ],
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: 'Вы уже друзья или заявка уже существует' },
        { status: 400 },
      );
    }

    const friendship = await prisma.friendship.create({
      data: {
        userId,
        friendId: friendUser.id,
      },
    });

    return NextResponse.json({
      friendshipId: friendship.id,
      userId: friendUser.id,
      username: friendUser.username,
      email: friendUser.email,
      since: friendship.createdAt,
    });
  } catch (e: any) {
    console.error('FRIENDS POST ERROR:', e);
    return NextResponse.json(
      {
        error: 'Внутренняя ошибка сервера (POST /api/friends)',
        details: e?.message ?? String(e),
      },
      { status: 500 },
    );
  }
}

// Удалить друга из списка (по friendshipId)
export async function DELETE(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
      return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
    }

    const bodyText = await request.text();
    let body: any = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return NextResponse.json(
        { error: 'Ожидался корректный JSON в теле запроса' },
        { status: 400 },
      );
    }

    const friendshipId = body?.friendshipId;
    if (!friendshipId || typeof friendshipId !== 'string') {
      return NextResponse.json(
        { error: 'Укажите friendshipId' },
        { status: 400 },
      );
    }

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, userId: true, friendId: true },
    });

    if (!friendship) {
      return NextResponse.json({ error: 'Связь дружбы не найдена' }, { status: 404 });
    }

    // проверяем права
    if (friendship.userId !== userId && friendship.friendId !== userId) {
      return NextResponse.json({ error: 'Нет доступа' }, { status: 403 });
    }

    await prisma.friendship.delete({ where: { id: friendshipId } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('FRIENDS DELETE ERROR:', e);
    return NextResponse.json(
      {
        error: 'Внутренняя ошибка сервера (DELETE /api/friends)',
        details: e?.message ?? String(e),
      },
      { status: 500 },
    );
  }
}
