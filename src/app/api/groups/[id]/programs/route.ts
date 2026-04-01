import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireManagedGroupMemberAccess } from '@/lib/groups';
import { prisma } from '@/lib/prisma';
import {
  ProgramError,
  createTrainingProgram,
  deriveAgeFromBirthDate,
  getManagedProgramOverview,
  suggestDurationWeeks,
  suggestFrequencyPerWeek,
  type ProgramCreateInput,
} from '@/lib/program';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function isExerciseType(value: string): value is ProgramCreateInput['exerciseType'] {
  return ['pushups', 'pullups', 'crunches', 'squats', 'plank'].includes(value);
}

function getTargetUserId(request: NextRequest): string {
  return String(request.nextUrl.searchParams.get('userId') || '').trim();
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    const targetUserId = getTargetUserId(request);
    if (!targetUserId) return jsonError('userId обязателен', 400, 'GROUP_PROGRAM_USER_REQUIRED');

    await requireManagedGroupMemberAccess(actor, id, targetUserId);
    const payload = await getManagedProgramOverview(targetUserId, id);
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP PROGRAMS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON', 400, 'BAD_JSON');

    const targetUserId = String(body.userId || '').trim();
    if (!targetUserId) return jsonError('userId обязателен', 400, 'GROUP_PROGRAM_USER_REQUIRED');

    await requireManagedGroupMemberAccess(actor, id, targetUserId);

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { birthDate: true, gender: true, weightKg: true },
    });

    const inferredAge = deriveAgeFromBirthDate(targetUser?.birthDate ?? null) ?? 25;
    const inferredWeight = targetUser?.weightKg ?? 70;
    const inferredSex = String(body.sex || targetUser?.gender || 'unknown').trim().toLowerCase();
    const rawExerciseType = String(body.exerciseType || 'pushups');
    const exerciseType: ProgramCreateInput['exerciseType'] = isExerciseType(rawExerciseType) ? rawExerciseType : 'pushups';
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

    const program = await createTrainingProgram(targetUserId, payload, {
      managedByGroupId: id,
      assignedByUserId: actor.id,
    });

    if (!program) return jsonError('Не удалось создать программу', 500, 'GROUP_PROGRAM_CREATE_FAILED');

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      targetUserId,
      action: 'group_member_program_created',
      entityType: 'training_program',
      entityId: program.id,
      metadata: {
        exerciseType,
        baselineMaxReps,
        targetReps,
        durationWeeks,
        frequencyPerWeek,
      },
    });

    return NextResponse.json({ ok: true, program });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    if (e instanceof ProgramError) return jsonError(e.message, e.status, e.code);
    console.error('GROUP PROGRAMS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
