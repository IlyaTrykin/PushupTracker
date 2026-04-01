import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireManagedGroupMemberAccess } from '@/lib/groups';
import { ProgramError, deactivateManagedTrainingProgram } from '@/lib/program';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; programId: string }> },
) {
  try {
    const actor = await requireUser(request);
    const { id, programId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400, 'BAD_JSON');

    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId) return jsonError('userId обязателен', 400, 'GROUP_PROGRAM_USER_REQUIRED');

    await requireManagedGroupMemberAccess(actor, id, targetUserId);
    const out = await deactivateManagedTrainingProgram(targetUserId, programId, id);

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      targetUserId,
      action: 'group_member_program_deactivated',
      entityType: 'training_program',
      entityId: programId,
    });

    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP PROGRAM DEACTIVATE POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
