import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { sendWebPushToUsers } from '@/lib/web-push';
import { formatExerciseValue } from '@/lib/exercise-metrics';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

function getExerciseTypeFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const t = url.searchParams.get('exerciseType');
  if (!t) return null;
  return String(t).trim() || null;
}

async function getChallengeRankMap(challengeId: string): Promise<Map<string, number>> {
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
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
  const acceptedIds = challenge.participants.map((p) => p.userId);
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
    grouped.forEach((g) => stats.set(g.userId, { sets: (g as any)._count._all ?? 0, reps: g._sum.reps ?? 0 }));

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
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const exerciseType = getExerciseTypeFromQuery(request);

  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      ...(exerciseType ? { exerciseType } : {}),
    },
    orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
    select: { id: true, reps: true, date: true, time: true, exerciseType: true, trainingSessionId: true },
  });

  return NextResponse.json(workouts);
}

export async function POST(request: Request) {
  let authUser: { id: string; username: string };
  try {
    const u = await requireUser(request);
    authUser = { id: u.id, username: u.username };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

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

  const activeChallenges = await prisma.challengeParticipant.findMany({
    where: {
      userId: authUser.id,
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
      userId: authUser.id,
      reps,
      exerciseType,
      date: dateMidnight,
      time: performedAt,
    },
    select: { id: true, reps: true, date: true, time: true, exerciseType: true, trainingSessionId: true },
  });

  // Fire-and-forget notifications (errors should not break workout creation).
  try {
    const notifications: Array<{ userId: string; type: string; title: string; body: string; link: string }> = [];
    const pushMessages = new Map<string, { title: string; body: string; link: string; tag: string }>();
    const workoutValue = formatExerciseValue(reps, exerciseType, true);

    // Notify followers about each new workout.
    const followers = await prisma.friendFollow.findMany({
      where: { friendId: authUser.id },
      select: { followerId: true },
    });

    followers.forEach((f) => {
      notifications.push({
        userId: f.followerId,
        type: 'friend_workout',
        title: 'Новая тренировка друга',
        body: `${authUser.username}: ${workoutValue} (${exerciseType})`,
        link: '/friends',
      });
      pushMessages.set(`friend_workout:${f.followerId}`, {
        title: 'Новая тренировка друга',
        body: `${authUser.username}: ${workoutValue} (${exerciseType})`,
        link: '/friends',
        tag: `friend-workout-${authUser.id}`,
      });
    });

    // Notify accepted challenge participants when their rank changes.
    for (const c of activeChallenges) {
      const before = beforeRanks.get(c.challengeId) ?? new Map<string, number>();
      const after = await getChallengeRankMap(c.challengeId);
      const participants = new Set<string>([...before.keys(), ...after.keys()]);

      participants.forEach((participantId) => {
        const prev = before.get(participantId);
        const next = after.get(participantId);
        if (!prev || !next || prev === next) return;
        if (participantId === authUser.id) return;

        const up = next < prev;
        notifications.push({
          userId: participantId,
          type: 'challenge_rank_change',
          title: `Изменилось место в соревновании`,
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

  return NextResponse.json(created);
}

export async function PUT(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  const reps = body.reps !== undefined ? Number(body.reps) : undefined;
  const dateStr = body.date !== undefined ? String(body.date) : undefined;
  const timeStr = body.time !== undefined ? String(body.time) : undefined;

  const existing = await prisma.workout.findFirst({ where: { id, userId }, select: { id: true, date: true } });
  if (!existing) return jsonError('Запись не найдена', 404);

  const data: any = {};

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

  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  const existing = await prisma.workout.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) return jsonError('Запись не найдена', 404);

  await prisma.workout.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
