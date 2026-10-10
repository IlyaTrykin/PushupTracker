import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, requestLocale, AuthError } from '@/lib/auth';
import { dayKeyInZone, dayKeyToDbDate, dbDateToDayKey, localHHMM, normalizeTimeZone, zonedTimeToInstant } from '@/lib/calendar-day';
import { tooManyRequests } from '@/lib/rate-limit';
import { WORKOUT_SELECT, WorkoutCreateError, createWorkoutForUser } from '@/lib/workout-create';
import { parseWorkoutDay, parseWorkoutDuration, parseWorkoutExerciseType, parseWorkoutLoadFields, parseWorkoutTime } from '@/lib/workout-input';
import { GroupError, recordGroupAuditLog, requireManagedGroupMemberAccess } from '@/lib/groups';

export const dynamic = 'force-dynamic';

type WorkoutActor = {
  id: string;
  username: string;
  isAdmin: boolean;
};

function jsonError(message: string, status = 400, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function getExerciseTypeFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const t = url.searchParams.get('exerciseType');
  if (!t) return null;
  return String(t).trim() || null;
}

function getUserIdFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId');
  if (!userId) return null;
  return String(userId).trim() || null;
}

function getGroupIdFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const groupId = url.searchParams.get('groupId');
  if (!groupId) return null;
  return String(groupId).trim() || null;
}

async function getWorkoutOwnerUserOrThrow(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, deletedAt: true, timeZone: true },
  });
  if (!user || user.deletedAt) throw new GroupError('Пользователь не найден', 404, 'WORKOUT_USER_NOT_FOUND');
  return { id: user.id, username: user.username, timeZone: user.timeZone };
}

