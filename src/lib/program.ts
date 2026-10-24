import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { notifyUsers, programStoppedMessage } from '@/lib/notify';
import { WorkoutCreateError, createWorkoutForUser, type WorkoutCreateResult } from '@/lib/workout-create';
import { addDays, dayKeyToDbDate, dbDateToDayKey, diffDays, normalizeTimeZone, type DayKey } from '@/lib/calendar-day';
import { programKind } from '@/lib/exercises';
import { ENERGY_BODY_SELECT, toBodyMetrics } from '@/lib/workout-energy';
import { planCircuitSession } from '@/lib/circuits';
import {
  buildCircuitProgramDraft,
  type CircuitProgramCreateInput,
  type ProgramDraftSession,
  type SetResult,
  ProgramError,
  autofilledDays,
  buildProgramDraft,
  canAutofillProgram,
  nextKettlebellLoad,
  planDistanceExtension,
  resolveSetResult,
  restoredSetWorkoutRows,
  type SetResultInput,
  recordClaimedSet,
  computeSetTarget,
  evaluateProgramOutcome,
  isSessionOpenForSets,
  planOverdueAutofill,
  planProgramExtension,
  programDayOf,
  programReplacementWhere,
  programSetWorkoutInput,
  setsMissingWorkouts,
  shiftInstantByDays,
  type ProgramClock,
  type ProgramCreateInput,
  type ProgramProfileHints,
} from '@/lib/program-plan';

export {
  ProgramError,
  isCircuitProgramBody,
  isProgramExerciseType,
  parseCircuitProgramCreateBody,
  parseProgramCreateBody,
  programLabel,
  suggestDurationWeeks,
  suggestFrequencyPerWeek,
} from '@/lib/program-plan';
export type {
  CircuitProgramCreateInput,
  ProgramCreateInput,
  ProgramExerciseType,
  ProgramGoalType,
  ProgramProfileHints,
} from '@/lib/program-plan';

const PROGRAM_INTERRUPTED_MESSAGE =
  'Программа была прервана из-за длительного пропуска. Создайте новую программу, когда будете готовы продолжить.';
