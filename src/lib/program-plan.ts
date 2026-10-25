/**
 * Training-program planning — pure functions, no DB.
 *
 * Every calendar decision ("which day", "19:00") is made in the user's time zone
 * through `calendar-day.ts`; the server time zone never matters.
 */
import {
  EXERCISES,
  EXERCISE_IDS,
  exerciseLabel,
  isExerciseType,
  isLoadedExercise,
  isUnilateralExercise,
  programKind,
  type ExerciseType,
  type ProgramKind,
} from './exercises';
import {
  addDays,
  dayKeyInZone,
  dbDateToDayKey,
  dayKeyToDbDate,
  diffDays,
  localHHMM,
  normalizeTimeZone,
  parseDayKey,
  zonedTimeToInstant,
  type DayKey,
} from './calendar-day';
import { MAX_DISTANCE_METERS, MAX_DURATION_SECONDS, normalizeLoadKg } from './workout-input';
import { programsMessages } from '../i18n/messages/features/programs';
// Только чистые модули: файл импортирует и клиент (мастер программ), БД сюда не тянется.
import { estimateActiveEnergy, type BodyMetrics } from './health/energy';
import {
  CIRCUIT_PLANS,
  circuitSessionSets,
  circuitTestSpec,
  getCircuitPlan,
  getCircuitTemplate,
  planCircuitSession,
  type CircuitDayLabel,
} from './circuits';

// Программа строится по любому упражнению каталога, у которого есть вид программы
// (`programKind`): повторы, время, гиря с весом, дистанция. Вид определяет единицы цели
// (повторы / секунды / метры) и форму занятия; у упражнений «на сторону» цель — на одну сторону.
export type ProgramExerciseType = ExerciseType;
export type ProgramGoalType = 'reach_target';

/** Упражнения, по которым можно взять программу, в порядке каталога. */
export const PROGRAM_EXERCISE_TYPES: readonly ExerciseType[] = EXERCISE_IDS.filter((id) => programKind(id) != null);

/** Local wall time of every scheduled program session. */
export const PROGRAM_SESSION_TIME = '19:00';

export type ProgramClock = { now: Date; timeZone: string };

type GoalTemplate = {
  percentages: number[];
  rest: number[];
  keySet: number;
};

// Коэффициент прироста: насколько быстро растёт максимум в подходе от занятия к занятию
// (1 — как у отжиманий). Тяжёлые и технически сложные упражнения растут медленнее.
const EXERCISE_COEFFICIENTS: Record<ExerciseType, number> = {
  pushups: 1.0,
  pullups: 0.85,
  crunches: 1.1,
  squats: 1.05,
  plank: 0.9,
  dips: 0.9,
  hanging_leg_raises: 0.85,
  muscle_ups: 0.6,
  lunges: 1.0,
  burpees: 0.95,
  jump_rope: 1.1,
  wall_sit: 0.95,
  kettlebell_press: 0.8,
  kettlebell_jerk: 0.85,
  kettlebell_swing: 1.0,
  run: 1.0,
  bike: 1.0,
  row: 1.0,
  australian_pullups: 0.95,
  glute_bridge: 1.1,
  superman: 1.05,
  side_plank: 0.9,
  mountain_climbers: 1.1,
  kettlebell_row: 0.85,
};

// Тяжёлые тяги собственного веса: реже занятия, медленнее прирост (как раньше у подтягиваний).
const HARD_PULL_EXERCISES: ReadonlySet<string> = new Set(['pullups', 'muscle_ups']);
// Упражнения, где большой вес тела мешает: жимы и тяги собственного веса.
const BODYWEIGHT_HEAVY_EXERCISES: ReadonlySet<string> = new Set(['pushups', 'pullups', 'dips', 'muscle_ups']);

export function isProgramExerciseType(value: unknown): value is ExerciseType {
  return isExerciseType(value) && programKind(value) != null;
}

/** Коэффициент прироста упражнения в программе (0 — программы по нему нет). */
export function programCoefficient(type: string): number {
  return isProgramExerciseType(type) ? EXERCISE_COEFFICIENTS[type] : 0;
}

/** Вид программы по упражнению (`programKind`), для неизвестного — `reps`. */
function kindOf(type: string): ProgramKind {
  return programKind(type) ?? 'reps';
}

// Стартовое условие: при максимуме 0 программа не начинается, вместо неё — подводящие.
const PROGRAM_START_ALTERNATIVES: Partial<Record<ExerciseType, ExerciseType[]>> = {
  muscle_ups: ['pullups', 'dips'],
};

/** С каких программ начать, если по упражнению пока нет ни одного повтора; [] — стартовать можно. */
export function programStartAlternatives(type: string, baselineMaxReps: number): ExerciseType[] {
  if (!isExerciseType(type)) return [];
  const alternatives = PROGRAM_START_ALTERNATIVES[type];
  if (!alternatives) return [];
  return Number(baselineMaxReps) >= 1 ? [] : [...alternatives];
}

/** Допустимые база и цель в единицах упражнения: повторы/секунды или метры. */
export function programValueRange(type: string): { min: number; max: number } {
  return kindOf(type) === 'distance' ? { min: 200, max: MAX_DISTANCE_METERS } : { min: 1, max: 1000 };
}

const GOAL_TEMPLATE: GoalTemplate = {
  // Last set is the key (max-like) set.
  percentages: [0.6, 0.72, 0.8, 0.7, 1.0],
  rest: [90, 90, 120, 120, 150],
  keySet: 5,
};

export type ProgramCreateInput = {
  exerciseType: ExerciseType;
  /** В единицах упражнения: повторы (на сторону), секунды, метры. */
  baselineMaxReps: number;
  targetReps: number;
  /** Вес гири — обязателен у гиревых программ, у остальных отбрасывается. */
  loadKg?: number | null;
  durationWeeks?: number | null;
  frequencyPerWeek?: number | null;
  ageYears?: number | null;
  weightKg?: number | null;
  sex?: string | null;
  startDate?: string | Date | null;
};

