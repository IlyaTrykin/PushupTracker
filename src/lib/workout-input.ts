import { addDays, diffDays, localHHMM, parseDayKey, zonedTimeToInstant, type DayKey } from '@/lib/calendar-day';
import { getExercise, isDistanceExercise, isExerciseType, type ExerciseType } from '@/lib/exercises';

export const MAX_WORKOUT_VALUE = 9999;
export const MAX_LOAD_KG = 200;
/** Cardio is stored in metres: 0.01 km … 300 km. */
export const MIN_DISTANCE_METERS = 10;
export const MAX_DISTANCE_METERS = 300_000;
export const MAX_DURATION_SECONDS = 48 * 3600;

/** The ceiling of one workout value depends on the unit (reps/seconds vs metres). */
export function maxWorkoutValue(exerciseType?: string | null): number {
  return isDistanceExercise(exerciseType) ? MAX_DISTANCE_METERS : MAX_WORKOUT_VALUE;
}

export type WorkoutLoadFields = {
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
};

type ParseResult = { ok: true; value: WorkoutLoadFields } | { ok: false; error: string };

function readSide(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_WORKOUT_VALUE) return 'invalid';
  return value;
}

export function normalizeLoadKg(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_LOAD_KG) return null;
  return Math.round(value * 10) / 10;
}

// Разбирает объём подхода из тела запроса с учётом свойств упражнения: у упражнений
// на одну руку итог = левая + правая (если раскладка передана), у упражнений со
// снарядом обязателен вес. Поля, не относящиеся к упражнению, обнуляются.
// `fallback` — текущие значения записи при редактировании.
export function parseWorkoutLoadFields(
  exerciseType: string,
  body: Record<string, unknown>,
  fallback?: WorkoutLoadFields,
): ParseResult {
  const exercise = getExercise(exerciseType);

  let reps = body.reps !== undefined ? Number(body.reps) : fallback?.reps ?? NaN;
  let repsLeft: number | null = null;
  let repsRight: number | null = null;

  if (exercise.unilateral) {
    const hasSides = body.repsLeft !== undefined || body.repsRight !== undefined;
    if (hasSides) {
      const left = readSide(body.repsLeft);
      const right = readSide(body.repsRight);
      if (left === 'invalid' || right === 'invalid') return { ok: false, error: 'Повторы для руки должны быть целым числом ≥ 0' };
      repsLeft = left ?? 0;
      repsRight = right ?? 0;
      reps = repsLeft + repsRight;
    } else if (fallback && (body.reps === undefined || reps === fallback.reps)) {
      // Итог не меняли — раскладка по рукам остаётся прежней.
      repsLeft = fallback.repsLeft;
      repsRight = fallback.repsRight;
    }
  }

  if (isDistanceExercise(exerciseType)) {
    if (!Number.isInteger(reps) || reps < MIN_DISTANCE_METERS || reps > MAX_DISTANCE_METERS) {
      return { ok: false, error: 'Дистанция должна быть от 0,01 до 300 км' };
    }
  } else if (!Number.isInteger(reps) || reps <= 0 || reps > MAX_WORKOUT_VALUE) {
    return { ok: false, error: `Количество должно быть целым числом от 1 до ${MAX_WORKOUT_VALUE}` };
  }

  let loadKg: number | null = null;
  if (exercise.load) {
    loadKg = body.loadKg !== undefined ? normalizeLoadKg(body.loadKg) : fallback?.loadKg ?? null;
    if (loadKg == null) return { ok: false, error: `Укажите вес снаряда (кг, до ${MAX_LOAD_KG})` };
  }

  return { ok: true, value: { reps, loadKg, repsLeft, repsRight } };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Kilometres typed by a person («5,2», «5.2») → whole metres, 0.01–300 km. */
export function parseDistanceKm(raw: unknown): Parsed<number> {
  const invalid = { ok: false as const, error: 'Дистанция должна быть от 0,01 до 300 км' };
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim().replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$/.test(text)) return invalid;
  const meters = Math.round(Number(text) * 1000);
  if (!Number.isFinite(meters) || meters < MIN_DISTANCE_METERS || meters > MAX_DISTANCE_METERS) return invalid;
  return { ok: true, value: meters };
}

