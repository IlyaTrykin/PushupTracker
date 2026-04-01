import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { sendWebPushToUsers } from '@/lib/web-push';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { getWorkoutPoints, matchWorkoutReward } from '@/lib/workout-rewards';
import { GroupError, recordGroupAuditLog, requireManagedGroupMemberAccess } from '@/lib/groups';

export const dynamic = 'force-dynamic';

type WorkoutActor = {
  id: string;
  username: string;
  isAdmin: boolean;
};

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function parseDate(dateStr: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseTimeHHMM(timeStr: string): { hh: number; mm: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function combineDateAndTime(date: Date, timeHHMM?: string | null): Date {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  if (!timeHHMM) {
    const now = new Date();
    base.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return base;
  }
  const t = parseTimeHHMM(timeHHMM);
  if (!t) return base;
  base.setHours(t.hh, t.mm, 0, 0);
  return base;
}

function combineDateWithExistingTime(date: Date, time: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  next.setHours(
    time.getHours(),
    time.getMinutes(),
    time.getSeconds(),
    time.getMilliseconds(),
  );
  return next;
}

function getExerciseTypeFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const t = url.searchParams.get('exerciseType');
  if (!t) return null;
  return String(t).trim() || null;
}

function getUserIdFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return null;
  return String(userId).trim() || null;
}

function getGroupIdFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const groupId = url.searchParams.get('groupId');
  if (!groupId) return null;
  return String(groupId).trim() || null;
}

async function getWorkoutOwnerUserOrThrow(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new GroupError('Пользователь не найден', 404, 'WORKOUT_USER_NOT_FOUND');
  return { id: user.id, username: user.username };
}

