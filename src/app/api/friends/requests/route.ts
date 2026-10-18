import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { loadBlockedPeerIds } from '@/lib/blocks';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  // Чужой email не отдаём (S04); удалённые пользователи из заявок скрыты.
  const [incoming, outgoing] = await Promise.all([
    prisma.friendship.findMany({
      where: { friendId: userId, status: 'pending', user: { deletedAt: null } },
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, username: true, avatarPath: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendship.findMany({
      where: { userId, status: 'pending', friend: { deletedAt: null } },
      select: {
        id: true,
        createdAt: true,
        friend: { select: { id: true, username: true, avatarPath: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Requests from or to someone blocked either way (R33.1) are not shown.
  const blocked = await loadBlockedPeerIds(prisma, userId, [...incoming.map((r) => r.user.id), ...outgoing.map((r) => r.friend.id)]);

  return NextResponse.json({
    incoming: incoming.filter((r) => !blocked.has(r.user.id)).map((r) => ({
      friendshipId: r.id,
      userId: r.user.id,
      username: r.user.username,
      avatarPath: r.user.avatarPath,
      createdAt: r.createdAt,
    })),
    outgoing: outgoing.filter((r) => !blocked.has(r.friend.id)).map((r) => ({
      friendshipId: r.id,
      userId: r.friend.id,
      username: r.friend.username,
      avatarPath: r.friend.avatarPath,
      createdAt: r.createdAt,
    })),
  });
}
