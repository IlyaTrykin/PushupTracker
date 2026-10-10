/**
 * Training-program planning — pure functions, no DB.
 *
 * Every calendar decision ("which day", "19:00") is made in the user's time zone
 * through `calendar-day.ts`; the server time zone never matters.
 */
import { EXERCISES, isExerciseType } from './exercises';
import {
  addDays,
  dayKeyInZone,
  dayKeyToDbDate,
  diffDays,
  localHHMM,
  normalizeTimeZone,
  parseDayKey,
  zonedTimeToInstant,
  type DayKey,
} from './calendar-day';

// Генератор программ рассчитан на упражнения с собственным весом: у каждого типа
// здесь свой коэффициент готовности, поэтому список задан явно, а не из каталога.
export type ProgramExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';
export type ProgramGoalType = 'reach_target';

/** Local wall time of every scheduled program session. */
export const PROGRAM_SESSION_TIME = '19:00';

export type ProgramClock = { now: Date; timeZone: string };

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
  plank: 0.9,
};

export function isProgramExerciseType(value: unknown): value is ProgramExerciseType {
  return isExerciseType(value)
    && EXERCISES[value].programSupported
    && Object.prototype.hasOwnProperty.call(EXERCISE_COEFFICIENTS, value);
}

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

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, Math.round(v)));
}

// ---------------------------------------------------------------------------
// Calendar helpers (user time zone)
// ---------------------------------------------------------------------------

/** The instant of a program session on `day`: 19:00 on the user's wall clock. */
export function programSessionInstant(day: DayKey, timeZone: string): Date {
  return zonedTimeToInstant(day, PROGRAM_SESSION_TIME, normalizeTimeZone(timeZone));
}

/** The user's calendar day of an instant. */
export function programDayOf(instant: Date, timeZone: string): DayKey {
  return dayKeyInZone(instant, normalizeTimeZone(timeZone));
}

/** `Workout.date` for something done at `instant` (the user's day, stored as UTC midnight). */
export function programWorkoutDate(instant: Date, timeZone: string): Date {
  return dayKeyToDbDate(programDayOf(instant, timeZone));
}

/** Moves an instant by whole calendar days, keeping the user's local wall time. */
export function shiftInstantByDays(instant: Date, days: number, timeZone: string): Date {
  if (!days) return new Date(instant.getTime());
  const zone = normalizeTimeZone(timeZone);
  return zonedTimeToInstant(addDays(dayKeyInZone(instant, zone), days), localHHMM(instant, zone), zone);
}

/** Program start day: an explicit 'YYYY-MM-DD', the user's day of a date/ISO string, else today. */
export function resolveProgramStartDay(input: string | Date | null | undefined, clock: ProgramClock): DayKey {
  const zone = normalizeTimeZone(clock.timeZone);
  if (typeof input === 'string') {
    const key = parseDayKey(input.trim());
    if (key) return key;
    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) return dayKeyInZone(parsed, zone);
  } else if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return dayKeyInZone(input, zone);
  }
  return dayKeyInZone(clock.now, zone);
}

export function weekNumberFor(day: DayKey, startDay: DayKey): number {
  return Math.floor(Math.max(0, diffDays(day, startDay)) / 7) + 1;
}

function laterDay(a: DayKey, b: DayKey): DayKey {
  return diffDays(a, b) >= 0 ? a : b;
}

function maxConsecutiveDaysForFrequency(freq: number): number {
  if (freq >= 5) return 3;
  return 2;
}