type NormalizedCreateInput = {
  exerciseType: ExerciseType;
  programKind: ProgramKind;
  baselineMaxReps: number;
  targetReps: number;
  loadKg: number | null;
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

export type ProgramErrorDetails = {
  /** PROGRAM_DISTANCE_TOO_FAR: самая дальняя цель, до которой дорастает план от этой базы, м. */
  maxTargetMeters?: number;
};

export class ProgramError extends Error {
  status: number;
  code?: string;
  details?: ProgramErrorDetails;

  constructor(message: string, status = 400, code?: string, details?: ProgramErrorDetails) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
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

export type ProgramSuggestionArgs = {
  exerciseType: string;
  baselineMaxReps: number;
  targetReps: number;
  ageYears: number;
  weightKg: number;
  frequencyPerWeek?: number | null;
};

/**
 * Рекомендуемая длительность программы, недели. Одна формула для сервера и мастера на клиенте.
 * Дистанция — по плану «+10% в неделю» (`buildDistancePlan`): столько недель, сколько нужно
 * длинной тренировке дорасти до цели, плюс неделя финального теста.
 */
export function suggestDurationWeeks(args: ProgramSuggestionArgs): number {
  if (kindOf(args.exerciseType) === 'distance') {
    const range = programValueRange(args.exerciseType);
    const baseline = clampInt(args.baselineMaxReps, range.min, range.max);
    const plan = buildDistancePlan({
      baselineMeters: baseline,
      targetMeters: clampInt(args.targetReps, baseline, range.max),
      frequencyPerWeek: DISTANCE_FREQUENCY,
    });
    return clampInt(plan.weeks.length + 1, 4, 24);
  }

  const baseline = clampInt(args.baselineMaxReps, 1, 500);
  const target = clampInt(args.targetReps, baseline, 1000);
  const age = clampInt(args.ageYears, 8, 90);
  const weight = clampInt(args.weightKg, 30, 250);
  const frequency = clampInt(
    Number(args.frequencyPerWeek ?? suggestFrequencyPerWeek(args)),
    1,
    6,
  );
  const coef = programCoefficient(args.exerciseType) || 1;

  const gap = Math.max(0, target - baseline);
  let readiness = 1;
  if (baseline <= 8) readiness *= 0.8;
  if (baseline >= 40) readiness *= 1.1;
  if (age >= 40) readiness *= 0.9;
  if (age >= 55) readiness *= 0.8;
  if (weight >= 95 && BODYWEIGHT_HEAVY_EXERCISES.has(args.exerciseType)) readiness *= 0.92;
  if (weight >= 115 && BODYWEIGHT_HEAVY_EXERCISES.has(args.exerciseType)) readiness *= 0.88;
  if (HARD_PULL_EXERCISES.has(args.exerciseType)) readiness *= 0.88;

  const progressPerSession = Math.max(0.35, baseline * 0.05 * coef * readiness);
  const requiredSessions = Math.ceil(gap / progressPerSession) + frequency * 2;

  // Duration is session demand divided by desired weekly frequency.
  let weeks = Math.ceil(requiredSessions / frequency);
  if (age >= 55) weeks += 1;
  if (frequency >= 5) weeks += 1;

  return clampInt(weeks, 4, 24);
}

/** Рекомендуемое число занятий в неделю; у дистанции всегда 3 (лёгкое, интервалы, длинное). */
export function suggestFrequencyPerWeek(args: Omit<ProgramSuggestionArgs, 'frequencyPerWeek'>): number {
  if (kindOf(args.exerciseType) === 'distance') return DISTANCE_FREQUENCY;

  const baseline = clampInt(args.baselineMaxReps, 1, 500);
  const target = clampInt(args.targetReps, baseline, 1000);
  const age = clampInt(args.ageYears, 8, 90);
  const weight = clampInt(args.weightKg, 30, 250);
  const goalGap = Math.max(0, target - baseline);

  let freq = 3;
  if (baseline <= 8) freq = 2;
  if (baseline >= 32) freq = 4;

  if (HARD_PULL_EXERCISES.has(args.exerciseType)) freq -= 1;
  if (age >= 45) freq -= 1;
  if (age >= 60) freq -= 1;
  if (weight >= 110 && BODYWEIGHT_HEAVY_EXERCISES.has(args.exerciseType)) freq -= 1;

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
    throw new ProgramError('Некорректный тип упражнения', 400, 'PROGRAM_EXERCISE_INVALID');
  }
  const kind = kindOf(exerciseType);

  if (programStartAlternatives(exerciseType, Number(raw.baselineMaxReps) || 0).length) {
    throw new ProgramError(
      'С нулевого максимума программа не стартует: начните с подводящих упражнений',
      400,
      'PROGRAM_BASELINE_ZERO',
    );
  }

  const range = programValueRange(exerciseType);
  const baselineMaxReps = clampInt(raw.baselineMaxReps, range.min, kind === 'distance' ? range.max : 500);
  const targetReps = clampInt(raw.targetReps, baselineMaxReps, range.max);
  if (kind === 'distance') {
    const maxTargetMeters = distanceTargetLimit(baselineMaxReps);
    if (targetReps > maxTargetMeters) {
      throw new ProgramError(
        programsMessages.ru.errors.distanceTooFar(formatKm(maxTargetMeters, 'ru')),
        400,
        'PROGRAM_DISTANCE_TOO_FAR',
        { maxTargetMeters },
      );
    }
  }

  let loadKg: number | null = null;
  if (kind === 'loaded') {
    loadKg = normalizeLoadKg(raw.loadKg);
    if (loadKg == null) throw new ProgramError('Укажите вес гири', 400, 'PROGRAM_LOAD_REQUIRED');
  }

  const ageYears = clampInt(Number(raw.ageYears ?? 25), 8, 90);
  const weightKg = clampInt(Number(raw.weightKg ?? 70), 30, 250);
  const frequencyPerWeek = kind === 'distance'
    ? DISTANCE_FREQUENCY
    : raw.frequencyPerWeek != null
      ? clampInt(Number(raw.frequencyPerWeek), 1, 6)
      : suggestFrequencyPerWeek({ exerciseType, baselineMaxReps, targetReps, ageYears, weightKg });
  const durationWeeks = kind !== 'distance' && raw.durationWeeks != null
    ? clampInt(Number(raw.durationWeeks), 4, 24)
    : suggestDurationWeeks({ exerciseType, baselineMaxReps, targetReps, ageYears, weightKg, frequencyPerWeek });

  const sexRaw = String(raw.sex || 'unknown').trim().toLowerCase();
  const sex = ['male', 'female', 'other', 'unknown'].includes(sexRaw) ? sexRaw : 'unknown';

  return {
    exerciseType,
    programKind: kind,
    baselineMaxReps,
    targetReps,
    loadKg,
    durationWeeks,
    frequencyPerWeek,
    ageYears,
    weightKg,
    sex,
    startDate: raw.startDate ?? null,
  };
}

function bodyNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Тело запроса создания программы (личной и назначенной в группе) → вход `createTrainingProgram`.
 * Неизвестное упражнение — 400, без подмены на отжимания. Возраст, вес и пол, которых нет
 * в запросе, берутся из профиля (`profile`).
 */
export function parseProgramCreateBody(
  body: Record<string, unknown>,
  profile: { ageYears: number; weightKg: number; sex: string },
): ProgramCreateInput {
  const exerciseType = typeof body.exerciseType === 'string' ? body.exerciseType.trim() : '';
  if (!isProgramExerciseType(exerciseType)) {
    throw new ProgramError('Некорректный тип упражнения', 400, 'PROGRAM_EXERCISE_INVALID');
  }
  const baselineMaxReps = bodyNumber(body.baselineMaxReps) ?? 1;
  const targetReps = bodyNumber(body.targetReps) ?? baselineMaxReps;
  const ageYears = bodyNumber(body.ageYears) || profile.ageYears;
  const weightKg = bodyNumber(body.weightKg) || profile.weightKg;
  const frequencyPerWeek = bodyNumber(body.frequencyPerWeek)
    ?? suggestFrequencyPerWeek({ exerciseType, baselineMaxReps, targetReps, ageYears, weightKg });
  const durationWeeks = bodyNumber(body.durationWeeks)
    ?? suggestDurationWeeks({ exerciseType, baselineMaxReps, targetReps, ageYears, weightKg, frequencyPerWeek });

  return {
    exerciseType,
    baselineMaxReps,
    targetReps,
    loadKg: isLoadedExercise(exerciseType) ? bodyNumber(body.loadKg) : null,
    durationWeeks,
    frequencyPerWeek,
    ageYears,
    weightKg,
    sex: String(body.sex || profile.sex || 'unknown').trim().toLowerCase(),
    startDate: body.startDate ? String(body.startDate) : null,
  };
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type DistanceSessionKind = 'easy' | 'interval' | 'long';
/** Вид занятия: дистанция — лёгкое/интервалы/длинное; круговая — `test` (тест-круг). */
export type ProgramSessionKind = DistanceSessionKind | 'test';

export type ProgramDraftSet = {
  setNumber: number;
  targetReps: number;
  restSeconds: number;
  isKeySet: boolean;
  /** Вес гири подхода (гиревые программы, станции кругов с гирей). */
  loadKg?: number | null;
  /** Круговая: упражнение станции, номер круга и станции (с 1). */
  exerciseType?: ExerciseType | null;
  round?: number | null;
  station?: number | null;
};

export type ProgramDraftSession = {
  weekNumber: number;
  sessionNumber: number;
  day: DayKey;
  scheduledAt: Date;
  isFinalTest: boolean;
  /** Дистанция: лёгкое / интервалы / длинное; круговая: `test` — тест-круг. */
  sessionKind?: ProgramSessionKind | null;
  /** Круговая: день ротации и шаблон круга. */
  dayLabel?: CircuitDayLabel | null;
  circuitTemplateId?: string | null;
  sets: ProgramDraftSet[];
};

function restSecondsFor(idx: number): number {
  return GOAL_TEMPLATE.rest[idx] ?? GOAL_TEMPLATE.rest[GOAL_TEMPLATE.rest.length - 1] ?? 90;
}

function finalTestSets(targetReps: number, loadKg: number | null = null): ProgramDraftSet[] {
  return [{ setNumber: 1, targetReps, restSeconds: 0, isKeySet: true, ...(loadKg != null ? { loadKg } : {}) }];
}

function withLoad(sets: ProgramDraftSet[], loadKg: number | null): ProgramDraftSet[] {
  return loadKg != null ? sets.map((st) => ({ ...st, loadKg })) : sets;
}

// ---------------------------------------------------------------------------
// Distance: «пройти X км без остановки» (R08.6)
// ---------------------------------------------------------------------------

/** Занятий в неделю у дистанционной программы: лёгкое, интервалы, длинное. */
export const DISTANCE_FREQUENCY = 3;
/** Рост недельного объёма — не больше 10%. */
export const DISTANCE_WEEKLY_GROWTH = 1.1;
const DISTANCE_MAX_TRAINING_WEEKS = 23;
const DISTANCE_INTERVAL_REPS = 4;
const DISTANCE_INTERVAL_REST_SECONDS = 90;
// Дни занятий от начала недели программы.
const DISTANCE_DAY_OFFSETS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5] };
const DISTANCE_KINDS: Record<number, DistanceSessionKind[]> = {
  2: ['easy', 'long'],
  3: ['easy', 'interval', 'long'],
  4: ['easy', 'interval', 'easy', 'long'],
};

