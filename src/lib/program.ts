import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendWebPushToUsers } from '@/lib/web-push';
import { EXERCISES, isExerciseType } from '@/lib/exercises';
import { dayKeyToDbDate, dbDateToDayKey, diffDays, normalizeTimeZone, type DayKey } from '@/lib/calendar-day';
import {
  ProgramError,
  buildProgramDraft,
  computeSetTarget,
  evaluateProgramOutcome,
  isSessionOpenForSets,
  planOverdueAutofill,
  planProgramExtension,
  programDayOf,
  programReplacementScope,
  programSetWorkoutTime,
  programWorkoutDate,
  setsMissingWorkouts,
  shiftInstantByDays,
  type ProgramClock,
  type ProgramCreateInput,
  type ProgramProfileHints,
} from '@/lib/program-plan';

export {
  ProgramError,
  isProgramExerciseType,
  suggestDurationWeeks,
  suggestFrequencyPerWeek,
} from '@/lib/program-plan';
export type {
  ProgramCreateInput,
  ProgramExerciseType,
  ProgramGoalType,
  ProgramProfileHints,
} from '@/lib/program-plan';

const PROGRAM_INTERRUPTED_MESSAGE =
  'Программа была прервана из-за длительного пропуска. Создайте новую программу, когда будете готовы продолжить.';
const RETEST_REQUIRED_MESSAGE = 'Пропуск более двух недель. Пройдите повторный тест и перегенерируйте программу.';

function exerciseTypeLabel(exerciseType: string): string {
  return isExerciseType(exerciseType) ? EXERCISES[exerciseType].label.ru.toLowerCase() : exerciseType;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

async function getUserTimeZone(userId: string): Promise<string> {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  return normalizeTimeZone(row?.timeZone);
}

async function getProgramTimeZone(programId: string): Promise<string> {
  const row = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    select: { user: { select: { timeZone: true } } },
  });
  return normalizeTimeZone(row?.user?.timeZone);
}

export function deriveAgeFromBirthDate(birthDate?: Date | null): number | null {
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const m = now.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  if (!Number.isFinite(age) || age <= 0) return null;
  return age;
}

function getWeekStats(
  sessions: Array<{ weekNumber: number; completed: boolean }>,
): Map<number, { total: number; completed: number; success: boolean }> {
  const map = new Map<number, { total: number; completed: number; success: boolean }>();
  sessions.forEach((s) => {
    const row = map.get(s.weekNumber) ?? { total: 0, completed: 0, success: false };
    row.total += 1;
    if (s.completed) row.completed += 1;
    row.success = row.total > 0 && row.completed === row.total;
    map.set(s.weekNumber, row);
  });
  return map;
}

function buildRecoveryWarnings(args: {
  completedSessions: Array<{ completedAt: Date | null; sets: Array<{ actualReps: number | null }> }>;
  baselineMaxReps: number;
  needsRetest: boolean;
  timeZone: string;
}): string[] {
  const warnings: string[] = [];
  if (args.needsRetest) {
    warnings.push('Пропуск более двух недель. Рекомендуется пройти повторный AMRAP-тест и перегенерировать программу.');
  }

  const recent = args.completedSessions
    .filter((s) => s.completedAt)
    .sort((a, b) => (b.completedAt!.getTime() - a.completedAt!.getTime()))
    .slice(0, 4);

  if (recent.length >= 3) {
    const oldest = programDayOf(recent[recent.length - 1].completedAt!, args.timeZone);
    const newest = programDayOf(recent[0].completedAt!, args.timeZone);
    const spanDays = Math.max(1, diffDays(newest, oldest) + 1);
    if (spanDays <= 4) {
      warnings.push('Высокая частота последних тренировок. Добавьте восстановление, если чувствуете усталость.');
    }
  }

  const hardDayThreshold = args.baselineMaxReps * 3;
  const heavySessions = args.completedSessions
    .filter((s) => s.completedAt)
    .map((s) => ({
      day: programDayOf(s.completedAt as Date, args.timeZone),
      total: s.sets.reduce((sum, st) => sum + (st.actualReps ?? 0), 0),
    }))
    .filter((x) => x.total >= hardDayThreshold)
    .sort((a, b) => diffDays(b.day, a.day));

  if (heavySessions.length >= 2) {
    const d = Math.abs(diffDays(heavySessions[0].day, heavySessions[1].day));
    if (d <= 1) {
      warnings.push('Две тяжёлые тренировки подряд. Следите за восстановлением и качеством сна.');
    }
  }

  return warnings;
}

function sumRepsByDay(workouts: Array<{ date: Date; reps: number | null }>): Map<DayKey, number> {
  const totals = new Map<DayKey, number>();
  workouts.forEach((w) => {
    const key = dbDateToDayKey(w.date);
    totals.set(key, (totals.get(key) ?? 0) + (w.reps || 0));
  });
  return totals;
}

