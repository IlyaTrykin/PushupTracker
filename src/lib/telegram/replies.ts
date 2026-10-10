/**
 * Bot reply texts (pure): what was logged, the day summary, help and errors,
 * in the user's language. Strings live in `features/telegram.ts`.
 */
import { formatGoalPoints } from '../daily-goal';
import { dayPointsTotal } from '../day-stats';
import { formatWorkoutValue } from '../exercise-metrics';
import { EXERCISE_IDS, getExercise, isDistanceExercise, resolveFavoriteExercises } from '../exercises';
import { exerciseName, formatNotifyValue, type NotifyLocale } from '../notify';
import { fillTelegramText, telegramMessages } from '../../i18n/messages/features/telegram';

export type ReplyWorkout = {
  exerciseType: string;
  reps: number;
  loadKg: number | null;
  durationSeconds?: number | null;
};

export type ReplyGoal = { done: number; goal: number } | null;

/** Points of workouts, summed like «всего за день» everywhere in the app (`dayPointsTotal`; the day is not used). */
export function replyPoints(workouts: Iterable<ReplyWorkout>): number {
  const rows = [];
  for (const w of workouts) rows.push({ date: '', reps: w.reps, exerciseType: w.exerciseType, loadKg: w.loadKg });
  return dayPointsTotal(rows);
}

function bot(locale: NotifyLocale) {
  return telegramMessages[locale].bot;
}

/** Index of the plural form for 1 / 2–4 / 5+ (ru), 1 / other (en); fractions use the second. */
function pluralIndex(n: number, locale: NotifyLocale): 0 | 1 | 2 {
  if (!Number.isInteger(n)) return 1;
  if (locale === 'en') return n === 1 ? 0 : 2;
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

export function pointsWord(points: number, locale: NotifyLocale): string {
  return bot(locale).pointsWords[pluralIndex(points, locale)];
}

/**
 * «30 отжиманий», «10 жимов гири × 24 кг», «30 push-ups» for exercises counted in reps;
 * «планка 60 сек», «бег 5,2 км · 26:30 (5:06/км)» for time and distance.
 */
function workoutWhat(workout: ReplyWorkout, locale: NotifyLocale): string {
  if (isDistanceExercise(workout.exerciseType)) {
    const value = formatWorkoutValue({ ...workout, durationSeconds: workout.durationSeconds ?? null }, locale);
    return `${exerciseName(workout.exerciseType, locale)} ${value}`;
  }
  const forms = bot(locale).counted[workout.exerciseType];
  if (forms && getExercise(workout.exerciseType).unit === 'reps') {
    const load = workout.loadKg != null ? ` × ${workout.loadKg} ${locale === 'en' ? 'kg' : 'кг'}` : '';
    return `${workout.reps} ${forms[pluralIndex(workout.reps, locale)]}${load}`;
  }
  return `${exerciseName(workout.exerciseType, locale)} ${formatNotifyValue(workout.reps, workout.exerciseType, locale, workout.loadKg)}`;
}

function goalLine(locale: NotifyLocale, goal: ReplyGoal): string | null {
  if (!goal || !(goal.goal > 0)) return null;
  const values = { done: formatGoalPoints(goal.done, locale), goal: formatGoalPoints(goal.goal, locale) };
  return fillTelegramText(goal.done >= goal.goal ? bot(locale).goalReached : bot(locale).goalLine, values);
}

/** «Записал: 30 отжиманий (+30 баллов).\nЦель дня: 80/100». */
export function workoutRecordedReply(locale: NotifyLocale, workout: ReplyWorkout, goal: ReplyGoal): string {
  const points = replyPoints([workout]);
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
  const points = replyPoints(workouts);
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
