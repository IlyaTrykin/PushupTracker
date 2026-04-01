import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireGroupAccess, requireGroupManageAccess } from '@/lib/groups';

type ChallengeProgressRow = {
  userId: string;
  username: string;
  total: number;
  creditedDays?: number;
  totalDays?: number;
  qualifiedSets?: number;
  qualifiedReps?: number;
};

function jsonError(message: string, status: number, code?: string, details?: string | Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let actor: { id: string; isAdmin: boolean; username: string };
    try {
      const user = await requireUser(request);
      actor = { id: user.id, isAdmin: user.isAdmin, username: user.username };
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const { id } = await ctx.params;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: {
        id: true,
        groupId: true,
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

    if (!challenge) return jsonError('Соревнование не найдено', 404);

    let activeGroupMemberIds: Set<string> | null = null;
    if (challenge.groupId) {
      await requireGroupAccess(prisma, actor, challenge.groupId);
      const activeMembers = await prisma.groupMembership.findMany({
        where: {
          groupId: challenge.groupId,
          status: 'active',
          group: { deletedAt: null },
        },
        select: { userId: true },
      });
      activeGroupMemberIds = new Set(activeMembers.map((row) => row.userId));
    } else {
      const isMember = actor.isAdmin || challenge.creatorId === actor.id || challenge.participants.some((p) => p.userId === actor.id);
      if (!isMember) return jsonError('Нет доступа', 403);
    }

    const acceptedIds = challenge.participants
      .filter((p) => p.status === 'accepted')
      .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
      .map((p) => p.userId);

    const totalDays = (() => {
      const s = new Date(challenge.startDate.getFullYear(), challenge.startDate.getMonth(), challenge.startDate.getDate());
      const e = new Date(challenge.endDate.getFullYear(), challenge.endDate.getMonth(), challenge.endDate.getDate());
      const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
      return diff >= 0 ? diff + 1 : 0;
    })();

    if (!acceptedIds.length) {
      const myStatus = challenge.participants
        .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
        .find((p) => p.userId === actor.id)?.status ?? null;
      return NextResponse.json({ challenge, myStatus, progress: [] });
    }

    // mode calculations:
    // most/target: total reps in period
    // daily_min: credited days with dayTotal >= targetReps
    // sets_min: count of sets with reps >= targetReps (tie-breaker: sum reps of qualified sets)
    let progress: ChallengeProgressRow[] = [];

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
        .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
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
      grouped.forEach((g) => setsMap.set(g.userId, { sets: g._count._all ?? 0, reps: g._sum.reps ?? 0 }));

      progress = challenge.participants
        .filter((p) => p.status === 'accepted')
        .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
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
        .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
        .map((p) => ({
          userId: p.userId,
          username: p.user.username,
          total: map.get(p.userId) ?? 0,
        }))
        .sort((a, b) => b.total - a.total);
    }

    const myStatus = challenge.participants
      .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
      .find((p) => p.userId === actor.id)?.status ?? null;

    return NextResponse.json({ challenge, myStatus, progress });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('CHALLENGE GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/challenges/[id])', 500, getErrorMessage(e));
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let actor: { id: string; isAdmin: boolean; username: string };
    try {
      const user = await requireUser(request);
      actor = { id: user.id, isAdmin: user.isAdmin, username: user.username };
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const { id } = await ctx.params;

    const challenge = await prisma.challenge.findUnique({
      where: { id },
      select: { id: true, creatorId: true, groupId: true },
    });

    if (!challenge) return jsonError('Соревнование не найдено', 404);
    if (challenge.groupId) {
      await requireGroupManageAccess(prisma, actor, challenge.groupId);
    } else if (!actor.isAdmin && challenge.creatorId !== actor.id) {
      return jsonError('Удалять может только создатель', 403);
    }

    await prisma.challengeParticipant.deleteMany({ where: { challengeId: id } });
    await prisma.challenge.delete({ where: { id } });

    if (challenge.groupId) {
      await recordGroupAuditLog({
        groupId: challenge.groupId,
        actorId: actor.id,
        action: 'group_challenge_deleted',
        entityType: 'challenge',
        entityId: id,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('CHALLENGE DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (DELETE /api/challenges/[id])', 500, getErrorMessage(e));
  }
}