async function autofillOverdueSessionsFromExternalWorkouts(programId: string, clock: ProgramClock) {
  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    include: {
      sessions: {
        where: { completed: false, isFinalTest: false },
        orderBy: { scheduledAt: 'asc' },
        include: {
          sets: { orderBy: { setNumber: 'asc' } },
        },
      },
    },
  });

  if (!program || !program.sessions.length) return;

  const today = programDayOf(clock.now, clock.timeZone);
  const overdueDays = program.sessions
    .map((s) => programDayOf(s.scheduledAt, clock.timeZone))
    .filter((day) => diffDays(day, today) < 0);
  if (!overdueDays.length) return;

  const workouts = await prisma.workout.findMany({
    where: {
      userId: program.userId,
      exerciseType: program.exerciseType,
      date: { gte: dayKeyToDbDate(overdueDays[0]), lte: dayKeyToDbDate(overdueDays[overdueDays.length - 1]) },
      trainingSessionId: null,
    },
    select: { date: true, reps: true },
  });

  const plan = planOverdueAutofill({ sessions: program.sessions, dayTotals: sumRepsByDay(workouts), clock });
  if (!plan.length) return;

  const byId = new Map(program.sessions.map((s) => [s.id, s]));

  await prisma.$transaction(async (tx) => {
    for (const item of plan) {
      const session = byId.get(item.sessionId);
      if (!session) continue;

      const claimed = await tx.trainingSession.updateMany({
        where: { id: session.id, completed: false },
        data: {
          completed: true,
          completedAt: session.scheduledAt,
          startedAt: session.startedAt || session.scheduledAt,
        },
      });
      if (claimed.count !== 1) continue;

      for (const st of item.sets) {
        await tx.trainingSet.update({
          where: { id: st.setId },
          data: { actualReps: st.actualReps, completedAt: session.scheduledAt },
        });
      }
    }
  });
}

async function getProgramByWhere(where: Prisma.TrainingProgramWhereInput) {
  const row = await prisma.trainingProgram.findFirst({
    where,
    include: {
      user: { select: { timeZone: true } },
      sessions: {
        orderBy: [{ scheduledAt: 'asc' }, { sessionNumber: 'asc' }],
        include: {
          sets: {
            orderBy: { setNumber: 'asc' },
          },
        },
      },
    },
  });

  if (!row) return null;
  const { user, ...program } = row;

  const weekStats = getWeekStats(program.sessions.map((s) => ({ weekNumber: s.weekNumber, completed: s.completed })));
  const successWeeks = Array.from(weekStats.values()).filter((x) => x.success).length;

  const completedSessions = program.sessions.filter((s) => s.completed);
  const warnings = buildRecoveryWarnings({
    completedSessions: completedSessions.map((s) => ({
      completedAt: s.completedAt,
      sets: s.sets.map((st) => ({ actualReps: st.actualReps })),
    })),
    baselineMaxReps: program.baselineMaxReps,
    needsRetest: program.needsRetest,
    timeZone: normalizeTimeZone(user?.timeZone),
  });

  return {
    ...program,
    stats: {
      totalSessions: program.sessions.length,
      completedSessions: completedSessions.length,
      totalSets: program.sessions.reduce((sum, s) => sum + s.sets.length, 0),
      completedSets: program.sessions.reduce((sum, s) => sum + s.sets.filter((st) => st.actualReps != null).length, 0),
      successWeeks,
      completionPercent: program.sessions.length
        ? Math.round((completedSessions.length / program.sessions.length) * 100)
        : 0,
      nextSession: program.sessions.find((s) => !s.completed) ?? null,
    },
    warnings,
  };
}

export async function createTrainingProgram(
  userId: string,
  input: ProgramCreateInput,
  options?: {
    managedByGroupId?: string | null;
    assignedByUserId?: string | null;
  },
) {
  const timeZone = await getUserTimeZone(userId);
  const draft = buildProgramDraft(input, { now: new Date(), timeZone });
  const scope = programReplacementScope(draft.clean.exerciseType, options?.managedByGroupId);

  const created = await prisma.$transaction(async (tx) => {
    // A group assignment never switches off the member's personal program (and vice versa).
    await tx.trainingProgram.updateMany({
      where: { userId, isActive: true, ...scope },
      data: { isActive: false, status: 'inactive' },
    });

    const program = await tx.trainingProgram.create({
      data: {
        userId,
        exerciseType: draft.clean.exerciseType,
        goalType: 'reach_target',
        targetReps: draft.clean.targetReps,
        durationWeeks: draft.clean.durationWeeks,
        frequencyPerWeek: draft.clean.frequencyPerWeek,
        baselineMaxReps: draft.clean.baselineMaxReps,
        ageYears: draft.clean.ageYears,
        weightKg: draft.clean.weightKg,
        sex: draft.clean.sex,
        startDate: dayKeyToDbDate(draft.startDay),
        isActive: true,
        status: 'active',
        managedByGroupId: options?.managedByGroupId ?? null,
        assignedByUserId: options?.assignedByUserId ?? null,
      },
      select: { id: true },
    });

    for (const s of draft.sessions) {
      await tx.trainingSession.create({
        data: {
          programId: program.id,
          weekNumber: s.weekNumber,
          sessionNumber: s.sessionNumber,
          scheduledAt: s.scheduledAt,
          isFinalTest: s.isFinalTest,
          sets: {
            create: s.sets.map((st) => ({
              setNumber: st.setNumber,
              targetReps: st.targetReps,
              restSeconds: st.restSeconds,
              isKeySet: st.isKeySet,
            })),
          },
        },
      });
    }

    return program;
  });

  return getProgramById(userId, created.id);
}