/** First day on/after `candidate` that respects the weekly frequency and max-consecutive-days rules. */
export function normalizeScheduledTrainingDay(args: {
  candidate: DayKey;
  previousDays: DayKey[];
  frequencyPerWeek: number;
}): DayKey {
  const freq = clampInt(args.frequencyPerWeek, 1, 6);
  const maxConsecutive = maxConsecutiveDaysForFrequency(freq);
  const prevDaySet = new Set(args.previousDays);
  let day = args.candidate;

  while (true) {
    if (prevDaySet.has(day)) {
      day = addDays(day, 1);
      continue;
    }

    const sessionsInLast7Days = args.previousDays.filter((prev) => {
      const d = diffDays(day, prev);
      return d >= 0 && d < 7;
    }).length;

    if (sessionsInLast7Days >= freq) {
      day = addDays(day, 1);
      continue;
    }

    let consecutive = 1;
    let probe = addDays(day, -1);
    while (prevDaySet.has(probe)) {
      consecutive += 1;
      probe = addDays(probe, -1);
    }

    if (consecutive > maxConsecutive) {
      day = addDays(day, 1);
      continue;
    }

    return day;
  }
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

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
  const age = clampInt(args.ageYears, 8, 90);
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
  const age = clampInt(args.ageYears, 8, 90);
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

export function computeSetTarget(args: {
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

  if (!isProgramExerciseType(exerciseType)) {
    throw new ProgramError('Некорректный тип упражнения');
  }

  const baselineMaxReps = clampInt(raw.baselineMaxReps, 1, 500);
  const targetReps = clampInt(raw.targetReps, baselineMaxReps, 1000);

  const ageYears = clampInt(Number(raw.ageYears ?? 25), 8, 90);
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

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type ProgramDraftSet = { setNumber: number; targetReps: number; restSeconds: number; isKeySet: boolean };

export type ProgramDraftSession = {
  weekNumber: number;
  sessionNumber: number;
  day: DayKey;
  scheduledAt: Date;
  isFinalTest: boolean;
  sets: ProgramDraftSet[];
};

function restSecondsFor(idx: number): number {
  return GOAL_TEMPLATE.rest[idx] ?? GOAL_TEMPLATE.rest[GOAL_TEMPLATE.rest.length - 1] ?? 90;
}

function finalTestSets(targetReps: number): ProgramDraftSet[] {
  return [{ setNumber: 1, targetReps, restSeconds: 0, isKeySet: true }];
}

export function buildProgramDraft(input: ProgramCreateInput, clock: ProgramClock) {
  const timeZone = normalizeTimeZone(clock.timeZone);
  const clean = normalizeCreateInput(input);
  const startDay = resolveProgramStartDay(clean.startDate, { now: clock.now, timeZone });
  const totalSessions = Math.max(1, clean.durationWeeks * clean.frequencyPerWeek);

  const sessions: ProgramDraftSession[] = [];

  let cursor = startDay;
  for (let sessionNumber = 1; sessionNumber <= totalSessions; sessionNumber += 1) {
    const day = normalizeScheduledTrainingDay({
      candidate: cursor,
      previousDays: sessions.map((s) => s.day),
      frequencyPerWeek: clean.frequencyPerWeek,
    });
    const weekNumber = weekNumberFor(day, startDay);

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
        restSeconds: restSecondsFor(idx),
        isKeySet: setNumber === GOAL_TEMPLATE.keySet,
      };
    });

    sessions.push({
      weekNumber,
      sessionNumber,
      day,
      scheduledAt: programSessionInstant(day, timeZone),
      isFinalTest: false,
      sets,
    });

    const progress = totalSessions <= 1 ? 1 : sessionNumber / totalSessions;
    const restDays = recommendedRecoveryGapDays({
      frequencyPerWeek: clean.frequencyPerWeek,
      progress,
      setTargets: sets.map((x) => x.targetReps),
      targetReps: clean.targetReps,
      sessionNumber,
    });
    cursor = addDays(day, restDays);
  }

  const lastTrainingDay = sessions.length ? sessions[sessions.length - 1].day : startDay;
  const finalTestDay = normalizeScheduledTrainingDay({
    candidate: addDays(lastTrainingDay, 2),
    previousDays: sessions.map((s) => s.day),
    frequencyPerWeek: clean.frequencyPerWeek,
  });
  sessions.push({
    weekNumber: weekNumberFor(finalTestDay, startDay),
    sessionNumber: sessions.length + 1,
    day: finalTestDay,
    scheduledAt: programSessionInstant(finalTestDay, timeZone),
    isFinalTest: true,
    sets: finalTestSets(clean.targetReps),
  });

  const effectiveDurationWeeks = Math.max(
    clean.durationWeeks,
    Math.ceil((diffDays(finalTestDay, startDay) + 1) / 7),
  );

  return {
    clean: {
      ...clean,
      durationWeeks: effectiveDurationWeeks,
    },
    startDay,
    sessions,
  };
}

// ---------------------------------------------------------------------------
// Program outcome (B02/B16)
// ---------------------------------------------------------------------------

export type ProgramOutcomeSession = {
  sessionNumber: number;
  isFinalTest: boolean;
  completed: boolean;
  scheduledAt: Date;
  completedAt: Date | null;
  sets: Array<{ isKeySet: boolean; actualReps: number | null }>;
};

export type ProgramOutcome<S extends ProgramOutcomeSession = ProgramOutcomeSession> =
  | { kind: 'in_progress' }
  | { kind: 'completed'; finalTest: S; finalTestActual: number }
  | { kind: 'extend'; finalTest: S; finalTestActual: number };

