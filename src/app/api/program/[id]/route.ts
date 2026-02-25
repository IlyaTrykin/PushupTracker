import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { ProgramError, getProgramById } from '@/lib/program';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;

    const program = await getProgramById(user.id, id);
    if (!program) return jsonError('Программа не найдена', 404);

    return NextResponse.json(program);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM BY ID GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