export async function deactivateTrainingProgram(userId: string, programId: string) {
  const row = await prisma.trainingProgram.findFirst({
    where: { id: programId, userId },
    select: { id: true },
  });
  if (!row) throw new ProgramError('Программа не найдена', 404);

  await prisma.trainingProgram.update({
    where: { id: programId },
    data: { isActive: false, status: 'inactive' },
  });

  return { ok: true };
}

export async function deactivateManagedTrainingProgram(userId: string, programId: string, groupId: string) {
  const row = await prisma.trainingProgram.findFirst({
    where: { id: programId, userId, managedByGroupId: groupId },
    select: { id: true },
  });
  if (!row) throw new ProgramError('Программа не найдена', 404);

  await prisma.trainingProgram.update({
    where: { id: programId },
    data: { isActive: false, status: 'inactive' },
  });

  return { ok: true };
}

export async function syncProgramSchedule(
  programId: string,
  now: Date = new Date(),
): Promise<{ shiftedDays: number; needsRetest: boolean }> {
  const clock: ProgramClock = { now, timeZone: await getProgramTimeZone(programId) };
  await autofillOverdueSessionsFromExternalWorkouts(programId, clock);

  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    select: {
      id: true,
      userId: true,
      isActive: true,
      needsRetest: true,
      exerciseType: true,
      sessions: {
        where: { completed: false },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, shiftedCount: true },
      },
    },
  });

  if (!program || !program.isActive || program.needsRetest) return { shiftedDays: 0, needsRetest: Boolean(program?.needsRetest) };
  if (!program.sessions.length) return { shiftedDays: 0, needsRetest: false };

  const today = programDayOf(now, clock.timeZone);
  const earliest = program.sessions[0];
  const earliestDay = programDayOf(earliest.scheduledAt, clock.timeZone);
  const overdueDays = Math.max(0, diffDays(today, earliestDay));
  const carriedMissDays = Math.max(0, earliest.shiftedCount) + overdueDays;

  if (carriedMissDays > 14) {
    const stopLink = `/program?stoppedProgram=${encodeURIComponent(program.id)}`;
    const stopTitle = 'Программа прервана';
    const stopBody = `Программа по упражнению "${exerciseTypeLabel(program.exerciseType)}" прервана из-за пропуска более 2 недель. Создайте новую, когда будете готовы.`;

    await prisma.$transaction(async (tx) => {
      await tx.trainingProgram.update({
        where: { id: program.id },
        data: {
          needsRetest: true,
          isActive: false,
          status: 'inactive',
        },
      });

      const alreadySent = await tx.notification.findFirst({
        where: {
          userId: program.userId,
          type: 'program_stopped',
          link: stopLink,
        },
        select: { id: true },
      });

      if (!alreadySent) {
        await tx.notification.create({
          data: {
            userId: program.userId,
            type: 'program_stopped',
            title: stopTitle,
            body: stopBody,
            link: stopLink,
          },
        });
      }
    });

    await sendWebPushToUsers(
      [program.userId],
      {
        title: stopTitle,
        body: stopBody,
        link: stopLink,
        tag: `program-stopped-${program.id}`,
      },
      'program_reminder',
    ).catch(() => {});

    return { shiftedDays: 0, needsRetest: true };
  }

  if (overdueDays <= 0) return { shiftedDays: 0, needsRetest: false };

  await prisma.$transaction(async (tx) => {
    for (const s of program.sessions) {
      // Guarded by the old time: a concurrent sync that already shifted this session wins.
      await tx.trainingSession.updateMany({
        where: { id: s.id, completed: false, scheduledAt: s.scheduledAt },
        data: {
          scheduledAt: shiftInstantByDays(s.scheduledAt, overdueDays, clock.timeZone),
          shiftedCount: { increment: overdueDays },
        },
      });
    }
  });

  return { shiftedDays: overdueDays, needsRetest: false };
}

/**
 * «Пропущена тренировка» (1 ч / 24 ч / предупреждение о прерывании) for one user at `now`.
 * Not called on page load — the scheduler (T07) runs it.
 */
