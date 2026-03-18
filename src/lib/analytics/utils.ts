import { calculateExercisePoints } from '@/lib/exercise-points';
import type {
  ExerciseFilter,
  ExerciseType,
  NormalizedWorkout,
  WorkoutRecord,
} from '@/lib/analytics/types';

export function createZeroByExercise<T>(factory: () => T): Record<ExerciseType, T> {
  return {
    pushups: factory(),
    pullups: factory(),
    crunches: factory(),
    squats: factory(),
    plank: factory(),
  };
}

export function toExerciseType(value?: string | null): ExerciseType {
  if (value === 'pullups' || value === 'crunches' || value === 'squats' || value === 'plank') return value;
  return 'pushups';
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function normalizeDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDayLabel(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function getWorkoutTimestamp(workout: WorkoutRecord): Date {
  return new Date(workout.time || workout.date);
}

export function toLoadPoints(reps: number, exerciseType: ExerciseType): number {
  return calculateExercisePoints(reps, exerciseType);
}

export function normalizeWorkouts(workouts: WorkoutRecord[]): NormalizedWorkout[] {
  return workouts
    .map((workout) => {
      const exerciseType = toExerciseType(workout.exerciseType);
      const reps = Number(workout.reps) || 0;
      const date = startOfDay(new Date(workout.date));
      const performedAt = getWorkoutTimestamp(workout);
      return {
        id: workout.id,
        reps,
        exerciseType,
        date,
        performedAt,
        trainingSessionId: workout.trainingSessionId ?? null,
        load: toLoadPoints(reps, exerciseType),
      };
    })
    .filter((workout) => Number.isFinite(workout.reps) && workout.reps > 0 && !Number.isNaN(workout.performedAt.getTime()))
    .sort((left, right) => left.performedAt.getTime() - right.performedAt.getTime());
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

export function getMetricForWorkout(workout: NormalizedWorkout, filter: ExerciseFilter): number {
  return filter === 'all' ? workout.load : workout.reps;
}

export function getMetricKind(filter: ExerciseFilter): 'load' | 'exercise' {
  return filter === 'all' ? 'load' : 'exercise';
}

export function sampleStandardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = average(values);
  if (mean == null) return null;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function fillTemplate(
  template: string,
  params: Record<string, string | number>,
): string {
  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