function keySetActual(session: ProgramOutcomeSession): number {
  const keySet = session.sets.find((x) => x.isKeySet) || session.sets[0];
  return keySet?.actualReps ?? 0;
}

/**
 * Whether a program is finished, still running, or needs an extension.
 * Uses the latest final test: a passed final test completes the program (even if
 * stale sessions were generated after it); a failed one, once nothing else is
 * pending, asks for an extension.
 */
export function evaluateProgramOutcome<S extends ProgramOutcomeSession>(
  sessions: S[],
  targetReps: number,
): ProgramOutcome<S> {
  if (!sessions.length) return { kind: 'in_progress' };
  const ordered = sessions.slice().sort((a, b) => a.sessionNumber - b.sessionNumber);
  const finalTests = ordered.filter((s) => s.isFinalTest);

  const lastCompletedTest = [...finalTests].reverse().find((s) => s.completed);
  if (lastCompletedTest) {
    const actual = keySetActual(lastCompletedTest);
    if (actual >= targetReps) return { kind: 'completed', finalTest: lastCompletedTest, finalTestActual: actual };
  }

  if (!ordered.every((s) => s.completed)) return { kind: 'in_progress' };

  const finalTest = finalTests[finalTests.length - 1] ?? ordered[ordered.length - 1];
  const actual = keySetActual(finalTest);
  if (actual >= targetReps) return { kind: 'completed', finalTest, finalTestActual: actual };
  return { kind: 'extend', finalTest, finalTestActual: actual };
}

/**
 * Extra training sessions plus a new final test after a failed final test.
 * Planning starts from the later of the test day and today, so nothing lands in the past.
 */
export function planProgramExtension(args: {
  targetReps: number;
  finalTestActual: number;
  frequencyPerWeek: number;
  startDay: DayKey;
  lastTestDay: DayKey;
  existingDays: DayKey[];
  nextSessionNumber: number;
  clock: ProgramClock;
}): ProgramDraftSession[] {
  const timeZone = normalizeTimeZone(args.clock.timeZone);
  const today = dayKeyInZone(args.clock.now, timeZone);
  const targetReps = Math.max(1, args.targetReps);
  const gap = Math.max(1, targetReps - Math.max(1, args.finalTestActual));
  const extraTrainingCount = clampInt(Math.ceil(gap / 2) + 2, 2, 10);
  const maxBeforeTest = targetReps > 1 ? targetReps - 1 : 1;
  const usedDays = [...args.existingDays];
  const out: ProgramDraftSession[] = [];

  let cursor = addDays(laterDay(args.lastTestDay, today), 2);
  let nextSessionNumber = args.nextSessionNumber;

  for (let i = 1; i <= extraTrainingCount; i += 1) {
    const progress = i / (extraTrainingCount + 1);
    const day = normalizeScheduledTrainingDay({
      candidate: cursor,
      previousDays: usedDays,
      frequencyPerWeek: args.frequencyPerWeek,
    });
    const weekNumber = weekNumberFor(day, args.startDay);
    const keyTarget = clampInt(Math.round(args.finalTestActual + gap * progress), 1, maxBeforeTest);
    const periodized = getPeriodizationMultiplier(weekNumber);

    const sets = GOAL_TEMPLATE.percentages.map((p, idx) => {
      const setNumber = idx + 1;
      return {
        setNumber,
        targetReps: setNumber === GOAL_TEMPLATE.keySet
          ? keyTarget
          : clampInt(Math.round(keyTarget * p * periodized), 1, targetReps),
        restSeconds: restSecondsFor(idx),
        isKeySet: setNumber === GOAL_TEMPLATE.keySet,
      };
    });

    out.push({
      weekNumber,
      sessionNumber: nextSessionNumber,
      day,
      scheduledAt: programSessionInstant(day, timeZone),
      isFinalTest: false,
      sets,
    });

    usedDays.push(day);
    nextSessionNumber += 1;
    const restDays = recommendedRecoveryGapDays({
      frequencyPerWeek: args.frequencyPerWeek,
      progress,
      setTargets: sets.map((x) => x.targetReps),
      targetReps,
      sessionNumber: nextSessionNumber,
    });
    cursor = addDays(day, restDays);
  }

  const finalTestDay = normalizeScheduledTrainingDay({
    candidate: cursor,
    previousDays: usedDays,
    frequencyPerWeek: args.frequencyPerWeek,
  });
  out.push({
    weekNumber: weekNumberFor(finalTestDay, args.startDay),
    sessionNumber: nextSessionNumber,
    day: finalTestDay,
    scheduledAt: programSessionInstant(finalTestDay, timeZone),
    isFinalTest: true,
    sets: finalTestSets(targetReps),
  });

  return out;
}