export async function sendProgramMissedSessionNotificationsForUser(userId: string, now: Date) {
  const oneHourMs = 60 * 60 * 1000;
  const oneDayMs = 24 * oneHourMs;

  const overdueSessions = await prisma.trainingSession.findMany({
    where: {
      completed: false,
      scheduledAt: { lt: now },
      program: {
        userId,
        isActive: true,
      },
    },
    orderBy: [{ programId: 'asc' }, { scheduledAt: 'asc' }],
    select: {
      id: true,
      programId: true,
      scheduledAt: true,
      shiftedCount: true,
      program: {
        select: {
          id: true,
          exerciseType: true,
        },
      },
    },
  });

  if (!overdueSessions.length) return;

  const timeZone = await getUserTimeZone(userId);
  const today = programDayOf(now, timeZone);

  const firstOverdueByProgram = new Map<string, typeof overdueSessions[number]>();
  for (const s of overdueSessions) {
    if (!firstOverdueByProgram.has(s.programId)) firstOverdueByProgram.set(s.programId, s);
  }

  for (const session of firstOverdueByProgram.values()) {
    const overdueMs = now.getTime() - session.scheduledAt.getTime();
    const carriedMissDays = Math.max(0, session.shiftedCount)
      + Math.max(0, diffDays(today, programDayOf(session.scheduledAt, timeZone)));
    if (overdueMs < oneHourMs) continue;

    const link = `/program/session/${session.id}`;
    const exerciseName = exerciseTypeLabel(session.program.exerciseType);

    const sentRows = await prisma.notification.findMany({
      where: {
        userId,
        type: {
          in: ['program_missed_1h', 'program_missed_24h', 'program_stop_warning'],
        },
        link,
      },
      select: { type: true },
    });
    const sentTypes = new Set(sentRows.map((x) => x.type));

    const notifications: Array<{ type: string; title: string; body: string; link: string }> = [];
    const pushes: Array<{ title: string; body: string; link: string; tag: string }> = [];

    if (overdueMs >= oneHourMs && !sentTypes.has('program_missed_1h')) {
      notifications.push({
        type: 'program_missed_1h',
        title: 'Пропущена плановая тренировка',
        body: `Прошёл 1 час после плановой тренировки (${exerciseName}). Вы можете выполнить её сейчас.`,
        link,
      });
      pushes.push({
        title: 'Пропущена тренировка',
        body: `1 час после плановой тренировки (${exerciseName}).`,
        link,
        tag: `program-missed-1h-${session.id}`,
      });
    }

    if (overdueMs >= oneDayMs && !sentTypes.has('program_missed_24h')) {
      notifications.push({
        type: 'program_missed_24h',
        title: 'Тренировка по программе не выполнена',
        body: `Прошли сутки после плановой тренировки (${exerciseName}).`,
        link,
      });
      pushes.push({
        title: 'Тренировка не выполнена',
        body: `Прошли сутки после плановой тренировки (${exerciseName}).`,
        link,
        tag: `program-missed-24h-${session.id}`,
      });
    }

    if (carriedMissDays >= 7 && carriedMissDays < 14 && !sentTypes.has('program_stop_warning')) {
      notifications.push({
        type: 'program_stop_warning',
        title: 'Программа будет прервана через неделю',
        body: 'Если пропуск плановой тренировки превысит 2 недели, программа автоматически прервётся.',
        link,
      });
      pushes.push({
        title: 'Риск прерывания программы',
        body: 'Ещё неделя пропуска и программа будет автоматически прервана.',
        link,
        tag: `program-stop-warning-${session.id}`,
      });
    }

    if (notifications.length) {
      await prisma.notification.createMany({
        data: notifications.map((n) => ({
          userId,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
        })),
      });
    }

    for (const p of pushes) {
      await sendWebPushToUsers(
        [userId],
        {
          title: p.title,
          body: p.body,
          link: p.link,
          tag: p.tag,
        },
        'program_reminder',
      ).catch(() => {});
    }
  }
}

/**
 * «Скоро тренировка» for sessions in the window −15…+30 min around `now`.
 * Not called on page load — the scheduler (T07) runs it.
 */
export async function sendProgramRemindersForUser(userId: string, now: Date) {
  const windowEnd = new Date(now.getTime() + 30 * 60 * 1000);
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

  const due = await prisma.trainingSession.findMany({
    where: {
      completed: false,
      reminderSentAt: null,
      scheduledAt: { gte: windowStart, lte: windowEnd },
      program: {
        userId,
        isActive: true,
        needsRetest: false,
      },
    },
    orderBy: { scheduledAt: 'asc' },
    select: {
      id: true,
      scheduledAt: true,
      program: { select: { exerciseType: true } },
    },
  });

  if (!due.length) return 0;

  const first = due[0];
  const text = due.length === 1
    ? `Через ${Math.max(0, Math.round((first.scheduledAt.getTime() - now.getTime()) / 60000))} мин: тренировка ${first.program.exerciseType}`
    : `У вас ${due.length} тренировок по программе в ближайшее время`;

  await prisma.notification.createMany({
    data: due.map((s) => ({
      userId,
      type: 'program_reminder',
      title: 'Напоминание о тренировке',
      body: 'Пора выполнить запланированную тренировку по программе',
      link: `/program/session/${s.id}`,
    })),
  }).catch(() => {});

  await sendWebPushToUsers(
    [userId],
    {
      title: 'Напоминание о тренировке',
      body: text,
      link: `/program/session/${first.id}`,
      tag: 'program-reminder',
    },
    'program_reminder',
  ).catch(() => {});

  await prisma.trainingSession.updateMany({
    where: { id: { in: due.map((x) => x.id) } },
    data: { reminderSentAt: now },
  });

  return due.length;
}

