import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, deleteGroup, getGroupDetails, updateGroupName } from '@/lib/groups';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const group = await getGroupDetails(user, id);
    return NextResponse.json({ group });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP BY ID GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400, 'BAD_JSON');

    const group = await updateGroupName(user, id, body.name);
    return NextResponse.json({ group });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP BY ID PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const result = await deleteGroup(user, id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP BY ID DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
