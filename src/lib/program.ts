import { prisma } from '@/lib/prisma';
import { sendWebPushToUsers } from '@/lib/web-push';

export type ProgramExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats';
export type ProgramGoalType = 'reach_target';

type GoalTemplate = {
  percentages: number[];
  rest: number[];
  keySet: number;
};

const EXERCISE_COEFFICIENTS: Record<ProgramExerciseType, number> = {
  pushups: 1.0,
  pullups: 0.85,
  crunches: 1.1,
  squats: 1.05,
};

const GOAL_TEMPLATE: GoalTemplate = {
  // Last set is the key (max-like) set.
  percentages: [0.6, 0.72, 0.8, 0.7, 1.0],
  rest: [90, 90, 120, 120, 150],
  keySet: 5,
};

export type ProgramCreateInput = {
  exerciseType: ProgramExerciseType;
  baselineMaxReps: number;
  targetReps: number;
  durationWeeks?: number | null;
  frequencyPerWeek?: number | null;
  ageYears?: number | null;
  weightKg?: number | null;
  sex?: string | null;
  startDate?: string | Date | null;
};

type NormalizedCreateInput = {
  exerciseType: ProgramExerciseType;
  baselineMaxReps: number;
  targetReps: number;
  durationWeeks: number;
  frequencyPerWeek: number;
  ageYears: number;
  weightKg: number;
  sex: string;
  startDate: string | Date | null;
};

export type ProgramProfileHints = {
  ageYears: number | null;
  weightKg: number | null;
  sex: string | null;
};

export class ProgramError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MS_DAY = 24 * 60 * 60 * 1000;

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function withDefaultTime(d: Date): Date {
  const x = new Date(d);
  x.setHours(19, 0, 0, 0);
  return x;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_DAY);
}

