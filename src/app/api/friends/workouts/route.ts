import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { isExerciseType, type ExerciseType } from '@/lib/exercises';
import { loadBlockedPeerIds } from '@/lib/blocks';

type WorkoutResponseItem = {
  id: string;
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
  durationSeconds: number | null;
  date: string;
  time: string | null;
  exerciseType: ExerciseType;
};


function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function getExerciseTypeFromQuery(request: NextRequest): ExerciseType | null {
  const raw = request.nextUrl.searchParams.get('exerciseType');
  if (!raw) return null;
  const et = raw.trim();
  return isExerciseType(et) ? et : null;
}

export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const exerciseType = getExerciseTypeFromQuery(request);

    const friendships = await prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
      select: { userId: true, friendId: true },
    });

    const ids = new Set<string>([userId]);
    for (const f of friendships) {
      ids.add(f.userId);
      ids.add(f.friendId);
    }
    // Feed and comparison: nobody blocked in either direction (R33.1).
    const blocked = await loadBlockedPeerIds(prisma, userId, Array.from(ids));
    const userIds = Array.from(ids).filter((id) => !blocked.has(id));

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });

    const idToUsername = new Map(users.map((u) => [u.id, u.username]));

    const where: Prisma.WorkoutWhereInput = { userId: { in: userIds } };
    if (exerciseType) where.exerciseType = exerciseType;

    const workouts = await prisma.workout.findMany({
      where,
      orderBy: [{ date: 'desc' }, { time: 'desc' }],
      select: { id: true, userId: true, reps: true, loadKg: true, repsLeft: true, repsRight: true, durationSeconds: true, date: true, time: true, exerciseType: true },
    });

    const byUser: Record<string, WorkoutResponseItem[]> = {};
    for (const w of workouts) {
      const username = idToUsername.get(w.userId) || w.userId;
      if (!byUser[username]) byUser[username] = [];

      byUser[username].push({
        id: w.id,
        reps: w.reps,
        loadKg: w.loadKg,
        repsLeft: w.repsLeft,
        repsRight: w.repsRight,
        durationSeconds: w.durationSeconds,
        date: toIsoString(w.date),
        time: w.time ? toIsoString(w.time) : null,
        exerciseType: w.exerciseType as ExerciseType,
      });
    }

    return NextResponse.json(byUser);
  } catch (e) {
    console.error('FRIENDS WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
