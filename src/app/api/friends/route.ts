import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { claimFriendRequestNotification, cooldownRetryDays, isUniqueViolation } from '@/lib/groups';
import { friendRequestAcceptedMessage, friendRequestMessage, notifyUsers } from '@/lib/notify';

type JsonObject = Record<string, unknown>;
// Чужой email в ответах не отдаём (S04): только ник и аватар.
type FriendDirectoryUser = {
  id: string;
  username: string;
  avatarPath: string | null;
  deletedAt: Date | null;
};
type FriendListItem = {
  friendshipId: string;
  userId: string;
  username: string;
  avatarPath: string | null;
  since: Date;
  isFollowing: boolean;
};

const publicUserSelect = { id: true, username: true, avatarPath: true, deletedAt: true } as const;

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message }, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Сериализует операции над одной парой пользователей (A→B и B→A одновременно) до конца транзакции.
async function lockFriendPair(tx: Prisma.TransactionClient, a: string, b: string) {
  const key = [a, b].sort().join(':');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`friend-pair:${key}`}))`;
}

class FriendRequestRejection extends Error {
  constructor(public readonly userMessage: string, public readonly status: number, public readonly code: string, public readonly details?: Record<string, unknown>) {
    super(code);
  }
}

async function parseBody(request: NextRequest): Promise<JsonObject> {
  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('BAD_JSON');
    }
    return parsed as JsonObject;
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
        user: { select: publicUserSelect },
        friend: { select: publicUserSelect },
      },
      orderBy: { createdAt: 'asc' },
    });

    const friendIds: string[] = [];
    const base: FriendListItem[] = friendships.reduce<FriendListItem[]>((acc, f) => {
      const isInitiator = f.userId === userId;
      const other: FriendDirectoryUser = isInitiator ? f.friend : f.user;
      if (other.deletedAt) return acc;
      friendIds.push(other.id);
      acc.push({
        friendshipId: f.id,
        userId: other.id,
        username: other.username,
        avatarPath: other.avatarPath ?? null,
        since: f.createdAt,
        isFollowing: false,
      });
      return acc;
    }, []);

    if (!base.length) return NextResponse.json([]);

    const follows = await prisma.friendFollow.findMany({
      where: { followerId: userId, friendId: { in: friendIds } },
      select: { friendId: true },
    });
    const following = new Set(follows.map((x) => x.friendId));

    return NextResponse.json(base.map((r) => ({ ...r, isFollowing: following.has(r.userId) })));
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (getErrorMessage(e) === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
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
      select: { id: true, username: true, deletedAt: true },
    });

    if (!target || target.deletedAt) return jsonError('Пользователь с таким ником не найден', 404);
    if (target.id === userId) return jsonError('Нельзя добавить в друзья самого себя', 400);

    const outcome = await prisma.$transaction(async (tx) => {
      await lockFriendPair(tx, userId, target.id);

      const existing = await tx.friendship.findFirst({
        where: {
          OR: [
            { userId, friendId: target.id },
            { userId: target.id, friendId: userId },
          ],
        },
      });

      if (existing) {
        if (existing.status === 'accepted') throw new FriendRequestRejection('Вы уже друзья', 409, 'FRIEND_ALREADY');
        if (existing.userId === userId) {
          throw new FriendRequestRejection('Заявка уже отправлена и ожидает подтверждения', 409, 'FRIEND_REQUEST_PENDING');
        }
        // Встречная заявка уже ждёт: обе стороны хотят дружить — сразу принимаем (B21).
        const accepted = await tx.friendship.update({ where: { id: existing.id }, data: { status: 'accepted' } });
        return { kind: 'merged' as const, friendship: accepted };
      }

      const cooldown = await tx.friendRequestCooldown.findUnique({
        where: { requesterId_targetId: { requesterId: userId, targetId: target.id } },
        select: { declinedAt: true },
      });
      const waitDays = cooldownRetryDays(cooldown?.declinedAt, new Date());
      if (waitDays > 0) {
        throw new FriendRequestRejection(
          `Пользователь отклонил вашу заявку. Повторить можно через ${waitDays} дн.`,
          400,
          'FRIEND_REQUEST_COOLDOWN',
          { retryAfterDays: waitDays },
        );
      }

      const created = await tx.friendship.create({
        data: { userId, friendId: target.id, status: 'pending' },
      });

      // Под блокировкой пары: решаем, будить ли адресата (не чаще раза в 7 дней на пару).
      const notify = await claimFriendRequestNotification(tx, userId, target.id, new Date());
      return { kind: 'created' as const, friendship: created, notify };
    });

    const requesterName = requester?.username || 'Пользователь';

    if (outcome.kind === 'merged') {
      // Только центр уведомлений (как и раньше), текст — на языке адресата.
      await notifyUsers(
        [target.id],
        'friend_request',
        (locale) => friendRequestAcceptedMessage(locale, { username: requesterName }),
        { inAppOnly: true, type: 'friend_request_accepted' },
      );

      return NextResponse.json({
        friendshipId: outcome.friendship.id,
        userId: target.id,
        username: target.username,
        since: outcome.friendship.createdAt,
        status: 'accepted',
      });
    }

    const friendship = outcome.friendship;
    const pendingResponse = NextResponse.json({
      friendshipId: friendship.id,
      userId: target.id,
      username: target.username,
      since: friendship.createdAt,
      status: 'pending',
    });
    // Повторная заявка после отмены в течение 7 дней: заявка есть, но адресата не будим снова.
    if (!outcome.notify) return pendingResponse;

    // In-app сразу; push, письмо и Telegram — по настройкам адресата, в фоне (ответ их не ждёт).
    await notifyUsers(
      [target.id],
      'friend_request',
      (locale) => friendRequestMessage(locale, { username: requesterName }),
      { tag: `friend-request-${friendship.id}` },
    );

    return pendingResponse;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (getErrorMessage(e) === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (getErrorMessage(e) === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    if (e instanceof FriendRequestRejection) return jsonError(e.userMessage, e.status, e.code, e.details);
    if (isUniqueViolation(e)) return jsonError('Заявка уже отправлена и ожидает подтверждения', 409, 'FRIEND_REQUEST_PENDING');
    console.error('FRIENDS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
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
      if (friendship.friendId !== userId) return jsonError('Нет доступа', 403);
      if (friendship.status === 'accepted') return NextResponse.json({ ok: true, status: 'accepted' });
      // Условное обновление: повторное или параллельное «принять» не шлёт второе уведомление.
      const claimed = await prisma.friendship.updateMany({
        where: { id: friendshipId, status: 'pending' },
        data: { status: 'accepted' },
      });
      if (claimed.count === 0) return NextResponse.json({ ok: true, status: 'accepted' });

      const me = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
      const accepterName = me?.username || 'Пользователь';
      await notifyUsers(
        [friendship.userId],
        'friend_request',
        (locale) => friendRequestAcceptedMessage(locale, { username: accepterName }),
        { inAppOnly: true, type: 'friend_request_accepted' },
      );

      return NextResponse.json({ ok: true, status: 'accepted' });
    }

    if (action === 'decline') {
      if (friendship.friendId !== userId || friendship.status !== 'pending') return jsonError('Нет доступа', 403);
      await prisma.$transaction(async (tx) => {
        await tx.friendship.deleteMany({ where: { id: friendshipId, status: 'pending' } });
        // Отправитель сможет повторить заявку не раньше чем через 7 дней (S05).
        await tx.friendRequestCooldown.upsert({
          where: { requesterId_targetId: { requesterId: friendship.userId, targetId: userId } },
          update: { declinedAt: new Date() },
          create: { requesterId: friendship.userId, targetId: userId },
        });
      });
      return NextResponse.json({ ok: true, status: 'declined' });
    }

    if (action === 'follow') {
      if (friendship.status !== 'accepted') return jsonError('Следить можно только за подтверждённым другом', 400);
      if (friendship.userId !== userId && friendship.friendId !== userId) return jsonError('Нет доступа', 403);

      const follow = Boolean(body.follow);
      const friendId = friendship.userId === userId ? friendship.friendId : friendship.userId;

      if (follow) {
        await prisma.friendFollow.createMany({
          data: [{ followerId: userId, friendId }],
          skipDuplicates: true,
        });
      } else {
        await prisma.friendFollow.deleteMany({ where: { followerId: userId, friendId } });
      }

      return NextResponse.json({ ok: true, isFollowing: follow });
    }

    return jsonError('Неизвестное действие', 400);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (getErrorMessage(e) === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (getErrorMessage(e) === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    if (isUniqueViolation(e)) return jsonError('Конфликт одновременных изменений, повторите', 409, 'CONFLICT');
    console.error('FRIENDS PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
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
      await tx.friendship.deleteMany({ where: { id: friendshipId } });
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
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (getErrorMessage(e) === 'BAD_JSON') return jsonError('Ожидался корректный JSON в теле запроса', 400);
    if (getErrorMessage(e) === 'INTERNAL_ERROR') return jsonError('Внутренняя ошибка сервера', 500);
    console.error('FRIENDS DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
