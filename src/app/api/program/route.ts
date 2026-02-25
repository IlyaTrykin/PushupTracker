import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  ProgramError,
  createTrainingProgram,
  deriveAgeFromBirthDate,
  getProgramOverview,
  suggestDurationWeeks,
  suggestFrequencyPerWeek,
  type ProgramCreateInput,
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

    const inferredAge = deriveAgeFromBirthDate(me?.birthDate ?? null) ?? 25;
    const inferredWeight = me?.weightKg ?? 70;
    const inferredSex = String(body.sex || me?.gender || 'unknown').trim().toLowerCase();
    const exerciseType = String(body.exerciseType || 'pushups') as any;
    const baselineMaxReps = Number(body.baselineMaxReps || 1);
    const targetReps = Number(body.targetReps || baselineMaxReps);
    const ageYears = Number(body.ageYears || inferredAge);
    const weightKg = Number(body.weightKg || inferredWeight);
    const frequencyPerWeek =
      body.frequencyPerWeek != null
        ? Number(body.frequencyPerWeek)
        : suggestFrequencyPerWeek({
            exerciseType,
            baselineMaxReps,
            targetReps,
            ageYears,
            weightKg,
          });
    const durationWeeks =
      body.durationWeeks != null
        ? Number(body.durationWeeks)
        : suggestDurationWeeks({
            exerciseType,
            baselineMaxReps,
            targetReps,
            ageYears,
            weightKg,
            frequencyPerWeek,
          });

    const payload: ProgramCreateInput = {
      exerciseType,
      baselineMaxReps,
      targetReps,
      durationWeeks,
      frequencyPerWeek,
      ageYears,
      weightKg,
      sex: inferredSex,
      startDate: body.startDate ? String(body.startDate) : null,
    };

    const program = await createTrainingProgram(user.id, payload);

    return NextResponse.json({ ok: true, program });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('PROGRAM POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