/** «мм:сс» or «ч:мм:сс» → seconds; empty → null (time is optional). */
export function parseDurationInput(raw: unknown): Parsed<number | null> {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return { ok: true, value: null };
  const invalid = { ok: false as const, error: 'Время указывается как мм:сс или ч:мм:сс' };
  const match = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(text);
  if (!match) return invalid;
  const hasHours = match[1] !== undefined;
  const minutes = Number(match[2]);
  if (hasHours && minutes > 59) return invalid;
  const total = (hasHours ? Number(match[1]) * 3600 : 0) + minutes * 60 + Number(match[3]);
  if (total <= 0 || total > MAX_DURATION_SECONDS) return invalid;
  return { ok: true, value: total };
}

/**
 * Optional time of a cardio workout from `body.durationSeconds` (`fallback` — the stored value on edit).
 * Other exercises have no duration: always null.
 */
export function parseWorkoutDuration(exerciseType: string, body: Record<string, unknown>, fallback?: number | null): Parsed<number | null> {
  if (!isDistanceExercise(exerciseType)) return { ok: true, value: null };
  const raw = body.durationSeconds;
  if (raw === undefined) return { ok: true, value: fallback ?? null };
  if (raw === null || raw === '') return { ok: true, value: null };
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_DURATION_SECONDS) {
    return { ok: false, error: 'Время должно быть от 1 секунды до 48 часов' };
  }
  return { ok: true, value: seconds };
}

/** Earliest day a workout can be recorded on (spec story 25). */
export const WORKOUT_MIN_DAY: DayKey = '2020-01-01';
export const CLIENT_REQUEST_ID_MAX_LENGTH = 64;
/** Workouts one user may create per 24 hours (spec stories 17, 48). */
export const WORKOUT_CREATE_LIMIT_PER_DAY = 300;

export function parseWorkoutExerciseType(raw: unknown): Parsed<ExerciseType> {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { ok: false, error: 'exerciseType обязателен' };
  if (!isExerciseType(value)) return { ok: false, error: 'Некорректный тип упражнения' };
  return { ok: true, value };
}

/** A real calendar day within [2020-01-01, today + 1]; `today` is the user's day. */
export function parseWorkoutDay(raw: unknown, today: DayKey): Parsed<DayKey> {
  const day = parseDayKey(raw);
  if (!day) return { ok: false, error: 'Некорректная дата: нужен существующий день в формате ГГГГ-ММ-ДД' };
  if (diffDays(day, WORKOUT_MIN_DAY) < 0 || diffDays(day, addDays(today, 1)) > 0) {
    return { ok: false, error: `Дата должна быть не раньше ${WORKOUT_MIN_DAY} и не позже завтрашнего дня` };
  }
  return { ok: true, value: day };
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The instant of the set: an ISO timestamp, or 'HH:MM' on `day` in the user's zone.
 * Without a time — the current wall-clock time of the user on `day`.
 */
export function parseWorkoutTime(raw: unknown, day: DayKey, timeZone: string, now: Date): Parsed<Date> {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: zonedTimeToInstant(day, localHHMM(now, timeZone), timeZone) };
  }
  if (typeof raw !== 'string') return { ok: false, error: 'Некорректное время' };
  if (raw.includes('T')) {
    const instant = new Date(raw);
    if (Number.isNaN(instant.getTime())) return { ok: false, error: 'Некорректное время' };
    return { ok: true, value: instant };
  }
  if (!HHMM_RE.test(raw)) return { ok: false, error: 'Время должно быть в формате ЧЧ:ММ' };
  return { ok: true, value: zonedTimeToInstant(day, raw, timeZone) };
}

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_.:-]+$/;

/** Optional idempotency key of a create request (B04). */
export function parseClientRequestId(raw: unknown): Parsed<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || raw.length > CLIENT_REQUEST_ID_MAX_LENGTH || !CLIENT_REQUEST_ID_RE.test(raw)) {
    return { ok: false, error: 'Некорректный clientRequestId' };
  }
  return { ok: true, value: raw };
}
