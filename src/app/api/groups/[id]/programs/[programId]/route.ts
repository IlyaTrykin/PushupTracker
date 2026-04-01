import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, requireManagedGroupMemberAccess } from '@/lib/groups';
import { ProgramError, getManagedProgramById } from '@/lib/program';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function getTargetUserId(request: NextRequest): string {
  return String(request.nextUrl.searchParams.get('userId') || '').trim();
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; programId: string }> },
) {
  try {
    const actor = await requireUser(request);
    const { id, programId } = await ctx.params;
    const targetUserId = getTargetUserId(request);
    if (!targetUserId) return jsonError('userId обязателен', 400, 'GROUP_PROGRAM_USER_REQUIRED');

    await requireManagedGroupMemberAccess(actor, id, targetUserId);
    const program = await getManagedProgramById(targetUserId, programId, id);
    if (!program) return jsonError('Программа не найдена', 404, 'PROGRAM_NOT_FOUND');

    return NextResponse.json(program);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP PROGRAM BY ID GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
