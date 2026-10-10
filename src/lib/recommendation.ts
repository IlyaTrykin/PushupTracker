/**
 * «Рекомендация на сегодня» (F12): a plan for the selected exercise from the last 14 days.
 *
 * - Growth: about +5% over the best recent day, split into the number of sets of that day.
 * - Deload: if yesterday was a heavy day (≥ 90% of the recent best), today is lighter
 *   (one set less, ~70% of the best day's volume, sets no bigger than that day's).
 * - Fewer than 3 workouts of this exercise in the window → `null` (the UI invites to train).
 *
 * The plan uses only days before today, so it does not move while the user trains today.
 * Values are in the exercise unit: reps, seconds (step 5 s) or metres (one distance, step 100 m).
 */
import { addDays, diffDays, type DayKey } from './calendar-day';
import { workoutDayKey } from './day-stats';
import { getExercise, toExerciseType, type ExerciseUnit } from './exercises';

export type RecommendationWorkout = { date: string | Date; reps: number; exerciseType?: string | null };

export type TodayRecommendation = {
  sets: number;
  /** Per set, in the exercise unit (reps, seconds, metres). */
  perSet: number;
  unit: ExerciseUnit;
  /** `grow` — a step over the recent best; `deload` — a lighter day after a heavy yesterday. */
  kind: 'grow' | 'deload';
};

export const RECOMMENDATION_WINDOW_DAYS = 14;
export const RECOMMENDATION_MIN_WORKOUTS = 3;
export const RECOMMENDATION_GROWTH = 1.05;
export const RECOMMENDATION_DELOAD = 0.7;
/** Yesterday at or above this share of the recent best day counts as heavy. */
export const HEAVY_DAY_SHARE = 0.9;
const MAX_SETS = 10;

const STEP: Record<ExerciseUnit, number> = { reps: 1, seconds: 5, distance: 100 };

function roundToStep(value: number, step: number): number {
  return Math.max(step, Math.round(value / step) * step);
}

export function recommendToday(
  history: Iterable<RecommendationWorkout>,
  exerciseType: string,
  today: DayKey,
): TodayRecommendation | null {
  const type = toExerciseType(exerciseType);
  const unit = getExercise(type).unit;
  const step = STEP[unit];

  // Per day of the window [today − 14, today − 1]: total and number of sets.
  const days = new Map<DayKey, { total: number; sets: number }>();
  let workoutCount = 0;
  for (const workout of history) {
    // Rows without a type are legacy push-ups (same rule as the rest of the app).
    if (toExerciseType(workout.exerciseType) !== type) continue;
    const value = Number(workout.reps) || 0;
    if (value <= 0) continue;
    const day = workoutDayKey(workout);
    const ago = diffDays(today, day);
    if (ago < 1 || ago > RECOMMENDATION_WINDOW_DAYS) continue;
    workoutCount += 1;
    const row = days.get(day) ?? { total: 0, sets: 0 };
    row.total += value;
    row.sets += 1;
    days.set(day, row);
  }
  if (workoutCount < RECOMMENDATION_MIN_WORKOUTS) return null;

  let best = { total: 0, sets: 0 };
  for (const row of days.values()) {
    if (row.total > best.total) best = row;
  }

  const bestSets = unit === 'distance' ? 1 : Math.min(MAX_SETS, Math.max(1, best.sets));
  const yesterday = days.get(addDays(today, -1));

  if (yesterday && yesterday.total >= best.total * HEAVY_DAY_SHARE) {
    const sets = Math.max(1, bestSets - 1);
    // Fewer and no bigger sets than the best day: the volume goes down, not the set size up.
    const bestSetAverage = best.total / bestSets;
    const perSet = roundToStep(Math.min(bestSetAverage, (best.total * RECOMMENDATION_DELOAD) / sets), step);
    return { sets, perSet, unit, kind: 'deload' };
  }

  const sets = bestSets;
  let perSet = roundToStep((best.total * RECOMMENDATION_GROWTH) / sets, step);
  // Always a step forward, even when +5% rounds away (3 × 5 → 3 × 6).
  while (perSet * sets <= best.total) perSet += step;
  return { sets, perSet, unit, kind: 'grow' };
}
