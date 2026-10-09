import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireGroupAccess, requireGroupManageAccess } from '@/lib/groups';
import { challengeTotalDays, challengeUsesPoints, scoreChallenge } from '@/lib/challenge-scoring';

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

    const totalDays = challengeTotalDays(challenge.startDate, challenge.endDate);

    if (!acceptedIds.length) {
      const myStatus = challenge.participants
        .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
        .find((p) => p.userId === actor.id)?.status ?? null;
      return NextResponse.json({ challenge, myStatus, progress: [], scoring: challengeUsesPoints(challenge.exerciseType) ? 'points' : 'reps' });
    }

    // Подсчёт — в challenge-scoring.ts: упражнения с весом в баллах, sets_min по слабейшей стороне (B10).
    const workouts = await prisma.workout.findMany({
      where: {
        userId: { in: acceptedIds },
        exerciseType: challenge.exerciseType,
        date: { gte: challenge.startDate, lte: challenge.endDate },
      },
      select: { userId: true, date: true, reps: true, loadKg: true, repsLeft: true, repsRight: true },
    });

    const usernames = new Map(challenge.participants.map((p) => [p.userId, p.user.username]));
    const progress: ChallengeProgressRow[] = scoreChallenge({
      mode: challenge.mode,
      exerciseType: challenge.exerciseType,
      targetReps: challenge.targetReps,
      participantIds: acceptedIds,
      workouts,
      totalDays,
    }).map((row) => ({ ...row, username: usernames.get(row.userId) ?? '' }));

    const myStatus = challenge.participants
      .filter((p) => !activeGroupMemberIds || activeGroupMemberIds.has(p.userId))
      .find((p) => p.userId === actor.id)?.status ?? null;

    return NextResponse.json({ challenge, myStatus, progress, scoring: challengeUsesPoints(challenge.exerciseType) ? 'points' : 'reps' });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('CHALLENGE GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
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
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
