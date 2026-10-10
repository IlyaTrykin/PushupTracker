/**
 * Per-day statistics of workouts for the UI (dashboard, friends, group, member pages).
 *
 * A workout belongs to its stored calendar day `Workout.date` (B23), read by UTC parts —
 * never to the local day of `time`. Day arithmetic goes through `calendar-day.ts`, so it
 * does not depend on the browser zone or DST (B24). The streak is `computeStreak` (B12, F4).
 */

import { dayKeyInZone, dbDateToDayKey, diffDays, parseDayKey, weekStart, type DayKey } from './calendar-day';
import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from './exercise-points';
import { computeStreak } from './streak';

export type DayStatsWorkout = {
  date: string | Date;
  reps: number;
  exerciseType?: string | null;
  loadKg?: number | null;
};

export type PeriodStats = {
  totalToday: number;
  totalWeek: number;
  totalMonth: number;
  totalYear: number;
  totalAll: number;
  avgPerDayMonth: number;
  avgPerDayYear: number;
  avgPerDayAll: number;
  /** Days in a row by the single streak rule (alive if the last active day is today or yesterday). */
  streak: number;
  /** This week's freeze is spent on the current streak — shown as ❄️. */
  streakFreezeUsed: boolean;
};

/** The calendar day of a workout: its `date` (UTC midnight, or an ISO string of it). */
export function workoutDayKey(workout: { date: string | Date }): DayKey {
  const { date } = workout;
  if (date instanceof Date) return dbDateToDayKey(date);
  return parseDayKey(String(date).slice(0, 10)) ?? dbDateToDayKey(new Date(date));
}

/** Today in the browser's zone (client components). */
export function localTodayKey(now: Date = new Date()): DayKey {
  let zone = 'UTC';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {}
  return dayKeyInZone(now, zone);
}

export function workoutPoints(workout: DayStatsWorkout): number {
  return calculateExercisePoints(workout.reps, workout.exerciseType ?? null, workout.loadKg ?? null);
}

/** «Всего за день» in points (B27): 20 push-ups + 60 s plank = 26. */
export function dayPointsTotal(workouts: Iterable<DayStatsWorkout>): number {
  let tenths = 0;
  for (const workout of workouts) tenths += pointsToTenths(workoutPoints(workout));
  return tenthsToPoints(tenths);
}

/** The streak of a set of workouts (any exercise with a positive value makes a day active). */
export function workoutStreak(workouts: Iterable<DayStatsWorkout>, today: DayKey) {
  const days = new Set<DayKey>();
  for (const workout of workouts) {
    if ((Number(workout.reps) || 0) > 0) days.add(workoutDayKey(workout));
  }
  return computeStreak(days, today);
}

/**
 * Totals per period in the workouts' own units (reps/seconds), averages per calendar day,
 * and the streak. Workouts after `today` do not count in the periods.
 */
export function computePeriodStats(workouts: Iterable<DayStatsWorkout>, today: DayKey): PeriodStats {
  const byDay = new Map<DayKey, number>();
  for (const workout of workouts) {
    const key = workoutDayKey(workout);
    byDay.set(key, (byDay.get(key) ?? 0) + (Number(workout.reps) || 0));
  }

  const week = weekStart(today);
  const month = `${today.slice(0, 8)}01`;
  const year = `${today.slice(0, 4)}-01-01`;

  let totalWeek = 0;
  let totalMonth = 0;
  let totalYear = 0;
  let totalAll = 0;
  let first: DayKey | null = null;

  for (const [day, value] of byDay) {
    totalAll += value;
    if (!first || day < first) first = day;
    if (diffDays(day, today) > 0) continue;
    if (diffDays(day, week) >= 0) totalWeek += value;
    if (diffDays(day, month) >= 0) totalMonth += value;
    if (diffDays(day, year) >= 0) totalYear += value;
  }

  const average = (total: number, from: DayKey | null) => {
    if (!from) return 0;
    const days = diffDays(today, from) + 1;
    return days > 0 ? Math.round(total / days) : 0;
  };

  const streak = computeStreak(
    Array.from(byDay.entries()).filter(([, value]) => value > 0).map(([day]) => day),
    today,
  );

  return {
    totalToday: byDay.get(today) ?? 0,
    totalWeek,
    totalMonth,
    totalYear,
    totalAll,
    avgPerDayMonth: average(totalMonth, month),
    avgPerDayYear: average(totalYear, year),
    avgPerDayAll: totalAll > 0 ? average(totalAll, first) : 0,
    streak: streak.current,
    streakFreezeUsed: streak.freezeUsedThisWeek,
  };
}

/** Texts of the streak freeze mark (F4). */
export const streakFreezeMessages = {
  ru: {
    badge: '❄️',
    hint: 'Заморозка: один пропущенный день в неделю не обрывает серию. На этой неделе она уже использована.',
    short: 'заморозка использована',
  },
  en: {
    badge: '❄️',
    hint: 'Streak freeze: one missed day a week does not break the streak. It is already used this week.',
    short: 'freeze used',
  },
} as const;
