import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { ProgramError, submitTrainingSet } from '@/lib/program';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string; setId: string }> }) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400);

    const actualReps = Number(body.actualReps);
    if (!Number.isFinite(actualReps) || actualReps <= 0) return jsonError('actualReps должен быть числом > 0', 400);

    const { id, setId } = await ctx.params;

    const out = await submitTrainingSet({
      userId: user.id,
      sessionId: id,
      setId,
      actualReps,
    });

    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM SET SUBMIT ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
