import { isTimedExercise } from '@/lib/exercises';

export { isTimedExercise };

export function exerciseValueLabel(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'Секунды' : 'Повторы';
}

export function exerciseValuePlural(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'секунд' : 'повторений';
}

export function exerciseValueShort(exerciseType?: string | null): string {
  return isTimedExercise(exerciseType) ? 'сек' : '';
}

export function formatExerciseValue(
  value: number | string | null | undefined,
  exerciseType?: string | null,
  withUnit = false,
): string {
  if (value == null || value === '') return '—';
  if (!withUnit || !isTimedExercise(exerciseType)) return String(value);
  return `${value} ${exerciseValueShort(exerciseType)}`;
}

type WorkoutValueFields = {
  reps: number;
  exerciseType?: string | null;
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
