import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { isChannelEnabledForUser } from '@/lib/notification-preferences';
import { sendChallengeInviteEmail } from '@/lib/notification-email';
import { queueWebPushToUsers } from '@/lib/web-push';
import { isExerciseType } from '@/lib/exercises';
import { dayKeyToDbDate, parseDayKey } from '@/lib/calendar-day';
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit';
import {
  CHALLENGE_CREATE_LIMIT_PER_DAY,
  CHALLENGE_NAME_MAX_LENGTH,
  CHALLENGE_PARTICIPANTS_MAX,
  isChallengeMode,
  splitChallengeInvitees,
} from '@/lib/challenge-scoring';

type JsonObject = Record<string, unknown>;


function jsonError(message: string, status: number, details?: string, code?: string) {
  return NextResponse.json({ error: message, ...(code ? { code } : {}), ...(details ? { details } : {}) }, { status });
}

// Календарный день челленджа хранится как полночь UTC — как Workout.date.
function parseChallengeDay(raw: unknown): Date | null {
  const key = parseDayKey(String(raw ?? '').trim());
  return key ? dayKeyToDbDate(key) : null;
}


export async function GET(request: NextRequest) {
  try {
    let actor: { id: string; isAdmin: boolean };
    try {
      const user = await requireUser(request);
      actor = { id: user.id, isAdmin: user.isAdmin };
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const challenges = await prisma.challenge.findMany({
      where: {
        OR: [{ creatorId: actor.id }, { participants: { some: { userId: actor.id } } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        exerciseType: true,
        mode: true,
        targetReps: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        creatorId: true,
        groupId: true,
        creator: { select: { username: true } },
        participants: {
          select: {
            userId: true,
            status: true,
            user: { select: { username: true } },
          },
        },
      },
    });

    const activeGroupIds = actor.isAdmin
      ? null
      : new Set(
          (
            await prisma.groupMembership.findMany({
              where: {
                userId: actor.id,
                status: 'active',
                group: { deletedAt: null },
              },
              select: { groupId: true },
            })
          ).map((row) => row.groupId),
        );

    // добавить "мой статус" для удобства UI
    const withMyStatus = challenges
      .filter((c) => actor.isAdmin || !c.groupId || activeGroupIds?.has(c.groupId))
      .map((c) => {
        const mine = c.participants.find((p) => p.userId === actor.id);
        return { ...c, myStatus: mine?.status ?? null };
      });

    return NextResponse.json(withMyStatus);
  } catch (e) {
    console.error('CHALLENGES GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const bodyText = await request.text();
    let body: JsonObject = {};
    try {
      const parsed = bodyText ? JSON.parse(bodyText) : {};
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
    } catch {
      return jsonError('Некорректный JSON', 400);
    }

    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    const exerciseType = String(body.exerciseType || 'pushups').trim() || 'pushups';

    const startDate = parseChallengeDay(body.startDate);
    const endDate = parseChallengeDay(body.endDate);

    if (!name) return jsonError('Введите название соревнования', 400);
    if (name.length > CHALLENGE_NAME_MAX_LENGTH) {
      return jsonError(`Название соревнования — не длиннее ${CHALLENGE_NAME_MAX_LENGTH} символов`, 400, undefined, 'CHALLENGE_NAME_TOO_LONG');
    }
    if (!isExerciseType(exerciseType)) return jsonError('Некорректный тип упражнения', 400);
    if (!startDate || !endDate) return jsonError('Даты должны быть в формате YYYY-MM-DD', 400);
    if (endDate < startDate) return jsonError('endDate не может быть раньше startDate', 400);

    const mode = String(body.mode || 'most').trim(); // most | target | daily_min | sets_min
    if (!isChallengeMode(mode)) return jsonError('mode должен быть most, target, daily_min или sets_min', 400);

    let targetReps: number | null = null;
    if (mode === 'target' || mode === 'daily_min' || mode === 'sets_min') {
      const t = Number(body.targetReps);
      if (!Number.isFinite(t) || t <= 0 || !Number.isInteger(t) || t > 1_000_000) {
        return jsonError('targetReps должен быть целым числом > 0', 400);
      }
      targetReps = t;
    }

    const requestedUsernames: string[] = Array.isArray(body.participantsUsernames)
      ? body.participantsUsernames.slice(0, 500).map((x) => String(x).trim().slice(0, 64)).filter(Boolean)
      : [];

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!me?.username) return jsonError('Пользователь не найден', 404);

    // Приглашать можно только подтверждённых друзей, не удалённых (S05, B34).
    const friendships = await prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
      select: {
        userId: true,
        user: { select: { id: true, username: true, deletedAt: true } },
        friend: { select: { id: true, username: true, deletedAt: true } },
      },
    });
    const friends = new Map<string, string>(); // username → id
    for (const f of friendships) {
      const other = f.userId === userId ? f.friend : f.user;
      if (!other.deletedAt) friends.set(other.username, other.id);
    }

    const { invited, notFriends } = splitChallengeInvitees(requestedUsernames, Array.from(friends.keys()), me.username);
    if (notFriends.length) {
      const shown = notFriends.slice(0, 20).join(', ') + (notFriends.length > 20 ? '…' : '');
      return jsonError('Пригласить можно только друзей', 400, `Не в друзьях: ${shown}`, 'CHALLENGE_NOT_FRIENDS');
    }
    if (invited.length + 1 > CHALLENGE_PARTICIPANTS_MAX) {
      return jsonError(
        `В соревновании может быть не больше ${CHALLENGE_PARTICIPANTS_MAX} участников`,
        400,
        undefined,
        'CHALLENGE_TOO_MANY_PARTICIPANTS',
      );
    }

    const limit = await hitRateLimit(`challenge-create:${userId}`, CHALLENGE_CREATE_LIMIT_PER_DAY, 24 * 60 * 60);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds);

    const invitedIds = invited.map((username) => friends.get(username) as string);

    const created = await prisma.challenge.create({
      data: {
        name,
        exerciseType,
        startDate,
        endDate,
        mode,
        targetReps,
        creatorId: userId,
        participants: {
          create: [
            { userId, status: 'accepted' },
            ...invitedIds.map((id) => ({ userId: id, status: 'pending' })),
          ],
        },
      },
      select: { id: true, name: true },
    });

    // Уведомления: in-app сразу, push и письма — в фоне, ответ их не ждёт (S09, B34).
    if (invitedIds.length) {
      const title = 'Приглашение в соревнование';
      const notifyBody = `${me.username} пригласил вас в соревнование: ${name}`;
      await prisma.notification.createMany({
        data: invitedIds.map((id) => ({
          userId: id,
          type: 'challenge_invite',
          title,
          body: notifyBody,
          link: `/challenges/${created.id}`,
        })),
      }).catch((e) => console.error('CHALLENGE INVITE NOTIFICATION ERROR:', e));

      queueWebPushToUsers(
        invitedIds,
        { title, body: notifyBody, link: `/challenges?invite=${created.id}`, tag: `challenge-invite-${created.id}` },
        'challenge_invite',
      );

      void (async () => {
        const recipients = await prisma.user.findMany({
          where: { id: { in: invitedIds }, deletedAt: null },
          select: { id: true, username: true, email: true },
        });
        for (const u of recipients) {
          if (!u.email) continue;
          if (!(await isChannelEnabledForUser(u.id, 'challenge_invite', 'email'))) continue;
          await sendChallengeInviteEmail({
            to: u.email,
            invitedUsername: u.username,
            creatorUsername: me.username,
            challengeId: created.id,
            challengeName: name,
            request,
          }).catch((e) => console.error('CHALLENGE INVITE EMAIL ERROR:', e));
        }
      })().catch((e) => console.error('CHALLENGE INVITE EMAIL ERROR:', e));
    }

    return NextResponse.json(created);
  } catch (e) {
    console.error('CHALLENGES POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
