import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { ProgramError, startTrainingSession } from '@/lib/program';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    const forceStartEarly = Boolean(body?.forceStartEarly);

    const data = await startTrainingSession(user.id, id, { forceStartEarly });
    return NextResponse.json({ ok: true, program: data });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM SESSION START ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
