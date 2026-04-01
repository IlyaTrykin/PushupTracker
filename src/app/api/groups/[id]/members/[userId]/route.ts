import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, removeGroupMember, updateGroupMemberStatsInclusion } from '@/lib/groups';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id, userId } = await ctx.params;
    const result = await removeGroupMember(user, id, userId);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP MEMBER DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id, userId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body.includeInStats !== 'boolean') {
      return jsonError('Некорректный JSON', 400, 'BAD_JSON');
    }

    const membership = await updateGroupMemberStatsInclusion(user, id, userId, body.includeInStats);
    return NextResponse.json({ membership });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP MEMBER PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
