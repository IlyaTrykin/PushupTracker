export function isTimedExercise(exerciseType?: string | null): boolean {
  return exerciseType === 'plank';
}

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