function calcPerformanceFactor(args: {
  sessions: Array<{ sets: Array<{ targetReps: number; actualReps: number | null }> }>;
  externalRatios: number[];
}): number {
  const ratios: number[] = [];

  args.sessions.forEach((s) => {
    s.sets.forEach((st) => {
      if (!st.actualReps || !st.targetReps) return;
      ratios.push(st.actualReps / st.targetReps);
    });
  });

  ratios.push(...args.externalRatios.filter((x) => Number.isFinite(x) && x > 0));

  if (!ratios.length) return 1;
  const avg = ratios.reduce((sum, x) => sum + x, 0) / ratios.length;
  return Math.max(0.6, Math.min(1.15, avg));
}

async function getExternalPerformanceRatios(
  program: {
    userId: string;
    exerciseType: string;
    sessions: Array<{ scheduledAt: Date; completed: boolean; sets: Array<{ targetReps: number }> }>;
  },
  clock: ProgramClock,
) {
  const today = programDayOf(clock.now, clock.timeZone);
  const candidates = program.sessions
    .filter((s) => !s.completed)
    .map((s) => ({ session: s, day: programDayOf(s.scheduledAt, clock.timeZone) }))
    .filter((x) => diffDays(x.day, today) < 0)
    .sort((a, b) => diffDays(a.day, b.day));
  if (!candidates.length) return [] as number[];

  const workouts = await prisma.workout.findMany({
    where: {
      userId: program.userId,
      exerciseType: program.exerciseType,
      trainingSessionId: null,
      date: { gte: dayKeyToDbDate(candidates[0].day), lte: dayKeyToDbDate(today) },
    },
    select: { date: true, reps: true },
  });

  const dayTotals = sumRepsByDay(workouts);

  const ratios: number[] = [];
  candidates.forEach(({ session, day }) => {
    const planned = session.sets.reduce((sum, st) => sum + (st.targetReps || 0), 0);
    if (planned <= 0) return;
    const actual = dayTotals.get(day) ?? 0;
    if (actual <= 0) return;
    ratios.push(Math.max(0.5, Math.min(1.15, actual / planned)));
  });

  return ratios;
}

export async function recalculateUpcomingSessions(programId: string, now: Date = new Date()) {
  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    include: {
      user: { select: { timeZone: true } },
      sessions: {
        orderBy: [{ weekNumber: 'asc' }, { sessionNumber: 'asc' }],
        include: {
          sets: {
            orderBy: { setNumber: 'asc' },
            select: { id: true, setNumber: true, targetReps: true, actualReps: true, isKeySet: true },
          },
        },
      },
    },
  });

  if (!program) return;

  const clock: ProgramClock = { now, timeZone: normalizeTimeZone(program.user?.timeZone) };
  const targetReps = program.targetReps || program.baselineMaxReps;
  const completedSessions = program.sessions.filter((s) => s.completed);
  const externalRatios = await getExternalPerformanceRatios(program, clock);

  // Sessions before the first final test follow the original progression; sessions of
  // an extension (after a failed test) keep the targets they were planned with.
  const firstFinalTestNumber = Math.min(
    ...program.sessions.filter((s) => s.isFinalTest).map((s) => s.sessionNumber),
  );
  const trainingSessions = program.sessions
    .filter((s) => !s.isFinalTest && s.sessionNumber < firstFinalTestNumber)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const trainingOrder = new Map(trainingSessions.map((s, idx) => [s.id, idx + 1]));
  const totalTrainingSessions = Math.max(1, trainingSessions.length);

  const performanceFactor = calcPerformanceFactor({
    sessions: completedSessions,
    externalRatios,
  });

  const future = program.sessions.filter((s) => !s.completed);
  const outcome = evaluateProgramOutcome(program.sessions, targetReps);

  try {
    await prisma.$transaction(async (tx) => {
      for (const s of future) {
        const order = trainingOrder.get(s.id);
        if (!s.isFinalTest && order == null) continue;
        for (const st of s.sets) {
          const nextTarget = s.isFinalTest
            ? targetReps
            : computeSetTarget({
                baselineMaxReps: program.baselineMaxReps,
                weekNumber: s.weekNumber,
                sessionNumber: order ?? s.sessionNumber,
                totalSessions: totalTrainingSessions,
                setNumber: st.setNumber,
                targetReps,
                performanceFactor,
              });

          if (nextTarget !== st.targetReps) {
            await tx.trainingSet.update({
              where: { id: st.id },
              data: { targetReps: nextTarget },
            });
          }
        }
      }

      if (outcome.kind === 'completed') {
        await tx.trainingProgram.update({
          where: { id: program.id },
          data: {
            lastRecalculatedAt: now,
            status: 'completed',
            isActive: false,
          },
        });
        return;
      }

      if (outcome.kind === 'extend') {
        const extension = planProgramExtension({
          targetReps,
          finalTestActual: outcome.finalTestActual,
          frequencyPerWeek: program.frequencyPerWeek,
          startDay: dbDateToDayKey(program.startDate),
          lastTestDay: programDayOf(outcome.finalTest.completedAt ?? outcome.finalTest.scheduledAt, clock.timeZone),
          existingDays: program.sessions.map((s) => programDayOf(s.scheduledAt, clock.timeZone)),
          nextSessionNumber: Math.max(...program.sessions.map((x) => x.sessionNumber)) + 1,
          clock,
        });

        for (const s of extension) {
          await tx.trainingSession.create({
            data: {
              programId: program.id,
              weekNumber: s.weekNumber,
              sessionNumber: s.sessionNumber,
              scheduledAt: s.scheduledAt,
              isFinalTest: s.isFinalTest,
              sets: { create: s.sets },
            },
          });
        }

        await tx.trainingProgram.update({
          where: { id: program.id },
          data: {
            lastRecalculatedAt: now,
            status: 'active',
            isActive: true,
          },
        });
        return;
      }

      await tx.trainingProgram.update({
        where: { id: program.id },
        data: {
          lastRecalculatedAt: now,
        },
      });
    });
  } catch (e) {
    // A concurrent recalculation already created this extension ((programId, sessionNumber) is unique).
    if (!isUniqueViolation(e)) throw e;
  }
}

