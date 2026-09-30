import type { ExerciseType, PeriodKey } from '@/lib/analytics/types';
import { EXERCISE_POINT_FACTORS } from '@/lib/exercise-points';
import { EXERCISE_ORDER as CATALOG_ORDER, createByExercise, EXERCISES } from '@/lib/exercises';

export const EXERCISE_ORDER: readonly ExerciseType[] = CATALOG_ORDER;

export const EXERCISE_LOAD_FACTORS: Record<ExerciseType, number> = EXERCISE_POINT_FACTORS;

export const EXERCISE_COLORS: Record<ExerciseType, string> = createByExercise((type) => EXERCISES[type].colors.chart);

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: '7d', label: '7 дней', days: 7 },
  { key: '30d', label: '30 дней', days: 30 },
  { key: '90d', label: '90 дней', days: 90 },
  { key: 'all', label: 'Всё время', days: null },
];