function diffDays(a: Date, b: Date): number {
  return Math.floor((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_DAY);
}

function maxConsecutiveDaysForFrequency(freq: number): number {
  if (freq >= 5) return 3;
  return 2;
}

function normalizeScheduledTrainingDate(args: {
  candidate: Date;
  previousDates: Date[];
  frequencyPerWeek: number;
}): Date {
  const freq = clampInt(args.frequencyPerWeek, 1, 6);
  const maxConsecutive = maxConsecutiveDaysForFrequency(freq);
  let day = startOfDay(args.candidate);

  while (true) {
    const prevDays = args.previousDates.map((d) => startOfDay(d).getTime());
    const prevDaySet = new Set(prevDays);
    const dayTs = day.getTime();

    if (prevDaySet.has(dayTs)) {
      day = addDays(day, 1);
      continue;
    }

    const sessionsInLast7Days = prevDays.filter((ts) => {
      const d = diffDays(day, new Date(ts));
      return d >= 0 && d < 7;
    }).length;

    if (sessionsInLast7Days >= freq) {
      day = addDays(day, 1);
      continue;
    }

    let consecutive = 1;
    let probe = addDays(day, -1);
    while (prevDaySet.has(probe.getTime())) {
      consecutive += 1;
      probe = addDays(probe, -1);
    }

    if (consecutive > maxConsecutive) {
      day = addDays(day, 1);
      continue;
    }

    return withDefaultTime(day);
  }
}

function parseProgramStartDate(input?: string | Date | null): Date {
  if (!input) return withDefaultTime(new Date());
  if (input instanceof Date && !Number.isNaN(input.getTime())) return withDefaultTime(input);
  if (typeof input === 'string') {
    const dt = new Date(input);
    if (!Number.isNaN(dt.getTime())) return withDefaultTime(dt);
  }
  return withDefaultTime(new Date());
}

function dayKey(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function exerciseTypeLabel(exerciseType: string): string {
  if (exerciseType === 'pushups') return 'отжимания';
  if (exerciseType === 'pullups') return 'подтягивания';
  if (exerciseType === 'crunches') return 'скручивания';
  if (exerciseType === 'squats') return 'приседания';
  return exerciseType;
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

export function suggestDurationWeeks(args: {
  exerciseType: ProgramExerciseType;
  baselineMaxReps: number;
  targetReps: number;
  ageYears: number;
  weightKg: number;
  frequencyPerWeek?: number | null;
}): number {
  const baseline = clampInt(args.baselineMaxReps, 1, 500);
  const target = clampInt(args.targetReps, baseline, 1000);
  const age = clampInt(args.ageYears, 12, 90);
  const weight = clampInt(args.weightKg, 30, 250);
  const frequency = clampInt(
    Number(args.frequencyPerWeek ?? suggestFrequencyPerWeek(args)),
    1,
    6,
  );
  const coef = EXERCISE_COEFFICIENTS[args.exerciseType] ?? 1;

  const gap = Math.max(0, target - baseline);
  let readiness = 1;
  if (baseline <= 8) readiness *= 0.8;
  if (baseline >= 40) readiness *= 1.1;
  if (age >= 40) readiness *= 0.9;
  if (age >= 55) readiness *= 0.8;
  if (weight >= 95 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) readiness *= 0.92;
  if (weight >= 115 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) readiness *= 0.88;
  if (args.exerciseType === 'pullups') readiness *= 0.88;

  const progressPerSession = Math.max(0.35, baseline * 0.05 * coef * readiness);
  const requiredSessions = Math.ceil(gap / progressPerSession) + frequency * 2;

  // Duration is session demand divided by desired weekly frequency.
  let weeks = Math.ceil(requiredSessions / frequency);
  if (age >= 55) weeks += 1;
  if (frequency >= 5) weeks += 1;

  return clampInt(weeks, 4, 24);
}

export function suggestFrequencyPerWeek(args: {
  exerciseType: ProgramExerciseType;
  baselineMaxReps: number;
  targetReps: number;
  ageYears: number;
  weightKg: number;
}): number {
  const baseline = clampInt(args.baselineMaxReps, 1, 500);
  const target = clampInt(args.targetReps, baseline, 1000);
  const age = clampInt(args.ageYears, 12, 90);
  const weight = clampInt(args.weightKg, 30, 250);
  const goalGap = Math.max(0, target - baseline);

  let freq = 3;
  if (baseline <= 8) freq = 2;
  if (baseline >= 32) freq = 4;

  if (args.exerciseType === 'pullups') freq -= 1;
  if (age >= 45) freq -= 1;
  if (age >= 60) freq -= 1;
  if (weight >= 110 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) freq -= 1;

  if (goalGap >= Math.max(12, Math.round(baseline * 0.7))) freq += 1;

  return clampInt(freq, 2, 6);
}

function getPeriodizationMultiplier(week: number): number {
  let m = 1;
  // Every 4th week is lighter for recovery.
  if (week % 4 === 0) m *= 0.9;
  return m;
}

function recommendedRecoveryGapDays(args: {
  frequencyPerWeek: number;
  progress: number;
  setTargets: number[];
  targetReps: number;
  sessionNumber: number;
}): number {
  const freq = clampInt(args.frequencyPerWeek, 1, 6);
  const keyTarget = Math.max(1, args.setTargets[GOAL_TEMPLATE.keySet - 1] || 1);
  const keyIntensity = Math.max(0, Math.min(1.2, keyTarget / Math.max(1, args.targetReps)));

  let restDays = 2;
  if (freq <= 2) restDays = 3;
  else if (freq === 3) restDays = 2;
  else if (freq >= 4) restDays = 1;

  if (keyIntensity >= 0.85) restDays += 1;
  if (args.progress >= 0.8) restDays += 1;
  if (args.sessionNumber % 4 === 0) restDays += 1; // micro-deload between blocks

  return clampInt(restDays, 1, 5);
}

function computeSetTarget(args: {
  baselineMaxReps: number;
  weekNumber: number;
  sessionNumber: number;
  totalSessions: number;
  setNumber: number;
  targetReps: number;
  performanceFactor?: number;
}): number {
  const {
    baselineMaxReps,
    weekNumber,
    sessionNumber,
    totalSessions,
    setNumber,
    targetReps,
    performanceFactor = 1,
  } = args;

  // Program goal is reps in a single key set (not total reps across a workout).
  const progress = totalSessions <= 1
    ? 1
    : Math.max(0, Math.min(1, (sessionNumber - 1) / (totalSessions - 1)));

  // Start intensity is adaptive: stronger athletes begin closer to their baseline AMRAP.
  const goalGap = Math.max(0, targetReps - baselineMaxReps);
  let startRatio = 0.75;
  if (baselineMaxReps >= 20) startRatio += 0.1;
  if (baselineMaxReps >= 35) startRatio += 0.07;
  if (goalGap >= 40) startRatio -= 0.04;
  startRatio = Math.max(0.75, Math.min(0.95, startRatio));

  const firstKeyTarget = Math.max(1, Math.round(baselineMaxReps * startRatio));
  const periodized = getPeriodizationMultiplier(weekNumber);

  const progressiveKeyTarget = firstKeyTarget + (targetReps - firstKeyTarget) * progress;
  let keyTarget = Math.round(progressiveKeyTarget * performanceFactor);
  keyTarget = clampInt(keyTarget, 1, targetReps);

  if (setNumber === GOAL_TEMPLATE.keySet) return keyTarget;

  const p = GOAL_TEMPLATE.percentages[setNumber - 1]
    ?? GOAL_TEMPLATE.percentages[GOAL_TEMPLATE.percentages.length - 1]
    ?? 0.6;
  const setTarget = Math.round(keyTarget * p * periodized);
  return clampInt(setTarget, 1, targetReps);
}

function normalizeCreateInput(raw: ProgramCreateInput): NormalizedCreateInput {
  const exerciseType = raw.exerciseType;

  if (!['pushups', 'pullups', 'crunches', 'squats'].includes(exerciseType)) {
    throw new ProgramError('Некорректный тип упражнения');
  }

  const baselineMaxReps = clampInt(raw.baselineMaxReps, 1, 500);
  const targetReps = clampInt(raw.targetReps, baselineMaxReps, 1000);

  const ageYears = clampInt(Number(raw.ageYears ?? 25), 12, 90);
  const weightKg = clampInt(Number(raw.weightKg ?? 70), 30, 250);
  const frequencyPerWeek = raw.frequencyPerWeek != null
    ? clampInt(Number(raw.frequencyPerWeek), 1, 6)
    : suggestFrequencyPerWeek({
      exerciseType,
      baselineMaxReps,
      targetReps,
      ageYears,
      weightKg,
    });
  const durationWeeks = raw.durationWeeks != null
    ? clampInt(Number(raw.durationWeeks), 4, 24)
    : suggestDurationWeeks({ exerciseType, baselineMaxReps, targetReps, ageYears, weightKg, frequencyPerWeek });

  const sexRaw = String(raw.sex || 'unknown').trim().toLowerCase();
  const sex = ['male', 'female', 'other', 'unknown'].includes(sexRaw) ? sexRaw : 'unknown';

  return {
    exerciseType,
    baselineMaxReps,
    targetReps,
    durationWeeks,
    frequencyPerWeek,
    ageYears,
    weightKg,
    sex,
    startDate: raw.startDate ?? null,
  };
}

function buildProgramDraft(input: ProgramCreateInput) {
  const clean = normalizeCreateInput(input);
  const start = parseProgramStartDate(clean.startDate);
  const totalSessions = Math.max(1, clean.durationWeeks * clean.frequencyPerWeek);
  const startDay = startOfDay(start);

  const sessions: Array<{
    weekNumber: number;
    sessionNumber: number;
    scheduledAt: Date;
    isFinalTest: boolean;
    sets: Array<{ setNumber: number; targetReps: number; restSeconds: number; isKeySet: boolean }>;
  }> = [];

  let scheduledCursor = start;
  for (let sessionNumber = 1; sessionNumber <= totalSessions; sessionNumber += 1) {
    const candidate = sessionNumber === 1 ? start : scheduledCursor;
    const scheduledAt = normalizeScheduledTrainingDate({
      candidate,
      previousDates: sessions.map((s) => s.scheduledAt),
      frequencyPerWeek: clean.frequencyPerWeek,
    });

    const daysFromStart = Math.max(0, diffDays(startOfDay(scheduledAt), startDay));
    const weekNumber = Math.floor(daysFromStart / 7) + 1;

    const sets = GOAL_TEMPLATE.percentages.map((_, idx) => {
      const setNumber = idx + 1;
      return {
        setNumber,
        targetReps: computeSetTarget({
          baselineMaxReps: clean.baselineMaxReps,
          weekNumber,
          sessionNumber,
          totalSessions,
          setNumber,
          targetReps: clean.targetReps,
          performanceFactor: 1,
        }),
        restSeconds: GOAL_TEMPLATE.rest[idx] ?? GOAL_TEMPLATE.rest[GOAL_TEMPLATE.rest.length - 1] ?? 90,
        isKeySet: setNumber === GOAL_TEMPLATE.keySet,
      };
    });

    sessions.push({ weekNumber, sessionNumber, scheduledAt, isFinalTest: false, sets });

    const progress = totalSessions <= 1 ? 1 : sessionNumber / totalSessions;
    const restDays = recommendedRecoveryGapDays({
      frequencyPerWeek: clean.frequencyPerWeek,
      progress,
      setTargets: sets.map((x) => x.targetReps),
      targetReps: clean.targetReps,
      sessionNumber,
    });
    scheduledCursor = addDays(scheduledAt, restDays);
  }

  const testSessionNumber = sessions.length + 1;
  const lastTrainingDate = sessions.length ? sessions[sessions.length - 1].scheduledAt : start;
  const finalTestDate = normalizeScheduledTrainingDate({
    candidate: addDays(lastTrainingDate, 2),
    previousDates: sessions.map((s) => s.scheduledAt),
    frequencyPerWeek: clean.frequencyPerWeek,
  });
  const testWeekNumber = Math.floor(Math.max(0, diffDays(startOfDay(finalTestDate), startDay)) / 7) + 1;
  sessions.push({
    weekNumber: testWeekNumber,
    sessionNumber: testSessionNumber,
    scheduledAt: finalTestDate,
    isFinalTest: true,
    sets: [{
      setNumber: 1,
      targetReps: clean.targetReps,
      restSeconds: 0,
      isKeySet: true,
    }],
  });

  const lastDay = startOfDay(sessions[sessions.length - 1].scheduledAt);
  const effectiveDurationWeeks = Math.max(
    clean.durationWeeks,
    Math.ceil((diffDays(lastDay, startDay) + 1) / 7),
  );

  return {
    clean: {
      ...clean,
      durationWeeks: effectiveDurationWeeks,
    },
    start,
    sessions,
  };
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
    const oldest = recent[recent.length - 1].completedAt!;
    const newest = recent[0].completedAt!;
    const spanDays = Math.max(1, diffDays(newest, oldest) + 1);
    if (spanDays <= 4) {
      warnings.push('Высокая частота последних тренировок. Добавьте восстановление, если чувствуете усталость.');
    }
  }

  const hardDayThreshold = args.baselineMaxReps * 3;
  const heavySessions = args.completedSessions
    .filter((s) => s.completedAt)
    .map((s) => ({
      date: startOfDay(s.completedAt as Date).getTime(),
      total: s.sets.reduce((sum, st) => sum + (st.actualReps ?? 0), 0),
    }))
    .filter((x) => x.total >= hardDayThreshold)
    .sort((a, b) => b.date - a.date);

  if (heavySessions.length >= 2) {
    const d = Math.abs(heavySessions[0].date - heavySessions[1].date) / MS_DAY;
    if (d <= 1) {
      warnings.push('Две тяжёлые тренировки подряд. Следите за восстановлением и качеством сна.');
    }
  }

  return warnings;
}

function distributeDayTotalAcrossSets(targets: number[], dayTotal: number): number[] {
  const safeTargets = targets.map((x) => Math.max(1, Math.round(x)));
  const totalTarget = safeTargets.reduce((sum, x) => sum + x, 0);
  if (totalTarget <= 0) return safeTargets.map(() => 1);

  const out = safeTargets.map((t) => Math.max(1, Math.round((dayTotal * t) / totalTarget)));
  let current = out.reduce((sum, x) => sum + x, 0);

  while (current > dayTotal && out.some((x) => x > 1)) {
    for (let i = out.length - 1; i >= 0 && current > dayTotal; i -= 1) {
      if (out[i] > 1) {
        out[i] -= 1;
        current -= 1;
      }
    }
  }

  while (current < dayTotal) {
    out[out.length - 1] += 1;
    current += 1;
  }

  return out;
}

async function autofillOverdueSessionsFromExternalWorkouts(programId: string) {
  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    include: {
      sessions: {
        where: { completed: false },
        orderBy: { scheduledAt: 'asc' },
        include: {
          sets: { orderBy: { setNumber: 'asc' } },
        },
      },
    },
  });

  if (!program || !program.sessions.length) return;

  const today = startOfDay(new Date());
  const overdue = program.sessions.filter((s) => startOfDay(s.scheduledAt).getTime() < today.getTime());
  if (!overdue.length) return;

  const minDate = startOfDay(overdue[0].scheduledAt);
  const maxDate = startOfDay(overdue[overdue.length - 1].scheduledAt);

  const workouts = await prisma.workout.findMany({
    where: {
      userId: program.userId,
      exerciseType: program.exerciseType,
      date: { gte: minDate, lte: maxDate },
      trainingSessionId: null,
    },
    select: { date: true, reps: true },
  });

  const byDay = new Map<string, number>();
  workouts.forEach((w) => {
    const key = dayKey(w.date);
    byDay.set(key, (byDay.get(key) ?? 0) + (w.reps || 0));
  });

  const consumedDays = new Set<string>();

  await prisma.$transaction(async (tx) => {
    for (const session of overdue) {
      const key = dayKey(session.scheduledAt);
      if (consumedDays.has(key)) continue;
      const dayTotal = byDay.get(key) ?? 0;
      if (dayTotal <= 0) continue;

      const targets = session.sets.map((s) => s.targetReps);
      const distributed = distributeDayTotalAcrossSets(targets, dayTotal);

      for (let i = 0; i < session.sets.length; i += 1) {
        const st = session.sets[i];
        await tx.trainingSet.update({
          where: { id: st.id },
          data: {
            actualReps: distributed[i] ?? st.targetReps,
            completedAt: session.scheduledAt,
          },
        });
      }

      await tx.trainingSession.update({
        where: { id: session.id },
        data: {
          completed: true,
          completedAt: session.scheduledAt,
          startedAt: session.startedAt || session.scheduledAt,
        },
      });

      consumedDays.add(key);
    }
  });
}