export async function getProgramById(userId: string, programId: string) {
  return getProgramByWhere({ id: programId, userId });
}

export async function getManagedProgramById(userId: string, programId: string, groupId: string) {
  return getProgramByWhere({ id: programId, userId, managedByGroupId: groupId });
}

export async function getProgramOverview(userId: string) {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthDate: true, weightKg: true, gender: true },
  });

  const profileHints: ProgramProfileHints = {
    ageYears: deriveAgeFromBirthDate(me?.birthDate ?? null),
    weightKg: me?.weightKg ?? null,
    sex: me?.gender ?? null,
  };

  const activeRows = await prisma.trainingProgram.findMany({
    where: { userId, isActive: true },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true },
  });

  // Reminders and «missed» notifications are sent by the scheduler, not on page load.
  const now = new Date();
  for (const row of activeRows) {
    const sync = await syncProgramSchedule(row.id, now);
    if (sync.needsRetest) continue;
    await recalculateUpcomingSessions(row.id, now).catch(() => {});
  }

  const activePrograms = (await Promise.all(activeRows.map((x) => getProgramById(userId, x.id))))
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.isActive));

  const historyRows = await prisma.trainingProgram.findMany({
    where: {
      userId,
      OR: [{ isActive: false }, { status: 'completed' }, { status: 'inactive' }],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      exerciseType: true,
      goalType: true,
      status: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      startDate: true,
      durationWeeks: true,
      frequencyPerWeek: true,
      baselineMaxReps: true,
      targetReps: true,
      sessions: {
        select: { id: true, completed: true, completedAt: true },
      },
    },
  });

  const history = historyRows.map((h) => {
    const total = h.sessions.length;
    const completed = h.sessions.filter((s) => s.completed).length;
    const completedAtList = h.sessions
      .map((s) => s.completedAt)
      .filter((d): d is Date => Boolean(d));
    const allCompleted = total > 0 && completed === total;
    const latestCompletedAt = completedAtList.length
      ? new Date(Math.max(...completedAtList.map((d) => d.getTime())))
      : null;
    const finishedAt = allCompleted
      ? latestCompletedAt
      : (!h.isActive || h.status === 'completed' || h.status === 'inactive'
        ? (latestCompletedAt ?? h.updatedAt)
        : null);

    return {
      id: h.id,
      exerciseType: h.exerciseType,
      goalType: h.goalType,
      status: h.status,
      createdAt: h.createdAt,
      startedAt: h.startDate ?? h.createdAt,
      finishedAt,
      durationWeeks: h.durationWeeks,
      frequencyPerWeek: h.frequencyPerWeek,
      baselineMaxReps: h.baselineMaxReps,
      targetReps: h.targetReps,
      totalSessions: total,
      completedSessions: completed,
      completionPercent: total ? Math.round((completed / total) * 100) : 0,
    };
  });

  return {
    profileHints,
    activePrograms,
    history,
  };
}

