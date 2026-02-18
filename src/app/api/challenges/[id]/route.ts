import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';


function jsonError(message: string, status: number, details?: string) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const { id } = await ctx.params;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
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

    if (!challenge) return jsonError('Челлендж не найден', 404);

    const isMember = challenge.creatorId === userId || challenge.participants.some((p) => p.userId === userId);
    if (!isMember) return jsonError('Нет доступа', 403);

    const acceptedIds = challenge.participants
      .filter((p) => p.status === 'accepted')
      .map((p) => p.userId);

    const totalDays = (() => {
      const s = new Date(challenge.startDate.getFullYear(), challenge.startDate.getMonth(), challenge.startDate.getDate());
      const e = new Date(challenge.endDate.getFullYear(), challenge.endDate.getMonth(), challenge.endDate.getDate());
      const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 0 ? diff + 1 : 0;
    })();

    if (!acceptedIds.length) {
      const myStatus = challenge.participants.find((p) => p.userId === userId)?.status ?? null;
      return NextResponse.json({ challenge, myStatus, progress: [] });
    }

    // mode calculations:
    // most/target: total reps in period
    // daily_min: credited days with dayTotal >= targetReps
    // sets_min: count of sets with reps >= targetReps (tie-breaker: sum reps of qualified sets)
    let progress: any[] = [];

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

      progress = challenge.participants
        .filter((p) => p.status === 'accepted')
        .map((p) => ({
          userId: p.userId,
          username: p.user.username,
          total: credited.get(p.userId) ?? 0, // creditedDays
          creditedDays: credited.get(p.userId) ?? 0,
          totalDays,
        }))
        .sort((a, b) => b.total - a.total);
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

      const setsMap = new Map<string, { sets: number; reps: number }>();
      grouped.forEach((g) => setsMap.set(g.userId, { sets: (g as any)._count._all ?? 0, reps: g._sum.reps ?? 0 }));

      progress = challenge.participants
        .filter((p) => p.status === 'accepted')
        .map((p) => {
          const v = setsMap.get(p.userId) ?? { sets: 0, reps: 0 };
          return {
            userId: p.userId,
            username: p.user.username,
            total: v.sets, // qualifiedSets
            qualifiedSets: v.sets,
            qualifiedReps: v.reps, // tie-breaker
          };
        })
        .sort((a, b) => (b.total - a.total) || ((b.qualifiedReps ?? 0) - (a.qualifiedReps ?? 0)));
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

      progress = challenge.participants
        .filter((p) => p.status === 'accepted')
        .map((p) => ({
          userId: p.userId,
          username: p.user.username,
          total: map.get(p.userId) ?? 0,
        }))
        .sort((a, b) => b.total - a.total);
    }

const myStatus = challenge.participants.find((p) => p.userId === userId)?.status ?? null;

    return NextResponse.json({ challenge, myStatus, progress });
  } catch (e: any) {
    console.error('CHALLENGE GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/challenges/[id])', 500, e?.message ?? String(e));
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const { id } = await ctx.params;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: { id: true, creatorId: true },
    });

    if (!challenge) return jsonError('Челлендж не найден', 404);
    if (challenge.creatorId !== userId) return jsonError('Удалять может только создатель', 403);

    await prisma.challengeParticipant.deleteMany({ where: { challengeId: id } });
    await prisma.challenge.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('CHALLENGE DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (DELETE /api/challenges/[id])', 500, e?.message ?? String(e));
  }
}
