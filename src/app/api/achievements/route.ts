import { NextRequest, NextResponse } from 'next/server';
import { ACHIEVEMENT_DEFS, personalBests } from '@/lib/achievements';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/achievements?userId= — badges (earned with a date, the rest with `achievedAt: null`)
 * and personal bests per exercise of the current user or of an accepted friend.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const requested = request.nextUrl.searchParams.get('userId')?.trim() || actor.id;

    if (requested !== actor.id) {
      const link = await prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { userId: actor.id, friendId: requested },
            { userId: requested, friendId: actor.id },
          ],
        },
        select: { id: true },
      });
      if (!link) return jsonError('Достижения доступны только друзьям', 403, 'NOT_FRIENDS');
    }

    const target = await prisma.user.findFirst({
      where: { id: requested, deletedAt: null },
      select: { id: true, username: true },
    });
    if (!target) return jsonError('Пользователь не найден', 404, 'USER_NOT_FOUND');

    const [rows, workouts] = await Promise.all([
      prisma.userAchievement.findMany({
        where: { userId: target.id, kind: 'badge' },
        orderBy: { achievedAt: 'asc' },
        select: { code: true, achievedAt: true },
      }),
      prisma.workout.findMany({
        where: { userId: target.id },
        select: { id: true, date: true, reps: true, exerciseType: true, loadKg: true },
      }),
    ]);

    const earned = new Map<string, Date>();
    for (const row of rows) if (!earned.has(row.code)) earned.set(row.code, row.achievedAt);

    return NextResponse.json({
      userId: target.id,
      username: target.username,
      badges: ACHIEVEMENT_DEFS.map((def) => ({ code: def.code, achievedAt: earned.get(def.code)?.toISOString() ?? null })),
      records: personalBests(workouts),
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('ACHIEVEMENTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