export async function getManagedProgramOverview(userId: string, groupId: string) {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthDate: true, weightKg: true, gender: true },
  });

  const profileHints: ProgramProfileHints = {
    ageYears: deriveAgeFromBirthDate(me?.birthDate ?? null),
    weightKg: me?.weightKg ?? null,
    sex: me?.gender ?? null,
  };

  const activeRows = await prisma.trainingProgram.findMany({
    where: { userId, isActive: true, managedByGroupId: groupId },
    orderBy: [{ createdAt: 'desc' }],
    select: { id: true },
  });

  const activePrograms = (await Promise.all(activeRows.map((x) => getManagedProgramById(userId, x.id, groupId))))
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.isActive));

  const historyRows = await prisma.trainingProgram.findMany({
    where: {
      userId,
      managedByGroupId: groupId,
      OR: [{ isActive: false }, { status: 'completed' }, { status: 'inactive' }],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      exerciseType: true,
      goalType: true,
      status: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      startDate: true,
      durationWeeks: true,
      frequencyPerWeek: true,
      baselineMaxReps: true,
      targetReps: true,
      sessions: {
        select: { id: true, completed: true, completedAt: true },
      },
    },
  });

  const history = historyRows.map((h) => {
    const total = h.sessions.length;
    const completed = h.sessions.filter((s) => s.completed).length;
    const completedAtList = h.sessions
      .map((s) => s.completedAt)
      .filter((d): d is Date => Boolean(d));
    const allCompleted = total > 0 && completed === total;
    const latestCompletedAt = completedAtList.length
      ? new Date(Math.max(...completedAtList.map((d) => d.getTime())))
      : null;
    const finishedAt = (allCompleted ? (latestCompletedAt ?? h.updatedAt) : null);

    return {
      id: h.id,
      exerciseType: h.exerciseType,
      goalType: h.goalType,
      status: h.status,
      createdAt: h.createdAt,
      startedAt: h.startDate ?? h.createdAt,
      finishedAt,
      durationWeeks: h.durationWeeks,
      frequencyPerWeek: h.frequencyPerWeek,
      baselineMaxReps: h.baselineMaxReps,
      targetReps: h.targetReps,
      totalSessions: total,
      completedSessions: completed,
      completionPercent: total ? Math.round((completed / total) * 100) : 0,
    };
  });

  return {
    profileHints,
    activePrograms,
    history,
  };
}

function assertProgramUsable(program: { isActive: boolean; needsRetest: boolean }) {
  if (!program.isActive) {
    if (program.needsRetest) throw new ProgramError(PROGRAM_INTERRUPTED_MESSAGE, 409, 'PROGRAM_INTERRUPTED');
    throw new ProgramError('Программа не активна', 400);
  }
  if (program.needsRetest) throw new ProgramError(RETEST_REQUIRED_MESSAGE, 409, 'RETEST_REQUIRED');
}

export async function startTrainingSession(
  userId: string,
  sessionId: string,
  options?: { forceStartEarly?: boolean },
) {
  const initial = await prisma.trainingSession.findFirst({
    where: { id: sessionId, program: { userId } },
    select: { id: true, programId: true },
  });

  if (!initial) throw new ProgramError('Сессия не найдена', 404);

  const now = new Date();
  const sync = await syncProgramSchedule(initial.programId, now);
  if (!sync.needsRetest) {
    await recalculateUpcomingSessions(initial.programId, now).catch(() => {});
  }

  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, program: { userId } },
    include: {
      program: {
        select: {
          id: true,
          needsRetest: true,
          isActive: true,
          user: { select: { timeZone: true } },
        },
      },
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  if (!session) throw new ProgramError('Сессия не найдена', 404);
  if (!session.completed) assertProgramUsable(session.program);

  const timeZone = normalizeTimeZone(session.program.user?.timeZone);
  const daysAhead = diffDays(programDayOf(session.scheduledAt, timeZone), programDayOf(now, timeZone));
  if (!session.completed && !session.startedAt && daysAhead > 0 && !options?.forceStartEarly) {
    throw new ProgramError(
      'Период отдыха ещё не завершён. Эту тренировку можно выполнить позже по расписанию.',
      409,
      'REST_PERIOD_NOT_FINISHED',
    );
  }

  if (!session.startedAt && !session.completed) {
    await prisma.trainingSession.updateMany({ where: { id: session.id, startedAt: null }, data: { startedAt: now } });
  }

  return getProgramById(userId, session.program.id);
}

/**
 * Records one set. Idempotent: a set that is already recorded answers with the stored
 * value, and only the request that actually fills the set creates its `Workout`.
 */
