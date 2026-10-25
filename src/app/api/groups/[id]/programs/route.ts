import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requestLocale, requireUser } from '@/lib/auth';
import { GroupError, recordGroupAuditLog, requireManagedGroupMemberAccess } from '@/lib/groups';
import { prisma } from '@/lib/prisma';
import {
  ProgramError,
  createCircuitTrainingProgram,
  createTrainingProgram,
  deriveAgeFromBirthDate,
  getManagedProgramOverview,
  isCircuitProgramBody,
  parseCircuitProgramCreateBody,
  parseProgramCreateBody,
} from '@/lib/program';
import { distanceTooFarMessage } from '@/lib/program-plan';

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

/** Ошибка программы; «цель дистанции дальше плана» — на языке запроса и с пределом в `details` (как `/api/program`). */
function programErrorResponse(e: ProgramError, request: NextRequest) {
  const maxTargetMeters = e.details?.maxTargetMeters;
  if (e.code === 'PROGRAM_DISTANCE_TOO_FAR' && maxTargetMeters != null) {
    return jsonError(distanceTooFarMessage(maxTargetMeters, requestLocale(request)), e.status, e.code, { maxTargetMeters });
  }
  return jsonError(e.message, e.status, e.code);
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

    const profile = {
      ageYears: deriveAgeFromBirthDate(targetUser?.birthDate ?? null) ?? 25,
      weightKg: targetUser?.weightKg ?? 70,
      sex: targetUser?.gender || 'unknown',
    };
    const scope = { managedByGroupId: id, assignedByUserId: actor.id };

    // Круговая программа-ротация (R09.6) — тот же путь назначения с `programType: 'circuit'`.
    // По упражнению: неизвестное — 400 (PROGRAM_EXERCISE_INVALID), без подмены на отжимания.
    const program = isCircuitProgramBody(body)
      ? await createCircuitTrainingProgram(targetUserId, parseCircuitProgramCreateBody(body, profile), scope)
      : await createTrainingProgram(targetUserId, parseProgramCreateBody(body, profile), scope);

    if (!program) return jsonError('Не удалось создать программу', 500, 'GROUP_PROGRAM_CREATE_FAILED');

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      targetUserId,
      action: 'group_member_program_created',
      entityType: 'training_program',
      entityId: program.id,
      metadata: {
        exerciseType: program.exerciseType,
        programType: program.programType,
        circuitPlanId: program.circuitPlanId,
        loadKg: program.loadKg,
        baselineMaxReps: program.baselineMaxReps,
        targetReps: program.targetReps,
        durationWeeks: program.durationWeeks,
        frequencyPerWeek: program.frequencyPerWeek,
      },
    });

    return NextResponse.json({ ok: true, program });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    if (e instanceof ProgramError) return programErrorResponse(e, request);
    console.error('GROUP PROGRAMS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
