/**
 * Bot reply texts (pure): what was logged, the day summary, help and errors,
 * in the user's language. Strings live in `features/telegram.ts`.
 */
import { formatGoalPoints } from '../daily-goal';
import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from '../exercise-points';
import { formatWorkoutValue } from '../exercise-metrics';
import { EXERCISE_IDS, isDistanceExercise, resolveFavoriteExercises } from '../exercises';
import { exerciseName, formatNotifyValue, type NotifyLocale } from '../notify';
import { fillTelegramText, telegramMessages } from '../../i18n/messages/features/telegram';

export type ReplyWorkout = {
  exerciseType: string;
  reps: number;
  loadKg: number | null;
  durationSeconds?: number | null;
};

export type ReplyGoal = { done: number; goal: number } | null;

/** Sum of points like «всего за день» (summed in tenths, as `dayPointsTotal`). */
export function workoutsPoints(workouts: Iterable<ReplyWorkout>): number {
  let tenths = 0;
  for (const w of workouts) tenths += pointsToTenths(calculateExercisePoints(w.reps, w.exerciseType, w.loadKg));
  return tenthsToPoints(tenths);
}

function bot(locale: NotifyLocale) {
  return telegramMessages[locale].bot;
}

export function pointsWord(points: number, locale: NotifyLocale): string {
  const [one, few, many] = bot(locale).pointsWords;
  if (!Number.isInteger(points)) return few;
  if (locale === 'en') return points === 1 ? one : many;
  const mod10 = points % 10;
  const mod100 = points % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «отжимания 30», «планка 60 сек», «жим гири 10 × 24 кг», «бег 5,2 км · 26:30 (5:06/км)». */
function workoutWhat(workout: ReplyWorkout, locale: NotifyLocale): string {
  const value = isDistanceExercise(workout.exerciseType)
    ? formatWorkoutValue({ ...workout, durationSeconds: workout.durationSeconds ?? null }, locale)
    : formatNotifyValue(workout.reps, workout.exerciseType, locale, workout.loadKg);
  return `${exerciseName(workout.exerciseType, locale)} ${value}`;
}

function goalLine(locale: NotifyLocale, goal: ReplyGoal): string | null {
  if (!goal || !(goal.goal > 0)) return null;
  const values = { done: formatGoalPoints(goal.done, locale), goal: formatGoalPoints(goal.goal, locale) };
  return fillTelegramText(goal.done >= goal.goal ? bot(locale).goalReached : bot(locale).goalLine, values);
}

/** «Записал: отжимания 30 (+30 баллов).\nЦель дня: 80/100». */
export function workoutRecordedReply(locale: NotifyLocale, workout: ReplyWorkout, goal: ReplyGoal): string {
  const points = calculateExercisePoints(workout.reps, workout.exerciseType, workout.loadKg);
  const first = fillTelegramText(bot(locale).recorded, {
    what: workoutWhat(workout, locale),
    points: formatGoalPoints(points, locale),
    pointsWord: pointsWord(points, locale),
  });
  return [first, goalLine(locale, goal)].filter(Boolean).join('\n');
}

/** «Сегодня: 47 баллов», a line per exercise (catalog order), the goal. */
export function todayReply(locale: NotifyLocale, workouts: ReplyWorkout[], goal: ReplyGoal): string {
  if (!workouts.length) return [bot(locale).todayEmpty, goalLine(locale, goal)].filter(Boolean).join('\n');
  const points = workoutsPoints(workouts);
  const totals = new Map<string, number>();
  for (const w of workouts) totals.set(w.exerciseType, (totals.get(w.exerciseType) ?? 0) + w.reps);
  const order = [...EXERCISE_IDS, ...[...totals.keys()].filter((t) => !(EXERCISE_IDS as readonly string[]).includes(t))];
  const lines = order
    .filter((type) => totals.has(type))
    .map((type) => {
      const total = totals.get(type)!;
      const value = isDistanceExercise(type)
        ? formatWorkoutValue({ exerciseType: type, reps: total }, locale)
        : formatNotifyValue(total, type, locale);
      return `• ${exerciseName(type, locale)}: ${value}`;
    });
  const title = fillTelegramText(bot(locale).todayTitle, {
    points: formatGoalPoints(points, locale),
    pointsWord: pointsWord(points, locale),
  });
  return [title, ...lines, goalLine(locale, goal)].filter(Boolean).join('\n');
}

export function helpReply(locale: NotifyLocale, favorites: readonly string[]): string {
  return fillTelegramText(bot(locale).help, { favorite: exerciseName(resolveFavoriteExercises(favorites)[0], locale) });
}

/** A failed `createWorkoutForUser` (its `code`) as a short localized reply. */
export function workoutErrorReply(locale: NotifyLocale, code: string | null | undefined): string {
  const text = bot(locale);
  if (code === 'RATE_LIMITED') return text.errorRateLimited;
  if (code === 'WORKOUT_DURATION_INVALID') return text.errorDuration;
  if (code === 'WORKOUT_VALUE_INVALID') return text.errorValue;
  return text.errorGeneric;
}

/** «Укажи вес гири, например: «жим 10 24кг»». */
export function needWeightReply(locale: NotifyLocale, exerciseType: string, value: number): string {
  const example = `${exerciseName(exerciseType, locale)} ${value} 24${locale === 'en' ? 'kg' : 'кг'}`;
  return fillTelegramText(bot(locale).needWeight, { example });
}
