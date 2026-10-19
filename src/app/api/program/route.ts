import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ProgramError,
  createTrainingProgram,
  deriveAgeFromBirthDate,
  getProgramOverview,
  parseProgramCreateBody,
} from '@/lib/program';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const payload = await getProgramOverview(user.id);
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400);

    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { birthDate: true, gender: true, weightKg: true },
    });

    // Неизвестное упражнение — 400 (PROGRAM_EXERCISE_INVALID), без подмены на отжимания.
    const payload = parseProgramCreateBody(body, {
      ageYears: deriveAgeFromBirthDate(me?.birthDate ?? null) ?? 25,
      weightKg: me?.weightKg ?? 70,
      sex: me?.gender || 'unknown',
    });

    const program = await createTrainingProgram(user.id, payload);

    return NextResponse.json({ ok: true, program });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
