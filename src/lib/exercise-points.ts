export type ExercisePointType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';

export const EXERCISE_POINT_FACTORS: Record<ExercisePointType, number> = {
  pushups: 1,
  pullups: 3,
  squats: 0.7,
  crunches: 0.5,
  plank: 0.1,
};

export function toExercisePointType(value?: string | null): ExercisePointType {
  if (value === 'pullups' || value === 'crunches' || value === 'squats' || value === 'plank') return value;
  return 'pushups';
}

export function calculateExercisePoints(
  value: number,
  exerciseType?: string | null,
): number {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue) || safeValue <= 0) return 0;
  const normalizedType = toExercisePointType(exerciseType);
  return tenthsToPoints(pointsToTenths(safeValue * EXERCISE_POINT_FACTORS[normalizedType]));
}

export function pointsToTenths(points: number): number {
  return Math.round(Number(points) * 10);
}

export function tenthsToPoints(tenths: number): number {
  return tenths / 10;
}