const RETEST_REQUIRED_MESSAGE = 'Пропуск более двух недель. Пройдите повторный тест и перегенерируйте программу.';

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

  // У круговой нет одной базы повторов (0): «тяжёлый день» по сумме подходов не определить.
  const hardDayThreshold = args.baselineMaxReps * 3;
  const heavySessions = hardDayThreshold <= 0 ? [] : args.completedSessions
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
  const today = programDayOf(clock.now, clock.timeZone);
  const head = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    select: {
      userId: true,
      exerciseType: true,
      programType: true,
      loadKg: true,
      sessions: { where: { completed: false, isFinalTest: false }, select: { scheduledAt: true } },
    },
  });
  if (!head) return;
  // Гиревые, дистанционные, «на сторону» и круговые пропущенные занятия сдвигаются (R08.10).
  if (!canAutofillProgram(head)) return;
  if (!head.sessions.some((s) => diffDays(programDayOf(s.scheduledAt, clock.timeZone), today) < 0)) return;

  await prisma.$transaction(async (tx) => {
    // One user + exercise at a time: two programs (D02) must not both read a day as free and
    // close a session each from the same ordinary workout.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`program-autofill:${head.userId}:${head.exerciseType}`}))`;

    const sessions = await tx.trainingSession.findMany({
      where: { programId, completed: false, isFinalTest: false },
      orderBy: { scheduledAt: 'asc' },
      include: { sets: { orderBy: { setNumber: 'asc' } } },
    });
    const overdueDays = sessions
      .map((s) => programDayOf(s.scheduledAt, clock.timeZone))
      .filter((day) => diffDays(day, today) < 0);
    if (!overdueDays.length) return;

    const workouts = await tx.workout.findMany({
      where: {
        userId: head.userId,
        exerciseType: head.exerciseType,
        date: { gte: dayKeyToDbDate(overdueDays[0]), lte: dayKeyToDbDate(overdueDays[overdueDays.length - 1]) },
        trainingSessionId: null,
      },
      select: { date: true, reps: true },
    });

    // Sessions of every program of this user on this exercise already closed by autofill (D02: a
    // personal and a group program may both be active) — one ordinary workout closes one session.
    const closedSessions = await tx.trainingSession.findMany({
      where: {
        completed: true,
        program: { userId: head.userId, exerciseType: head.exerciseType },
        scheduledAt: {
          gte: dayKeyToDbDate(addDays(overdueDays[0], -1)),
          lt: dayKeyToDbDate(addDays(overdueDays[overdueDays.length - 1], 2)),
        },
      },
      select: { scheduledAt: true, completed: true, completedAt: true },
    });

    const plan = planOverdueAutofill({
      sessions,
      dayTotals: sumRepsByDay(workouts),
      clock,
      consumedDays: autofilledDays(closedSessions, clock.timeZone),
    });
    const byId = new Map(sessions.map((s) => [s.id, s]));

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
    // Гиревая программа пройдена: следующий вес гири из пресетов (R08.5).
    nextLoadKg: program.status === 'completed' ? nextKettlebellLoad(program.exerciseType, program.loadKg) : null,
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

type DraftSet = ProgramDraftSession['sets'][number];

/** Строка подхода из черновика: вес гири, у круговой — упражнение, круг и станция. */
function setCreateData(st: DraftSet) {
  return {
    setNumber: st.setNumber,
    targetReps: st.targetReps,
    restSeconds: st.restSeconds,
    isKeySet: st.isKeySet,
    loadKg: st.loadKg ?? null,
    exerciseType: st.exerciseType ?? null,
    round: st.round ?? null,
    station: st.station ?? null,
  };
}

/** Занятие из черновика со всеми подходами (вид дистанции, день ротации и шаблон круга). */
function sessionCreateData(programId: string, s: ProgramDraftSession): Prisma.TrainingSessionUncheckedCreateInput {
  return {
    programId,
    weekNumber: s.weekNumber,
    sessionNumber: s.sessionNumber,
    scheduledAt: s.scheduledAt,
    isFinalTest: s.isFinalTest,
    sessionKind: s.sessionKind ?? null,
    dayLabel: s.dayLabel ?? null,
    circuitTemplateId: s.circuitTemplateId ?? null,
    sets: { create: s.sets.map(setCreateData) },
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
  const created = await prisma.$transaction(async (tx) => {
    // A group assignment never switches off the member's personal program (and vice versa).
    await tx.trainingProgram.updateMany({
      where: programReplacementWhere(userId, draft.clean.exerciseType, options?.managedByGroupId),
      data: { isActive: false, status: 'inactive' },
    });

    const program = await tx.trainingProgram.create({
      data: {
        userId,
        exerciseType: draft.clean.exerciseType,
        programType: 'single',
        loadKg: draft.clean.loadKg,
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
      await tx.trainingSession.create({ data: sessionCreateData(program.id, s) });
    }

    return program;
  });

  return getProgramById(userId, created.id);
}

/**
 * Круговая программа-ротация (личная или назначенная владельцем группы): тест-круг дня A, затем
 * занятия по дням ротации. Заменяет прежнюю активную круговую программу того же владельца
 * (личную — личная, групповую — группа), как и однокомпонентная.
 */
export async function createCircuitTrainingProgram(
  userId: string,
  input: CircuitProgramCreateInput,
  options?: {
    managedByGroupId?: string | null;
    assignedByUserId?: string | null;
  },
) {
  const timeZone = await getUserTimeZone(userId);
  const draft = buildCircuitProgramDraft(input, { now: new Date(), timeZone });
  const created = await prisma.$transaction(async (tx) => {
    await tx.trainingProgram.updateMany({
      where: programReplacementWhere(userId, draft.clean.exerciseType, options?.managedByGroupId),
      data: { isActive: false, status: 'inactive' },
    });

    const program = await tx.trainingProgram.create({
      data: {
        userId,
        exerciseType: draft.clean.exerciseType,
        programType: draft.clean.programType,
        circuitPlanId: draft.clean.circuitPlanId,
        loadKg: null,
        goalType: 'circuit_plan',
        targetReps: null,
        durationWeeks: draft.clean.durationWeeks,
        frequencyPerWeek: draft.clean.frequencyPerWeek,
        baselineMaxReps: 0,
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
      await tx.trainingSession.create({ data: sessionCreateData(program.id, s) });
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
      programType: true,
      loadKg: true,
      circuitPlanId: true,
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
    await prisma.trainingProgram.update({
      where: { id: program.id },
      data: {
        needsRetest: true,
        isActive: false,
        status: 'inactive',
      },
    });

    await notifyUsers(
      [program.userId],
      'program_reminder',
      (locale) => programStoppedMessage(locale, {
        programId: program.id,
        exerciseType: program.exerciseType,
        programType: program.programType,
        loadKg: program.loadKg,
        circuitPlanId: program.circuitPlanId,
      }),
      { type: 'program_stopped', tag: `program-stopped-${program.id}`, dedupeKey: () => `program-stopped:${program.id}` },
    );

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
    programType: string;
    loadKg: number | null;
    sessions: Array<{ scheduledAt: Date; completed: boolean; sets: Array<{ targetReps: number }> }>;
  },
  clock: ProgramClock,
) {
  // Обычные тренировки дня сравнимы с планом только там, где ими можно закрыть занятие.
  if (!canAutofillProgram(program)) return [] as number[];
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

type CircuitSetRow = {
  setNumber: number;
  targetReps: number;
  restSeconds: number;
  exerciseType: string | null;
  loadKg: number | null;
  round: number | null;
  station: number | null;
};

function sameCircuitSets(current: CircuitSetRow[], planned: NonNullable<ReturnType<typeof planCircuitSession>>): boolean {
  if (current.length !== planned.length) return false;
  return planned.every((p, i) => {
    const c = current[i];
    return c.setNumber === p.setNumber && c.targetReps === p.targetReps && c.restSeconds === p.restSeconds
      && c.exerciseType === p.exerciseType && (c.loadKg ?? null) === p.loadKg && c.round === p.round && c.station === p.station;
  });
}

/**
 * Круговая программа: после тест-круга цели всех ещё не начатых занятий строятся от его
 * результатов (старт 70%, рост ~10% в неделю, при потолке — плюс круг; `planCircuitSession`).
 * Занятие, в котором уже записан подход, не трогается. Все занятия пройдены — программа завершена.
 */
async function recalculateCircuitProgram(programId: string, now: Date) {
  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    select: {
      id: true,
      sessions: {
        orderBy: { sessionNumber: 'asc' },
        select: {
          id: true,
          weekNumber: true,
          sessionKind: true,
          circuitTemplateId: true,
          completed: true,
          sets: {
            orderBy: { setNumber: 'asc' },
            select: {
              setNumber: true,
              targetReps: true,
              actualReps: true,
              restSeconds: true,
              exerciseType: true,
              loadKg: true,
              round: true,
              station: true,
            },
          },
        },
      },
    },
  });
  if (!program) return;

  const test = program.sessions.find((s) => s.sessionKind === 'test');
  const results = test?.completed
    ? test.sets.map((st) => ({ exerciseType: st.exerciseType ?? '', target: st.targetReps, actual: st.actualReps }))
    : null;
  const allDone = program.sessions.length > 0 && program.sessions.every((s) => s.completed);

  try {
    await prisma.$transaction(async (tx) => {
      for (const s of program.sessions) {
        if (s.completed || s.sessionKind === 'test' || s.sets.some((st) => st.actualReps != null)) continue;
        const planned = planCircuitSession(s.circuitTemplateId, s.weekNumber, results);
        if (!planned || sameCircuitSets(s.sets, planned)) continue;
        // Подход, записанный параллельно, не удалится, и вставка упрётся в уникальность — откат.
        await tx.trainingSet.deleteMany({ where: { sessionId: s.id, actualReps: null } });
        await tx.trainingSet.createMany({ data: planned.map((st) => ({ sessionId: s.id, ...st })) });
      }
      await tx.trainingProgram.update({
        where: { id: program.id },
        data: allDone
          ? { lastRecalculatedAt: now, status: 'completed', isActive: false }
          : { lastRecalculatedAt: now },
      });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
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
  if (program.programType === 'circuit') {
    await recalculateCircuitProgram(program.id, now);
    return;
  }

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
  // Дистанция идёт по своему плану «+10% в неделю»: цели подходов не пересчитываются.
  const isDistance = programKind(program.exerciseType) === 'distance';

  try {
    await prisma.$transaction(async (tx) => {
      for (const s of isDistance ? [] : future) {
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
        const extensionArgs = {
          finalTestActual: outcome.finalTestActual,
          frequencyPerWeek: program.frequencyPerWeek,
          startDay: dbDateToDayKey(program.startDate),
          lastTestDay: programDayOf(outcome.finalTest.completedAt ?? outcome.finalTest.scheduledAt, clock.timeZone),
          nextSessionNumber: Math.max(...program.sessions.map((x) => x.sessionNumber)) + 1,
          clock,
        };
        const extension = isDistance
          ? planDistanceExtension({ ...extensionArgs, targetMeters: targetReps })
          : planProgramExtension({
            ...extensionArgs,
            targetReps,
            existingDays: program.sessions.map((s) => programDayOf(s.scheduledAt, clock.timeZone)),
            loadKg: program.loadKg,
          });

        for (const s of extension) {
          await tx.trainingSession.create({ data: sessionCreateData(program.id, s) });
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
      programType: true,
      loadKg: true,
      circuitPlanId: true,
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
      programType: h.programType,
      loadKg: h.loadKg,
      circuitPlanId: h.circuitPlanId,
      nextLoadKg: h.status === 'completed' ? nextKettlebellLoad(h.exerciseType, h.loadKg) : null,
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
      programType: true,
      loadKg: true,
      circuitPlanId: true,
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
      programType: h.programType,
      loadKg: h.loadKg,
      circuitPlanId: h.circuitPlanId,
      nextLoadKg: h.status === 'completed' ? nextKettlebellLoad(h.exerciseType, h.loadKg) : null,
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

type ProgramSetOwner = { id: string; username: string; timeZone: string };

type RecordedSetFields = {
  id: string;
  setNumber: number;
  actualReps: number | null;
  actualLeft: number | null;
  actualRight: number | null;
  actualSeconds: number | null;
  loadKg: number | null;
  completedAt: Date | null;
};

const RECORDED_SET_SELECT = {
  id: true,
  setNumber: true,
  actualReps: true,
  actualLeft: true,
  actualRight: true,
  actualSeconds: true,
  loadKg: true,
  completedAt: true,
} as const;

/**
 * The workout of a recorded set, through the common creation path (records, badges, the daily
 * limit, notifications to friends, active calories — as for any workout). Idempotent by the set's
 * own key. A kettlebell set carries its weight, a one-side set both sides, a distance set its time.
 */
async function recordProgramSetWorkout(
  owner: ProgramSetOwner,
  set: { id: string; setNumber: number; doneAt: Date; loadKg: number | null } & SetResult,
  session: { id: string; exerciseType: string },
  now: Date,
): Promise<WorkoutCreateResult> {
  const input = programSetWorkoutInput({
    setId: set.id,
    setNumber: set.setNumber,
    exerciseType: session.exerciseType,
    actualReps: set.actualReps,
    actualLeft: set.actualLeft,
    actualRight: set.actualRight,
    actualSeconds: set.actualSeconds,
    loadKg: set.loadKg,
    doneAt: set.doneAt,
    timeZone: owner.timeZone,
  });
  try {
    return await createWorkoutForUser(owner, input, { source: 'program', trainingSessionId: session.id, now });
  } catch (e) {
    if (e instanceof WorkoutCreateError) throw new ProgramError(e.message, e.status, e.code);
    throw e;
  }
}

/**
 * Records one set: `actualReps` (повторы/секунды/метры), for a one-side exercise `actualLeft` /
 * `actualRight`, for a distance optional `actualSeconds`. Idempotent: a set that is already recorded
 * answers with the stored value; the set's workout has its own idempotency key
 * (`programSetClientRequestId`), so a repeated or parallel request never creates a second one.
 */
export async function submitTrainingSet(args: {
  userId: string;
  sessionId: string;
  setId: string;
} & SetResultInput) {
  const row = await prisma.trainingSet.findFirst({
    where: {
      id: args.setId,
      sessionId: args.sessionId,
      session: {
        program: { userId: args.userId },
      },
    },
    select: {
      ...RECORDED_SET_SELECT,
      exerciseType: true,
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
              loadKg: true,
              user: { select: { username: true, timeZone: true } },
            },
          },
        },
      },
    },
  });

  if (!row) throw new ProgramError('Подход не найден', 404);

  const recordedSet = (set: RecordedSetFields) => ({
    ok: true as const,
    set: {
      id: set.id,
      setNumber: set.setNumber,
      actualReps: set.actualReps,
      actualLeft: set.actualLeft,
      actualRight: set.actualRight,
      actualSeconds: set.actualSeconds,
      loadKg: set.loadKg,
      completedAt: set.completedAt,
    },
  });

  if (row.actualReps != null) return recordedSet(row);

  const exerciseType = row.exerciseType || row.session.program.exerciseType;
  const result = resolveSetResult(exerciseType, args);
  const loadKg = row.loadKg ?? row.session.program.loadKg ?? null;

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

  // The set is claimed first; only the request that filled it creates the workout. Over the
  // daily limit (or on any failure) the set is emptied again, so nothing is recorded.
  const created = await recordClaimedSet({
    claim: async () =>
      (await prisma.trainingSet.updateMany({
        where: { id: row.id, actualReps: null },
        data: { ...result, completedAt: now },
      })).count === 1,
    create: () =>
      recordProgramSetWorkout(
        { id: args.userId, username: row.session.program.user?.username ?? '', timeZone: clock.timeZone },
        { id: row.id, setNumber: row.setNumber, doneAt: now, loadKg, ...result },
        { id: args.sessionId, exerciseType },
        now,
      ),
    release: async () => {
      await prisma.trainingSet
        .updateMany({
          where: { id: row.id, actualReps: result.actualReps, completedAt: now },
          data: { actualReps: null, actualLeft: null, actualRight: null, actualSeconds: null, completedAt: null },
        })
        .catch((e) => console.error('PROGRAM SET RELEASE ERROR:', e));
    },
  });

  const stored = await prisma.trainingSet.findUnique({ where: { id: row.id }, select: RECORDED_SET_SELECT });
  return {
    ...recordedSet(stored ?? { ...row, ...result, completedAt: now }),
    records: created?.records ?? [],
    achievements: created?.achievements ?? [],
  };
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
            loadKg: true,
            needsRetest: true,
            isActive: true,
            user: { select: { username: true, timeZone: true, ...ENERGY_BODY_SELECT } },
          },
        },
        sets: { orderBy: { setNumber: 'asc' } },
      },
    });

    if (!session) throw new ProgramError('Сессия не найдена', 404);
    if (session.completed) return { programId: session.program.id, changed: false as const };
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
    if (claimed.count !== 1) return { programId: session.program.id, changed: false as const };

    const timeZone = normalizeTimeZone(session.program.user?.timeZone);

    // Recorded sets without a workout (e.g. it was deleted on the dashboard) get it back in this
    // transaction: a restore, not a new workout — no daily limit, no notifications, never lost.
    const workouts = await tx.workout.findMany({
      where: { trainingSessionId: session.id },
      select: { time: true, reps: true },
    });
    const missingSets = setsMissingWorkouts(session.sets, workouts);
    if (missingSets.length) {
      await tx.workout.createMany({
        // С весом гири, сторонами, временем и активными калориями — как у записанной тренировки.
        data: restoredSetWorkoutRows({
          sets: missingSets,
          program: session.program,
          sessionId: session.id,
          timeZone,
          now,
          body: toBodyMetrics(session.program.user),
        }),
        // A workout of that set that exists under its key but did not match by time/reps stays as is.
        skipDuplicates: true,
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

    return { programId: session.program.id, changed: true as const };
  });

  if (result.changed) await recalculateUpcomingSessions(result.programId, now);

  return getProgramById(userId, result.programId);
}