export type DistancePlanSession = {
  kind: DistanceSessionKind;
  sets: Array<{ targetReps: number; restSeconds: number; isKeySet: boolean }>;
};
export type DistancePlanWeek = { weekNumber: number; longMeters: number; volumeMeters: number; sessions: DistancePlanSession[] };

function floorTo10(meters: number): number {
  return Math.max(10, Math.floor(meters / 10) * 10);
}

function distanceSession(kind: DistanceSessionKind, longMeters: number): DistancePlanSession {
  if (kind === 'long') return { kind, sets: [{ targetReps: longMeters, restSeconds: 0, isKeySet: true }] };
  if (kind === 'easy') return { kind, sets: [{ targetReps: floorTo10(longMeters * 0.5), restSeconds: 0, isKeySet: false }] };
  const rep = floorTo10(longMeters * 0.1);
  return {
    kind,
    sets: Array.from({ length: DISTANCE_INTERVAL_REPS }, (_, i) => ({
      targetReps: rep,
      restSeconds: i === DISTANCE_INTERVAL_REPS - 1 ? 0 : DISTANCE_INTERVAL_REST_SECONDS,
      isKeySet: false,
    })),
  };
}

function sessionVolume(session: DistancePlanSession): number {
  return session.sets.reduce((sum, st) => sum + st.targetReps, 0);
}

