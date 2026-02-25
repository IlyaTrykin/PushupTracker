import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { sendFriendRequestEmail } from '@/lib/notification-email';
import { isChannelEnabledForUser } from '@/lib/notification-preferences';
import { sendWebPushToUsers } from '@/lib/web-push';

function jsonError(message: string, status = 400, details?: string) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status });
}

async function parseBody(request: NextRequest): Promise<any> {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('BAD_JSON');
  }
}

async function getCurrentUserId(request: NextRequest): Promise<string> {
  try {
    return (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new Error('INTERNAL_ERROR');
  }
}

// accepted friends list
export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId(request);

    const friendships = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [{ userId }, { friendId: userId }],
      },
      include: {
        user: { select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true } },
        friend: { select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const friendIds: string[] = [];
    const base = friendships
      .map((f) => {
        const isInitiator = f.userId === userId;
        const other = isInitiator ? f.friend : f.user;
        if ((other as any).deletedAt) return null;
        friendIds.push(other.id);
        return {
          friendshipId: f.id,
          userId: other.id,
          username: other.username,
          email: other.email,
          avatarPath: (other as any).avatarPath ?? null,
          since: f.createdAt,
          isFollowing: false,
        };
      })
      .filter(Boolean) as any[];

    if (!base.length) return NextResponse.json([]);

    const follows = await prisma.friendFollow.findMany({
      where: { followerId: userId, friendId: { in: friendIds } },
      select: { friendId: true },
    });
    const following = new Set(follows.map((x) => x.friendId));

    return NextResponse.json(base.map((r) => ({ ...r, isFollowing: following.has(r.userId) })));
  } catch (e: any) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e?.message === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/friends)', 500, e?.message ?? String(e));
  }
}

// create friend request
export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserId(request);
    const body = await parseBody(request);

    const username = String(body.username || '').trim();
    if (!username) return jsonError('Укажите ник друга (username)', 400);

    const requester = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const target = await prisma.user.findUnique({
      where: { username },
      select: { id: true, username: true, email: true, avatarPath: true, deletedAt: true },
    });

    if (!target || target.deletedAt) return jsonError('Пользователь с таким ником не найден', 404);
    if (target.id === userId) return jsonError('Нельзя добавить в друзья самого себя', 400);

    const existing = await prisma.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId: target.id },
          { userId: target.id, friendId: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'accepted') return jsonError('Вы уже друзья', 400);
      if (existing.userId === userId) return jsonError('Заявка уже отправлена и ожидает подтверждения', 400);
      return jsonError('Этот пользователь уже отправил вам заявку. Подтвердите её во входящих запросах.', 400);
    }

    const friendship = await prisma.friendship.create({
      data: { userId, friendId: target.id, status: 'pending' },
    });

    await prisma.notification.create({
      data: {
        userId: target.id,
        type: 'friend_request',
        title: 'Новый запрос в друзья',
        body: `${requester?.username || 'Пользователь'} отправил вам запрос в друзья`,
        link: '/friends',
      },
    }).catch(() => {});

    await sendWebPushToUsers([target.id], {
      title: 'Новый запрос в друзья',
      body: `${requester?.username || 'Пользователь'} отправил вам запрос в друзья`,
      link: '/friends',
      tag: `friend-request-${friendship.id}`,
    }, 'friend_request').catch((e) => console.error('FRIEND REQUEST PUSH ERROR:', e));

    if (target.email && (await isChannelEnabledForUser(target.id, 'friend_request', 'email'))) {
      await sendFriendRequestEmail({
        to: target.email,
        inviterUsername: requester?.username || 'Пользователь',
        invitedUsername: target.username,
        requestId: friendship.id,
        request,
      }).catch((e) => console.error('FRIEND REQUEST EMAIL ERROR:', e));
    }

    return NextResponse.json({
      friendshipId: friendship.id,
      userId: target.id,
      username: target.username,
      email: target.email,
      since: friendship.createdAt,
      status: 'pending',
    });
  } catch (e: any) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e?.message === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (e?.message === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (POST /api/friends)', 500, e?.message ?? String(e));
  }
}

// PATCH actions: accept|decline incoming request, follow/unfollow accepted friend
export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId(request);
    const body = await parseBody(request);

    const action = String(body.action || '').trim();
    const friendshipId = String(body.friendshipId || '').trim();
    if (!action) return jsonError('action обязателен', 400);
    if (!friendshipId) return jsonError('friendshipId обязателен', 400);

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, userId: true, friendId: true, status: true },
    });
    if (!friendship) return jsonError('Связь дружбы не найдена', 404);

    if (action === 'accept') {
      if (friendship.friendId !== userId || friendship.status !== 'pending') return jsonError('Нет доступа', 403);
      await prisma.friendship.update({ where: { id: friendshipId }, data: { status: 'accepted' } });

      const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      await prisma.notification.create({
        data: {
          userId: friendship.userId,
          type: 'friend_request_accepted',
          title: 'Запрос в друзья принят',
          body: `${me?.username || 'Пользователь'} принял ваш запрос в друзья`,
          link: '/friends',
        },
      }).catch(() => {});

      return NextResponse.json({ ok: true, status: 'accepted' });
    }

    if (action === 'decline') {
      if (friendship.friendId !== userId || friendship.status !== 'pending') return jsonError('Нет доступа', 403);
      await prisma.friendship.delete({ where: { id: friendshipId } });
      return NextResponse.json({ ok: true, status: 'declined' });
    }

    if (action === 'follow') {
      if (friendship.status !== 'accepted') return jsonError('Следить можно только за подтверждённым другом', 400);
      if (friendship.userId !== userId && friendship.friendId !== userId) return jsonError('Нет доступа', 403);

      const follow = Boolean(body.follow);
      const friendId = friendship.userId === userId ? friendship.friendId : friendship.userId;

      if (follow) {
        await prisma.friendFollow.upsert({
          where: { followerId_friendId: { followerId: userId, friendId } },
          update: {},
          create: { followerId: userId, friendId },
        });
      } else {
        await prisma.friendFollow.deleteMany({ where: { followerId: userId, friendId } });
      }

      return NextResponse.json({ ok: true, isFollowing: follow });
    }

    return jsonError('Неизвестное действие', 400);
  } catch (e: any) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e?.message === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (e?.message === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (PATCH /api/friends)', 500, e?.message ?? String(e));
  }
}

// Remove friend relation (accepted or pending). If pending, either side may cancel.
export async function DELETE(request: NextRequest) {
  try {
    const userId = await getCurrentUserId(request);
    const body = await parseBody(request);

    const friendshipId = String(body?.friendshipId || '').trim();
    if (!friendshipId) return jsonError('Укажите friendshipId', 400);

    const friendship = await prisma.friendship.findUnique({
      where: { id: friendshipId },
      select: { id: true, userId: true, friendId: true },
    });

    if (!friendship) return jsonError('Связь дружбы не найдена', 404);
    if (friendship.userId !== userId && friendship.friendId !== userId) return jsonError('Нет доступа', 403);

    await prisma.$transaction(async (tx) => {
      await tx.friendship.delete({ where: { id: friendshipId } });
      await tx.friendFollow.deleteMany({
        where: {
          OR: [
            { followerId: friendship.userId, friendId: friendship.friendId },
            { followerId: friendship.friendId, friendId: friendship.userId },
          ],
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e?.message === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (e?.message === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (DELETE /api/friends)', 500, e?.message ?? String(e));
  }
}
