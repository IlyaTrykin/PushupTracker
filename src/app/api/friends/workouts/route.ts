import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
type WorkoutResponseItem = {
  id: string;
  reps: number;
  date: string;
  time: string | null;
  exerciseType: ExerciseType;
};

const ALLOWED_EXERCISES = new Set(['pushups', 'pullups', 'crunches', 'squats', 'plank']);


function jsonError(message: string, status: number, details?: string) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function getExerciseTypeFromQuery(request: NextRequest): ExerciseType | null {
  const raw = request.nextUrl.searchParams.get('exerciseType');
  if (!raw) return null;
  const et = raw.trim();
  if (!ALLOWED_EXERCISES.has(et)) return null;
  return et as ExerciseType;
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
    const userIds = Array.from(ids);

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
      select: { id: true, userId: true, reps: true, date: true, time: true, exerciseType: true },
    });

    const byUser: Record<string, WorkoutResponseItem[]> = {};
    for (const w of workouts) {
      const username = idToUsername.get(w.userId) || w.userId;
      if (!byUser[username]) byUser[username] = [];

      byUser[username].push({
        id: w.id,
        reps: w.reps,
        date: toIsoString(w.date),
        time: w.time ? toIsoString(w.time) : null,
        exerciseType: w.exerciseType as ExerciseType,
      });
    }

    return NextResponse.json(byUser);
  } catch (e) {
    console.error('FRIENDS WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/friends/workouts)', 500, getErrorMessage(e));
  }
}
