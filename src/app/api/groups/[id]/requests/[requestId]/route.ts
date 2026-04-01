import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, resolveJoinRequest } from '@/lib/groups';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { id, requestId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400, 'BAD_JSON');

    const action = String(body.action || '').trim();
    if (action !== 'approve' && action !== 'reject') {
      return jsonError('Неизвестное действие', 400, 'GROUP_JOIN_REQUEST_BAD_ACTION');
    }

    const result = await resolveJoinRequest(user, id, requestId, action, request);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP REQUEST RESOLVE POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
