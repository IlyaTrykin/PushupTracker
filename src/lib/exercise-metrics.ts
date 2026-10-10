import { isDistanceExercise, isTimedExercise } from '@/lib/exercises';

export { isDistanceExercise, isTimedExercise };

function decimal(value: number, digits: number, locale: string): string {
  const text = String(Math.round(value * 10 ** digits) / 10 ** digits);
  return locale === 'en' ? text : text.replace('.', ',');
}

/** Metres → «5,2 км» / «5.2 km» (up to 2 decimals, trailing zeros dropped). */
export function formatDistance(meters: number, locale: string = 'ru'): string {
  return `${decimal(Number(meters) / 1000, 2, locale)} ${locale === 'en' ? 'km' : 'км'}`;
}

/** Seconds → «26:30», or «1:02:05» from an hour. */
export function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(Number(totalSeconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${ss}` : `${minutes}:${ss}`;
}

/** Pace for running/rowing: «5:06/км». */
export function formatPace(meters: number, seconds: number, locale: string = 'ru'): string {
  const perKm = Math.round(Number(seconds) / (Number(meters) / 1000));
  return `${formatDuration(perKm)}/${locale === 'en' ? 'km' : 'км'}`;
}

/** Speed for cycling: «19,5 км/ч». */
export function formatSpeed(meters: number, seconds: number, locale: string = 'ru'): string {
  const kmh = Number(meters) / 1000 / (Number(seconds) / 3600);
  return `${decimal(kmh, 1, locale)} ${locale === 'en' ? 'km/h' : 'км/ч'}`;
}

export function exerciseValueLabel(exerciseType?: string | null): string {
  if (isDistanceExercise(exerciseType)) return 'Дистанция';
  return isTimedExercise(exerciseType) ? 'Секунды' : 'Повторы';
}

export function exerciseValuePlural(exerciseType?: string | null): string {
  if (isDistanceExercise(exerciseType)) return 'км';
  return isTimedExercise(exerciseType) ? 'секунд' : 'повторений';
}

export function exerciseValueShort(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'сек' : '';
}

export function formatExerciseValue(
  value: number | string | null | undefined,
  exerciseType?: string | null,
  withUnit = false,
  locale: string = 'ru',
): string {
  if (value == null || value === '') return '—';
  if (withUnit && isDistanceExercise(exerciseType)) return formatDistance(Number(value), locale);
  if (!withUnit || !isTimedExercise(exerciseType)) return String(value);
  return `${value} ${exerciseValueShort(exerciseType)}`;
}

type WorkoutValueFields = {
  reps: number;
  exerciseType?: string | null;
  durationSeconds?: number | null;
  loadKg?: number | null;
  repsLeft?: number | null;
  repsRight?: number | null;
};

// Раскладка по рукам («Л 5 / П 6») или пустая строка, если её нет.
export function formatWorkoutSides(workout: WorkoutValueFields, locale: string = 'ru'): string {
  if (workout.repsLeft == null && workout.repsRight == null) return '';
  const left = workout.repsLeft ?? 0;
  const right = workout.repsRight ?? 0;
  return locale === 'en' ? `L ${left} / R ${right}` : `Л ${left} / П ${right}`;
}

// Значение подхода для детализации: итог, вес снаряда и (если withSides) раскладка
// по рукам. В сводной статистике используется только итог (reps).
export function formatWorkoutValue(workout: WorkoutValueFields, locale: string = 'ru', withSides = true): string {
  if (isDistanceExercise(workout.exerciseType)) {
    let line = formatDistance(workout.reps, locale);
    const seconds = workout.durationSeconds;
    if (seconds && seconds > 0 && workout.reps > 0) {
      const rate = workout.exerciseType === 'bike' ? formatSpeed(workout.reps, seconds, locale) : formatPace(workout.reps, seconds, locale);
      line += ` · ${formatDuration(seconds)} (${rate})`;
    }
    return line;
  }
  let out = formatExerciseValue(workout.reps, workout.exerciseType, true);
  if (workout.loadKg != null) out += ` × ${workout.loadKg} ${locale === 'en' ? 'kg' : 'кг'}`;
  const sides = withSides ? formatWorkoutSides(workout, locale) : '';
  return sides ? `${out} (${sides})` : out;
}

export function challengeMostLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Кто дольше за период' : 'Кто больше за период';
}

export function challengeTargetPromptLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Цель (N секунд)' : 'Цель (N повторов)';
}

export function challengeTargetLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Цель (секунды)' : 'Цель (повторы)';
}

export function challengeDailyMinLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Минимум секунд в день (X)' : 'Минимум повторов в день (X)';
}

export function challengeSetsModeLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Зачтённые подходы (секунды ≥ X)' : 'Зачтённые подходы (reps ≥ X)';
}

export function challengeSetsMinLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Минимум секунд для зачёта подхода (X)' : 'Минимум повторов для зачёта подхода (X)';
}

export function challengeQualifiedValueLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Секунды (зачт.)' : 'Повторы (зачт.)';
}

export function programBaselinePromptLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? '2) Базовое удержание (сек)' : '2) Базовый тест (AMRAP)';
}

export function programTargetPromptLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? '3) Целевое время удержания в секундах' : '3) Целевое значение повторений в одном подходе';
}