export async function createTrainingProgram(userId: string, input: ProgramCreateInput) {
  const draft = buildProgramDraft(input);

  const created = await prisma.$transaction(async (tx) => {
    await tx.trainingProgram.updateMany({
      where: { userId, isActive: true, exerciseType: draft.clean.exerciseType },
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
        startDate: startOfDay(draft.start),
        isActive: true,
        status: 'active',
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

export async function syncProgramSchedule(programId: string): Promise<{ shiftedDays: number; needsRetest: boolean }> {
  await autofillOverdueSessionsFromExternalWorkouts(programId);

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

  const now = new Date();
  const today = startOfDay(now);
  const earliest = program.sessions[0];
  const earliestDay = startOfDay(earliest.scheduledAt);
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

  if (earliestDay.getTime() >= today.getTime()) return { shiftedDays: 0, needsRetest: false };

  await prisma.$transaction(async (tx) => {
    for (const s of program.sessions) {
      await tx.trainingSession.update({
        where: { id: s.id },
        data: {
          scheduledAt: addDays(s.scheduledAt, overdueDays),
          shiftedCount: { increment: overdueDays },
        },
      });
    }
  });

  return { shiftedDays: overdueDays, needsRetest: false };
}

async function sendProgramMissedSessionNotificationsForUser(userId: string) {
  const now = new Date();
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

  const firstOverdueByProgram = new Map<string, typeof overdueSessions[number]>();
  for (const s of overdueSessions) {
    if (!firstOverdueByProgram.has(s.programId)) firstOverdueByProgram.set(s.programId, s);
  }

  for (const session of firstOverdueByProgram.values()) {
    const overdueMs = now.getTime() - session.scheduledAt.getTime();
    const carriedMissDays = Math.max(0, session.shiftedCount) + Math.max(0, diffDays(now, session.scheduledAt));
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

async function sendProgramRemindersForUser(userId: string) {
  const now = new Date();
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

async function getExternalPerformanceRatios(program: {
  userId: string;
  exerciseType: string;
  sessions: Array<{ scheduledAt: Date; completed: boolean; sets: Array<{ targetReps: number }> }>;
}) {
  const now = new Date();
  const today = startOfDay(now);
  const candidates = program.sessions.filter((s) => !s.completed && startOfDay(s.scheduledAt).getTime() < today.getTime());
  if (!candidates.length) return [] as number[];

  const minDate = startOfDay(candidates[0].scheduledAt);

  const workouts = await prisma.workout.findMany({
    where: {
      userId: program.userId,
      exerciseType: program.exerciseType,
      trainingSessionId: null,
      date: { gte: minDate, lte: today },
    },
    select: { date: true, reps: true },
  });

  const dayTotals = new Map<string, number>();
  workouts.forEach((w) => {
    const key = dayKey(w.date);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + (w.reps || 0));
  });

  const ratios: number[] = [];
  candidates.forEach((s) => {
    const planned = s.sets.reduce((sum, st) => sum + (st.targetReps || 0), 0);
    if (planned <= 0) return;
    const actual = dayTotals.get(dayKey(s.scheduledAt)) ?? 0;
    if (actual <= 0) return;
    ratios.push(Math.max(0.5, Math.min(1.15, actual / planned)));
  });

  return ratios;
}

export async function recalculateUpcomingSessions(programId: string) {
  const program = await prisma.trainingProgram.findUnique({
    where: { id: programId },
    include: {
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

  const completedSessions = program.sessions.filter((s) => s.completed);
  const externalRatios = await getExternalPerformanceRatios(program);
  const trainingSessions = program.sessions
    .filter((s) => !s.isFinalTest)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const trainingOrder = new Map(trainingSessions.map((s, idx) => [s.id, idx + 1]));
  const totalTrainingSessions = Math.max(1, trainingSessions.length);

  const performanceFactor = calcPerformanceFactor({
    sessions: completedSessions,
    externalRatios,
  });

  const future = program.sessions.filter((s) => !s.completed);

  await prisma.$transaction(async (tx) => {
    for (const s of future) {
      for (const st of s.sets) {
        const nextTarget = s.isFinalTest
          ? (program.targetReps || program.baselineMaxReps)
          : computeSetTarget({
              baselineMaxReps: program.baselineMaxReps,
              weekNumber: s.weekNumber,
              sessionNumber: trainingOrder.get(s.id) ?? s.sessionNumber,
              totalSessions: totalTrainingSessions,
              setNumber: st.setNumber,
              targetReps: program.targetReps || program.baselineMaxReps,
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

    const allCompleted = program.sessions.length > 0 && program.sessions.every((s) => s.completed);

    if (allCompleted) {
      const targetReps = program.targetReps || program.baselineMaxReps;
      const ordered = program.sessions.slice().sort((a, b) => a.sessionNumber - b.sessionNumber);
      const finalTest = ordered.find((s) => s.isFinalTest) || ordered[ordered.length - 1];
      const keySet = finalTest?.sets.find((x) => x.isKeySet) || finalTest?.sets[0];
      const finalTestActual = keySet?.actualReps ?? 0;

      if (finalTestActual >= targetReps) {
        await tx.trainingProgram.update({
          where: { id: program.id },
          data: {
            lastRecalculatedAt: new Date(),
            status: 'completed',
            isActive: false,
          },
        });
        return;
      }

      const gap = Math.max(1, targetReps - Math.max(1, finalTestActual));
      const extraTrainingCount = clampInt(Math.ceil(gap / 2) + 2, 2, 10);
      let scheduledCursor = addDays(finalTest?.scheduledAt || new Date(), 2);
      let nextSessionNumber = Math.max(...ordered.map((x) => x.sessionNumber)) + 1;
      const startDay = startOfDay(program.startDate);
      const maxBeforeTest = targetReps > 1 ? targetReps - 1 : 1;
      const generatedDates: Date[] = ordered.map((x) => x.scheduledAt);

      for (let i = 1; i <= extraTrainingCount; i += 1) {
        const progress = i / (extraTrainingCount + 1);
        const scheduledAt = normalizeScheduledTrainingDate({
          candidate: scheduledCursor,
          previousDates: generatedDates,
          frequencyPerWeek: program.frequencyPerWeek,
        });
        const daysFromStart = Math.max(0, diffDays(startOfDay(scheduledAt), startDay));
        const weekNumber = Math.floor(daysFromStart / 7) + 1;
        const keyTarget = clampInt(Math.round(finalTestActual + gap * progress), 1, maxBeforeTest);
        const periodized = getPeriodizationMultiplier(weekNumber);

        const sets = GOAL_TEMPLATE.percentages.map((p, idx) => {
          const setNumber = idx + 1;
          return {
            setNumber,
            targetReps: setNumber === GOAL_TEMPLATE.keySet
              ? keyTarget
              : clampInt(Math.round(keyTarget * p * periodized), 1, targetReps),
            restSeconds: GOAL_TEMPLATE.rest[idx] ?? GOAL_TEMPLATE.rest[GOAL_TEMPLATE.rest.length - 1] ?? 90,
            isKeySet: setNumber === GOAL_TEMPLATE.keySet,
          };
        });

        await tx.trainingSession.create({
          data: {
            programId: program.id,
            weekNumber,
            sessionNumber: nextSessionNumber,
            scheduledAt,
            isFinalTest: false,
            sets: {
              create: sets,
            },
          },
        });

        generatedDates.push(scheduledAt);
        nextSessionNumber += 1;
        const restDays = recommendedRecoveryGapDays({
          frequencyPerWeek: program.frequencyPerWeek,
          progress,
          setTargets: sets.map((x) => x.targetReps),
          targetReps,
          sessionNumber: nextSessionNumber,
        });
        scheduledCursor = addDays(scheduledAt, restDays);
      }

      const finalTestDate = normalizeScheduledTrainingDate({
        candidate: scheduledCursor,
        previousDates: generatedDates,
        frequencyPerWeek: program.frequencyPerWeek,
      });
      const daysFromStart = Math.max(0, diffDays(startOfDay(finalTestDate), startDay));
      const testWeekNumber = Math.floor(daysFromStart / 7) + 1;
      await tx.trainingSession.create({
        data: {
          programId: program.id,
          weekNumber: testWeekNumber,
          sessionNumber: nextSessionNumber,
          scheduledAt: finalTestDate,
          isFinalTest: true,
          sets: {
            create: [{
              setNumber: 1,
              targetReps,
              restSeconds: 0,
              isKeySet: true,
            }],
          },
        },
      });

      await tx.trainingProgram.update({
        where: { id: program.id },
        data: {
          lastRecalculatedAt: new Date(),
          status: 'active',
          isActive: true,
        },
      });
      return;
    }

    await tx.trainingProgram.update({
      where: { id: program.id },
      data: {
        lastRecalculatedAt: new Date(),
      },
    });
  });
}

export async function getProgramById(userId: string, programId: string) {
  const program = await prisma.trainingProgram.findFirst({
    where: { id: programId, userId },
    include: {
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

  if (!program) return null;

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

  if (activeRows.length) {
    await sendProgramMissedSessionNotificationsForUser(userId).catch(() => {});
    for (const row of activeRows) {
      const sync = await syncProgramSchedule(row.id);
      if (sync.needsRetest) continue;
      await recalculateUpcomingSessions(row.id).catch(() => {});
    }
    await sendProgramRemindersForUser(userId).catch(() => {});
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

  const sync = await syncProgramSchedule(initial.programId);
  if (!sync.needsRetest) {
    await recalculateUpcomingSessions(initial.programId).catch(() => {});
  }

  const session = await prisma.trainingSession.findFirst({
    where: { id: sessionId, program: { userId } },
    include: {
      program: {
        select: {
          id: true,
          needsRetest: true,
          isActive: true,
        },
      },
      sets: { orderBy: { setNumber: 'asc' } },
    },
  });

  if (!session) throw new ProgramError('Сессия не найдена', 404);
  if (!session.program.isActive) {
    if (session.program.needsRetest) {
      throw new ProgramError(
        'Программа была прервана из-за длительного пропуска. Создайте новую программу, когда будете готовы продолжить.',
        409,
        'PROGRAM_INTERRUPTED',
      );
    }
    throw new ProgramError('Программа не активна', 400);
  }
  if (session.program.needsRetest) {
    throw new ProgramError('Пропуск более двух недель. Пройдите повторный тест и перегенерируйте программу.', 409, 'RETEST_REQUIRED');
  }
  const today = startOfDay(new Date());
  const sessionDay = startOfDay(session.scheduledAt);
  if (sessionDay.getTime() > today.getTime() && !options?.forceStartEarly) {
    throw new ProgramError(
      'Период отдыха ещё не завершён. Эту тренировку можно выполнить позже по расписанию.',
      409,
      'REST_PERIOD_NOT_FINISHED',
    );
  }

  if (!session.startedAt) {
    await prisma.trainingSession.update({ where: { id: session.id }, data: { startedAt: new Date() } });
  }

  return getProgramById(userId, session.program.id);
}

export async function submitTrainingSet(args: {
  userId: string;
  sessionId: string;
  setId: string;
  actualReps: number;
}) {
  const actualReps = clampInt(args.actualReps, 1, 5000);

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
      session: {
        select: {
          completed: true,
          program: { select: { needsRetest: true, isActive: true, exerciseType: true } },
        },
      },
    },
  });

  if (!row) throw new ProgramError('Подход не найден', 404);
  if (!row.session.program.isActive) {
    if (row.session.program.needsRetest) {
      throw new ProgramError(
        'Программа была прервана из-за длительного пропуска. Создайте новую программу, когда будете готовы продолжить.',
        409,
        'PROGRAM_INTERRUPTED',
      );
    }
    throw new ProgramError('Программа не активна', 400);
  }
  if (row.session.program.needsRetest) {
    throw new ProgramError('Пропуск более двух недель. Пройдите повторный тест и перегенерируйте программу.', 409, 'RETEST_REQUIRED');
  }
  if (row.session.completed) throw new ProgramError('Сессия уже завершена', 400);
  if (row.actualReps != null) throw new ProgramError('Этот подход уже записан', 400);

  const now = new Date();
  const dateMidnight = startOfDay(now);

  await prisma.$transaction(async (tx) => {
    await tx.trainingSet.update({
      where: { id: row.id },
      data: {
        actualReps,
        completedAt: now,
      },
    });

    await tx.workout.create({
      data: {
        userId: args.userId,
        reps: actualReps,
        date: dateMidnight,
        time: new Date(now.getTime() + row.setNumber * 1000),
        exerciseType: row.session.program.exerciseType,
        trainingSessionId: args.sessionId,
      },
    });
  });

  return { ok: true };
}

export async function completeTrainingSession(userId: string, sessionId: string) {
  const now = new Date();

  const done = await prisma.$transaction(async (tx) => {
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
          },
        },
        sets: { orderBy: { setNumber: 'asc' } },
      },
    });

    if (!session) throw new ProgramError('Сессия не найдена', 404);
    if (!session.program.isActive) {
      if (session.program.needsRetest) {
        throw new ProgramError(
          'Программа была прервана из-за длительного пропуска. Создайте новую программу, когда будете готовы продолжить.',
          409,
          'PROGRAM_INTERRUPTED',
        );
      }
      throw new ProgramError('Программа не активна', 400);
    }
    if (session.program.needsRetest) {
      throw new ProgramError('Пропуск более двух недель. Пройдите повторный тест и перегенерируйте программу.', 409, 'RETEST_REQUIRED');
    }

    if (session.completed) return session.program.id;

    const missing = session.sets.filter((s) => s.actualReps == null);
    if (missing.length) {
      throw new ProgramError(`Заполните все подходы перед завершением (осталось: ${missing.length})`, 400);
    }

    const dateMidnight = startOfDay(now);

    const existingWorkoutCount = await tx.workout.count({
      where: { trainingSessionId: session.id },
    });

    if (existingWorkoutCount < session.sets.length) {
      const missingSets = session.sets.slice(existingWorkoutCount);
      await tx.workout.createMany({
        data: missingSets.map((s, idx) => ({
          userId: session.program.userId,
          reps: s.actualReps || 0,
          date: dateMidnight,
          time: new Date(now.getTime() + (existingWorkoutCount + idx) * 1000),
          exerciseType: session.program.exerciseType,
          trainingSessionId: session.id,
        })),
      });
    }

    await tx.trainingSession.update({
      where: { id: session.id },
      data: {
        completed: true,
        completedAt: now,
        startedAt: session.startedAt || now,
      },
    });

    const earlyDays = diffDays(startOfDay(session.scheduledAt), dateMidnight);
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
          data: { scheduledAt: addDays(row.scheduledAt, -earlyDays) },
        });
      }
    }

    return session.program.id;
  });

  await recalculateUpcomingSessions(done);

  return getProgramById(userId, done);
}
