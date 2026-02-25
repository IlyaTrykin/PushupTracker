import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

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

  const [incoming, outgoing] = await Promise.all([
    prisma.friendship.findMany({
      where: { friendId: userId, status: 'pending' },
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, username: true, email: true, avatarPath: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.friendship.findMany({
      where: { userId, status: 'pending' },
      select: {
        id: true,
        createdAt: true,
        friend: { select: { id: true, username: true, email: true, avatarPath: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return NextResponse.json({
    incoming: incoming.map((r) => ({
      friendshipId: r.id,
      userId: r.user.id,
      username: r.user.username,
      email: r.user.email,
      avatarPath: r.user.avatarPath,
      createdAt: r.createdAt,
    })),
    outgoing: outgoing.map((r) => ({
      friendshipId: r.id,
      userId: r.friend.id,
      username: r.friend.username,
      email: r.friend.email,
      avatarPath: r.friend.avatarPath,
      createdAt: r.createdAt,
    })),
  });
}
