import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { DEFAULT_TIME_ZONE, dayKeyInZone, dayKeyToDbDate } from '@/lib/calendar-day';
import { GroupError, recordGroupAuditLog, requireGroupAccess, requireGroupManageAccess } from '@/lib/groups';
import {
  isGroupGoalActive,
  loadGroupGoalProgress,
  parseGroupGoalInput,
  toGroupGoalDto,
} from '@/lib/group-goal';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const PAST_GOALS_LIMIT = 10;

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

const GOAL_ERROR_TEXT: Record<string, string> = {
  GOAL_TITLE_INVALID: 'Название цели: от 1 до 80 символов',
  GOAL_POINTS_INVALID: 'Баллов должно быть от 100 до 10 000 000',
  GOAL_EXERCISE_INVALID: 'Неизвестное упражнение',
  GOAL_DATE_INVALID: 'Некорректные даты цели',
};

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    await requireGroupAccess(prisma, actor, id);

    const today = dayKeyInZone(new Date(), DEFAULT_TIME_ZONE);
    const goals = await prisma.groupGoal.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'desc' },
      take: PAST_GOALS_LIMIT + 5,
    });
    const activeGoal = goals.find((goal) => isGroupGoalActive(goal, today)) ?? null;
    const pastGoals = goals.filter((goal) => goal !== activeGoal).slice(0, PAST_GOALS_LIMIT);

    const [active, past] = await Promise.all([
      activeGoal ? loadGroupGoalProgress(activeGoal).then((p) => toGroupGoalDto(activeGoal, p)) : null,
      Promise.all(pastGoals.map((goal) => loadGroupGoalProgress(goal).then((p) => toGroupGoalDto(goal, p)))),
    ]);
    return NextResponse.json({ active, past });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP GOALS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    await requireGroupManageAccess(prisma, actor, id);

    const parsed = parseGroupGoalInput(await request.json().catch(() => null));
    if (!parsed.ok) return jsonError(GOAL_ERROR_TEXT[parsed.code], 400, parsed.code);
    const input = parsed.value;
    const today = dayKeyInZone(new Date(), DEFAULT_TIME_ZONE);

    const created = await prisma.$transaction(async (tx) => {
      // Two owners posting at once must not both pass the «one active goal» check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`group-goal:${id}`}))`;
      const open = await tx.groupGoal.findMany({
        where: { groupId: id, deletedAt: null, completedAt: null },
        select: { completedAt: true, deletedAt: true, endDate: true },
      });
      if (open.some((goal) => isGroupGoalActive(goal, today))) return null;
      return tx.groupGoal.create({
        data: {
          groupId: id,
          title: input.title,
          targetPoints: input.targetPoints,
          exerciseType: input.exerciseType,
          startDate: dayKeyToDbDate(input.startDay),
          endDate: dayKeyToDbDate(input.endDay),
          createdById: actor.id,
        },
      });
    });
    if (!created) return jsonError('У группы уже есть активная цель', 409, 'GOAL_ALREADY_ACTIVE');

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      action: 'group_goal_created',
      entityType: 'group_goal',
      entityId: created.id,
      metadata: { title: created.title, targetPoints: created.targetPoints, exerciseType: created.exerciseType },
    });
    return NextResponse.json({ goal: toGroupGoalDto(created, await loadGroupGoalProgress(created)) }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP GOALS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