async function resolveWorkoutReadAccess(actor: WorkoutActor, request: Request) {
  const requestedUserId = getUserIdFromQuery(request);
  const groupId = getGroupIdFromQuery(request);
  const targetUserId = requestedUserId || actor.id;

  if (targetUserId === actor.id || actor.isAdmin) {
    return { targetUserId, groupId, managedByGroup: false };
  }

  if (!groupId) {
    throw new GroupError('Для доступа к тренировкам участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
  }

  const { group } = await requireManagedGroupMemberAccess(actor, groupId, targetUserId);
  return { targetUserId, groupId: group.id, managedByGroup: true };
}

async function resolveWorkoutWriteAccess(actor: WorkoutActor, body: unknown) {
  const bodyRecord = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const requestedUserId = String(bodyRecord.userId || '').trim();
  const groupId = String(bodyRecord.groupId || '').trim() || null;
  const targetUserId = requestedUserId || actor.id;

  if (targetUserId === actor.id || actor.isAdmin) {
    return { targetUserId, groupId, managedByGroup: false };
  }

  if (!groupId) {
    throw new GroupError('Для управления тренировками участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
  }

  const { group } = await requireManagedGroupMemberAccess(actor, groupId, targetUserId);
  return { targetUserId, groupId: group.id, managedByGroup: true };
}

async function getChallengeRankMap(challengeId: string): Promise<Map<string, number>> {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      groupId: true,
      exerciseType: true,
      mode: true,
      targetReps: true,
      startDate: true,
      endDate: true,
      participants: {
        where: { status: 'accepted' },
        select: { userId: true, user: { select: { username: true } } },
      },
    },
  });

  if (!challenge) return new Map();
  let acceptedIds = challenge.participants.map((p) => p.userId);
  if (challenge.groupId) {
    const activeMemberRows = await prisma.groupMembership.findMany({
      where: {
        groupId: challenge.groupId,
        status: 'active',
        group: { deletedAt: null },
      },
      select: { userId: true },
    });
    const activeMemberIds = new Set(activeMemberRows.map((row) => row.userId));
    acceptedIds = acceptedIds.filter((userId) => activeMemberIds.has(userId));
  }
  if (!acceptedIds.length) return new Map();

  const rows: Array<{ userId: string; username: string; total: number; tie?: number }> = [];

  if (challenge.mode === 'daily_min') {
    const threshold = Number(challenge.targetReps ?? 0);
    const byDay = await prisma.workout.groupBy({
      by: ['userId', 'date'],
      where: {
        userId: { in: acceptedIds },
        exerciseType: challenge.exerciseType,
        date: { gte: challenge.startDate, lte: challenge.endDate },
      },
      _sum: { reps: true },
    });

    const credited = new Map<string, number>();
    byDay.forEach((row) => {
      const reps = row._sum.reps ?? 0;
      if (reps >= threshold) credited.set(row.userId, (credited.get(row.userId) ?? 0) + 1);
    });

    challenge.participants.forEach((p) => {
      rows.push({ userId: p.userId, username: p.user.username, total: credited.get(p.userId) ?? 0 });
    });
  } else if (challenge.mode === 'sets_min') {
    const threshold = Number(challenge.targetReps ?? 0);
    const grouped = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        userId: { in: acceptedIds },
        exerciseType: challenge.exerciseType,
        date: { gte: challenge.startDate, lte: challenge.endDate },
        reps: { gte: threshold },
      },
      _count: { _all: true },
      _sum: { reps: true },
    });

    const stats = new Map<string, { sets: number; reps: number }>();
    grouped.forEach((g) => stats.set(g.userId, { sets: g._count._all ?? 0, reps: g._sum.reps ?? 0 }));

    challenge.participants.forEach((p) => {
      const v = stats.get(p.userId) ?? { sets: 0, reps: 0 };
      rows.push({ userId: p.userId, username: p.user.username, total: v.sets, tie: v.reps });
    });
  } else {
    const sums = await prisma.workout.groupBy({
      by: ['userId'],
      where: {
        userId: { in: acceptedIds },
        exerciseType: challenge.exerciseType,
        date: { gte: challenge.startDate, lte: challenge.endDate },
      },
      _sum: { reps: true },
    });

    const map = new Map<string, number>();
    sums.forEach((s) => map.set(s.userId, s._sum.reps ?? 0));

    challenge.participants.forEach((p) => {
      rows.push({ userId: p.userId, username: p.user.username, total: map.get(p.userId) ?? 0 });
    });
  }

  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if ((b.tie ?? 0) !== (a.tie ?? 0)) return (b.tie ?? 0) - (a.tie ?? 0);
    return a.username.localeCompare(b.username, 'ru', { sensitivity: 'base' });
  });

  const rankMap = new Map<string, number>();
  rows.forEach((r, i) => rankMap.set(r.userId, i + 1));
  return rankMap;
}

