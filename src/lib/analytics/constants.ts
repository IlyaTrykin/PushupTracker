import type { ExerciseType, PeriodKey } from '@/lib/analytics/types';

export const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats', 'plank'];

export const EXERCISE_LOAD_FACTORS: Record<ExerciseType, number> = {
  pushups: 1,
  pullups: 3,
  squats: 0.7,
  crunches: 0.5,
  plank: 0.1,
};

export const EXERCISE_COLORS: Record<ExerciseType, string> = {
  pushups: '#0f766e',
  pullups: '#d9485f',
  crunches: '#2563eb',
  squats: '#c27c1a',
  plank: '#7c3aed',
};

export const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: '7d', label: '7 дней', days: 7 },
  { key: '30d', label: '30 дней', days: 30 },
  { key: '90d', label: '90 дней', days: 90 },
  { key: 'all', label: 'Всё время', days: null },
];