async function resolveWorkoutReadAccess(actor: WorkoutActor, request: Request) {
  const requestedUserId = getUserIdFromQuery(request);
  const groupId = getGroupIdFromQuery(request);
  const targetUserId = requestedUserId || actor.id;

  if (targetUserId === actor.id || actor.isAdmin) {
    return { targetUserId, groupId, managedByGroup: false };
  }

  if (!groupId) {
    throw new GroupError('Для доступа к тренировкам участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
  }

  const { group } = await requireManagedGroupMemberAccess(actor, groupId, targetUserId);
  return { targetUserId, groupId: group.id, managedByGroup: true };
}

async function resolveWorkoutWriteAccess(actor: WorkoutActor, body: unknown) {
  const bodyRecord = (body && typeof body === 'object') ? body as Record<string, unknown> : {};
  const requestedUserId = String(bodyRecord.userId || '').trim();
  const groupId = String(bodyRecord.groupId || '').trim() || null;
  const targetUserId = requestedUserId || actor.id;

  if (targetUserId === actor.id || actor.isAdmin) {
    return { targetUserId, groupId, managedByGroup: false };
  }

  if (!groupId) {
    throw new GroupError('Для управления тренировками участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
  }

  const { group } = await requireManagedGroupMemberAccess(actor, groupId, targetUserId);
  return { targetUserId, groupId: group.id, managedByGroup: true };
}

export async function GET(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const { targetUserId } = await resolveWorkoutReadAccess(actor, request);
    const exerciseType = getExerciseTypeFromQuery(request);

    const workouts = await prisma.workout.findMany({
      where: {
        userId: targetUserId,
        ...(exerciseType ? { exerciseType } : {}),
      },
      orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'desc' }],
      select: WORKOUT_SELECT,
    });

    return NextResponse.json(workouts);
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: Request) {
  let actor: WorkoutActor;
  try {
    const u = await requireUser(request);
    actor = { id: u.id, username: u.username, isAdmin: u.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return jsonError('Некорректный JSON');

    const { targetUserId, groupId, managedByGroup } = await resolveWorkoutWriteAccess(actor, body);
    const owner = await getWorkoutOwnerUserOrThrow(targetUserId);
    const result = await createWorkoutForUser(owner, body, { source: 'web', actorId: actor.id });
    const { workout } = result;

    if (managedByGroup && groupId && !result.replayed) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: owner.id,
        action: 'group_member_workout_created',
        entityType: 'workout',
        entityId: workout.id,
        metadata: {
          reps: workout.reps,
          loadKg: workout.loadKg,
          date: workout.date.toISOString(),
          time: workout.time.toISOString(),
          exerciseType: workout.exerciseType,
        },
      });
    }

    return NextResponse.json({
      workout,
      reward: result.reward,
      records: result.records,
      achievements: result.achievements,
    });
  } catch (e) {
    if (e instanceof WorkoutCreateError) {
      if (e.status === 429) return tooManyRequests(e.retryAfterSeconds, requestLocale(request));
      return jsonError(e.message, e.status, e.code);
    }
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function PUT(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const id = String(body.id || '').trim();
    if (!id) return jsonError('id обязателен');

    const existing = await prisma.workout.findUnique({
      where: { id },
      select: {
        id: true, userId: true, date: true, time: true, reps: true, loadKg: true, repsLeft: true, repsRight: true, durationSeconds: true, exerciseType: true,
        user: { select: { timeZone: true } },
      },
    });
    if (!existing) return jsonError('Запись не найдена', 404);

    let managedByGroup = false;
    let groupId = String(body.groupId || '').trim() || null;
    if (existing.userId !== actor.id && !actor.isAdmin) {
      if (!groupId) return jsonError('Для управления тренировкой участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
      const access = await requireManagedGroupMemberAccess(actor, groupId, existing.userId);
      managedByGroup = true;
      groupId = access.group.id;
    }

    const timeZone = normalizeTimeZone(existing.user.timeZone);
    const now = new Date();

    // B13: the exercise may change; load fields are re-validated for the new one.
    let exerciseType = existing.exerciseType;
    if (body.exerciseType !== undefined && body.exerciseType !== existing.exerciseType) {
      const parsedType = parseWorkoutExerciseType(body.exerciseType);
      if (!parsedType.ok) return jsonError(parsedType.error, 400, 'WORKOUT_EXERCISE_INVALID');
      exerciseType = parsedType.value;
    }

    const data: {
      exerciseType?: string; reps?: number; loadKg?: number | null; repsLeft?: number | null; repsRight?: number | null; durationSeconds?: number | null; date?: Date; time?: Date;
    } = {};

    const parsedLoad = parseWorkoutLoadFields(exerciseType, body, existing);
    if (!parsedLoad.ok) return jsonError(parsedLoad.error, 400, 'WORKOUT_VALUE_INVALID');
    Object.assign(data, parsedLoad.value);
    if (exerciseType !== existing.exerciseType) data.exerciseType = exerciseType;

    const parsedDuration = parseWorkoutDuration(exerciseType, body, existing.durationSeconds);
    if (!parsedDuration.ok) return jsonError(parsedDuration.error, 400, 'WORKOUT_DURATION_INVALID');
    if (parsedDuration.value !== existing.durationSeconds) data.durationSeconds = parsedDuration.value;

    let day = dbDateToDayKey(existing.date);
    if (body.date !== undefined) {
      const parsedDay = parseWorkoutDay(body.date, dayKeyInZone(now, timeZone));
      if (!parsedDay.ok) return jsonError(parsedDay.error, 400, 'WORKOUT_DATE_INVALID');
      day = parsedDay.value;
      data.date = dayKeyToDbDate(day);
    }

    if (body.time !== undefined) {
      const parsedTime = parseWorkoutTime(body.time, day, timeZone, now);
      if (!parsedTime.ok) return jsonError(parsedTime.error, 400, 'WORKOUT_TIME_INVALID');
      data.time = parsedTime.value;
    } else if (data.date) {
      // Moved to another day: keep the wall-clock time of the set.
      data.time = zonedTimeToInstant(day, localHHMM(existing.time, timeZone), timeZone);
    }

    const updated = await prisma.workout.update({
      where: { id },
      data,
      select: WORKOUT_SELECT,
    });

    if (managedByGroup && groupId) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: existing.userId,
        action: 'group_member_workout_updated',
        entityType: 'workout',
        entityId: existing.id,
        metadata: {
          before: {
            reps: existing.reps,
            date: existing.date.toISOString(),
            time: existing.time.toISOString(),
            exerciseType: existing.exerciseType,
          },
          after: {
            reps: updated.reps,
            date: updated.date.toISOString(),
            time: updated.time.toISOString(),
            exerciseType: updated.exerciseType,
          },
        },
      });
    }

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS PUT ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function DELETE(request: Request) {
  let actor: WorkoutActor;
  try {
    const user = await requireUser(request);
    actor = { id: user.id, username: user.username, isAdmin: user.isAdmin };
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const id = String(body.id || '').trim();
    if (!id) return jsonError('id обязателен');

    const existing = await prisma.workout.findUnique({
      where: { id },
      select: { id: true, userId: true, reps: true, date: true, time: true, exerciseType: true },
    });
    if (!existing) return jsonError('Запись не найдена', 404);

    let managedByGroup = false;
    let groupId = String(body.groupId || '').trim() || null;
    if (existing.userId !== actor.id && !actor.isAdmin) {
      if (!groupId) return jsonError('Для управления тренировкой участника группы нужен groupId', 400, 'GROUP_ID_REQUIRED');
      const access = await requireManagedGroupMemberAccess(actor, groupId, existing.userId);
      managedByGroup = true;
      groupId = access.group.id;
    }

    await prisma.workout.delete({ where: { id } });

    if (managedByGroup && groupId) {
      await recordGroupAuditLog({
        groupId,
        actorId: actor.id,
        targetUserId: existing.userId,
        action: 'group_member_workout_deleted',
        entityType: 'workout',
        entityId: existing.id,
        metadata: {
          reps: existing.reps,
          date: existing.date.toISOString(),
          time: existing.time.toISOString(),
          exerciseType: existing.exerciseType,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('WORKOUTS DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