export async function GET(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const { targetUserId } = await resolveWorkoutReadAccess(actor, request);
    const exerciseType = getExerciseTypeFromQuery(request);

    const workouts = await prisma.workout.findMany({
      where: {
        userId: targetUserId,
        ...(exerciseType ? { exerciseType } : {}),
      },
      orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
      select: { id: true, reps: true, date: true, time: true, exerciseType: true, trainingSessionId: true },
    });

    return NextResponse.json(workouts);
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: Request) {
  let actor: WorkoutActor;
  try {
    const u = await requireUser(request);
    actor = { id: u.id, username: u.username, isAdmin: u.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const { targetUserId, groupId, managedByGroup } = await resolveWorkoutWriteAccess(actor, body);
    const owner = await getWorkoutOwnerUserOrThrow(targetUserId);
    const reps = Number(body.reps);
    const dateStr = String(body.date || '');
    const timeStr = body.time ? String(body.time) : null;
    const exerciseType = String(body.exerciseType || '').trim();

    if (!Number.isFinite(reps) || reps <= 0) return jsonError('reps должен быть числом > 0');
    const date = parseDate(dateStr);
    if (!date) return jsonError('date должен быть в формате YYYY-MM-DD');
    if (!exerciseType) return jsonError('exerciseType обязателен');

    const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const performedAt = (timeStr && timeStr.includes('T')) ? new Date(timeStr) : combineDateAndTime(date, timeStr);
    const { earnedPoints, earnedPointsTenths } = getWorkoutPoints(reps, exerciseType);

    const activeChallenges = await prisma.challengeParticipant.findMany({
      where: {
        userId: owner.id,
        status: 'accepted',
        challenge: {
          exerciseType,
          startDate: { lte: dateMidnight },
          endDate: { gte: dateMidnight },
        },
      },
      select: {
        challengeId: true,
        challenge: { select: { id: true, name: true } },
      },
    });

    const beforeRanks = new Map<string, Map<string, number>>();
    for (const c of activeChallenges) {
      beforeRanks.set(c.challengeId, await getChallengeRankMap(c.challengeId));
    }

    const created = await prisma.workout.create({
      data: {
        userId: owner.id,
        reps,
        exerciseType,
        date: dateMidnight,
        time: performedAt,
      },
      select: { id: true, reps: true, date: true, time: true, exerciseType: true, trainingSessionId: true },
    });

    if (managedByGroup && groupId) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: owner.id,
        action: 'group_member_workout_created',
        entityType: 'workout',
        entityId: created.id,
        metadata: {
          reps,
          date: dateMidnight.toISOString(),
          time: performedAt.toISOString(),
          exerciseType,
        },
      });
    }

    const reward = matchWorkoutReward(
      await prisma.workoutReward.findFirst({
        where: { minPointsTenths: { lte: earnedPointsTenths } },
        orderBy: [{ minPointsTenths: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
      }),
      earnedPoints,
    );

    try {
      const notifications: Array<{ userId: string; type: string; title: string; body: string; link: string }> = [];
      const pushMessages = new Map<string, { title: string; body: string; link: string; tag: string }>();
      const workoutValue = formatExerciseValue(reps, exerciseType, true);

      const followers = await prisma.friendFollow.findMany({
        where: { friendId: owner.id },
        select: { followerId: true },
      });

      followers.forEach((f) => {
        notifications.push({
          userId: f.followerId,
          type: 'friend_workout',
          title: 'Новая тренировка друга',
          body: `${owner.username}: ${workoutValue} (${exerciseType})`,
          link: '/friends',
        });
        pushMessages.set(`friend_workout:${f.followerId}`, {
          title: 'Новая тренировка друга',
          body: `${owner.username}: ${workoutValue} (${exerciseType})`,
          link: '/friends',
          tag: `friend-workout-${owner.id}`,
        });
      });

      for (const c of activeChallenges) {
        const before = beforeRanks.get(c.challengeId) ?? new Map<string, number>();
        const after = await getChallengeRankMap(c.challengeId);
        const participants = new Set<string>([...before.keys(), ...after.keys()]);

        participants.forEach((participantId) => {
          const prev = before.get(participantId);
          const next = after.get(participantId);
          if (!prev || !next || prev === next) return;
          if (participantId === owner.id) return;

          const up = next < prev;
          notifications.push({
            userId: participantId,
            type: 'challenge_rank_change',
            title: 'Изменилось место в соревновании',
            body: `${c.challenge.name}: ${prev} → ${next} (${up ? 'поднялись' : 'опустились'})`,
            link: `/challenges/${c.challengeId}`,
          });

          pushMessages.set(`challenge_rank_change:${c.challengeId}:${participantId}`, {
            title: 'Изменилось место в соревновании',
            body: `${c.challenge.name}: ${prev} → ${next} (${up ? 'поднялись' : 'опустились'})`,
            link: `/challenges/${c.challengeId}`,
            tag: `challenge-rank-${c.challengeId}`,
          });
        });
      }

      if (notifications.length) {
        await prisma.notification.createMany({ data: notifications });
      }

      if (pushMessages.size) {
        for (const [k, msg] of pushMessages.entries()) {
          const parts = k.split(':');
          const userId = parts[parts.length - 1] || '';
          const eventType = k.startsWith('challenge_rank_change:')
            ? 'challenge_rank_change'
            : k.startsWith('friend_workout:')
              ? 'friend_workout'
              : undefined;
          if (!userId) continue;
          await sendWebPushToUsers([userId], msg, eventType).catch((e) => console.error('WORKOUT PUSH SEND ERROR:', e));
        }
      }
    } catch (e) {
      console.error('WORKOUT NOTIFICATIONS ERROR:', e);
    }

    return NextResponse.json({ workout: created, reward });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function PUT(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const id = String(body.id || '').trim();
    if (!id) return jsonError('id обязателен');

    const existing = await prisma.workout.findUnique({
      where: { id },
      select: { id: true, userId: true, date: true, time: true, reps: true, exerciseType: true },
    });
    if (!existing) return jsonError('Запись не найдена', 404);

    let managedByGroup = false;
    let groupId = String(body.groupId || '').trim() || null;
    if (existing.userId !== actor.id && !actor.isAdmin) {
      if (!groupId) return jsonError('Для управления тренировкой участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
      const access = await requireManagedGroupMemberAccess(actor, groupId, existing.userId);
      managedByGroup = true;
      groupId = access.group.id;
    }

    const reps = body.reps !== undefined ? Number(body.reps) : undefined;
    const dateStr = body.date !== undefined ? String(body.date) : undefined;
    const timeStr = body.time !== undefined ? String(body.time) : undefined;

    const data: { reps?: number; date?: Date; time?: Date } = {};

    if (reps !== undefined) {
      if (!Number.isFinite(reps) || reps <= 0) return jsonError('reps должен быть числом > 0');
      data.reps = reps;
    }

    let newDate = existing.date;
    if (dateStr !== undefined) {
      const parsed = parseDate(dateStr);
      if (!parsed) return jsonError('date должен быть в формате YYYY-MM-DD');
      newDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      data.date = newDate;
      if (timeStr === undefined) {
        data.time = combineDateWithExistingTime(newDate, existing.time);
      }
    }

    if (timeStr !== undefined) {
      if (timeStr.includes('T')) {
        const dt = new Date(timeStr);
        if (Number.isNaN(dt.getTime())) return jsonError('Некорректное время');
        data.time = dt;
      } else {
        const t = parseTimeHHMM(timeStr);
        if (!t) return jsonError('time должен быть в формате HH:MM');
        data.time = combineDateAndTime(newDate, timeStr);
      }
    }

    const updated = await prisma.workout.update({
      where: { id },
      data,
      select: { id: true, reps: true, date: true, time: true, exerciseType: true },
    });

    if (managedByGroup && groupId) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: existing.userId,
        action: 'group_member_workout_updated',
        entityType: 'workout',
        entityId: existing.id,
        metadata: {
          before: {
            reps: existing.reps,
            date: existing.date.toISOString(),
            time: existing.time.toISOString(),
            exerciseType: existing.exerciseType,
          },
          after: {
            reps: updated.reps,
            date: updated.date.toISOString(),
            time: updated.time.toISOString(),
            exerciseType: updated.exerciseType,
          },
        },
      });
    }

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS PUT ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function DELETE(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const id = String(body.id || '').trim();
    if (!id) return jsonError('id обязателен');

    const existing = await prisma.workout.findUnique({
      where: { id },
      select: { id: true, userId: true, reps: true, date: true, time: true, exerciseType: true },
    });
    if (!existing) return jsonError('Запись не найдена', 404);

    let managedByGroup = false;
    let groupId = String(body.groupId || '').trim() || null;
    if (existing.userId !== actor.id && !actor.isAdmin) {
      if (!groupId) return jsonError('Для управления тренировкой участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
      const access = await requireManagedGroupMemberAccess(actor, groupId, existing.userId);
      managedByGroup = true;
      groupId = access.group.id;
    }

    await prisma.workout.delete({ where: { id } });

    if (managedByGroup && groupId) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: existing.userId,
        action: 'group_member_workout_deleted',
        entityType: 'workout',
        entityId: existing.id,
        metadata: {
          reps: existing.reps,
          date: existing.date.toISOString(),
          time: existing.time.toISOString(),
          exerciseType: existing.exerciseType,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