export async function submitTrainingSet(args: {
  userId: string;
  sessionId: string;
  setId: string;
  actualReps: number;
}) {
  const actualReps = Math.min(5000, Math.max(1, Math.round(args.actualReps)));

  const row = await prisma.trainingSet.findFirst({
    where: {
      id: args.setId,
      sessionId: args.sessionId,
      session: {
        program: { userId: args.userId },
      },
    },
    select: {
      id: true,
      setNumber: true,
      actualReps: true,
      completedAt: true,
      session: {
        select: {
          completed: true,
          scheduledAt: true,
          startedAt: true,
          program: {
            select: {
              needsRetest: true,
              isActive: true,
              exerciseType: true,
              user: { select: { timeZone: true } },
            },
          },
        },
      },
    },
  });

  if (!row) throw new ProgramError('Подход не найден', 404);

  const recordedSet = (set: { id: string; setNumber: number; actualReps: number | null; completedAt: Date | null }) => ({
    ok: true as const,
    set: { id: set.id, setNumber: set.setNumber, actualReps: set.actualReps, completedAt: set.completedAt },
  });

  if (row.actualReps != null) return recordedSet(row);

  assertProgramUsable(row.session.program);
  if (row.session.completed) throw new ProgramError('Сессия уже завершена', 400);

  const now = new Date();
  const clock: ProgramClock = { now, timeZone: normalizeTimeZone(row.session.program.user?.timeZone) };
  if (!isSessionOpenForSets(row.session, clock)) {
    throw new ProgramError(
      'Эта тренировка ещё не наступила. Откройте её из расписания, чтобы начать.',
      409,
      'SESSION_NOT_STARTED',
    );
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.trainingSet.updateMany({
      where: { id: row.id, actualReps: null },
      data: { actualReps, completedAt: now },
    });
    if (claimed.count !== 1) return;

    await tx.workout.create({
      data: {
        userId: args.userId,
        reps: actualReps,
        date: programWorkoutDate(now, clock.timeZone),
        time: programSetWorkoutTime(now, row.setNumber),
        exerciseType: row.session.program.exerciseType,
        trainingSessionId: args.sessionId,
      },
    });
  });

  const stored = await prisma.trainingSet.findUnique({
    where: { id: row.id },
    select: { id: true, setNumber: true, actualReps: true, completedAt: true },
  });
  return recordedSet(stored ?? { ...row, actualReps, completedAt: now });
}

/**
 * Completes a session. Idempotent and race-safe: the `completed: false → true` flip is the
 * first write, so a repeated or parallel request neither duplicates workouts nor shifts
 * the schedule twice.
 */
export async function completeTrainingSession(userId: string, sessionId: string) {
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.trainingSession.findFirst({
      where: { id: sessionId, program: { userId } },
      include: {
        program: {
          select: {
            id: true,
            userId: true,
            exerciseType: true,
            needsRetest: true,
            isActive: true,
            user: { select: { timeZone: true } },
          },
        },
        sets: { orderBy: { setNumber: 'asc' } },
      },
    });

    if (!session) throw new ProgramError('Сессия не найдена', 404);
    if (session.completed) return { programId: session.program.id, changed: false };
    assertProgramUsable(session.program);

    const missing = session.sets.filter((s) => s.actualReps == null);
    if (missing.length) {
      throw new ProgramError(`Заполните все подходы перед завершением (осталось: ${missing.length})`, 400);
    }

    const claimed = await tx.trainingSession.updateMany({
      where: { id: session.id, completed: false },
      data: {
        completed: true,
        completedAt: now,
        startedAt: session.startedAt || now,
      },
    });
    if (claimed.count !== 1) return { programId: session.program.id, changed: false };

    const timeZone = normalizeTimeZone(session.program.user?.timeZone);

    const workouts = await tx.workout.findMany({
      where: { trainingSessionId: session.id },
      select: { time: true, reps: true },
    });
    const missingSets = setsMissingWorkouts(session.sets, workouts);
    if (missingSets.length) {
      await tx.workout.createMany({
        data: missingSets.map((s) => {
          const doneAt = s.completedAt ?? now;
          return {
            userId: session.program.userId,
            reps: s.actualReps || 0,
            date: programWorkoutDate(doneAt, timeZone),
            time: programSetWorkoutTime(doneAt, s.setNumber),
            exerciseType: session.program.exerciseType,
            trainingSessionId: session.id,
          };
        }),
      });
    }

    const earlyDays = diffDays(programDayOf(session.scheduledAt, timeZone), programDayOf(now, timeZone));
    if (earlyDays > 0) {
      const pendingFuture = await tx.trainingSession.findMany({
        where: {
          programId: session.program.id,
          completed: false,
          scheduledAt: { gt: session.scheduledAt },
        },
        select: { id: true, scheduledAt: true },
      });

      for (const row of pendingFuture) {
        await tx.trainingSession.update({
          where: { id: row.id },
          data: { scheduledAt: shiftInstantByDays(row.scheduledAt, -earlyDays, timeZone) },
        });
      }
    }

    return { programId: session.program.id, changed: true };
  });

  if (result.changed) await recalculateUpcomingSessions(result.programId, now);

  return getProgramById(userId, result.programId);
}
