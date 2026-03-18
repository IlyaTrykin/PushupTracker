export type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';

const EXERCISE_TYPE_KEY = 'exerciseType';

export function isExerciseType(value: unknown): value is ExerciseType {
  return value === 'pushups' || value === 'pullups' || value === 'crunches' || value === 'squats' || value === 'plank';
}

export function getStoredExerciseType(): ExerciseType {
  if (typeof window === 'undefined') return 'pushups';
  try {
    const saved = window.localStorage.getItem(EXERCISE_TYPE_KEY);
    if (isExerciseType(saved)) return saved;
  } catch {}
  return 'pushups';
}

export function subscribeExerciseType(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};

  const handleCustomChange = () => onStoreChange();
  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === EXERCISE_TYPE_KEY) onStoreChange();
  };

  window.addEventListener('exerciseTypeChanged', handleCustomChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener('exerciseTypeChanged', handleCustomChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export function persistExerciseType(next: ExerciseType) {
  try {
    window.localStorage.setItem(EXERCISE_TYPE_KEY, next);
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent('exerciseTypeChanged', { detail: { exerciseType: next } }));
  } catch {}
}
