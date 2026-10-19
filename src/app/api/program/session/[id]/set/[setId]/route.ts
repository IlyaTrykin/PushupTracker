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

    const { id, setId } = await ctx.params;

    // actualReps — повторы/секунды/метры; у упражнений «на сторону» — actualLeft/actualRight,
    // у дистанции — необязательное actualSeconds. Проверка по виду упражнения — в submitTrainingSet.
    const out = await submitTrainingSet({
      userId: user.id,
      sessionId: id,
      setId,
      actualReps: body.actualReps,
      actualLeft: body.actualLeft,
      actualRight: body.actualRight,
      actualSeconds: body.actualSeconds,
    });

    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM SET SUBMIT ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