// ---------------------------------------------------------------------------
// Autofill of overdue sessions from ordinary workouts (B16)
// ---------------------------------------------------------------------------

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

export type AutofillSession = {
  id: string;
  scheduledAt: Date;
  isFinalTest: boolean;
  sets: Array<{ id: string; targetReps: number }>;
};

export type AutofillPlan = { sessionId: string; day: DayKey; sets: Array<{ setId: string; actualReps: number }> };

/**
 * Overdue training sessions that ordinary workouts of the same day count for.
 * A final test is never filled from a day total — it measures a single set.
 */
export function planOverdueAutofill(args: {
  sessions: AutofillSession[];
  dayTotals: Map<DayKey, number>;
  clock: ProgramClock;
}): AutofillPlan[] {
  const today = programDayOf(args.clock.now, args.clock.timeZone);
  const consumedDays = new Set<DayKey>();
  const out: AutofillPlan[] = [];
  const ordered = args.sessions.slice().sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  for (const session of ordered) {
    if (session.isFinalTest) continue;
    const day = programDayOf(session.scheduledAt, args.clock.timeZone);
    if (diffDays(day, today) >= 0) continue;
    if (consumedDays.has(day)) continue;
    const dayTotal = args.dayTotals.get(day) ?? 0;
    if (dayTotal <= 0) continue;

    const distributed = distributeDayTotalAcrossSets(session.sets.map((s) => s.targetReps), dayTotal);
    out.push({
      sessionId: session.id,
      day,
      sets: session.sets.map((st, i) => ({ setId: st.id, actualReps: distributed[i] ?? st.targetReps })),
    });
    consumedDays.add(day);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Session flow (B05/B31/B32)
// ---------------------------------------------------------------------------

/** A session can take sets once it has been started or its day has come. */
export function isSessionOpenForSets(
  session: { scheduledAt: Date; startedAt: Date | null },
  clock: ProgramClock,
): boolean {
  if (session.startedAt) return true;
  return diffDays(programDayOf(session.scheduledAt, clock.timeZone), programDayOf(clock.now, clock.timeZone)) <= 0;
}

/** `Workout.time` of a program set: its completion instant plus `setNumber` seconds (keeps sets ordered). */
export function programSetWorkoutTime(completedAt: Date, setNumber: number): Date {
  return new Date(completedAt.getTime() + setNumber * 1000);
}

export type SessionSetRecord = { setNumber: number; actualReps: number | null; completedAt: Date | null };

/**
 * Recorded sets that have no matching `Workout` (e.g. one was deleted on the dashboard).
 * A workout matches a set by its time (`programSetWorkoutTime`), otherwise by equal reps.
 */
export function setsMissingWorkouts<S extends SessionSetRecord>(
  sets: S[],
  workouts: Array<{ time: Date; reps: number }>,
): S[] {
  const recorded = sets.filter((s) => s.actualReps != null);
  const remaining = workouts.slice();
  const unmatched: S[] = [];

  for (const set of recorded) {
    if (!set.completedAt) {
      unmatched.push(set);
      continue;
    }
    const expected = programSetWorkoutTime(set.completedAt, set.setNumber).getTime();
    const idx = remaining.findIndex((w) => w.time.getTime() === expected);
    if (idx >= 0) remaining.splice(idx, 1);
    else unmatched.push(set);
  }

  const missing: S[] = [];
  for (const set of unmatched) {
    const idx = remaining.findIndex((w) => w.reps === set.actualReps);
    if (idx >= 0) remaining.splice(idx, 1);
    else missing.push(set);
  }

  return missing.sort((a, b) => a.setNumber - b.setNumber);
}

// ---------------------------------------------------------------------------
// Program replacement (B15)
// ---------------------------------------------------------------------------

/**
 * Which active programs a newly created one replaces: same exercise and same owner
 * scope — a group assignment replaces only that group's program, a personal one only
 * the personal program.
 */
export function programReplacementScope(
  exerciseType: ProgramExerciseType,
  managedByGroupId: string | null | undefined,
): { exerciseType: ProgramExerciseType; managedByGroupId: string | null } {
  return { exerciseType, managedByGroupId: managedByGroupId || null };
}