/**
 * Недели дистанционной программы до финального теста. Длинная тренировка начинается с базы
 * (дистанция, которую человек проходит без остановки сейчас) и растёт геометрически до ~90% цели,
 * не быстрее 10% в неделю; лёгкое — половина длинной, интервалы — 4 × 10% длинной. Недельный объём
 * не больше 1,1 × предыдущего: лишнее после округления снимается с лёгких занятий. Минимум 4 недели.
 */
export function buildDistancePlan(args: {
  baselineMeters: number;
  targetMeters: number;
  frequencyPerWeek?: number | null;
}): { weeks: DistancePlanWeek[] } {
  const base = clampInt(args.baselineMeters, 100, MAX_DISTANCE_METERS);
  const target = clampInt(args.targetMeters, base, MAX_DISTANCE_METERS);
  const freq = clampInt(Number(args.frequencyPerWeek ?? DISTANCE_FREQUENCY), 2, 4);
  const kinds = DISTANCE_KINDS[freq];

  const peak = Math.max(base, Math.floor((target * 0.9) / 10) * 10);
  let stepsNeeded = 0;
  for (let long = base; long < peak && stepsNeeded < DISTANCE_MAX_TRAINING_WEEKS - 1; stepsNeeded += 1) {
    long = maxDistanceLongStep(long);
  }
  const weekCount = Math.min(DISTANCE_MAX_TRAINING_WEEKS, Math.max(4, stepsNeeded + 1));

  const weeks: DistancePlanWeek[] = [];
  let prevLong = base;
  let prevVolume: number | null = null;
  for (let w = 1; w <= weekCount; w += 1) {
    // Рост под оставшиеся недели пересчитывается каждую неделю: округление до 10 м не копит недобор,
    // и длинная к последней неделе доходит до 90% цели (если это вообще достижимо за 10% в неделю).
    const growth = peak > prevLong ? (peak / prevLong) ** (1 / (weekCount - w + 1)) : 1;
    const longMeters = w === 1
      ? base
      : Math.max(prevLong, Math.min(peak, maxDistanceLongStep(prevLong), Math.ceil((prevLong * growth) / 10) * 10));
    const sessions = kinds.map((kind) => distanceSession(kind, longMeters));
    let volume = sessions.reduce((sum, s) => sum + sessionVolume(s), 0);

    if (prevVolume != null) {
      const cap = Math.floor(prevVolume * DISTANCE_WEEKLY_GROWTH);
      for (const s of sessions) {
        if (volume <= cap) break;
        if (s.kind !== 'easy') continue;
        const set = s.sets[0];
        const cut = Math.min(set.targetReps - 10, Math.ceil((volume - cap) / 10) * 10);
        set.targetReps -= cut;
        volume -= cut;
      }
    }

    weeks.push({ weekNumber: w, longMeters, volumeMeters: volume, sessions });
    prevLong = longMeters;
    prevVolume = volume;
  }
  return { weeks };
}

/** Длинная тренировка следующей недели при максимальном росте: +10%, вниз до 10 м, не меньше текущей. */
function maxDistanceLongStep(longMeters: number): number {
  return Math.max(longMeters, Math.floor((longMeters * DISTANCE_WEEKLY_GROWTH) / 10) * 10);
}

/**
 * Самая дальняя цель «без остановки», до которой дорастает план от базы `baselineMeters`:
 * длинная за максимум недель (≈ база × 1,1^(недели − 1)) — это 90% цели. Дальше — 400
 * `PROGRAM_DISTANCE_TOO_FAR`: план не обещает недостижимое.
 */
export function distanceTargetLimit(baselineMeters: number): number {
  const range = programValueRange('run');
  const base = clampInt(baselineMeters, range.min, range.max);
  let long = base;
  for (let w = 2; w <= DISTANCE_MAX_TRAINING_WEEKS; w += 1) long = maxDistanceLongStep(long);
  return Math.max(base, Math.min(MAX_DISTANCE_METERS, Math.floor(long / 0.9 / 10) * 10));
}

/** Метры → «8,8 км» / «8.8 km» (до 10 м, как `formatDistance`). */
function formatKm(meters: number, locale: 'ru' | 'en'): string {
  const km = String(Math.round(meters / 10) / 100);
  return `${locale === 'en' ? km : km.replace('.', ',')} ${locale === 'en' ? 'km' : 'км'}`;
}

