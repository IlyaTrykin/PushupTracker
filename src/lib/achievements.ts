/**
 * Personal records and badges (F3) — pure rules, safe for client components.
 * Saving, notifications and the league badge live in `workout-hooks.ts` (server).
 */

import { achievementsMessages, fillAchievementText } from '@/i18n/messages/features/achievements';
import type { DayKey } from './calendar-day';
import { workoutDayKey } from './day-stats';
import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from './exercise-points';
import { formatDistance } from './exercise-metrics';
import { EXERCISE_ORDER, exerciseLabel, isDistanceExercise, isLoadedExercise, isTimedExercise, toExerciseType, type ExerciseType } from './exercises';
import { computeStreak } from './streak';

export type BadgeCode = keyof (typeof achievementsMessages)['ru']['badges'];

export type AchievementDef = {
  code: BadgeCode;
  icon: string;
  title: { ru: string; en: string };
  description: { ru: string; en: string };
};

export type RecordKind = 'best_set' | 'best_day';

/** `value`/`previous` are points for loaded exercises, metres for distance, otherwise reps/seconds. */
export type RecordHit = { kind: RecordKind; exerciseType: ExerciseType; value: number; previous: number | null };

/** A saved badge as the API returns it. */
export type AchievementDto = {
  id: string;
  kind: 'badge';
  code: BadgeCode;
  exerciseType: string | null;
  value: number | null;
  workoutId: string | null;
  achievedAt: string;
};

/** `GET /api/achievements/workouts?ids=` — what each workout earned (the 🏆 mark in feeds). */
export type WorkoutAchievementMarks = Record<string, { records: RecordKind[]; badges: BadgeCode[] }>;

export type AchievementWorkout = {
  id: string;
  date: Date | string;
  reps: number;
  exerciseType: string;
  loadKg?: number | null;
};

export type BadgeContext = {
  /** All workouts of the user, the new one included. */
  workouts: AchievementWorkout[];
  newWorkout: AchievementWorkout;
  /** The user's today (streaks end here). */
  today: DayKey;
  dailyGoalPoints?: number | null;
  /** Badge codes the user already has. */
  owned: Iterable<string>;
};

const ICONS: Record<BadgeCode, string> = {
  streak_7: '🔥',
  streak_30: '📅',
  streak_100: '💯',
  points_1000: '⭐',
  points_10000: '🌟',
  points_100000: '🏅',
  pushups_1000: '💪',
  pushups_10000: '🦾',
  first_exercise: '👣',
  daily_goal_first: '🎯',
  league_winner: '🥇',
};

export const BADGE_CODES = Object.keys(ICONS) as BadgeCode[];

export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = BADGE_CODES.map((code) => ({
  code,
  icon: ICONS[code],
  title: { ru: achievementsMessages.ru.badges[code].title, en: achievementsMessages.en.badges[code].title },
  description: { ru: achievementsMessages.ru.badges[code].description, en: achievementsMessages.en.badges[code].description },
}));

export function isBadgeCode(value: unknown): value is BadgeCode {
  return typeof value === 'string' && value in ICONS;
}

/** What a record compares, in tenths: points for loaded exercises, otherwise the value itself (reps, seconds, metres). */
function recordTenths(workout: AchievementWorkout): number {
  const value = Number(workout.reps) || 0;
  if (value <= 0) return 0;
  if (isLoadedExercise(workout.exerciseType)) {
    return pointsToTenths(calculateExercisePoints(value, workout.exerciseType, workout.loadKg ?? null));
  }
  return pointsToTenths(value);
}

/**
 * Records of `newWorkout` against the earlier workouts of the same exercise:
 * - `best_set` — the set beats the best earlier set;
 * - `best_day` — with this set the day's total crosses the best total of any other day
 *   (once per day: later sets of the same day do not repeat it).
 * The very first set of an exercise (and the first day of it) is not a record.
 */
export function detectRecords(history: AchievementWorkout[], newWorkout: AchievementWorkout): RecordHit[] {
  const exerciseType = toExerciseType(newWorkout.exerciseType);
  const same = history.filter((item) => item.id !== newWorkout.id && item.exerciseType === newWorkout.exerciseType);
  const current = recordTenths(newWorkout);
  if (!same.length || current <= 0) return [];

  const hits: RecordHit[] = [];
  const bestSet = Math.max(...same.map(recordTenths));
  if (current > bestSet) {
    hits.push({ kind: 'best_set', exerciseType, value: tenthsToPoints(current), previous: tenthsToPoints(bestSet) });
  }

  const day = workoutDayKey(newWorkout);
  const byDay = new Map<DayKey, number>();
  for (const item of same) {
    const key = workoutDayKey(item);
    byDay.set(key, (byDay.get(key) ?? 0) + recordTenths(item));
  }
  const before = byDay.get(day) ?? 0;
  byDay.delete(day);
  if (byDay.size) {
    const bestOtherDay = Math.max(...byDay.values());
    if (before <= bestOtherDay && before + current > bestOtherDay) {
      hits.push({ kind: 'best_day', exerciseType, value: tenthsToPoints(before + current), previous: tenthsToPoints(bestOtherDay) });
    }
  }
  return hits;
}

const STREAK_BADGES: Array<[BadgeCode, number]> = [['streak_7', 7], ['streak_30', 30], ['streak_100', 100]];
const POINTS_BADGES: Array<[BadgeCode, number]> = [['points_1000', 1000], ['points_10000', 10000], ['points_100000', 100000]];
const PUSHUPS_BADGES: Array<[BadgeCode, number]> = [['pushups_1000', 1000], ['pushups_10000', 10000]];

