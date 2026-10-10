import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireGroupManageAccess } from '@/lib/groups';
import { prisma } from '@/lib/prisma';

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Ends a goal early: soft delete, the record stays in the past goals. */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; goalId: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id, goalId } = await ctx.params;
    await requireGroupManageAccess(prisma, actor, id);

    const result = await prisma.groupGoal.updateMany({
      where: { id: goalId, groupId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!result.count) return jsonError('Цель не найдена', 404, 'GOAL_NOT_FOUND');

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      action: 'group_goal_deleted',
      entityType: 'group_goal',
      entityId: goalId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP GOAL DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