/** Текст ошибки «цель дальше, чем дорастает план» на языке запроса (API) или интерфейса. */
export function distanceTooFarMessage(maxTargetMeters: number, locale: string): string {
  const lang = locale === 'en' ? 'en' : 'ru';
  return programsMessages[lang].errors.distanceTooFar(formatKm(maxTargetMeters, lang));
}

function distanceDraftSessions(args: {
  plan: DistancePlanWeek[];
  frequencyPerWeek: number;
  firstDay: DayKey;
  startDay: DayKey;
  firstSessionNumber: number;
  targetMeters: number;
  timeZone: string;
}): ProgramDraftSession[] {
  const freq = clampInt(args.frequencyPerWeek, 2, 4);
  const offsets = DISTANCE_DAY_OFFSETS[freq];
  const out: ProgramDraftSession[] = [];
  let sessionNumber = args.firstSessionNumber;
  args.plan.forEach((week, weekIdx) => {
    week.sessions.forEach((session, idx) => {
      const day = addDays(args.firstDay, weekIdx * 7 + (offsets[idx] ?? idx * 2));
      out.push({
        weekNumber: weekNumberFor(day, args.startDay),
        sessionNumber,
        day,
        scheduledAt: programSessionInstant(day, args.timeZone),
        isFinalTest: false,
        sessionKind: session.kind,
        sets: session.sets.map((st, i) => ({ setNumber: i + 1, ...st })),
      });
      sessionNumber += 1;
    });
  });
  const finalDay = addDays(args.firstDay, args.plan.length * 7);
  out.push({
    weekNumber: weekNumberFor(finalDay, args.startDay),
    sessionNumber,
    day: finalDay,
    scheduledAt: programSessionInstant(finalDay, args.timeZone),
    isFinalTest: true,
    sessionKind: null,
    sets: finalTestSets(args.targetMeters),
  });
  return out;
}

/**
 * Продление дистанционной программы после несданного финального теста: новый план «+10% в неделю»
 * от пройденного на тесте до цели и новый финальный тест; не раньше чем через 2 дня после теста и сегодня.
 */
export function planDistanceExtension(args: {
  targetMeters: number;
  finalTestActual: number;
  frequencyPerWeek: number;
  startDay: DayKey;
  lastTestDay: DayKey;
  nextSessionNumber: number;
  clock: ProgramClock;
}): ProgramDraftSession[] {
  const timeZone = normalizeTimeZone(args.clock.timeZone);
  const today = dayKeyInZone(args.clock.now, timeZone);
  const plan = buildDistancePlan({
    baselineMeters: Math.max(100, Math.min(args.finalTestActual, args.targetMeters)),
    targetMeters: args.targetMeters,
    frequencyPerWeek: args.frequencyPerWeek,
  });
  return distanceDraftSessions({
    plan: plan.weeks,
    frequencyPerWeek: args.frequencyPerWeek,
    firstDay: addDays(laterDay(args.lastTestDay, today), 2),
    startDay: args.startDay,
    firstSessionNumber: args.nextSessionNumber,
    targetMeters: args.targetMeters,
    timeZone,
  });
}