/**
 * Badges the user earns with `newWorkout`, in `ACHIEVEMENT_DEFS` order, without the ones already owned.
 * Totals and the best streak are taken from the whole history, so a badge for the past comes with
 * the next workout (there is no backfill). `league_winner` is given only by `awardLeagueWinner`.
 */
export function evaluateBadges(ctx: BadgeContext): BadgeCode[] {
  const owned = new Set(ctx.owned);
  const earned = new Set<BadgeCode>();

  const activeDays = new Set<DayKey>();
  let pointsTenths = 0;
  let pushups = 0;
  for (const item of ctx.workouts) {
    const value = Number(item.reps) || 0;
    if (value <= 0) continue;
    activeDays.add(workoutDayKey(item));
    pointsTenths += pointsToTenths(calculateExercisePoints(value, item.exerciseType, item.loadKg ?? null));
    if (item.exerciseType === 'pushups') pushups += value;
  }

  const bestStreak = computeStreak(activeDays, ctx.today).best;
  for (const [code, days] of STREAK_BADGES) if (bestStreak >= days) earned.add(code);
  for (const [code, points] of POINTS_BADGES) if (pointsTenths >= pointsToTenths(points)) earned.add(code);
  for (const [code, count] of PUSHUPS_BADGES) if (pushups >= count) earned.add(code);

  const { newWorkout } = ctx;
  const triedBefore = ctx.workouts.some((item) => item.id !== newWorkout.id && item.exerciseType === newWorkout.exerciseType);
  if (!triedBefore) earned.add('first_exercise');

  const goal = Number(ctx.dailyGoalPoints) || 0;
  if (goal > 0) {
    const day = workoutDayKey(newWorkout);
    const dayTenths = ctx.workouts
      .filter((item) => workoutDayKey(item) === day)
      .reduce((sum, item) => sum + pointsToTenths(calculateExercisePoints(item.reps, item.exerciseType, item.loadKg ?? null)), 0);
    if (dayTenths >= pointsToTenths(goal)) earned.add('daily_goal_first');
  }

  return BADGE_CODES.filter((code) => earned.has(code) && !owned.has(code));
}

export type AchievementLocale = 'ru' | 'en';

function decimal(value: number, locale: AchievementLocale): string {
  const text = String(Math.round(value * 10) / 10);
  return locale === 'en' ? text : text.replace('.', ',');
}

/** A record value with its unit: «31», «240 сек», «5,2 км», «35,6 баллов». */
export function formatRecordValue(value: number, exerciseType: string, locale: AchievementLocale): string {
  if (isLoadedExercise(exerciseType)) return `${decimal(value, locale)} ${achievementsMessages[locale].pointsUnit}`;
  if (isDistanceExercise(exerciseType)) return formatDistance(value, locale);
  if (isTimedExercise(exerciseType)) return `${decimal(value, locale)} ${locale === 'en' ? 's' : 'сек'}`;
  return decimal(value, locale);
}

export function badgeTitle(code: BadgeCode, locale: AchievementLocale): string {
  return achievementsMessages[locale].badges[code].title;
}

/** `friend_achievement`: «bob: новый рекорд подхода — Отжимания: 31; значок «Неделя подряд»». */
export function friendAchievementMessage(
  locale: AchievementLocale,
  args: { username: string; records: RecordHit[]; badges: BadgeCode[] },
): { title: string; body: string; link: string } {
  const text = achievementsMessages[locale];
  const parts = [
    ...args.records.map((hit) =>
      fillAchievementText(hit.kind === 'best_set' ? text.notifyBestSet : text.notifyBestDay, {
        exercise: exerciseLabel(hit.exerciseType, locale),
        value: formatRecordValue(hit.value, hit.exerciseType, locale),
      }),
    ),
    ...args.badges.map((code) => fillAchievementText(text.notifyBadge, { title: badgeTitle(code, locale) })),
  ];
  return { title: text.notifyTitle, body: `${args.username}: ${parts.join('; ')}`, link: '/friends' };
}

export type PersonalBest = {
  exerciseType: ExerciseType;
  bestSet: { value: number; day: DayKey };
  bestDay: { value: number; day: DayKey };
};

/** Best set and best day of every exercise the user has done (catalog order); loaded exercises in points. */
export function personalBests(workouts: AchievementWorkout[]): PersonalBest[] {
  const byExercise = new Map<string, { set: [number, DayKey]; days: Map<DayKey, number> }>();
  for (const item of workouts) {
    const tenths = recordTenths(item);
    if (tenths <= 0) continue;
    const day = workoutDayKey(item);
    const entry = byExercise.get(item.exerciseType) ?? { set: [0, day] as [number, DayKey], days: new Map<DayKey, number>() };
    if (tenths > entry.set[0] || (tenths === entry.set[0] && day < entry.set[1])) entry.set = [tenths, day];
    entry.days.set(day, (entry.days.get(day) ?? 0) + tenths);
    byExercise.set(item.exerciseType, entry);
  }

  return EXERCISE_ORDER.flatMap((exerciseType) => {
    const entry = byExercise.get(exerciseType);
    if (!entry) return [];
    let bestDay: [number, DayKey] = [0, entry.set[1]];
    for (const [day, tenths] of entry.days) {
      if (tenths > bestDay[0] || (tenths === bestDay[0] && day < bestDay[1])) bestDay = [tenths, day];
    }
    return [{
      exerciseType,
      bestSet: { value: tenthsToPoints(entry.set[0]), day: entry.set[1] },
      bestDay: { value: tenthsToPoints(bestDay[0]), day: bestDay[1] },
    }];
  });
}
