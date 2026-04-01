import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, getGroupWorkoutScope } from '@/lib/groups';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
type WorkoutResponseItem = {
  id: string;
  reps: number;
  date: string;
  time: string | null;
  exerciseType: ExerciseType;
};

const ALLOWED_EXERCISES = new Set(['pushups', 'pullups', 'crunches', 'squats', 'plank']);

function jsonError(message: string, status: number, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
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

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const exerciseType = getExerciseTypeFromQuery(request);

    const { group, members, userIds } = await getGroupWorkoutScope(user, id);
    const where: Prisma.WorkoutWhereInput = { userId: { in: userIds } };
    if (exerciseType) where.exerciseType = exerciseType;

    const workouts = await prisma.workout.findMany({
      where,
      orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
      select: { id: true, userId: true, reps: true, date: true, time: true, exerciseType: true },
    });

    const byUserId = new Map(members.map((membership) => [membership.userId, membership.user]));
    const byUser: Record<string, WorkoutResponseItem[]> = {};
    for (const workout of workouts) {
      const userInfo = byUserId.get(workout.userId);
      const username = userInfo?.username || workout.userId;
      if (!byUser[username]) byUser[username] = [];
      byUser[username].push({
        id: workout.id,
        reps: workout.reps,
        date: toIsoString(workout.date),
        time: workout.time ? toIsoString(workout.time) : null,
        exerciseType: workout.exerciseType as ExerciseType,
      });
    }

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        ownerId: group.ownerId,
      },
      byUser,
      members: members.map((membership) => ({
        userId: membership.userId,
        username: membership.user.username,
        avatarPath: membership.user.avatarPath ?? null,
        isOwner: membership.userId === group.ownerId,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