/** Следующий вес гири из пресетов упражнения после `loadKg`; null — тяжелее нет или упражнение без гири. */
export function nextKettlebellLoad(exerciseType: string, loadKg: number | null | undefined): number | null {
  if (!isExerciseType(exerciseType)) return null;
  const load = EXERCISES[exerciseType].load;
  const kg = Number(loadKg);
  if (!load || !Number.isFinite(kg)) return null;
  return load.presetsKg.find((preset) => preset > kg) ?? null;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export function buildProgramDraft(input: ProgramCreateInput, clock: ProgramClock) {
  const timeZone = normalizeTimeZone(clock.timeZone);
  const clean = normalizeCreateInput(input);
  const startDay = resolveProgramStartDay(clean.startDate, { now: clock.now, timeZone });

  if (clean.programKind === 'distance') {
    const plan = buildDistancePlan({
      baselineMeters: clean.baselineMaxReps,
      targetMeters: clean.targetReps,
      frequencyPerWeek: clean.frequencyPerWeek,
    });
    const sessions = distanceDraftSessions({
      plan: plan.weeks,
      frequencyPerWeek: clean.frequencyPerWeek,
      firstDay: startDay,
      startDay,
      firstSessionNumber: 1,
      targetMeters: clean.targetReps,
      timeZone,
    });
    const finalDay = sessions[sessions.length - 1].day;
    return {
      clean: { ...clean, durationWeeks: Math.ceil((diffDays(finalDay, startDay) + 1) / 7) },
      startDay,
      sessions,
    };
  }

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

    const sets = withLoad(GOAL_TEMPLATE.percentages.map((_, idx) => {
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
    }), clean.loadKg);

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
    sets: finalTestSets(clean.targetReps, clean.loadKg),
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
// Круговая программа-ротация (R09.3–R09.6)
// ---------------------------------------------------------------------------

/** Недели и частота круговой программы. */
export const CIRCUIT_PROGRAM_WEEKS = { min: 4, max: 12, default: 8 } as const;
export const CIRCUIT_PROGRAM_FREQUENCY = { min: 2, max: 4, default: 3 } as const;

export type CircuitProgramCreateInput = {
  circuitPlanId: string;
  durationWeeks?: number | null;
  frequencyPerWeek?: number | null;
  ageYears?: number | null;
  weightKg?: number | null;
  sex?: string | null;
  startDate?: string | Date | null;
};

/** Тело запроса создания программы — круговая (`programType: 'circuit'`)? */
export function isCircuitProgramBody(body: Record<string, unknown> | null | undefined): boolean {
  return Boolean(body) && body?.programType === 'circuit';
}

function circuitPlanOrThrow(id: unknown) {
  const plan = typeof id === 'string' ? getCircuitPlan(id.trim()) : null;
  if (!plan) throw new ProgramError('Неизвестная круговая программа', 400, 'CIRCUIT_PLAN_INVALID');
  return plan;
}

/** Тело запроса круговой программы (личной и назначенной в группе); возраст/вес/пол — из профиля, если их нет. */
export function parseCircuitProgramCreateBody(
  body: Record<string, unknown>,
  profile: { ageYears: number; weightKg: number; sex: string },
): CircuitProgramCreateInput {
  const plan = circuitPlanOrThrow(body.circuitPlanId);
  return {
    circuitPlanId: plan.id,
    durationWeeks: bodyNumber(body.durationWeeks),
    frequencyPerWeek: bodyNumber(body.frequencyPerWeek),
    ageYears: bodyNumber(body.ageYears) || profile.ageYears,
    weightKg: bodyNumber(body.weightKg) || profile.weightKg,
    sex: String(body.sex || profile.sex || 'unknown').trim().toLowerCase(),
    startDate: body.startDate ? String(body.startDate) : null,
  };
}

function circuitDraftSets(sets: ReturnType<typeof circuitSessionSets>): ProgramDraftSet[] {
  return sets.map((st) => ({ ...st }));
}

/**
 * Расписание круговой программы: `durationWeeks × frequencyPerWeek` занятий в дни недели по
 * частоте (как у дистанции). Первое — тест-круг дня A (один круг на максимум, без отдыха); дальше
 * дни ротации по кругу, продолжая после A: B, C, A… Цели до теста — 70% целей шаблона, рост ~10%
 * в неделю (`progressCircuit`); после теста их пересчитывает сервер от результатов (`planCircuitSession`).
 * Финального теста нет: программа завершается, когда пройдены все занятия.
 */
export function buildCircuitProgramDraft(input: CircuitProgramCreateInput, clock: ProgramClock) {
  const timeZone = normalizeTimeZone(clock.timeZone);
  const plan = circuitPlanOrThrow(input.circuitPlanId);
  const durationWeeks = clampInt(Number(input.durationWeeks ?? CIRCUIT_PROGRAM_WEEKS.default), CIRCUIT_PROGRAM_WEEKS.min, CIRCUIT_PROGRAM_WEEKS.max);
  const frequencyPerWeek = clampInt(
    Number(input.frequencyPerWeek ?? CIRCUIT_PROGRAM_FREQUENCY.default),
    CIRCUIT_PROGRAM_FREQUENCY.min,
    CIRCUIT_PROGRAM_FREQUENCY.max,
  );
  const startDay = resolveProgramStartDay(input.startDate ?? null, { now: clock.now, timeZone });
  const offsets = DISTANCE_DAY_OFFSETS[frequencyPerWeek];
  const firstDay = plan.days[0];
  const testTemplate = getCircuitTemplate(firstDay.templateId);
  if (!testTemplate) throw new ProgramError('Неизвестная круговая программа', 400, 'CIRCUIT_PLAN_INVALID');

  const sessions: ProgramDraftSession[] = [];
  const total = durationWeeks * frequencyPerWeek;
  for (let i = 0; i < total; i += 1) {
    const day = addDays(startDay, Math.floor(i / frequencyPerWeek) * 7 + (offsets[i % frequencyPerWeek] ?? 0));
    const weekNumber = weekNumberFor(day, startDay);
    const rotation = plan.days[i % plan.days.length];
    const sets = i === 0
      ? circuitSessionSets(circuitTestSpec(testTemplate))
      : planCircuitSession(rotation.templateId, weekNumber, null) ?? [];
    sessions.push({
      weekNumber,
      sessionNumber: i + 1,
      day,
      scheduledAt: programSessionInstant(day, timeZone),
      isFinalTest: false,
      sessionKind: i === 0 ? 'test' : null,
      dayLabel: rotation.label,
      circuitTemplateId: rotation.templateId,
      sets: circuitDraftSets(sets),
    });
  }

  const sexRaw = String(input.sex || 'unknown').trim().toLowerCase();
  return {
    clean: {
      programType: 'circuit' as const,
      exerciseType: 'circuit' as const,
      circuitPlanId: plan.id,
      durationWeeks,
      frequencyPerWeek,
      ageYears: clampInt(Number(input.ageYears ?? 25), 8, 90),
      weightKg: clampInt(Number(input.weightKg ?? 70), 30, 250),
      sex: ['male', 'female', 'other', 'unknown'].includes(sexRaw) ? sexRaw : 'unknown',
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
  /** Вес гири гиревой программы — переносится в подходы продления. */
  loadKg?: number | null;
}): ProgramDraftSession[] {
  const timeZone = normalizeTimeZone(args.clock.timeZone);
  const today = dayKeyInZone(args.clock.now, timeZone);
  const loadKg = args.loadKg ?? null;
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

    const sets = withLoad(GOAL_TEMPLATE.percentages.map((p, idx) => {
      const setNumber = idx + 1;
      return {
        setNumber,
        targetReps: setNumber === GOAL_TEMPLATE.keySet
          ? keyTarget
          : clampInt(Math.round(keyTarget * p * periodized), 1, targetReps),
        restSeconds: restSecondsFor(idx),
        isKeySet: setNumber === GOAL_TEMPLATE.keySet,
      };
    }), loadKg);

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
    sets: finalTestSets(targetReps, loadKg),
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

export type AutofillProgram = { exerciseType: string; programType?: string | null; loadKg?: number | null };

/**
 * Можно ли честно закрыть просроченное занятие программы обычными тренировками дня (R08.10):
 * только однокомпонентная программа без веса, не дистанционная и не «на сторону» (у тех цель —
 * на сторону, а тренировка хранит сумму). Остальные пропущенные занятия сдвигаются.
 */
export function canAutofillProgram(program: AutofillProgram): boolean {
  if ((program.programType ?? 'single') !== 'single') return false;
  if (program.loadKg != null) return false;
  const kind = programKind(program.exerciseType);
  if (kind !== 'reps' && kind !== 'timed') return false;
  return !isUnilateralExercise(program.exerciseType);
}

/**
 * Overdue training sessions that ordinary workouts of the same day count for.
 * A final test is never filled from a day total — it measures a single set.
 * A day closes at most one session: `consumedDays` are days whose ordinary workouts already
 * closed a session (of this or another program on the same exercise, see `autofilledDays`).
 */
export function planOverdueAutofill(args: {
  sessions: AutofillSession[];
  dayTotals: Map<DayKey, number>;
  clock: ProgramClock;
  consumedDays?: Iterable<DayKey>;
  /** Программа занятий; без неё — как у однокомпонентной программы без веса. */
  program?: AutofillProgram;
}): AutofillPlan[] {
  if (args.program && !canAutofillProgram(args.program)) return [];
  const today = programDayOf(args.clock.now, args.clock.timeZone);
  const consumedDays = new Set<DayKey>(args.consumedDays ?? []);
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

/**
 * Days whose ordinary workouts already closed a session: autofill marks a session done
 * at its own scheduled instant (`completedAt = scheduledAt`), a real completion never does.
 */
export function autofilledDays(
  sessions: Array<{ scheduledAt: Date; completed: boolean; completedAt: Date | null }>,
  timeZone: string,
): Set<DayKey> {
  const days = new Set<DayKey>();
  for (const s of sessions) {
    if (s.completed && s.completedAt && s.completedAt.getTime() === s.scheduledAt.getTime()) {
      days.add(programDayOf(s.scheduledAt, timeZone));
    }
  }
  return days;
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

/** The idempotency key of the workout of a program set: one workout per set, however often it is sent. */
export function programSetClientRequestId(setId: string): string {
  return `program-set:${setId}`;
}

export type SetResultInput = {
  actualReps?: unknown;
  actualLeft?: unknown;
  actualRight?: unknown;
  actualSeconds?: unknown;
};

export type SetResult = {
  /** Итог для цели подхода: повторы/секунды/метры; у «на сторону» — слабая сторона. */
  actualReps: number;
  actualLeft: number | null;
  actualRight: number | null;
  /** Время дистанции, секунды (необязательно). */
  actualSeconds: number | null;
};

function optionalInt(raw: unknown, min: number, max: number, message: string): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || Math.round(n) < min || Math.round(n) > max) throw new ProgramError(message, 400, 'PROGRAM_SET_INVALID');
  return Math.round(n);
}

/**
 * Факт подхода по виду упражнения. «На сторону»: обе стороны (если пришло одно число — его сделали
 * обе стороны), итог для цели — слабая сторона. Дистанция: метры и, по желанию, время.
 */
export function resolveSetResult(exerciseType: string, input: SetResultInput): SetResult {
  const kind = kindOf(exerciseType);
  const max = kind === 'distance' ? MAX_DISTANCE_METERS : 5000;
  const valueError = kind === 'distance' ? 'Дистанция подхода — от 10 м до 300 км' : `Результат подхода — от 1 до ${max}`;

  if (isUnilateralExercise(exerciseType)) {
    const left = optionalInt(input.actualLeft, 0, max, 'Результат стороны — целое число от 0');
    const right = optionalInt(input.actualRight, 0, max, 'Результат стороны — целое число от 0');
    if (left != null || right != null) {
      const l = left ?? 0;
      const r = right ?? 0;
      if (l + r <= 0) throw new ProgramError('Запишите результат хотя бы одной стороны', 400, 'PROGRAM_SET_INVALID');
      return { actualReps: Math.min(l, r), actualLeft: l, actualRight: r, actualSeconds: null };
    }
    const both = optionalInt(input.actualReps, 1, max, valueError);
    if (both == null) throw new ProgramError(valueError, 400, 'PROGRAM_SET_INVALID');
    return { actualReps: both, actualLeft: both, actualRight: both, actualSeconds: null };
  }

  const value = optionalInt(input.actualReps, kind === 'distance' ? 10 : 1, max, valueError);
  if (value == null) throw new ProgramError(valueError, 400, 'PROGRAM_SET_INVALID');
  const seconds = kind === 'distance'
    ? optionalInt(input.actualSeconds, 1, MAX_DURATION_SECONDS, 'Время — от 1 секунды до 48 часов')
    : null;
  return { actualReps: value, actualLeft: null, actualRight: null, actualSeconds: seconds };
}

/** Значение тренировки подхода: у «на сторону» — сумма сторон, иначе итог подхода. */
export function programSetWorkoutReps(set: { actualReps: number | null; actualLeft?: number | null; actualRight?: number | null }): number {
  if (set.actualLeft != null || set.actualRight != null) return (set.actualLeft ?? 0) + (set.actualRight ?? 0);
  return set.actualReps ?? 0;
}

export type ProgramSetWorkoutInput = {
  exerciseType: string;
  reps: number;
  repsLeft?: number;
  repsRight?: number;
  loadKg?: number;
  durationSeconds?: number;
  date: DayKey;
  time: string;
  clientRequestId: string;
};

/** The `createWorkoutForUser` input of a recorded program set (its local day and `programSetWorkoutTime`). */
export function programSetWorkoutInput(args: {
  setId: string;
  setNumber: number;
  exerciseType: string;
  actualReps: number;
  actualLeft?: number | null;
  actualRight?: number | null;
  actualSeconds?: number | null;
  loadKg?: number | null;
  doneAt: Date;
  timeZone: string;
}): ProgramSetWorkoutInput {
  const sides = args.actualLeft != null || args.actualRight != null;
  return {
    exerciseType: args.exerciseType,
    reps: programSetWorkoutReps(args),
    ...(sides ? { repsLeft: args.actualLeft ?? 0, repsRight: args.actualRight ?? 0 } : {}),
    ...(args.loadKg != null && isLoadedExercise(args.exerciseType) ? { loadKg: args.loadKg } : {}),
    ...(args.actualSeconds != null && kindOf(args.exerciseType) === 'distance' ? { durationSeconds: args.actualSeconds } : {}),
    date: programDayOf(args.doneAt, args.timeZone),
    time: programSetWorkoutTime(args.doneAt, args.setNumber).toISOString(),
    clientRequestId: programSetClientRequestId(args.setId),
  };
}

/**
 * Records a program set once: `claim` fills the set only if it is still empty; only the request
 * that claimed it runs `create` (the workout, points, notifications). If `create` fails, `release`
 * empties the set again and the error goes on. A request that lost the claim gets `null`.
 */
export async function recordClaimedSet<T>(steps: {
  claim(): Promise<boolean>;
  create(): Promise<T>;
  release(): Promise<void>;
}): Promise<T | null> {
  if (!(await steps.claim())) return null;
  try {
    return await steps.create();
  } catch (e) {
    await steps.release();
    throw e;
  }
}

export type SessionSetRecord = {
  setNumber: number;
  actualReps: number | null;
  actualLeft?: number | null;
  actualRight?: number | null;
  completedAt: Date | null;
};

/**
 * Recorded sets that have no matching `Workout` (e.g. one was deleted on the dashboard).
 * A workout matches a set by its time (`programSetWorkoutTime`), otherwise by equal reps
 * (for a one-side set — the sum of both sides, as the workout stores it).
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
    const expectedReps = programSetWorkoutReps(set);
    const idx = remaining.findIndex((w) => w.reps === expectedReps);
    if (idx >= 0) remaining.splice(idx, 1);
    else missing.push(set);
  }

  return missing.sort((a, b) => a.setNumber - b.setNumber);
}

export type RestoredSetRow = SessionSetRecord & {
  id: string;
  /** Упражнение подхода (круговые); null — упражнение программы. */
  exerciseType?: string | null;
  actualSeconds?: number | null;
  loadKg?: number | null;
};

/**
 * Строки `createMany` для подходов без тренировки при завершении занятия: восстановление
 * (без лимита и уведомлений) с весом гири, сторонами, временем дистанции и активными калориями.
 */
export function restoredSetWorkoutRows(args: {
  sets: RestoredSetRow[];
  program: { userId: string; exerciseType: string; loadKg?: number | null };
  sessionId: string;
  timeZone: string;
  now: Date;
  body: BodyMetrics;
}) {
  return args.sets.map((st) => {
    const doneAt = st.completedAt ?? args.now;
    const exerciseType = st.exerciseType || args.program.exerciseType;
    const input = programSetWorkoutInput({
      setId: st.id,
      setNumber: st.setNumber,
      exerciseType,
      actualReps: st.actualReps ?? 0,
      actualLeft: st.actualLeft,
      actualRight: st.actualRight,
      actualSeconds: st.actualSeconds,
      loadKg: st.loadKg ?? args.program.loadKg ?? null,
      doneAt,
      timeZone: args.timeZone,
    });
    const date = programWorkoutDate(doneAt, args.timeZone);
    const row = {
      userId: args.program.userId,
      reps: input.reps,
      loadKg: input.loadKg ?? null,
      repsLeft: input.repsLeft ?? null,
      repsRight: input.repsRight ?? null,
      durationSeconds: input.durationSeconds ?? null,
      date,
      time: programSetWorkoutTime(doneAt, st.setNumber),
      exerciseType,
      trainingSessionId: args.sessionId,
      clientRequestId: input.clientRequestId,
    };
    return { ...row, activeKcal: estimateActiveEnergy(row, args.body, dbDateToDayKey(row.date)) };
  });
}

// ---------------------------------------------------------------------------
// Program label (R08.9)
// ---------------------------------------------------------------------------

export type ProgramLabelSource = {
  exerciseType: string;
  programType?: string | null;
  loadKg?: number | null;
  circuitPlanId?: string | null;
  /** Название плана круговой программы (из каталога кругов). */
  circuitTitle?: { ru: string; en: string } | null;
};

/**
 * Название программы для уведомлений, календаря и списков: упражнение, у гиревой — с весом
 * («Махи гирей · 16 кг»), у круговой — «Круговая · <план>».
 */
export function programLabel(program: ProgramLabelSource, locale: string = 'ru'): string {
  const en = locale === 'en';
  if (program.programType === 'circuit' || program.exerciseType === 'circuit') {
    const head = en ? 'Circuit' : 'Круговая';
    const source = program.circuitTitle ?? CIRCUIT_PLANS.find((p) => p.id === program.circuitPlanId)?.title ?? null;
    const title = source ? source[en ? 'en' : 'ru'] : null;
    return title ? `${head} · ${title}` : head;
  }
  const name = exerciseLabel(program.exerciseType, en ? 'en' : 'ru');
  const kg = Number(program.loadKg);
  if (program.loadKg != null && Number.isFinite(kg) && kg > 0 && isLoadedExercise(program.exerciseType)) {
    const value = Number.isInteger(kg) ? String(kg) : String(Math.round(kg * 10) / 10).replace('.', en ? '.' : ',');
    return `${name} · ${value} ${en ? 'kg' : 'кг'}`;
  }
  return name;
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
  exerciseType: string,
  managedByGroupId: string | null | undefined,
): { exerciseType: string; managedByGroupId: string | null } {
  return { exerciseType, managedByGroupId: managedByGroupId || null };
}

/** The `updateMany` filter of the active programs a new one switches off (see `programReplacementScope`). */
export function programReplacementWhere(
  userId: string,
  exerciseType: string,
  managedByGroupId: string | null | undefined,
): { userId: string; isActive: true; exerciseType: string; managedByGroupId: string | null } {
  return { userId, isActive: true, ...programReplacementScope(exerciseType, managedByGroupId) };
}
