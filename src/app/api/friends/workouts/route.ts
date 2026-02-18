import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

const ALLOWED_EXERCISES = new Set(['pushups', 'pullups', 'crunches', 'squats']);


function jsonError(message: string, status: number, details?: string) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status });
}

function getExerciseTypeFromQuery(request: NextRequest): 'pushups' | 'pullups' {
  const et = request.nextUrl.searchParams.get('exerciseType')?.trim() || 'pushups';
  return (ALLOWED_EXERCISES.has(et) ? et : 'pushups') as any;
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
      where: { OR: [{ userId }, { friendId: userId }] },
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

    const workouts = await prisma.workout.findMany({
      where: { userId: { in: userIds }, exerciseType },
      orderBy: [{ date: 'desc' }, { time: 'desc' }],
      select: { id: true, userId: true, reps: true, date: true, time: true, exerciseType: true },
    });

    const byUser: Record<string, any[]> = {};
    for (const w of workouts) {
      const username = idToUsername.get(w.userId) || w.userId;
      if (!byUser[username]) byUser[username] = [];

      byUser[username].push({
        id: w.id,
        reps: w.reps,
        date: (w.date as any) instanceof Date ? (w.date as any).toISOString() : String(w.date),
        time: w.time ? ((w.time as any) instanceof Date ? (w.time as any).toISOString() : String(w.time)) : null,
        exerciseType: w.exerciseType,
      });
    }

    return NextResponse.json(byUser);
  } catch (e: any) {
    console.error('FRIENDS WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/friends/workouts)', 500, e?.message ?? String(e));
  }
}
